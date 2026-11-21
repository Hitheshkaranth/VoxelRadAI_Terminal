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
import { hostname } from 'node:os'
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
// Heartbeats renew a 60 s lease every 5 s (and notice cancellation); a dead executor's read is recovered within ~1 min.
const CANCEL_POLL_MS = 5_000
const LEASE_SECONDS = 60
const intSetting = (value, fallback, min, max) => { const n = Number(value); return value !== undefined && value !== '' && Number.isInteger(n) && n >= min && n <= max ? n : fallback }

/**
 * Queue settings. READ_EXECUTION=inline (default) runs each async read in the process that accepted it (Vercel
 * waitUntil, or in-process); =worker leaves every read to `node src/worker.mjs` processes.
 */
export function queueSettings(env) {
  return {
    mode: env.READ_EXECUTION === 'worker' ? 'worker' : 'inline',
    // Queued reads beyond this are refused with 503 queue_full before anything is counted. 0 = no limit.
    queueLimit: intSetting(env.READ_QUEUE_LIMIT, 500, 0, 1_000_000),
    // A read waiting longer than this fails (refunded if it never started).
    queueTtlSeconds: intSetting(env.READ_QUEUE_TTL_SECONDS, 600, 60, 86_400),
    // Executions per read, counting a retry after its executor died.
    maxAttempts: intSetting(env.READ_MAX_ATTEMPTS, 2, 1, 5),
  }
}
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
// A read still running without a lease (written before the durable queue) after STALE belongs to a function that died.
const STALE = "interval '10 minutes'"
const SWEEP_LIMIT = 20
const INTERRUPTED = JSON.stringify({ message: 'The read was interrupted before it finished. No findings were generated. Submit it again.', type: 'api_error', code: 'interrupted' })
const QUEUE_TIMEOUT = JSON.stringify({ message: 'The read waited too long in the queue and was not started. No findings were generated and it was not counted. Submit it again.', type: 'api_error', code: 'queue_timeout' })
const ORG_READ = 'FROM api_reads r JOIN api_keys k ON k.id=r.key_id WHERE r.id=$1 AND k.organisation_id=$2 AND r.expires_at>now()'
const CLAIM_COLUMNS = 'r.id,r.key_id,r.request,r.webhook_url,r.created_at,r.attempts'
export const READ_CHANNEL = 'voxelrad_reads'

/**
 * SQL persistence for asynchronous reads, which doubles as the durable read queue. Reads are visible to every key
 * of the same organisation record. `lease` is { owner, seconds }: whoever holds a read renews it with heartbeat();
 * a read whose lease lapsed is returned to the queue by sweep() while it has attempts left.
 */
export function createReadStore(pool) {
  // Recover lapsed reads a bounded number at a time (FOR UPDATE SKIP LOCKED keeps concurrent sweeps apart).
  async function recover({ limit, maxAttempts, queueTtlSeconds }) {
    await pool.query(`UPDATE api_reads SET status='queued',lease_owner=NULL,lease_expires_at=NULL,available_at=now()+make_interval(secs=>LEAST(60,5*attempts)) WHERE id IN (SELECT id FROM api_reads WHERE status='running' AND lease_expires_at<now() AND attempts<$1 AND request IS NOT NULL AND expires_at>now() ORDER BY lease_expires_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)`, [maxAttempts])
    await pool.query(`UPDATE api_reads SET status='failed',error=$1,request=NULL,finished_at=now(),lease_expires_at=NULL WHERE id IN (SELECT id FROM api_reads WHERE status='running' AND (lease_expires_at<now() OR (lease_expires_at IS NULL AND COALESCE(started_at,created_at)<now()-${STALE})) ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)`, [INTERRUPTED])
    // Waited past the queue time limit. attempts=0 means it never reached a GPU, so the caller refunds it.
    const expired = await pool.query(`UPDATE api_reads SET status='failed',error=CASE WHEN attempts=0 THEN $1::jsonb ELSE $2::jsonb END,request=NULL,finished_at=now() WHERE id IN (SELECT id FROM api_reads WHERE status='queued' AND created_at<now()-make_interval(secs=>$3) ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED) RETURNING id,key_id,attempts`, [QUEUE_TIMEOUT, INTERRUPTED, queueTtlSeconds])
    return { expired: expired.rows.filter(row => row.attempts === 0).map(({ id, key_id }) => ({ id, key_id })) }
  }
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
    /** Wake read workers listening on READ_CHANNEL. */
    async notify() { await pool.query('SELECT pg_notify($1,$2)', [READ_CHANNEL, '']) },
    /** Take one specific queued read (the submitting process running its own read). */
    async start(id, lease) {
      return (await pool.query("UPDATE api_reads SET status='running',started_at=COALESCE(started_at,now()),attempts=attempts+1,lease_owner=$2,lease_expires_at=now()+make_interval(secs=>$3) WHERE id=$1 AND status='queued' AND available_at<=now()", [id, lease.owner, lease.seconds])).rowCount === 1
    },
    /** Take up to `limit` queued reads, oldest first. `retriesOnly` leaves fresh reads to the process that took them. */
    async claim(lease, limit, { retriesOnly = false } = {}) {
      const result = await pool.query(`WITH next AS (SELECT id FROM api_reads WHERE status='queued' AND available_at<=now() AND expires_at>now() ${retriesOnly ? 'AND attempts>0' : ''} ORDER BY available_at,created_at LIMIT $3 FOR UPDATE SKIP LOCKED), claimed AS (UPDATE api_reads r SET status='running',started_at=COALESCE(r.started_at,now()),attempts=r.attempts+1,lease_owner=$1,lease_expires_at=now()+make_interval(secs=>$2) FROM next WHERE r.id=next.id RETURNING ${CLAIM_COLUMNS}) SELECT c.*,k.webhook_secret_issued FROM claimed c JOIN api_keys k ON k.id=c.key_id`, [lease.owner, lease.seconds, limit])
      return result.rows
    },
    /** Renew the lease. 'running' while this executor still holds the read, else 'cancelled' or 'lost'. */
    async heartbeat(id, lease) {
      const result = await pool.query("WITH beat AS (UPDATE api_reads SET lease_expires_at=now()+make_interval(secs=>$3) WHERE id=$1 AND status='running' AND lease_owner=$2 RETURNING id) SELECT EXISTS (SELECT 1 FROM beat) AS held,(SELECT status FROM api_reads WHERE id=$1) AS status", [id, lease.owner, lease.seconds])
      const row = result.rows[0]
      return row?.held ? 'running' : row?.status === 'cancelled' ? 'cancelled' : 'lost'
    },
    /** Put a held read back on the queue without using an attempt (graceful worker shutdown). */
    async release(id, lease) {
      await pool.query("UPDATE api_reads SET status='queued',lease_owner=NULL,lease_expires_at=NULL,available_at=now(),attempts=GREATEST(attempts-1,0) WHERE id=$1 AND status='running' AND lease_owner=$2", [id, lease.owner])
    },
    async depth() {
      const row = (await pool.query("SELECT count(*) FILTER (WHERE status='queued')::int AS queued,count(*) FILTER (WHERE status='running')::int AS running FROM api_reads WHERE status IN ('queued','running')")).rows[0]
      return { queued: row?.queued ?? 0, running: row?.running ?? 0 }
    },
    /** Only a queued or running read can finish (queued when starting it failed), and only by the lease holder. */
    async finish(id, { status, result, error, request, owner = null }) {
      const updated = await pool.query("UPDATE api_reads SET status=$2,result=$3,error=$4,request=$5,finished_at=now(),lease_expires_at=NULL WHERE id=$1 AND status IN ('queued','running') AND (lease_owner IS NULL OR lease_owner=$6) RETURNING id", [id, status, result ? JSON.stringify(result) : null, error ? JSON.stringify(error) : null, JSON.stringify(request), owner])
      return updated.rowCount === 1
    },
    /** Mark one unfinished read interrupted and drop its request (image data included). */
    async abandon(id) { await pool.query("UPDATE api_reads SET status='failed',error=$2,request=NULL,finished_at=now(),lease_expires_at=NULL WHERE id=$1 AND status IN ('queued','running')", [id, INTERRUPTED]) },
    /**
     * Claim the refund for a read. Returns the end of the UTC day it was counted on the first time, and null after
     * that (or for a read that was never counted), so concurrent or repeated refund paths refund once.
     */
    async markRefunded(id) {
      return (await pool.query('UPDATE api_reads SET refunded_at=now() WHERE id=$1 AND refunded_at IS NULL AND quota_resets_at IS NOT NULL RETURNING quota_resets_at', [id])).rows[0]?.quota_resets_at ?? null
    },
    async get(id, organisationId) {
      return (await pool.query(`SELECT ${READ_COLUMNS} ${ORG_READ}`, [id, organisationId])).rows[0] || null
    },
    /** Returns { row, was } where `was` is the status before cancelling, or { row } unchanged when it had already finished. */
    async cancel(id, organisationId) {
      const result = await pool.query(`WITH prev AS (SELECT r.id,r.status ${ORG_READ} AND r.status IN ('queued','running') FOR UPDATE OF r) UPDATE api_reads r SET status='cancelled',finished_at=now(),lease_expires_at=NULL FROM prev WHERE r.id=prev.id RETURNING prev.status AS was,r.request,${READ_COLUMNS}`, [id, organisationId])
      if (result.rows[0]) {
        const { was, request, ...row } = result.rows[0]
        await pool.query('UPDATE api_reads SET request=$2 WHERE id=$1', [id, JSON.stringify(redactRequest(request))])
        return { row, was }
      }
      const row = await this.get(id, organisationId)
      return row ? { row } : null
    },
    /** Bounded recovery, cheap enough (partial indexes) to run beside every /api/v1 request. */
    sweep: ({ maxAttempts, queueTtlSeconds }) => recover({ limit: SWEEP_LIMIT, maxAttempts, queueTtlSeconds }),
    async cleanup({ maxAttempts, queueTtlSeconds }) {
      const result = await recover({ limit: 1000, maxAttempts, queueTtlSeconds })
      await pool.query('DELETE FROM api_reads WHERE expires_at<now()')
      return result
    },
  }
}

/**
 * `modelProxy` supplies the upstream bridge and the daily counters; `apiKeys.authenticate` resolves the Bearer key.
 * `schedule(promise)` keeps an async read alive after the 202 response (Vercel waitUntil, or in-process).
 */
export function createPublicApi({ readStore, env = process.env, body, send, modelProxy, apiKeys, publicOrigin, schedule = task => { task.catch(() => {}) }, resolve, deliver = deliverWebhook, now = Date.now, timeouts = {}, leaseOwner = `api-${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}` }) {
  const settings = queueSettings(env)
  const lease = { owner: leaseOwner, seconds: timeouts.leaseSeconds ?? LEASE_SECONDS }
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

  /**
   * Run one async read to completion, then deliver its webhook. Never throws. `claimed` means the caller already
   * holds the read's lease (a worker claim); otherwise this takes it, and returns if someone else has it.
   */
  async function execute(row, key, payload, startedAt, { claimed = false } = {}) {
    const deadline = startedAt + jobBudgetMs
    let outcome
    try {
      if (!claimed && !await readStore.start(row.id, lease)) return // cancelled while queued (that path refunds), or taken
      const ac = new AbortController()
      // The heartbeat keeps the lease and stops the read once it is cancelled or another executor has taken it over.
      const beat = setInterval(() => { readStore.heartbeat(row.id, lease).then(state => { if (state !== 'running') ac.abort(new Error(state === 'cancelled' ? 'cancelled' : 'lease-lost')) }).catch(() => {}) }, cancelPollMs)
      try {
        const opened = await modelProxy.openRead(payload, pseudonym(key.id), ac)
        if (opened.failure) outcome = { ok: false, status: opened.failure.status, code: opened.failure.code, message: opened.failure.error, refund: true }
        else outcome = await modelProxy.bufferRead(opened.upstream, ac, Math.min(readLimitMs, Math.max(1000, deadline - now() - 30_000)))
      } finally { clearInterval(beat) }
    } catch {
      outcome = { ok: false, status: 503, code: 'internal_error', message: 'The read could not be completed. No findings were generated.', refund: true }
    }
    if (!outcome.ok && outcome.refund) await refundRead(row.id, row.key_id)
    const status = outcome.ok ? 'succeeded' : 'failed'
    const result = outcome.ok ? { content: outcome.content, report: parseReport(outcome.content), finish_reason: outcome.finish ?? null, model: API_MODEL, ...(outcome.usage ? { usage: outcome.usage } : {}) } : null
    const error = outcome.ok ? null : errorBody(outcome.status, outcome.message, outcome.code).error
    try {
      if (!await readStore.finish(row.id, { status, result, error, request: redactRequest(payload), owner: lease.owner })) return // cancelled or taken over
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

  /** Recover lapsed reads; reads that expired in the queue without reaching a GPU are refunded. Never throws. */
  async function recover(all = false) {
    try {
      const outcome = await (all ? readStore.cleanup(settings) : readStore.sweep(settings))
      for (const read of outcome?.expired ?? []) await refundRead(read.id, read.key_id)
    } catch { /* the next sweep retries */ }
  }

  /** Claim up to `limit` queued reads and start them. Returns one promise per read (each never rejects). */
  async function runQueued(limit, options) {
    const rows = await readStore.claim(lease, limit, options)
    return rows.map(row => execute(row, { id: row.key_id, webhooks: row.webhook_secret_issued === true && webhooksConfigured(env) }, row.request, now(), { claimed: true }))
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
    // Back-pressure: a full queue refuses new reads before anything is counted.
    if (settings.queueLimit > 0 && (await readStore.depth()).queued >= settings.queueLimit) return fail(res, 503, 'The read queue is full. Retry in a minute.', 'queue_full', { ...keyHeaders(key), 'Retry-After': '30' })
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
    if (settings.mode === 'worker') schedule(readStore.notify())
    else schedule(execute(row, key, checked.payload, startedAt))
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
    settings,
    lease,
    cleanup: () => recover(true),
    recover,
    runQueued,
    depth: () => readStore.depth(),
    release: id => readStore.release(id, lease),
    /** Answers every /api/v1/* request. Only a valid Bearer key is accepted; session cookies are ignored here. */
    async handle(req, res, path) {
      try {
        const auth = await apiKeys.authenticate(req)
        if (auth.error) return fail(res, auth.error.status, auth.error.message, auth.error.code, { 'WWW-Authenticate': 'Bearer' })
        const { key } = auth
        // Recover stuck reads a few at a time on every authenticated request, beside the work. Without workers, a
        // read put back on the queue after its executor died is retried here too (fresh reads stay with their submitter).
        schedule(Promise.resolve().then(async () => {
          await recover()
          if (settings.mode === 'inline' && modelProxy.enabled) await Promise.all(await runQueued(1, { retriesOnly: true }))
        }))
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
