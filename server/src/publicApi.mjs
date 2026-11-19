// Public, key-authenticated model API at /api/v1 (server-to-server; no cookies, no browser CORS).
//   GET    /api/v1/models               model list (OpenAI shape)
//   POST   /api/v1/chat/completions     one read; stream:false (default for keys) returns chat.completion JSON
//   POST   /api/v1/reads                asynchronous read → 202 { id, status, poll_url }
//   GET    /api/v1/reads/{id}           status and result (keys of the same organisation record only)
//   DELETE /api/v1/reads/{id}           cancel a queued or running read
// Reads are scoped by organisation_id, never by organisation name: names are labels an administrator types and
// may repeat. Idempotency keys are scoped to the API key that used them.
// Reads spend the Space owner's ZeroGPU quota, so each key has a daily cap (refunded, at most once per read and
// only to the UTC day it was counted on, when a read never reached the GPU). API reads are NEVER captured for model training: this module does not use
// trainingCapture, and a key's data_agreement_id is stored only for a possible future opt-in.
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { checkWebhookUrl, deliverWebhook } from './webhook.mjs'
import { webhookSecretFor, webhooksConfigured } from './apiKeys.mjs'

export const API_MODEL = 'skanda-v1'
// The model service (deploy/huggingface/space_app.py) caps max_tokens at 1536; refuse larger values here rather than
// let them be cut silently upstream.
export const MAX_TOKENS = 1536
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IDEMPOTENCY = /^[\x21-\x7e]{1,255}$/
// Vercel's maxDuration is 300 s. An async read gets 230 s (the Space itself cancels at 180 s), leaving time for the webhook.
const JOB_BUDGET_MS = 290_000
const ASYNC_READ_MS = 230_000
const CANCEL_POLL_MS = 5_000
const ROLES = new Set(['system', 'user', 'assistant'])

const ERROR_TYPES = { 400: 'invalid_request_error', 401: 'authentication_error', 403: 'permission_error', 404: 'invalid_request_error', 405: 'invalid_request_error', 409: 'invalid_request_error', 413: 'invalid_request_error', 422: 'invalid_request_error', 429: 'rate_limit_error' }
export const errorBody = (status, message, code) => ({ error: { message, type: ERROR_TYPES[status] || 'api_error', code } })

/** Validate an OpenAI-style read body. Returns { payload } (what is sent upstream) or { status, code, message }. */
export function validateRead(data, { allowWebhook = false } = {}) {
  if (data.model === undefined) return { status: 400, code: 'missing_model', message: `Set "model": "${API_MODEL}".` }
  if (data.model !== API_MODEL) return { status: 404, code: 'model_not_found', message: `Unknown model. This API serves "${API_MODEL}".` }
  if (!Array.isArray(data.messages) || !data.messages.length || data.messages.length > 64) return { status: 400, code: 'invalid_messages', message: '"messages" must be an array of 1 to 64 messages.' }
  for (const message of data.messages) {
    if (!message || typeof message !== 'object' || !ROLES.has(message.role) || !(typeof message.content === 'string' || Array.isArray(message.content))) return { status: 400, code: 'invalid_messages', message: 'Each message needs a role (system, user or assistant) and string or array content.' }
  }
  if (data.stream !== undefined && typeof data.stream !== 'boolean') return { status: 400, code: 'invalid_stream', message: '"stream" must be true or false.' }
  if (data.max_tokens !== undefined && !(Number.isInteger(data.max_tokens) && data.max_tokens > 0 && data.max_tokens <= MAX_TOKENS)) return { status: 400, code: 'invalid_max_tokens', message: `"max_tokens" must be a whole number from 1 to ${MAX_TOKENS}.` }
  if (data.temperature !== undefined && !(typeof data.temperature === 'number' && data.temperature >= 0 && data.temperature <= 2)) return { status: 400, code: 'invalid_temperature', message: '"temperature" must be a number from 0 to 2.' }
  if (!allowWebhook && data.webhook_url !== undefined) return { status: 400, code: 'unsupported_parameter', message: '"webhook_url" is accepted only by POST /api/v1/reads.' }
  const { webhook_url: _webhook, ...rest } = data
  // The Space always answers as SSE; this server buffers it when the client asked for stream:false.
  return { payload: { ...rest, stream: true }, stream: data.stream === true }
}

/** Copy of a stored request without image data: image parts lose their URL and unknown top-level fields are dropped. */
export function redactRequest(request) {
  if (!request || typeof request !== 'object') return null
  const messages = Array.isArray(request.messages) ? request.messages.map(message => ({
    role: message?.role,
    content: Array.isArray(message?.content)
      ? message.content.map(part => part?.type === 'text' ? { type: 'text', text: typeof part.text === 'string' ? part.text.slice(0, 20000) : '' } : { type: typeof part?.type === 'string' ? part.type : 'unknown', removed: true })
      : typeof message?.content === 'string' ? message.content.slice(0, 20000) : null,
  })) : []
  const kept = { model: request.model, messages }
  for (const field of ['max_tokens', 'temperature']) if (typeof request[field] === 'number') kept[field] = request[field]
  const removed = Object.keys(request).filter(field => !['model', 'messages', 'max_tokens', 'temperature', 'stream'].includes(field))
  if (removed.length) kept.removed_fields = removed
  return kept
}

const parseReport = content => { try { const value = JSON.parse(content); return value && typeof value === 'object' ? value : null } catch { return null } }
export const keyPseudonym = (keyId, secret) => 'k-' + createHmac('sha256', secret).update(`voxelrad-key:${keyId}`).digest('hex').slice(0, 16)

const READ_COLUMNS = 'r.id,r.key_id,r.status,r.request_hash,r.result,r.error,r.webhook_url,r.created_at,r.started_at,r.finished_at,r.expires_at'
// Every read is over (finished, failed or cut off) well inside 300 s of submission; one still queued or running after
// STALE belongs to a function that died, and must not keep its image data.
const STALE = "interval '10 minutes'"
const SWEEP_LIMIT = 20
const INTERRUPTED = JSON.stringify({ message: 'The read was interrupted before it finished. No findings were generated. Submit it again.', type: 'api_error', code: 'interrupted' })
const ORG_READ = 'FROM api_reads r JOIN api_keys k ON k.id=r.key_id WHERE r.id=$1 AND k.organisation_id=$2 AND r.expires_at>now()'

/** SQL persistence for asynchronous reads. Reads are visible to every key of the same organisation record. */
export function createReadStore(pool) {
  return {
    async findIdempotent(keyId, idempotencyKey) {
      await pool.query('DELETE FROM api_reads WHERE key_id=$1 AND idempotency_key=$2 AND expires_at<=now()', [keyId, idempotencyKey])
      return (await pool.query(`SELECT ${READ_COLUMNS} FROM api_reads r WHERE r.key_id=$1 AND r.idempotency_key=$2`, [keyId, idempotencyKey])).rows[0] || null
    },
    /** Null when the idempotency key was taken concurrently. `quotaResetsAt` is the counted day (see refund). */
    async insert({ id, keyId, request, requestHash, idempotencyKey, webhookUrl, quotaResetsAt }) {
      const result = await pool.query(`INSERT INTO api_reads(id,key_id,status,request,request_hash,idempotency_key,webhook_url,quota_resets_at) VALUES ($1,$2,'queued',$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING ${READ_COLUMNS.replace(/r\./g, '')}`, [id, keyId, JSON.stringify(request), requestHash, idempotencyKey, webhookUrl, quotaResetsAt])
      return result.rows[0] || null
    },
    async start(id) { return (await pool.query("UPDATE api_reads SET status='running',started_at=now() WHERE id=$1 AND status='queued'", [id])).rowCount === 1 },
    async status(id) { return (await pool.query('SELECT status FROM api_reads WHERE id=$1', [id])).rows[0]?.status ?? null },
    /** Only a queued or running read can finish (queued when starting it failed); a cancelled one keeps its status. */
    async finish(id, { status, result, error, request }) {
      const updated = await pool.query("UPDATE api_reads SET status=$2,result=$3,error=$4,request=$5,finished_at=now() WHERE id=$1 AND status IN ('queued','running') RETURNING id", [id, status, result ? JSON.stringify(result) : null, error ? JSON.stringify(error) : null, JSON.stringify(request)])
      return updated.rowCount === 1
    },
    /** Mark one unfinished read interrupted and drop its request (image data included). */
    async abandon(id) { await pool.query("UPDATE api_reads SET status='failed',error=$2,request=NULL,finished_at=now() WHERE id=$1 AND status IN ('queued','running')", [id, INTERRUPTED]) },
    /**
     * Claim the refund for a read. Returns the end of the UTC day it was counted on the first time, and null after
     * that (or for a read that was never counted), so concurrent or repeated refund paths refund once.
     */
    async markRefunded(id) {
      return (await pool.query('UPDATE api_reads SET refunded_at=now() WHERE id=$1 AND refunded_at IS NULL AND quota_resets_at IS NOT NULL RETURNING quota_resets_at', [id])).rows[0]?.quota_resets_at ?? null
    },
    async get(id, organisationId) {
      // A read whose function died mid-way can never finish; report it as failed rather than running forever.
      await pool.query(`UPDATE api_reads SET status='failed',error=$2,request=NULL,finished_at=now() WHERE id=$1 AND status IN ('queued','running') AND created_at<now()-${STALE}`, [id, INTERRUPTED])
      return (await pool.query(`SELECT ${READ_COLUMNS} ${ORG_READ}`, [id, organisationId])).rows[0] || null
    },
    /** Returns { row, was } where `was` is the status before cancelling, or { row } unchanged when it had already finished. */
    async cancel(id, organisationId) {
      const result = await pool.query(`WITH prev AS (SELECT r.id,r.status ${ORG_READ} AND r.status IN ('queued','running') FOR UPDATE OF r) UPDATE api_reads r SET status='cancelled',finished_at=now() FROM prev WHERE r.id=prev.id RETURNING prev.status AS was,r.request,${READ_COLUMNS}`, [id, organisationId])
      if (result.rows[0]) {
        const { was, request, ...row } = result.rows[0]
        await pool.query('UPDATE api_reads SET request=$2 WHERE id=$1', [id, JSON.stringify(redactRequest(request))])
        return { row, was }
      }
      const row = await this.get(id, organisationId)
      return row ? { row } : null
    },
    /**
     * Fail reads left queued or running past STALE and drop their image data. One UPDATE over the partial
     * api_reads_active_idx index, at most SWEEP_LIMIT rows, cheap enough to run on every /api/v1 request.
     */
    async sweep() {
      await pool.query(`UPDATE api_reads SET status='failed',error=$1,request=NULL,finished_at=now() WHERE id IN (SELECT id FROM api_reads WHERE status IN ('queued','running') AND created_at<now()-${STALE} ORDER BY created_at LIMIT ${SWEEP_LIMIT} FOR UPDATE SKIP LOCKED)`, [INTERRUPTED])
    },
    async cleanup() {
      await pool.query(`UPDATE api_reads SET status='failed',error=$1,request=NULL,finished_at=now() WHERE status IN ('queued','running') AND created_at<now()-${STALE}`, [INTERRUPTED])
      await pool.query('DELETE FROM api_reads WHERE expires_at<now()')
    },
  }
}

/**
 * `modelProxy` supplies the upstream bridge and the daily counters; `apiKeys.authenticate` resolves the Bearer key.
 * `schedule(promise)` keeps an async read alive after the 202 response (Vercel waitUntil, or in-process).
 */
export function createPublicApi({ readStore, env = process.env, body, send, modelProxy, apiKeys, publicOrigin, schedule = task => { task.catch(() => {}) }, resolve, deliver = deliverWebhook, now = Date.now, timeouts = {} }) {
  const readLimitMs = timeouts.asyncRead ?? ASYNC_READ_MS
  const jobBudgetMs = timeouts.job ?? JOB_BUDGET_MS
  const cancelPollMs = timeouts.cancelPoll ?? CANCEL_POLL_MS
  const fail = (res, status, message, code, headers = {}) => send(res, status, errorBody(status, message, code), headers)
  const bucket = keyId => `api-reads:${keyId}`
  const pseudonym = keyId => keyPseudonym(keyId, env.BRIDGE_SECRET || '')
  const keyHeaders = (key, reservation) => ({ 'X-VoxelRad-Key-Kind': key.kind, ...(reservation ? { 'X-VoxelRad-Reads-Left': String(Math.max(0, key.dailyReadLimit - reservation.count)) } : {}) })
  const pollUrl = id => `${publicOrigin}/api/v1/reads/${id}`

  const iso = value => value ? new Date(value).toISOString() : null
  const readView = row => ({ id: row.id, object: 'read', status: row.status, model: API_MODEL, created_at: iso(row.created_at), started_at: iso(row.started_at), finished_at: iso(row.finished_at), expires_at: iso(row.expires_at), poll_url: pollUrl(row.id), result: row.result ?? null, error: row.error ?? null })

  /** Count one read against the key. Returns { reservation } or sends 429/503 and returns null. */
  async function reserve(res, key) {
    if (modelProxy.limit === 0) { fail(res, 503, 'Hosted model reads are turned off on this site.', 'reads_disabled', keyHeaders(key)); return null }
    const reservation = await modelProxy.reserve(bucket(key.id))
    if (reservation.count > key.dailyReadLimit) {
      await modelProxy.refund(reservation.key, reservation.resetsAt)
      await apiKeys.auditDenied(key.id, 'limit')
      fail(res, 429, `Daily limit reached: ${key.dailyReadLimit} reads per day for this ${key.kind} key. The limit resets at 00:00 UTC.`, 'daily_limit_reached', { ...keyHeaders(key), 'Retry-After': String(modelProxy.retryAfter(reservation.resetsAt)) })
      return null
    }
    return reservation
  }
  /** Refund an async read's count to the day it was counted on, at most once however many paths ask. Never throws. */
  async function refundRead(readId, keyId) {
    try {
      const resetsAt = await readStore.markRefunded(readId)
      if (resetsAt) await modelProxy.refund(modelProxy.bucketKey(bucket(keyId)), new Date(resetsAt))
    } catch { /* a lost refund only over-counts one read */ }
  }

  async function models(res, key) {
    const result = await modelProxy.fetchModels('/v1/models', pseudonym(key.id))
    if (!result.json) return fail(res, result.status, result.error, result.code || 'model_unavailable', keyHeaders(key))
    const ids = Array.isArray(result.json.data) ? result.json.data.map(model => model?.id).filter(id => typeof id === 'string') : []
    return send(res, 200, { object: 'list', data: ids.map(id => ({ id, object: 'model', owned_by: 'voxelrad' })) }, keyHeaders(key))
  }

  async function chat(req, res, key) {
    const checked = validateRead(await body(req, modelProxy.readBodyLimit))
    if (!checked.payload) return fail(res, checked.status, checked.message, checked.code, keyHeaders(key))
    // OpenAI's default is stream:false, so a key gets one JSON body unless it asks for "stream": true.
    const wantsStream = checked.stream
    const reservation = await reserve(res, key)
    if (!reservation) return
    const ac = new AbortController()
    let finished = false
    res.on('close', () => { if (!finished) ac.abort() })
    try {
      const opened = await modelProxy.openRead(checked.payload, pseudonym(key.id), ac)
      if (opened.failure) {
        await modelProxy.refund(reservation.key, reservation.resetsAt)
        if (res.destroyed || res.writableEnded) return
        return fail(res, opened.failure.status, opened.failure.error, opened.failure.code, keyHeaders(key, reservation))
      }
      if (wantsStream) return await modelProxy.pipeStream(res, opened.upstream, ac, keyHeaders(key, reservation))
      const outcome = await modelProxy.bufferRead(opened.upstream, ac)
      if (!outcome.ok) {
        if (outcome.refund) await modelProxy.refund(reservation.key, reservation.resetsAt)
        if (res.destroyed || res.writableEnded) return
        return fail(res, outcome.status, outcome.message, outcome.code, keyHeaders(key, reservation))
      }
      return send(res, 200, {
        id: outcome.id || `chatcmpl-${randomUUID().replace(/-/g, '')}`, object: 'chat.completion', created: Math.floor(now() / 1000), model: API_MODEL,
        choices: [{ index: 0, message: { role: 'assistant', content: outcome.content }, finish_reason: outcome.finish ?? null }],
        ...(outcome.usage ? { usage: outcome.usage } : {}),
      }, keyHeaders(key, reservation))
    } finally { finished = true }
  }

  /** Run one async read to completion, then deliver its webhook. Never throws. */
  async function execute(row, key, payload, startedAt) {
    const deadline = startedAt + jobBudgetMs
    let outcome
    try {
      if (!await readStore.start(row.id)) return // cancelled while queued (that path refunds)
      const ac = new AbortController()
      const poll = setInterval(() => { readStore.status(row.id).then(status => { if (status === 'cancelled') ac.abort(new Error('cancelled')) }).catch(() => {}) }, cancelPollMs)
      try {
        const opened = await modelProxy.openRead(payload, pseudonym(key.id), ac)
        if (opened.failure) outcome = { ok: false, status: opened.failure.status, code: opened.failure.code, message: opened.failure.error, refund: true }
        else outcome = await modelProxy.bufferRead(opened.upstream, ac, Math.min(readLimitMs, Math.max(1000, deadline - now() - 30_000)))
      } finally { clearInterval(poll) }
    } catch {
      outcome = { ok: false, status: 503, code: 'internal_error', message: 'The read could not be completed. No findings were generated.', refund: true }
    }
    if (!outcome.ok && outcome.refund) await refundRead(row.id, row.key_id)
    const status = outcome.ok ? 'succeeded' : 'failed'
    const result = outcome.ok ? { content: outcome.content, report: parseReport(outcome.content), finish_reason: outcome.finish ?? null, model: API_MODEL, ...(outcome.usage ? { usage: outcome.usage } : {}) } : null
    const error = outcome.ok ? null : errorBody(outcome.status, outcome.message, outcome.code).error
    try {
      if (!await readStore.finish(row.id, { status, result, error, request: redactRequest(payload) })) return // cancelled
    } catch {
      // The outcome could not be stored. Do not leave the image data behind until the stale sweep: fail the read now.
      await readStore.abandon(row.id).catch(() => {})
      return
    }
    try {
      if (row.webhook_url && key.webhooks) {
        const secret = webhookSecretFor(key.id, env)
        if (secret) await deliver({ url: row.webhook_url, payload: outcome.ok ? { id: row.id, status, result } : { id: row.id, status, error }, secret, deadline, now })
      }
    } catch { /* delivery results are not stored; the client can poll */ }
  }

  async function submit(req, res, key) {
    const startedAt = now()
    const data = await body(req, modelProxy.readBodyLimit)
    const checked = validateRead(data, { allowWebhook: true })
    if (!checked.payload) return fail(res, checked.status, checked.message, checked.code, keyHeaders(key))
    let webhookUrl = null
    if (data.webhook_url !== undefined && data.webhook_url !== null) {
      if (!webhooksConfigured(env)) return fail(res, 400, 'Webhooks are not configured on this server. Poll the read instead.', 'webhooks_not_configured', keyHeaders(key))
      // A key issued before webhooks were enabled was never shown a signing secret, so it could not verify deliveries.
      if (!key.webhooks) return fail(res, 400, 'This API key was issued without a webhook signing secret. Poll the read, or ask your VoxelRad administrator for a new key.', 'webhooks_not_configured', keyHeaders(key))
      const webhook = await checkWebhookUrl(data.webhook_url, resolve ? { resolve } : {})
      if (webhook.error) return fail(res, 400, webhook.error, 'invalid_webhook_url', keyHeaders(key))
      webhookUrl = webhook.url
    }
    const idempotencyKey = req.headers['idempotency-key'] ?? null
    if (idempotencyKey !== null && (typeof idempotencyKey !== 'string' || !IDEMPOTENCY.test(idempotencyKey))) return fail(res, 400, 'Idempotency-Key must be 1 to 255 visible ASCII characters.', 'invalid_idempotency_key', keyHeaders(key))
    const requestHash = createHash('sha256').update(JSON.stringify(data)).digest('hex')
    const replay = async existing => existing.request_hash !== requestHash
      ? fail(res, 422, 'This Idempotency-Key was already used with a different request body in the last 24 hours.', 'idempotency_conflict', keyHeaders(key))
      : send(res, 200, readView(existing), { ...keyHeaders(key), 'Idempotent-Replayed': 'true' })
    if (idempotencyKey) {
      const existing = await readStore.findIdempotent(key.id, idempotencyKey)
      if (existing) return replay(existing)
    }
    // Counted at submission; refunded if the read never reaches the GPU or is cancelled while queued.
    const reservation = await reserve(res, key)
    if (!reservation) return
    let row
    try { row = await readStore.insert({ id: randomUUID(), keyId: key.id, request: checked.payload, requestHash, idempotencyKey, webhookUrl, quotaResetsAt: reservation.resetsAt }) }
    catch (error) { await modelProxy.refund(reservation.key, reservation.resetsAt); throw error }
    if (!row) {
      await modelProxy.refund(reservation.key, reservation.resetsAt)
      const existing = await readStore.findIdempotent(key.id, idempotencyKey)
      return existing ? replay(existing) : fail(res, 409, 'A read with this Idempotency-Key is being created. Retry.', 'idempotency_conflict', keyHeaders(key))
    }
    send(res, 202, readView(row), { ...keyHeaders(key, reservation), Location: pollUrl(row.id) })
    schedule(execute(row, key, checked.payload, startedAt))
  }

  async function readRoute(req, res, key, id) {
    if (!UUID.test(id)) return fail(res, 404, 'Read not found.', 'not_found', keyHeaders(key))
    if (req.method === 'GET') {
      const row = await readStore.get(id, key.organisationId)
      return row ? send(res, 200, readView(row), keyHeaders(key)) : fail(res, 404, 'Read not found.', 'not_found', keyHeaders(key))
    }
    if (req.method === 'DELETE') {
      const cancelled = await readStore.cancel(id, key.organisationId)
      if (!cancelled) return fail(res, 404, 'Read not found.', 'not_found', keyHeaders(key))
      if (!cancelled.was) return fail(res, 409, `The read has already ${cancelled.row.status === 'cancelled' ? 'been cancelled' : 'finished'}.`, 'read_not_cancellable', keyHeaders(key))
      // A queued read never reached the GPU, so it is refunded to the key that submitted it. A running one may have.
      if (cancelled.was === 'queued') await refundRead(cancelled.row.id, cancelled.row.key_id)
      return send(res, 200, readView(cancelled.row), keyHeaders(key))
    }
    return fail(res, 405, 'Method not allowed.', 'method_not_allowed', { ...keyHeaders(key), Allow: 'GET, DELETE' })
  }

  return {
    cleanup: () => readStore.cleanup(),
    /** Answers every /api/v1/* request. Only a valid Bearer key is accepted; session cookies are ignored here. */
    async handle(req, res, path) {
      try {
        const auth = await apiKeys.authenticate(req)
        if (auth.error) return fail(res, auth.error.status, auth.error.message, auth.error.code, { 'WWW-Authenticate': 'Bearer' })
        const { key } = auth
        // Fail stuck reads (and drop their images) a few at a time on every authenticated request, beside the work.
        schedule(Promise.resolve().then(() => readStore.sweep()))
        if (!modelProxy.enabled) return fail(res, 503, 'The hosted model service is not configured on this server.', 'model_unavailable', keyHeaders(key))
        if (path === '/api/v1/models') return req.method === 'GET' ? await models(res, key) : fail(res, 405, 'Method not allowed.', 'method_not_allowed', { ...keyHeaders(key), Allow: 'GET' })
        if (path === '/api/v1/chat/completions') return req.method === 'POST' ? await chat(req, res, key) : fail(res, 405, 'Method not allowed.', 'method_not_allowed', { ...keyHeaders(key), Allow: 'POST' })
        if (path === '/api/v1/reads') return req.method === 'POST' ? await submit(req, res, key) : fail(res, 405, 'Method not allowed.', 'method_not_allowed', { ...keyHeaders(key), Allow: 'POST' })
        const read = path.match(/^\/api\/v1\/reads\/([^/]+)$/)
        if (read) return await readRoute(req, res, key, read[1])
        return fail(res, 404, 'Endpoint not found.', 'not_found', keyHeaders(key))
      } catch (error) {
        if (res.headersSent) { if (!res.writableEnded) res.end(); return }
        if (error.status === 413 || error.statusCode === 413) return fail(res, 413, 'Request exceeds the allowed size.', 'request_too_large')
        if (error.status === 400 || error.statusCode === 400) return fail(res, 400, 'Request must contain a JSON object.', 'invalid_json')
        return fail(res, 503, 'Service unavailable. Please retry.', 'internal_error')
      }
    },
  }
}
