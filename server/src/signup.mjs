// Self-service sign-up: email + password (confirmed by an emailed link) or Google. Every new account starts
// pending and cannot sign in until an administrator approves it in Administration → Users.
import { randomUUID } from 'node:crypto'
import * as oidcClient from 'openid-client'
import { hashPassword, hashToken, newToken, normalizeEmail, validEmail, validPassword } from './security.mjs'

export const GOOGLE_ISSUER = 'https://accounts.google.com'
const flowCookie = 'radgenis_google_flow'
const opaque = /^[A-Za-z0-9_-]{43}$/
const LIMITS = { name: 120, organization: 160, role: 80 }
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : ''

/** Validates a sign-up form. Returns { spam }, { error } or { value } ready to store. */
export function parseSignup(data) {
  if (!data || typeof data !== 'object') return { error: 'Request must contain a JSON object.' }
  if (clean(data.website)) return { spam: true }
  const value = { name: clean(data.name), email: normalizeEmail(data.email), organization: clean(data.organization), role: clean(data.role), password: data.password }
  if (!value.name) return { error: 'Enter your name.' }
  if (!validEmail(value.email)) return { error: 'Enter a valid work email address.' }
  if (!value.organization) return { error: 'Enter your organization.' }
  for (const [field, max] of Object.entries(LIMITS)) if (value[field].length > max) return { error: `${field[0].toUpperCase() + field.slice(1)} must be ${max} characters or fewer.` }
  if (!validPassword(value.password)) return { error: 'Choose a password of at least 12 characters.' }
  return { value }
}

/** Why an account cannot sign in yet, or null when it can. Disabled accounts are handled as wrong credentials. */
export function signInBlock(account) {
  if (account.signup_source === 'password' && !account.email_verified_at) return { status: 403, code: 'email_unverified', error: 'Confirm your email first: open the link we sent you, then sign in.' }
  if (account.approval === 'pending') return { status: 403, code: 'approval_pending', error: 'Your account is waiting for approval. We will email you as soon as an administrator approves it.' }
  return null
}

export function googleSettings(env, publicOrigin) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return { enabled: false }
  const origin = new URL(publicOrigin)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  if (origin.protocol !== 'https:' && !local) throw new Error('Google sign-in requires an HTTPS PUBLIC_ORIGIN')
  return { enabled: true, clientId: env.GOOGLE_CLIENT_ID.trim(), clientSecret: env.GOOGLE_CLIENT_SECRET.trim(), callbackUrl: new URL('/api/auth/google/callback', origin).href }
}

/** Google's ID token claims → the identity to store. Only Google-verified email addresses are accepted. */
export function validateGoogleClaims(claims) {
  if (!claims || ![GOOGLE_ISSUER, 'accounts.google.com'].includes(claims.iss)) throw new Error('Invalid identity issuer')
  if (typeof claims.sub !== 'string' || !/^[0-9A-Za-z_-]{1,255}$/.test(claims.sub)) throw new Error('Invalid identity subject')
  const email = normalizeEmail(claims.email)
  if (!validEmail(email) || claims.email_verified !== true) throw new Error('Google did not confirm this email address')
  return { subject: claims.sub, email, name: clean(claims.name).slice(0, LIMITS.name) }
}

const googleFlowCookie = (token, secure, maxAge = 600) => `${flowCookie}=${token}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
function readGoogleFlowCookie(header = '') {
  const value = header.split(';').map(part => part.trim()).find(part => part.startsWith(`${flowCookie}=`))?.slice(flowCookie.length + 1)
  return value && opaque.test(value) ? value : null
}

/**
 * Routes: GET /api/signup/config, POST /api/signup, POST /api/signup/verify, GET /api/auth/google/start and
 * /api/auth/google/callback. `schedule(promise)` keeps email sending alive after the response.
 */
export function createSignupRoutes({ pool, publicOrigin, secureCookies, body, send, rateLimit, clientIp, notifier, issueSession, schedule = promise => promise, env = process.env, client = oidcClient, log = console }) {
  const google = googleSettings(env, publicOrigin)
  const mail = (promise, what) => schedule(Promise.resolve(promise).catch(error => log.error(`${what} email failed:`, error?.code || error?.message || 'unknown error')))
  let discovery
  async function googleConfig() {
    if (!discovery) discovery = client.discovery(new URL(GOOGLE_ISSUER), google.clientId, google.clientSecret, undefined, { timeout: 10 }).catch(error => { discovery = undefined; throw error })
    return discovery
  }
  async function transaction(fn) {
    const tx = await pool.connect()
    try { await tx.query('BEGIN'); const result = await fn(tx); await tx.query('COMMIT'); return result }
    catch (error) { await tx.query('ROLLBACK'); throw error } finally { tx.release() }
  }
  const redirect = (res, location, cookies) => { res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(cookies ? { 'Set-Cookie': cookies } : {}) }); res.end() }

  async function signup(req, res) {
    if (!notifier.enabled) return send(res, 503, { error: 'Sign-up by email is not available right now. Use Google, or request access instead.' })
    const parsed = parseSignup(await body(req, 4096))
    if (parsed.spam) return send(res, 202, { ok: true })
    if (parsed.error) return send(res, 400, { error: parsed.error })
    const { name, email, organization, role, password } = parsed.value
    if (await rateLimit(`signup-ip:${clientIp(req)}`, 5) || await rateLimit(`signup-email:${email}`, 3)) return send(res, 429, { error: 'Too many sign-up attempts. Try again in 15 minutes.' }, { 'Retry-After': '900' })
    const passwordHash = await hashPassword(password)
    const token = newToken()
    // The reply is the same whether or not the email is new, so the form cannot be used to discover accounts.
    const resend = await transaction(async tx => {
      const existing = (await tx.query('SELECT id,signup_source,email_verified_at,full_name FROM users WHERE email=$1 FOR UPDATE', [email])).rows[0]
      if (existing) {
        // Only an unconfirmed email sign-up gets a fresh link; its password and details are left as first entered.
        if (existing.signup_source !== 'password' || existing.email_verified_at) return null
        await tx.query('DELETE FROM email_verifications WHERE user_id=$1', [existing.id])
        await tx.query("INSERT INTO email_verifications(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '24 hours')", [hashToken(token), existing.id])
        return { name: existing.full_name, email }
      }
      const id = randomUUID()
      await tx.query("INSERT INTO users(id,email,password_hash,role,approval,signup_source,full_name,organization,job_role) VALUES ($1,$2,$3,'clinician','pending','password',$4,$5,$6)", [id, email, passwordHash, name, organization, role])
      await tx.query("INSERT INTO email_verifications(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '24 hours')", [hashToken(token), id])
      await tx.query("INSERT INTO audit_events(actor_id,event_type,subject_id) VALUES ($1,'signup.created',$2)", [id, id])
      return { name, email }
    })
    if (resend) mail(notifier.signupVerification(resend, token), 'Sign-up confirmation')
    return send(res, 202, { ok: true })
  }

  async function verify(req, res) {
    const data = await body(req, 1024)
    if (typeof data.token !== 'string' || !opaque.test(data.token)) return send(res, 400, { error: 'This confirmation link is invalid or has expired. Sign up again to get a new one.' })
    if (await rateLimit(`signup-verify:${clientIp(req)}`, 20)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' }, { 'Retry-After': '900' })
    const user = await transaction(async tx => {
      const consumed = (await tx.query('DELETE FROM email_verifications WHERE token_hash=$1 AND expires_at>now() RETURNING user_id', [hashToken(data.token)])).rows[0]
      if (!consumed) return null
      const row = (await tx.query("UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1 AND NOT disabled RETURNING email,full_name,organization,job_role,approval", [consumed.user_id])).rows[0]
      if (!row) return null
      await tx.query('DELETE FROM email_verifications WHERE user_id=$1', [consumed.user_id])
      await tx.query("INSERT INTO audit_events(actor_id,event_type,subject_id) VALUES ($1,'signup.verified',$2)", [consumed.user_id, consumed.user_id])
      return row
    })
    if (!user) return send(res, 400, { error: 'This confirmation link is invalid or has expired. Sign up again to get a new one.' })
    if (user.approval === 'pending') mail(notifier.signupPending({ name: user.full_name, email: user.email, organization: user.organization, role: user.job_role, source: 'password' }), 'Sign-up approval notice')
    return send(res, 200, { verified: true, approval: user.approval })
  }

  async function googleStart(req, res) {
    if (await rateLimit(`google-start:${clientIp(req)}`, 30)) return redirect(res, '/workspace?signup=busy')
    const config = await googleConfig()
    const state = newToken(), browser = newToken(), verifier = client.randomPKCECodeVerifier(), nonce = client.randomNonce()
    const url = client.buildAuthorizationUrl(config, { redirect_uri: google.callbackUrl, scope: 'openid email profile', response_type: 'code', code_challenge: await client.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', state, nonce, prompt: 'select_account' })
    await transaction(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(193823)')
      await tx.query('DELETE FROM oidc_login_states WHERE expires_at<=now()')
      const previous = readGoogleFlowCookie(req.headers.cookie)
      if (previous) await tx.query('DELETE FROM oidc_login_states WHERE browser_hash=$1', [hashToken(previous)])
      if ((await tx.query('SELECT count(*)::int AS total FROM oidc_login_states')).rows[0].total >= 10000) throw Object.assign(new Error('busy'), { busy: true })
      await tx.query("INSERT INTO oidc_login_states(state_hash,browser_hash,code_verifier,nonce,issuer,expires_at) VALUES ($1,$2,$3,$4,$5,now()+interval '10 minutes')", [hashToken(state), hashToken(browser), verifier, nonce, GOOGLE_ISSUER])
    })
    redirect(res, url.href, googleFlowCookie(browser, secureCookies))
  }

  async function googleCallback(req, res) {
    const clear = googleFlowCookie('', secureCookies, 0)
    const url = new URL(req.url, publicOrigin), state = url.searchParams.get('state'), browser = readGoogleFlowCookie(req.headers.cookie)
    if (url.searchParams.get('error')) return redirect(res, '/workspace?signup=google-cancelled', clear)
    if (!state || !opaque.test(state) || !browser || url.searchParams.getAll('state').length !== 1) return redirect(res, '/workspace?signup=google-error', clear)
    // Consume the flow before the code exchange so a callback cannot be replayed.
    const flow = (await pool.query('DELETE FROM oidc_login_states WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() AND issuer=$3 RETURNING *', [hashToken(state), hashToken(browser), GOOGLE_ISSUER])).rows[0]
    if (!flow) return redirect(res, '/workspace?signup=google-error', clear)
    let identity
    try {
      const tokens = await client.authorizationCodeGrant(await googleConfig(), url, { pkceCodeVerifier: flow.code_verifier, expectedState: state, expectedNonce: flow.nonce, idTokenExpected: true })
      identity = validateGoogleClaims(tokens.claims())
    } catch (error) {
      log.error('Google sign-in failed:', error?.message || 'unknown error')
      return redirect(res, '/workspace?signup=google-error', clear)
    }
    const unusablePassword = await hashPassword(newToken())
    const outcome = await transaction(async tx => {
      const linked = (await tx.query('SELECT u.id,u.email,u.role,u.disabled,u.approval,u.signup_source,u.email_verified_at FROM oidc_identities i JOIN users u ON u.id=i.user_id WHERE i.issuer=$1 AND i.subject=$2 FOR UPDATE OF u', [GOOGLE_ISSUER, identity.subject])).rows[0]
      if (linked) {
        if (linked.disabled) return { location: '/workspace?signup=unavailable' }
        if (linked.approval === 'pending') return { location: '/workspace?signup=pending' }
        const cookie = await issueSession(tx, linked)
        await tx.query('UPDATE users SET last_login_at=now() WHERE id=$1', [linked.id])
        await tx.query("INSERT INTO audit_events(actor_id,event_type) VALUES ($1,'login.google')", [linked.id])
        return { location: '/workspace', cookie }
      }
      // An existing account is never linked automatically by email: its owner signs in with their password.
      if ((await tx.query('SELECT 1 FROM users WHERE email=$1', [identity.email])).rowCount) return { location: '/workspace?signup=exists' }
      const id = randomUUID()
      await tx.query("INSERT INTO users(id,email,password_hash,role,approval,signup_source,email_verified_at,full_name) VALUES ($1,$2,$3,'clinician','pending','google',now(),$4)", [id, identity.email, unusablePassword, identity.name])
      await tx.query('INSERT INTO oidc_identities(issuer,subject,user_id) VALUES ($1,$2,$3)', [GOOGLE_ISSUER, identity.subject, id])
      await tx.query("INSERT INTO audit_events(actor_id,event_type,subject_id) VALUES ($1,'signup.google',$2)", [id, id])
      return { location: '/workspace?signup=pending', created: true }
    })
    if (outcome.created) mail(notifier.signupPending({ name: identity.name, email: identity.email, source: 'google' }), 'Sign-up approval notice')
    redirect(res, outcome.location, outcome.cookie ? [clear, outcome.cookie] : clear)
  }

  async function route(req, res, path) {
    if (path === '/api/signup/config' && req.method === 'GET') { send(res, 200, { password: notifier.enabled, google: google.enabled }); return true }
    if (path === '/api/signup' && req.method === 'POST') { await signup(req, res); return true }
    if (path === '/api/signup/verify' && req.method === 'POST') { await verify(req, res); return true }
    if (path === '/api/auth/google/start' || path === '/api/auth/google/callback') {
      if (req.method !== 'GET') return false
      if (!google.enabled) { redirect(res, '/workspace?signup=google-off'); return true }
      try { await (path.endsWith('/start') ? googleStart(req, res) : googleCallback(req, res)) }
      catch (error) {
        log.error('Google sign-in unavailable:', error?.message || 'unknown error')
        redirect(res, error?.busy ? '/workspace?signup=busy' : '/workspace?signup=google-error', googleFlowCookie('', secureCookies, 0))
      }
      return true
    }
    return false
  }
  return { route, googleEnabled: google.enabled }
}
