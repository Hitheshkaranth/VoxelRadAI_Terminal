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
  if (quotaError(detail || text)) return { status: 429, error: `ZeroGPU quota exceeded on the shared model service. ${detail || 'Try again later.'}`.trim() }
  if (status === 401 || status === 403) return { status: 502, error: 'The model service rejected this site\'s bridge credentials. An administrator must check BRIDGE_SECRET on Vercel and the Space.' }
  if (status === 413) return { status: 413, error: 'The image is too large for the model service.' }
  if (status === 429) return { status: 429, error: 'The model service is busy. Wait a minute and retry.' }
  if (status === 404) return { status: 502, error: 'The model service address is wrong. An administrator must check MODEL_UPSTREAM_URL.' }
  if (status >= 400 && status < 500) return { status, error: detail || 'The model service refused the request.' }
  return { status: 503, error: 'The model service is starting or unavailable. Wait a minute, then retry.' }
}

export function createModelProxy({ pool, env = process.env, body, send, fetchImpl = fetch, timeouts = {} }) {
  const enabled = bridgeConfigured(env)
  const base = upstreamBase(env.MODEL_UPSTREAM_URL)
  const secret = env.BRIDGE_SECRET
  const limit = dailyReadLimit(env)
  const streamLimit = timeouts.stream ?? STREAM_LIMIT_MS
  const headersTimeout = timeouts.headers ?? HEADERS_TIMEOUT_MS

  // Same table and upsert pattern as the sign-in limiter; the bucket resets at the next UTC midnight.
  async function reserveRead(userId) {
    const key = hashToken(`model-reads:${userId}`)
    const result = await pool.query("INSERT INTO login_attempts(key_hash,attempts,resets_at) VALUES ($1,1,date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 day') ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN login_attempts.resets_at<now() THEN 1 ELSE login_attempts.attempts+1 END,resets_at=CASE WHEN login_attempts.resets_at<now() THEN date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 day' ELSE login_attempts.resets_at END RETURNING attempts,resets_at", [key])
    return { key, count: result.rows[0].attempts, resetsAt: new Date(result.rows[0].resets_at) }
  }
  // A read that never reached the GPU should not count against the user.
  const refund = key => pool.query('UPDATE login_attempts SET attempts=GREATEST(attempts-1,0) WHERE key_hash=$1', [key]).catch(() => {})

  const headers = user => ({ 'X-VoxelRad-Bridge': secret, 'X-VoxelRad-User': userPseudonym(user.id, secret) })

  async function models(req, res, user) {
    let upstream
    try { upstream = await fetchImpl(base + req.url.slice('/lmstudio'.length).split('?')[0], { headers: headers(user), signal: AbortSignal.timeout(MODELS_TIMEOUT_MS) }) }
    catch { return send(res, 503, { error: 'The model service is not responding. It may be starting; wait a minute, then check again.' }) }
    const text = await upstream.text().catch(() => '')
    if (!upstream.ok) { const mapped = upstreamError(upstream.status, text); return send(res, mapped.status, { error: mapped.error }) }
    try { return send(res, 200, JSON.parse(text)) } catch { return send(res, 502, { error: 'The model service returned an unreadable model list.' }) }
  }

  async function chat(req, res, user) {
    const payload = await body(req, READ_BODY_LIMIT)
    if (limit === 0) return send(res, 503, { error: 'Hosted model reads are turned off on this site.' })
    const reservation = await reserveRead(user.id)
    if (reservation.count > limit) {
      await refund(reservation.key)
      const retry = Math.max(60, Math.ceil((reservation.resetsAt.getTime() - Date.now()) / 1000))
      return send(res, 429, { error: `Daily limit reached: ${limit} model reads per user per day on the shared GPU quota. Try again after 00:00 UTC.` }, { 'Retry-After': String(retry) })
    }
    const ac = new AbortController()
    let finished = false
    // Client went away (tab closed, Cancel): stop the upstream read so the queued GPU job is released.
    res.on('close', () => { if (!finished) ac.abort() })
    const headerTimer = setTimeout(() => ac.abort(new Error('headers-timeout')), headersTimeout)
    let upstream
    try {
      upstream = await fetchImpl(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers(user) }, body: JSON.stringify(payload), signal: ac.signal })
    } catch (error) {
      clearTimeout(headerTimer)
      await refund(reservation.key)
      if (res.destroyed || res.writableEnded) return
      const timedOut = ac.signal.reason?.message === 'headers-timeout'
      return send(res, timedOut ? 504 : 503, { error: timedOut ? 'The model service did not start the read within 60 seconds. It may be waking up; retry in a minute.' : 'The model service is not reachable. Check again in a minute.' })
    }
    clearTimeout(headerTimer)
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '')
      await refund(reservation.key)
      const mapped = upstreamError(upstream.status, text)
      return send(res, mapped.status, { error: mapped.error })
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff', 'X-VoxelRad-Reads-Left': String(Math.max(0, limit - reservation.count)) })
    res.flushHeaders?.()
    const deadline = setTimeout(() => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ error: { message: 'The model read exceeded the hosting time limit and was cancelled. No findings were generated.' } })}\n\ndata: [DONE]\n\n`)
      ac.abort()
    }, streamLimit)
    try {
      // Pass bytes straight through: no buffering, so queue heartbeats and the result arrive as sent.
      for await (const chunk of upstream.body) {
        if (res.destroyed) break
        if (!res.write(chunk)) await new Promise(resolve => { res.once('drain', resolve); res.once('close', resolve) })
      }
    } catch {
      if (!res.writableEnded && !res.destroyed && !ac.signal.aborted) res.write(`data: ${JSON.stringify({ error: { message: 'The model service connection dropped before the read completed. No findings were generated.' } })}\n\ndata: [DONE]\n\n`)
    } finally {
      clearTimeout(deadline)
      finished = true
      if (!res.writableEnded) res.end()
    }
  }

  return {
    enabled,
    limit,
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
