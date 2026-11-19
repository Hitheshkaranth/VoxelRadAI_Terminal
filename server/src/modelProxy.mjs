// Same-origin model proxy for the Vercel deployment: /lmstudio/v1/* is forwarded to the Hugging Face
// ZeroGPU Space with a shared bridge secret. All signed-in users spend the Space owner's GPU quota,
// so reads are capped per user per UTC day. Off unless MODEL_UPSTREAM_URL and BRIDGE_SECRET are set.
import { createHmac } from 'node:crypto'
import { hashToken } from './security.mjs'

export const MODEL_PATHS = new Set(['/lmstudio/v1/chat/completions', '/lmstudio/v1/models', '/lmstudio/api/v0/models'])
const READ_BODY_LIMIT = (process.env.VERCEL ? 4 : 25) * 1024 * 1024
// The Space cancels a read after 180 s; stop just inside Vercel's 300 s function limit regardless.
const STREAM_LIMIT_MS = 280_000
const HEADERS_TIMEOUT_MS = 60_000
const MODELS_TIMEOUT_MS = 12_000

/** HTTPS upstream (or loopback http for local testing), without a trailing slash. Null when unusable. */
export function upstreamBase(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null
    if (url.username || url.password || url.search || url.hash) return null
    return url.href.replace(/\/+$/, '')
  } catch { return null }
}

export function bridgeConfigured(env) {
  return Boolean(upstreamBase(env.MODEL_UPSTREAM_URL) && typeof env.BRIDGE_SECRET === 'string' && env.BRIDGE_SECRET.length >= 32)
}

/** Vercel rewrite target: model paths reach the proxy only when the bridge is configured. */
export function modelRoute(route, env) {
  if (!route.startsWith('lmstudio/')) return route
  return bridgeConfigured(env) && MODEL_PATHS.has(`/${route}`) ? route : 'unconfigured-model'
}

export function dailyReadLimit(env) {
  const value = Number(env.MODEL_DAILY_READS)
  return Number.isInteger(value) && value >= 0 && value <= 10000 && env.MODEL_DAILY_READS !== '' ? value : 40
}

/** Stable per-user pseudonym for the Space log; the account id and email never leave this server. */
export function userPseudonym(userId, secret) {
  return 'u-' + createHmac('sha256', secret).update(`voxelrad-user:${userId}`).digest('hex').slice(0, 16)
}

function quotaError(text) {
  return /exceeded[^\n]*quota|quota exceeded|reached[^\n]*GPU limit|quota/i.test(text)
}

/** Map an upstream refusal to the { error } JSON the workspace already shows (and gpuQuota() recognises). */
export function upstreamError(status, text) {
  let detail = ''
  try { const json = JSON.parse(text); detail = typeof json.error === 'string' ? json.error : json.error?.message || '' } catch { /* HTML or plain text from a gateway */ }
  detail = String(detail).slice(0, 300)
  if (quotaError(detail || text)) return { status: 429, code: 'upstream_quota_exceeded', error: `ZeroGPU quota exceeded on the shared model service. ${detail || 'Try again later.'}`.trim() }
  if (status === 401 || status === 403) return { status: 502, code: 'upstream_misconfigured', error: 'The model service rejected this site\'s bridge credentials. An administrator must check BRIDGE_SECRET on Vercel and the Space.' }
  if (status === 413) return { status: 413, code: 'request_too_large', error: 'The image is too large for the model service.' }
  if (status === 429) return { status: 429, code: 'upstream_busy', error: 'The model service is busy. Wait a minute and retry.' }
  if (status === 404) return { status: 502, code: 'upstream_misconfigured', error: 'The model service address is wrong. An administrator must check MODEL_UPSTREAM_URL.' }
  if (status >= 400 && status < 500) return { status, code: 'upstream_rejected', error: detail || 'The model service refused the request.' }
  return { status: 503, code: 'model_unavailable', error: 'The model service is starting or unavailable. Wait a minute, then retry.' }
}

// Error text the Space puts in front of every in-stream ZeroGPU failure; only the detail after it says whether quota ran out.
const STREAM_FAILURE_PREFIX = /^ZeroGPU read failed or quota exhausted\.\s*/

/** Classify an `{ error }` event inside the upstream stream. `refund` is true only when the read cannot have used the GPU. */
export function streamFailure(message) {
  const text = String(message || 'The model service failed the read.').slice(0, 500)
  if (/timed out/i.test(text)) return { status: 504, code: 'upstream_timeout', message: text, refund: false }
  if (quotaError(text.replace(STREAM_FAILURE_PREFIX, ''))) return { status: 429, code: 'upstream_quota_exceeded', message: text, refund: true }
  return { status: 502, code: 'upstream_error', message: text, refund: false }
}

/** Read an upstream SSE body to the end and return the assembled completion. Queue heartbeats are ignored. */
export async function collectStream(stream, { signal } = {}) {
  const decoder = new TextDecoder()
  let buffer = '', content = '', finish = null, model = null, id = null, usage = null, done = false, failure = null, received = false
  const consume = line => {
    line = line.replace(/\r$/, '').trim()
    if (!line.startsWith('data:')) return
    const data = line.slice(5).trim()
    if (data === '[DONE]') { done = true; return }
    let json
    try { json = JSON.parse(data) } catch { return }
    if (json?.error) { failure = streamFailure(typeof json.error === 'string' ? json.error : json.error.message); return }
    const choice = json?.choices?.[0]
    const piece = choice?.delta?.content ?? choice?.message?.content
    if (typeof piece === 'string') { content += piece; received = true }
    if (typeof choice?.finish_reason === 'string') finish = choice.finish_reason
    if (typeof json?.model === 'string') model = json.model
    if (typeof json?.id === 'string') id = json.id
    if (json?.usage && typeof json.usage === 'object') usage = json.usage
  }
  for await (const chunk of stream) {
    if (signal?.aborted) break
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) { consume(line); if (done || failure) break }
    if (done || failure) break
  }
  if (!done && !failure) consume(buffer + decoder.decode())
  if (failure) return { ok: false, ...failure }
  if (!received && !done) return { ok: false, status: 502, code: 'stream_error', message: 'The model service connection dropped before the read completed. No findings were generated.', refund: false }
  return { ok: true, content, finish, model, id, usage }
}

export function createModelProxy({ pool, env = process.env, body, send, fetchImpl = fetch, timeouts = {} }) {
  const enabled = bridgeConfigured(env)
  const base = upstreamBase(env.MODEL_UPSTREAM_URL)
  const secret = env.BRIDGE_SECRET
  const limit = dailyReadLimit(env)
  const streamLimit = timeouts.stream ?? STREAM_LIMIT_MS
  const headersTimeout = timeouts.headers ?? HEADERS_TIMEOUT_MS

  // Same table and upsert pattern as the sign-in limiter; the bucket resets at the next UTC midnight.
  async function reserve(bucket) {
    const key = hashToken(bucket)
    const result = await pool.query("INSERT INTO login_attempts(key_hash,attempts,resets_at) VALUES ($1,1,date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 day') ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN login_attempts.resets_at<now() THEN 1 ELSE login_attempts.attempts+1 END,resets_at=CASE WHEN login_attempts.resets_at<now() THEN date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 day' ELSE login_attempts.resets_at END RETURNING attempts,resets_at", [key])
    return { key, count: result.rows[0].attempts, resetsAt: new Date(result.rows[0].resets_at) }
  }
  const reserveRead = userId => reserve(`model-reads:${userId}`)
  // A read that never reached the GPU should not count against the user. The refund goes back to the UTC day the read
  // was counted on (`resetsAt` from its reservation): after midnight the bucket belongs to a new day and is left alone.
  const refund = (key, resetsAt) => pool.query('UPDATE login_attempts SET attempts=GREATEST(attempts-1,0) WHERE key_hash=$1 AND resets_at=$2', [key, resetsAt]).catch(() => {})
  const retryAfter = resetsAt => Math.max(60, Math.ceil((resetsAt.getTime() - Date.now()) / 1000))

  const bridgeHeaders = pseudonym => ({ 'X-VoxelRad-Bridge': secret, 'X-VoxelRad-User': pseudonym })
  const headers = user => bridgeHeaders(userPseudonym(user.id, secret))

  /** GET an upstream model-list path. Returns { status, json } or { status, error }. */
  async function fetchModels(upstreamPath, pseudonym) {
    let upstream
    try { upstream = await fetchImpl(base + upstreamPath, { headers: bridgeHeaders(pseudonym), signal: AbortSignal.timeout(MODELS_TIMEOUT_MS) }) }
    catch { return { status: 503, code: 'model_unavailable', error: 'The model service is not responding. It may be starting; wait a minute, then check again.' } }
    const text = await upstream.text().catch(() => '')
    if (!upstream.ok) return upstreamError(upstream.status, text)
    try { return { status: 200, json: JSON.parse(text) } } catch { return { status: 502, code: 'upstream_error', error: 'The model service returned an unreadable model list.' } }
  }

  async function models(req, res, user) {
    const result = await fetchModels(req.url.slice('/lmstudio'.length).split('?')[0], userPseudonym(user.id, secret))
    return result.json ? send(res, 200, result.json) : send(res, result.status, { error: result.error })
  }

  /**
   * Start one upstream read. Returns { upstream } with a readable SSE body, or { failure: { status, error, code } }
   * for a read that never started (always refundable). `ac` aborts the read; a 60 s wait for headers aborts it too.
   */
  async function openRead(payload, pseudonym, ac) {
    const headerTimer = setTimeout(() => ac.abort(new Error('headers-timeout')), headersTimeout)
    let upstream
    try {
      upstream = await fetchImpl(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...bridgeHeaders(pseudonym) }, body: JSON.stringify(payload), signal: ac.signal })
    } catch {
      clearTimeout(headerTimer)
      const timedOut = ac.signal.reason?.message === 'headers-timeout'
      return { failure: timedOut
        ? { status: 504, code: 'upstream_timeout', error: 'The model service did not start the read within 60 seconds. It may be waking up; retry in a minute.' }
        : { status: 503, code: 'model_unavailable', error: 'The model service is not reachable. Check again in a minute.' } }
    }
    clearTimeout(headerTimer)
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '')
      return { failure: upstreamError(upstream.status, text) }
    }
    return { upstream }
  }

  /** Pass the upstream SSE bytes straight to the client, with an in-stream error event if the hosting limit is reached. */
  async function pipeStream(res, upstream, ac, extraHeaders = {}) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff', ...extraHeaders })
    res.flushHeaders?.()
    const deadline = setTimeout(() => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ error: { message: 'The model read exceeded the hosting time limit and was cancelled. No findings were generated.' } })}\n\ndata: [DONE]\n\n`)
      ac.abort()
    }, streamLimit)
    try {
      // No buffering, so queue heartbeats and the result arrive as sent.
      for await (const chunk of upstream.body) {
        if (res.destroyed) break
        if (!res.write(chunk)) await new Promise(resolve => { res.once('drain', resolve); res.once('close', resolve) })
      }
    } catch {
      if (!res.writableEnded && !res.destroyed && !ac.signal.aborted) res.write(`data: ${JSON.stringify({ error: { message: 'The model service connection dropped before the read completed. No findings were generated.' } })}\n\ndata: [DONE]\n\n`)
    } finally {
      clearTimeout(deadline)
      if (!res.writableEnded) res.end()
    }
  }

  /** Buffer a whole read (heartbeats included) into one completion, bounded by `limitMs`. */
  async function bufferRead(upstream, ac, limitMs = streamLimit) {
    const deadline = setTimeout(() => ac.abort(new Error('read-timeout')), limitMs)
    try {
      const collected = await collectStream(upstream.body, { signal: ac.signal })
      if (ac.signal.aborted && !collected.ok && collected.code === 'stream_error') throw new Error('aborted')
      return collected
    } catch {
      if (ac.signal.reason?.message === 'read-timeout') return { ok: false, status: 504, code: 'read_timeout', message: 'The model read exceeded the hosting time limit and was cancelled. No findings were generated.', refund: false }
      if (ac.signal.reason?.message === 'cancelled') return { ok: false, status: 409, code: 'cancelled', message: 'The read was cancelled.', refund: false }
      return { ok: false, status: 502, code: 'stream_error', message: 'The model service connection dropped before the read completed. No findings were generated.', refund: false }
    } finally { clearTimeout(deadline) }
  }

  async function chat(req, res, user) {
    const payload = await body(req, READ_BODY_LIMIT)
    if (limit === 0) return send(res, 503, { error: 'Hosted model reads are turned off on this site.' })
    const reservation = await reserveRead(user.id)
    if (reservation.count > limit) {
      await refund(reservation.key, reservation.resetsAt)
      return send(res, 429, { error: `Daily limit reached: ${limit} model reads per user per day on the shared GPU quota. Try again after 00:00 UTC.` }, { 'Retry-After': String(retryAfter(reservation.resetsAt)) })
    }
    const ac = new AbortController()
    let finished = false
    // Client went away (tab closed, Cancel): stop the upstream read so the queued GPU job is released.
    res.on('close', () => { if (!finished) ac.abort() })
    const opened = await openRead(payload, userPseudonym(user.id, secret), ac)
    if (opened.failure) {
      await refund(reservation.key, reservation.resetsAt)
      if (res.destroyed || res.writableEnded) return
      return send(res, opened.failure.status, { error: opened.failure.error })
    }
    try { await pipeStream(res, opened.upstream, ac, { 'X-VoxelRad-Reads-Left': String(Math.max(0, limit - reservation.count)) }) }
    finally { finished = true }
  }

  return {
    enabled,
    limit,
    readBodyLimit: READ_BODY_LIMIT,
    reserve, refund, retryAfter, bucketKey: hashToken, fetchModels, openRead, pipeStream, bufferRead,
    /** Returns true when the request was a model path and has been answered. */
    async handle(req, res, path, user) {
      if (!enabled || !MODEL_PATHS.has(path)) return false
      if (path === '/lmstudio/v1/chat/completions' && req.method === 'POST') { await chat(req, res, user); return true }
      if (path !== '/lmstudio/v1/chat/completions' && req.method === 'GET') { await models(req, res, user); return true }
      send(res, 405, { error: 'Method not allowed.' }, { Allow: path.endsWith('/completions') ? 'POST' : 'GET' })
      return true
    },
  }
}
