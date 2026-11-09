import http from 'node:http'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { allowedOrigin, hashPassword, hashToken, newToken, normalizeEmail, readSessionCookie, sessionCookie, validEmail, validPassword, verifyPassword } from './security.mjs'
import { sharedDocument } from './share.mjs'
import { migrate } from './migrate.mjs'
import { validStudy } from './studyValidation.mjs'
import { pagination } from './pagination.mjs'

const { Pool } = pg
const port = Number(process.env.PORT || 8080)
const publicOrigin = new URL(process.env.PUBLIC_ORIGIN || 'http://localhost:5173').origin
const secureCookies = publicOrigin.startsWith('https:')
const localOverride = process.env.ALLOW_INSECURE_LOCALHOST === 'true' && ['localhost','127.0.0.1','[::1]'].includes(new URL(publicOrigin).hostname)
if (process.env.NODE_ENV === 'production' && !secureCookies && !localOverride) throw new Error('Production requires HTTPS PUBLIC_ORIGIN (or explicit loopback-only ALLOW_INSECURE_LOCALHOST=true).')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_SIZE || 10), connectionTimeoutMillis: 5000, statement_timeout: 10000 })
pool.on('error', () => console.error('Database connection interrupted'))
await migrate(pool)

// Bootstrap is opt-in and only allowed when the user table is empty. No shipped credentials.
if (process.env.BOOTSTRAP_ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_PASSWORD) {
  const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL)
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD
  if (!validEmail(email) || !validPassword(password)) throw new Error('Bootstrap requires a valid email and password of 12–256 characters')
  const passwordHash = await hashPassword(password)
  const client = await pool.connect()
  try { await client.query('BEGIN'); await client.query('LOCK TABLE users IN EXCLUSIVE MODE'); await client.query("INSERT INTO users (id,email,password_hash,role) SELECT $1,$2,$3,'admin' WHERE NOT EXISTS (SELECT 1 FROM users)", [randomUUID(), email, passwordHash]); await client.query('COMMIT') }
  catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
const dummyHash = await hashPassword(newToken())
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function send(res, status, body, extra = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra }); res.end(JSON.stringify(body)) }
async function body(req, limit = 8192) {
  const chunks = []; let bytes = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) { bytes += chunk.length; if (bytes > limit) { req.resume(); const error = new Error('Request exceeds the allowed size'); error.status = 413; throw error } chunks.push(chunk) }
  try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data } catch { const error = new Error('Request must contain a JSON object'); error.status = 400; throw error }
}
const audit = (actor, event) => pool.query('INSERT INTO audit_events(actor_id,event_type) VALUES ($1,$2)', [actor, event])
async function userFor(req) {
  const token = readSessionCookie(req.headers.cookie)
  if (!token) return null
  const result = await pool.query('SELECT u.id,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND NOT u.disabled', [hashToken(token)])
  return result.rows[0] || null
}
async function rateLimit(key) {
  const result = await pool.query("INSERT INTO login_attempts(key_hash,attempts,resets_at) VALUES ($1,1,now()+interval '15 minutes') ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN login_attempts.resets_at<now() THEN 1 ELSE login_attempts.attempts+1 END,resets_at=CASE WHEN login_attempts.resets_at<now() THEN now()+interval '15 minutes' ELSE login_attempts.resets_at END RETURNING attempts", [hashToken(key)])
  return result.rows[0].attempts > 15
}
const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://internal').pathname
    if (path === '/healthz' && req.method === 'GET') { await pool.query('SELECT 1'); return send(res, 200, { status: 'ok' }) }
    if (['POST','PUT','PATCH','DELETE'].includes(req.method) && !allowedOrigin(req.headers.origin, publicOrigin)) return send(res, 403, { error: 'Request origin is not allowed' })
    if (path === '/api/login' && req.method === 'POST') {
      const data = await body(req); const email = normalizeEmail(data.email)
      if (!validEmail(email) || typeof data.password !== 'string' || data.password.length > 256) return send(res, 401, { error: 'Email or password is incorrect.' })
      if (await rateLimit(`email:${email}`)) return send(res, 429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' }, { 'Retry-After': '900' })
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
        await client.query('COMMIT')
        return send(res, 200, { user: { id: account.id, email: account.email, role: account.role } }, { 'Set-Cookie': sessionCookie(token, secureCookies) })
      } catch(error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }
    if (path.startsWith('/api/shared/') && req.method === 'GET') {
      const token = path.slice('/api/shared/'.length)
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return send(res, 404, { error: 'This share link is unavailable or expired.' })
      const result = await pool.query('SELECT snapshot_html FROM share_grants WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()', [hashToken(token)])
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
    if (path.startsWith('/api/admin/') && user.role !== 'admin') return send(res, 403, { error: 'Administrator access is required.' })
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
      const result = await pool.query('INSERT INTO users(id,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id,email,role', [randomUUID(), email, await hashPassword(data.password), data.role])
      await audit(user.id, 'user.created'); return send(res, 201, { user: result.rows[0] })
    }
    const userMatch = path.match(/^\/api\/admin\/users\/([a-f0-9-]+)$/i)
    if (userMatch && UUID.test(userMatch[1]) && req.method === 'PATCH') {
      const data = await body(req), target = userMatch[1]
      if (target === user.id && data.disabled === true) return send(res,400,{error:'You cannot disable your own account.'})
      if (typeof data.disabled !== 'boolean' && !validPassword(data.password)) return send(res,400,{error:'Supply disabled true/false or a 12–256 character password.'})
      if ('password' in data && !validPassword(data.password)) return send(res,400,{error:'Password must contain 12–256 characters.'})
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
      const data = await body(req, 25 * 1024 * 1024)
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
      return send(res, 201, { share: { id, expiresAt: expiresAt.toISOString(), url: `${publicOrigin}/api/shared/${token}` } })
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
    console.error('Request failed', error.code || error.name)
    if (!res.headersSent) send(res, 503, { error: 'Service unavailable. Please retry.' })
  }
})
server.requestTimeout = 30000
server.headersTimeout = 15000
server.listen(port, '0.0.0.0', () => console.log(`Skanda API listening on ${port}`))
const cleanup = setInterval(() => { pool.query('DELETE FROM sessions WHERE expires_at<now()').catch(() => {}); pool.query('DELETE FROM login_attempts WHERE resets_at<now()').catch(() => {}) }, 3600000).unref()
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => { clearInterval(cleanup); server.close(() => { pool.end().then(() => process.exit(0)) }); setTimeout(() => process.exit(1), 10000).unref() })
