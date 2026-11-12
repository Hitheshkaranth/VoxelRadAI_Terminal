import http from 'node:http'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { allowedOrigin, hashPassword, hashToken, newToken, normalizeEmail, readSessionCookie, sessionCookie, validEmail, validPassword, verifyPassword, needsRehash } from './security.mjs'
import { sharedDocument } from './share.mjs'
import { migrate } from './migrate.mjs'
import { validStudy } from './studyValidation.mjs'
import { pagination } from './pagination.mjs'
import { createOperations } from './operations.mjs'
import { createOidcRoutes } from './oidc.mjs'
import { createObjectStorageRouter } from './objectStorage.mjs'
import { createDicomweb } from './dicomweb.mjs'

const { Pool } = pg
const port = Number(process.env.PORT || 8080)
const publicOrigin = new URL(process.env.PUBLIC_ORIGIN || 'http://localhost:5173').origin
const secureCookies = publicOrigin.startsWith('https:')
const localOverride = process.env.ALLOW_INSECURE_LOCALHOST === 'true' && ['localhost','127.0.0.1','[::1]'].includes(new URL(publicOrigin).hostname)
if (process.env.NODE_ENV === 'production' && !secureCookies && !localOverride) throw new Error('Production requires HTTPS PUBLIC_ORIGIN (or explicit loopback-only ALLOW_INSECURE_LOCALHOST=true).')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_SIZE || 10), connectionTimeoutMillis: 5000, statement_timeout: 10000 })
let waitUntil = null
if (process.env.VERCEL) {
  const vercelFunctions = await import('@vercel/functions')
  vercelFunctions.attachDatabasePool(pool)
  waitUntil = vercelFunctions.waitUntil
}
pool.on('error', () => console.error('Database connection interrupted'))
await migrate(pool)

// Bootstrap is opt-in and only allowed when the user table is empty. No shipped credentials.
if ((process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_PASSWORD) && !(await pool.query('SELECT 1 FROM users LIMIT 1')).rowCount) {
  const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL)
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD
  if (!validEmail(email) || !validPassword(password)) throw new Error('Bootstrap requires a valid email and password of 12–256 characters')
  const passwordHash = await hashPassword(password)
  const client = await pool.connect()
  try { await client.query('BEGIN'); await client.query('LOCK TABLE users IN EXCLUSIVE MODE'); await client.query("INSERT INTO users (id,email,password_hash,role) SELECT $1,$2,$3,'admin' WHERE NOT EXISTS (SELECT 1 FROM users)", [randomUUID(), email, passwordHash]); await client.query('COMMIT') }
  catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
const dummyHash = await hashPassword(newToken())
const operations = createOperations()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function send(res, status, body, extra = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra }); res.end(JSON.stringify(body)) }
async function body(req, limit = 8192) {
  // Vercel's Node runtime may parse JSON before invoking the exported handler.
  if (req.body !== undefined) {
    let data = req.body
    const raw = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : JSON.stringify(data)
    if (Buffer.byteLength(raw || '') > limit) throw Object.assign(new Error('Request exceeds the allowed size'), { status: 413 })
    if (typeof data === 'string' || Buffer.isBuffer(data)) {
      try { data = JSON.parse(raw) } catch { throw Object.assign(new Error('Request must contain a JSON object'), { status: 400 }) }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('Request must contain a JSON object'), { status: 400 })
    return data
  }
  const chunks = []; let bytes = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) { bytes += chunk.length; if (bytes > limit) { req.resume(); const error = new Error('Request exceeds the allowed size'); error.status = 413; throw error } chunks.push(chunk) }
  try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data } catch { const error = new Error('Request must contain a JSON object'); error.status = 400; throw error }
}
const sessionIdleMinutes = Math.min(480, Math.max(5, Number(process.env.SESSION_IDLE_MINUTES) || 60))
const audit = (actor, event) => pool.query('INSERT INTO audit_events(actor_id,event_type) VALUES ($1,$2)', [actor, event])
async function userFor(req) {
  const token = readSessionCookie(req.headers.cookie)
  if (!token) return null
  // Idle sessions end after SESSION_IDLE_MINUTES; last_used_at is refreshed at most once a minute to limit writes.
  const result = await pool.query(`UPDATE sessions s SET last_used_at=CASE WHEN s.last_used_at<now()-interval '1 minute' THEN now() ELSE s.last_used_at END FROM users u WHERE u.id=s.user_id AND s.token_hash=$1 AND s.expires_at>now() AND s.last_used_at>now()-make_interval(mins=>$2) AND NOT u.disabled RETURNING u.id,u.email,u.role`, [hashToken(token), sessionIdleMinutes])
  return result.rows[0] || null
}
// Client address for abuse limits. Vercel and the bundled nginx set X-Real-IP themselves; elsewhere use the socket.
function clientIp(req) {
  const header = req.headers['x-real-ip']
  if ((process.env.VERCEL || process.env.TRUST_PROXY_HEADERS === 'true') && typeof header === 'string' && header.length <= 64) return header.trim()
  return req.socket?.remoteAddress || 'unknown'
}
const clearRateLimit = key => pool.query('DELETE FROM login_attempts WHERE key_hash=$1', [hashToken(key)])
async function confirmAdmin(user, password) {
  if (typeof password !== 'string' || !password || password.length > 256) return false
  if (await rateLimit(`admin-reauth:${user.id}`)) return false
  const result = await pool.query("SELECT password_hash FROM users WHERE id=$1 AND role='admin' AND NOT disabled", [user.id])
  return Boolean(result.rows[0]) && await verifyPassword(password, result.rows[0].password_hash)
}
async function rateLimit(key, max = 15) {
  const result = await pool.query("INSERT INTO login_attempts(key_hash,attempts,resets_at) VALUES ($1,1,now()+interval '15 minutes') ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN login_attempts.resets_at<now() THEN 1 ELSE login_attempts.attempts+1 END,resets_at=CASE WHEN login_attempts.resets_at<now() THEN now()+interval '15 minutes' ELSE login_attempts.resets_at END RETURNING attempts", [hashToken(key)])
  return result.rows[0].attempts > max
}
const oidc = createOidcRoutes({ pool, publicOrigin, secureCookies, userFor, body, send, rateLimit, clientIp,
  issueSession: async (client, user) => {
    const token = newToken()
    await client.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '8 hours')", [hashToken(token), user.id])
    return sessionCookie(token, secureCookies)
  },
})
const objectStorage = await createObjectStorageRouter({ pool, body, send, env: process.env })
const pacs = createDicomweb({ env: process.env })
// Prune expired rows and abandoned uploads. Long-running servers use a timer; on Vercel a small share of requests schedules it after the response.
async function cleanup() {
  await Promise.allSettled([objectStorage.cleanupExpiredUploads(), pool.query('DELETE FROM sessions WHERE expires_at<now()'), pool.query('DELETE FROM login_attempts WHERE resets_at<now()'), pool.query('DELETE FROM password_recovery_tokens WHERE expires_at<now()')])
}
export async function handler(req, res) {
  const requestId = operations.begin(res)
  if (waitUntil && Math.random() < 0.02) waitUntil(cleanup())
  try {
    const path = new URL(req.url, 'http://internal').pathname
    if (path === '/healthz' && req.method === 'GET') { await pool.query('SELECT 1'); return send(res, 200, { status: 'ok' }) }
    if (['POST','PUT','PATCH','DELETE'].includes(req.method) && !allowedOrigin(req.headers.origin, publicOrigin)) return send(res, 403, { error: 'Request origin is not allowed' })
    if (await oidc.route(req, res)) return
    if (path === '/api/password-recovery' && req.method === 'POST') {
      const data = await body(req)
      if (typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.token) || !validPassword(data.password)) return send(res, 400, { error: 'Supply a recovery token and a password of 12–256 characters.' })
      // Unknown random codes must not create unbounded persistent limiter buckets.
      // This indexed check is outside the transaction; validity is rechecked under lock below.
      const knownRecovery = await pool.query('SELECT user_id FROM password_recovery_tokens WHERE token_hash=$1', [hashToken(data.token)])
      if (!knownRecovery.rowCount) return send(res, 400, { error: 'Recovery token is invalid or expired.' })
      // Do not key this to socket.remoteAddress: every user behind our proxy shares it.
      if (await rateLimit(`recovery-token:${data.token}`)) return send(res, 429, { error: 'Too many attempts with this recovery code. Try again in 15 minutes.' }, { 'Retry-After': '900' })
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const lookup = await client.query('SELECT user_id FROM password_recovery_tokens WHERE token_hash=$1', [hashToken(data.token)])
        const target = lookup.rows[0]?.user_id
        if (!target) { await client.query('ROLLBACK'); return send(res, 400, { error: 'Recovery token is invalid or expired.' }) }
        // Same lock order as login/password reset: user first, then token.
        const account = await client.query('SELECT id,disabled FROM users WHERE id=$1 FOR UPDATE', [target])
        const token = await client.query('SELECT token_hash FROM password_recovery_tokens WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() FOR UPDATE', [hashToken(data.token)])
        if (!token.rowCount || !account.rows[0] || account.rows[0].disabled) { await client.query('ROLLBACK'); return send(res, 400, { error: 'Recovery token is invalid or expired.' }) }
        await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [target, await hashPassword(data.password)])
        await client.query('UPDATE password_recovery_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL', [target])
        await client.query('DELETE FROM sessions WHERE user_id=$1', [target])
        await client.query('INSERT INTO audit_events(actor_id,event_type) VALUES ($1,$2)', [target, 'account.recovered'])
        await client.query('COMMIT')
        return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', secureCookies, 0) })
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
    if (path === '/api/login' && req.method === 'POST') {
      const data = await body(req); const email = normalizeEmail(data.email)
      if (!validEmail(email) || typeof data.password !== 'string' || data.password.length > 256) return send(res, 401, { error: 'Email or password is incorrect.' })
      if (await rateLimit(`login-ip:${clientIp(req)}`, 60) || await rateLimit(`email:${email}`)) return send(res, 429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' }, { 'Retry-After': '900' })
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        // Serialize with password-reset/disable so old credentials cannot mint a session after revocation.
        const result = await client.query('SELECT id,email,role,password_hash,disabled FROM users WHERE email=$1 FOR UPDATE', [email])
        const account = result.rows[0]
        const valid = await verifyPassword(data.password, account?.password_hash || dummyHash)
        if (!account || !valid || account.disabled) { await client.query('ROLLBACK'); return send(res, 401, { error: 'Email or password is incorrect.' }) }
        const token = newToken()
        await client.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '8 hours')", [hashToken(token), account.id])
        await client.query('UPDATE users SET last_login_at=now() WHERE id=$1', [account.id])
        await client.query('INSERT INTO audit_events(actor_id,event_type) VALUES ($1,$2)',[account.id,'login'])
        if (needsRehash(account.password_hash)) await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [account.id, await hashPassword(data.password)])
        await client.query('COMMIT')
        await clearRateLimit(`email:${email}`).catch(() => {})
        return send(res, 200, { user: { id: account.id, email: account.email, role: account.role } }, { 'Set-Cookie': sessionCookie(token, secureCookies) })
      } catch(error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
    if (path === '/api/shared' && req.method === 'POST') {
      // Token travels in the body so it never appears in request logs; the viewer page reads it from the URL fragment.
      const data = await body(req, 1024)
      if (typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.token)) return send(res, 404, { error: 'This share link is unavailable or expired.' })
      const result = await pool.query('SELECT g.snapshot_html FROM share_grants g JOIN users u ON u.id=g.owner_id WHERE g.token_hash=$1 AND g.revoked_at IS NULL AND g.expires_at>now() AND NOT u.disabled', [hashToken(data.token)])
      if (!result.rows[0]?.snapshot_html) return send(res, 404, { error: 'This share link is unavailable or expired.' })
      return send(res, 200, { html: result.rows[0].snapshot_html })
    }
    // Legacy path-token links stay readable until they expire (at most 168 hours after issue).
    if (path.startsWith('/api/shared/') && req.method === 'GET') {
      const token = path.slice('/api/shared/'.length)
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return send(res, 404, { error: 'This share link is unavailable or expired.' })
      const result = await pool.query('SELECT g.snapshot_html FROM share_grants g JOIN users u ON u.id=g.owner_id WHERE g.token_hash=$1 AND g.revoked_at IS NULL AND g.expires_at>now() AND NOT u.disabled', [hashToken(token)])
      if (!result.rows[0]?.snapshot_html) return send(res, 404, { error: 'This share link is unavailable or expired.' })
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" })
      return res.end(result.rows[0].snapshot_html)
    }
    const user = await userFor(req)
    if (path === '/api/auth/check' && req.method === 'GET') return send(res, user ? 200 : 401, user ? { ok: true } : { error: 'Sign in to continue.' })
    if (path === '/api/session' && req.method === 'GET') return send(res, 200, { user })
    if (path === '/api/logout' && req.method === 'POST') {
      const token = readSessionCookie(req.headers.cookie)
      if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(token)])
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', secureCookies, 0) })
    }
    if (!user) return send(res, 401, { error: 'Sign in to continue.' })
    if (await objectStorage.handle({ req, res, path, user })) return
    if (await pacs.handle(req, res, user, { audit })) return
    if (path === '/api/account/password' && req.method === 'POST') {
      const data = await body(req)
      if (!validPassword(data.password) || typeof data.currentPassword !== 'string' || data.currentPassword.length > 256) return send(res, 400, { error: 'Supply your current password and a new password of 12–256 characters.' })
      if (await rateLimit(`password-change:${user.id}`)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' }, { 'Retry-After': '900' })
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await client.query('SELECT password_hash,disabled FROM users WHERE id=$1 FOR UPDATE', [user.id])
        if (result.rows[0]?.disabled !== false || !await verifyPassword(data.currentPassword, result.rows[0]?.password_hash)) { await client.query('ROLLBACK'); return send(res, 403, { error: 'Current password is incorrect.' }) }
        if (data.currentPassword === data.password) { await client.query('ROLLBACK'); return send(res, 400, { error: 'Choose a different password.' }) }
        await client.query('UPDATE users SET password_hash=$2 WHERE id=$1', [user.id, await hashPassword(data.password)])
        await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id])
        await client.query('UPDATE password_recovery_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL', [user.id])
        await client.query('INSERT INTO audit_events(actor_id,event_type) VALUES ($1,$2)', [user.id, 'account.password_changed'])
        await client.query('COMMIT')
        return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', secureCookies, 0) })
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
    if (path.startsWith('/api/admin/') && user.role !== 'admin') return send(res, 403, { error: 'Administrator access is required.' })
    if (path === '/api/admin/operations' && req.method === 'GET') {
      await pool.query('SELECT 1')
      return send(res, 200, { ...operations.snapshot(), generatedAt: new Date().toISOString(), database: { status: 'ready', connections: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }, memory: { rssBytes: process.memoryUsage().rss }, features: { accountRecovery: 'administrator-issued-token', mfa: false, sso: oidc.enabled, multiTenant: false, volumeStorage: objectStorage.enabled, durableInferenceJobs: false } })
    }
    const recoveryMatch = path.match(/^\/api\/admin\/users\/([a-f0-9-]+)\/recovery$/i)
    if (recoveryMatch && UUID.test(recoveryMatch[1]) && req.method === 'POST') {
      const data = await body(req), target = recoveryMatch[1]
      if (typeof data.currentPassword !== 'string' || data.currentPassword.length > 256) return send(res, 400, { error: 'Confirm your administrator password.' })
      if (await rateLimit(`recovery-issue:${user.id}`)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' }, { 'Retry-After': '900' })
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const accounts = await client.query('SELECT id,role,disabled,password_hash FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[user.id, target]])
        const actor = accounts.rows.find(row => row.id === user.id), account = accounts.rows.find(row => row.id === target)
        if (!actor || actor.disabled || actor.role !== 'admin' || !await verifyPassword(data.currentPassword, actor.password_hash)) { await client.query('ROLLBACK'); return send(res, 403, { error: 'Administrator password is incorrect.' }) }
        if (!account || account.disabled) { await client.query('ROLLBACK'); return send(res, 404, { error: 'Active user not found.' }) }
        const token = newToken(), expiresAt = new Date(Date.now() + 15 * 60000)
        await client.query('UPDATE password_recovery_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL', [target])
        await client.query('INSERT INTO password_recovery_tokens(token_hash,user_id,created_by,expires_at) VALUES ($1,$2,$3,$4)', [hashToken(token), target, user.id, expiresAt])
        await client.query('INSERT INTO audit_events(actor_id,event_type) VALUES ($1,$2)', [user.id, 'account.recovery_issued'])
        await client.query('COMMIT')
        return send(res, 201, { token, expiresAt: expiresAt.toISOString() })
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
    if (path === '/api/admin/users' && req.method === 'GET') {
      const params = new URL(req.url, 'http://internal').searchParams
      let limit,offset
      try { ({limit,offset}=pagination(params)) } catch(error) { return send(res,400,{error:error.message}) }
      const [result,count] = await Promise.all([pool.query('SELECT id,email,role,disabled,created_at AS "createdAt",last_login_at AS "lastSeenAt" FROM users ORDER BY created_at DESC,id LIMIT $1 OFFSET $2',[limit,offset]),pool.query('SELECT count(*)::int AS total FROM users')])
      return send(res, 200, { users: result.rows, total: count.rows[0].total })
    }
    if (path === '/api/admin/users' && req.method === 'POST') {
      const data = await body(req); const email = normalizeEmail(data.email)
      if (!validEmail(email) || !validPassword(data.password) || !['admin','clinician'].includes(data.role)) return send(res, 400, { error: 'Use a valid email, a 12–256 character password, and admin or clinician role.' })
      if (!await confirmAdmin(user, data.currentPassword)) return send(res, 403, { error: 'Administrator password is incorrect.' })
      const result = await pool.query('INSERT INTO users(id,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id,email,role', [randomUUID(), email, await hashPassword(data.password), data.role])
      await audit(user.id, 'user.created'); return send(res, 201, { user: result.rows[0] })
    }
    const userMatch = path.match(/^\/api\/admin\/users\/([a-f0-9-]+)$/i)
    if (userMatch && UUID.test(userMatch[1]) && req.method === 'PATCH') {
      const data = await body(req), target = userMatch[1]
      if (target === user.id && data.disabled === true) return send(res,400,{error:'You cannot disable your own account.'})
      if (typeof data.disabled !== 'boolean' && !validPassword(data.password)) return send(res,400,{error:'Supply disabled true/false or a 12–256 character password.'})
      if ('password' in data && !validPassword(data.password)) return send(res,400,{error:'Password must contain 12–256 characters.'})
      if ('password' in data && target === user.id) return send(res,400,{error:'Change your own password from account security.'})
      if ('password' in data && !await confirmAdmin(user, data.currentPassword)) return send(res,403,{error:'Administrator password is incorrect.'})
      const passwordHash = data.password ? await hashPassword(data.password) : null
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        // Administrative lifecycle mutations must not race two administrators into disabling each other.
        const locked = await client.query('SELECT id,disabled FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[user.id,target]])
        if (locked.rows.find(row=>row.id===user.id)?.disabled !== false) { await client.query('ROLLBACK'); return send(res,401,{error:'Sign in to continue.'}) }
        const result = await client.query('UPDATE users SET disabled=COALESCE($2,disabled),password_hash=COALESCE($3,password_hash) WHERE id=$1 RETURNING id,email,role,disabled',[target,typeof data.disabled === 'boolean' ? data.disabled : null,passwordHash])
        if (!result.rowCount) { await client.query('ROLLBACK'); return send(res,404,{error:'User not found.'}) }
        if (data.disabled === true || passwordHash) await client.query('DELETE FROM sessions WHERE user_id=$1',[target])
        if (data.disabled === true || passwordHash) await client.query('UPDATE password_recovery_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL',[target])
        if (data.disabled === true) await client.query('UPDATE share_grants SET revoked_at=now() WHERE owner_id=$1 AND revoked_at IS NULL',[target])
        await client.query('INSERT INTO audit_events(actor_id,event_type) VALUES ($1,$2)',[user.id,passwordHash ? 'user.password_reset' : data.disabled ? 'user.disabled' : 'user.enabled'])
        await client.query('COMMIT'); return send(res,200,{user:result.rows[0]})
      } catch(error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
    if (path === '/api/admin/metrics' && req.method === 'GET') {
      const [users, studies, shares, events] = await Promise.all([
        pool.query("SELECT count(*)::int AS total,count(*) FILTER (WHERE last_login_at>now()-interval '30 days')::int AS active FROM users"),
        pool.query('SELECT count(*)::int AS total,COALESCE(sum(image_count),0)::int AS images,count(*) FILTER (WHERE has_report)::int AS reports,count(*) FILTER (WHERE report_signed)::int AS signed FROM studies'),
        pool.query('SELECT count(*) FILTER (WHERE revoked_at IS NULL AND expires_at>now())::int AS active,count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked FROM share_grants'),
        pool.query("SELECT count(*)::int AS total FROM audit_events WHERE created_at>now()-interval '30 days'")])
      const s = studies.rows[0]
      return send(res, 200, { scope: 'organization', generatedAt: new Date().toISOString(), browserLocalExcluded: true, users: { total: users.rows[0].total, active30d: users.rows[0].active }, studies: { total: s.total }, images: { total: s.images }, reports: { total: s.reports, signed: s.signed }, shares: shares.rows[0], jobs: { queued: 0, running: 0, failed: 0, available: false }, events: { total30d: events.rows[0].total } })
    }
    if (path === '/api/studies' && req.method === 'GET') {
      const params = new URL(req.url,'http://internal').searchParams
      let limit,offset
      try { ({limit,offset}=pagination(params)) } catch(error) { return send(res,400,{error:error.message}) }
      const [result,count] = await Promise.all([pool.query('SELECT id,payload->>\'title\' AS title,image_count AS "imageCount",has_report AS "hasReport",report_signed AS "reportSigned",updated_at AS "updatedAt" FROM studies WHERE owner_id=$1 ORDER BY updated_at DESC,id LIMIT $2 OFFSET $3', [user.id,limit,offset]),pool.query('SELECT count(*)::int AS total FROM studies WHERE owner_id=$1',[user.id])])
      return send(res, 200, { studies: result.rows, total:count.rows[0].total })
    }
    if (path === '/api/studies' && req.method === 'POST') {
      const data = await body(req, (process.env.VERCEL ? 4 : 25) * 1024 * 1024)
      if (!validStudy(data)) return send(res, 400, { error: 'The study has invalid patient, image, analysis or report fields. Export a valid Skanda study and retry.' })
      const result = await pool.query('INSERT INTO studies(id,owner_id,payload,image_count,has_report,report_signed) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,image_count=EXCLUDED.image_count,has_report=EXCLUDED.has_report,report_signed=EXCLUDED.report_signed,updated_at=now() WHERE studies.owner_id=$2 RETURNING id', [data.id,user.id,JSON.stringify(data),data.images.length,!!data.report,!!data.report?.signed])
      if (!result.rowCount) return send(res, 404, { error: 'Study not found.' })
      await audit(user.id, 'study.saved'); return send(res, 200, { id: data.id })
    }
    const shareMatch = path.match(/^\/api\/studies\/([a-f0-9-]+)\/shares$/i)
    if (shareMatch && UUID.test(shareMatch[1]) && ['GET','POST'].includes(req.method)) {
      const study = await pool.query('SELECT payload FROM studies WHERE id=$1 AND owner_id=$2', [shareMatch[1],user.id])
      if (!study.rows[0]) return req.method === 'GET' ? send(res, 200, { shares: [] }) : send(res, 404, { error: 'Study not found.' })
      if (req.method === 'GET') {
        const result = await pool.query('SELECT id,expires_at AS "expiresAt",revoked_at AS "revokedAt",created_at AS "createdAt" FROM share_grants WHERE study_id=$1 AND owner_id=$2 ORDER BY created_at DESC', [shareMatch[1],user.id])
        return send(res, 200, { shares: result.rows })
      }
      const data = await body(req)
      if (!Number.isInteger(data.expiresInHours) || data.expiresInHours < 1 || data.expiresInHours > 168 || typeof data.includeIdentity !== 'boolean' || typeof data.includeImages !== 'boolean') return send(res, 400, { error: 'Choose expiry from 1 to 168 hours and explicit identity/image options.' })
      const token = newToken(), id = randomUUID(), expiresAt = new Date(Date.now() + data.expiresInHours * 3600000)
      await pool.query('INSERT INTO share_grants(id,owner_id,study_id,token_hash,expires_at,snapshot_html) VALUES ($1,$2,$3,$4,$5,$6)', [id,user.id,shareMatch[1],hashToken(token),expiresAt,sharedDocument(study.rows[0].payload,data)])
      await audit(user.id, 'share.created')
      return send(res, 201, { share: { id, expiresAt: expiresAt.toISOString(), url: `${publicOrigin}/shared#${token}` } })
    }
    if (path.startsWith('/api/shares/') && req.method === 'DELETE') {
      const id = path.slice('/api/shares/'.length)
      if (!UUID.test(id)) return send(res, 400, { error: 'Invalid share ID.' })
      const result = await pool.query('UPDATE share_grants SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND owner_id=$2 RETURNING id', [id,user.id])
      if (!result.rowCount) return send(res, 404, { error: 'Share not found.' })
      await audit(user.id, 'share.revoked'); return send(res, 200, { ok: true })
    }
    if (path.startsWith('/api/studies/') && req.method === 'GET') {
      const id = path.slice('/api/studies/'.length)
      if (!UUID.test(id)) return send(res,400,{error:'Invalid study ID.'})
      const result = await pool.query('SELECT payload FROM studies WHERE id=$1 AND owner_id=$2',[id,user.id])
      return result.rows[0] ? send(res,200,{study:result.rows[0].payload}) : send(res,404,{error:'Study not found.'})
    }
    if (path.startsWith('/api/studies/') && req.method === 'DELETE') {
      const id = path.slice('/api/studies/'.length)
      if (!UUID.test(id)) return send(res, 400, { error: 'Invalid study ID.' })
      const result = await pool.query('DELETE FROM studies WHERE id=$1 AND owner_id=$2', [id,user.id])
      if (!result.rowCount) return send(res, 404, { error: 'Study not found.' })
      await audit(user.id, 'study.deleted'); return send(res, 200, { ok: true })
    }
    return send(res, 404, { error: 'Endpoint not found.' })
  } catch (error) {
    if (error.code === '23505') return send(res, 409, { error: 'This record already exists.' })
    if (error.status) return send(res, error.status, { error: error.message })
    // Vercel's lazy body parser reports malformed or oversized bodies with statusCode.
    if (error.statusCode === 400 || error.statusCode === 413) return send(res, error.statusCode, { error: error.statusCode === 413 ? 'Request exceeds the allowed size' : 'Request must contain a JSON object' })
    console.error(JSON.stringify({ event: 'http.error', requestId, code: error.code || error.name }))
    if (!res.headersSent) send(res, 503, { error: 'Service unavailable. Please retry.' })
  }
}
if (!process.env.VERCEL) {
const server = http.createServer(handler)
server.requestTimeout = 30000
server.headersTimeout = 15000
server.listen(port, '0.0.0.0', () => console.log(`VoxelRad AI API listening on ${port}`))
const cleanupTimer = setInterval(() => { cleanup().catch(() => {}) }, 3600000).unref()
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => { clearInterval(cleanupTimer); server.close(() => { pool.end().then(() => process.exit(0)) }); setTimeout(() => process.exit(1), 10000).unref() })
}
