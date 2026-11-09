import * as oidcClient from 'openid-client'
import { hashToken, newToken, readSessionCookie, sessionCookie, verifyPassword } from './security.mjs'

const cookieName = 'skanda_oidc_flow'
const opaque = /^[A-Za-z0-9_-]{43}$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const localHost = hostname => ['localhost','127.0.0.1','[::1]'].includes(hostname) || hostname.endsWith('.localhost')
export const validOidcSubject = subject => typeof subject === 'string' && subject.length > 0 && subject.length <= 255 && !/[\x00-\x20\x7f]/.test(subject)
export function readOidcSettings(env, publicOrigin) {
  if (env.OIDC_ENABLED !== 'true') return { enabled: false }
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) throw new Error('OIDC_ENABLED requires OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET')
  const issuer = new URL(env.OIDC_ISSUER), origin = new URL(publicOrigin)
  if (issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname.includes('/.well-known/')) throw new Error('OIDC_ISSUER must be an issuer identifier without credentials, query, fragment or discovery path')
  const insecureLocal = env.OIDC_ALLOW_INSECURE_LOCALHOST === 'true' && localHost(issuer.hostname) && localHost(origin.hostname)
  if (issuer.protocol !== 'https:' && !(insecureLocal && issuer.protocol === 'http:')) throw new Error('OIDC issuer requires HTTPS except explicitly enabled loopback development')
  if (origin.protocol !== 'https:' && !(insecureLocal && origin.protocol === 'http:')) throw new Error('OIDC callback requires HTTPS except explicitly enabled loopback development')
  return { enabled: true, issuer: issuer.href, clientId: env.OIDC_CLIENT_ID, clientSecret: env.OIDC_CLIENT_SECRET, insecureLocal, providerName: (env.OIDC_PROVIDER_NAME || 'Keycloak').slice(0,80), requiredAcr: env.OIDC_REQUIRED_ACR || null, callbackUrl: new URL('/api/oidc/callback', origin).href }
}
export function oidcFlowCookie(token, secure, maxAge = 600) {
  // Lax is necessary for the IdP's top-level GET callback. The application session remains Strict.
  return `${cookieName}=${token}; Path=/api/oidc; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}
export function readOidcFlowCookie(header = '') {
  const value = header.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  return value && opaque.test(value) ? value : null
}
export function validateIdentityClaims(claims, settings) {
  if (!claims || claims.iss !== settings.issuer || !validOidcSubject(claims.sub)) throw new Error('Invalid identity claims')
  if (settings.requiredAcr && claims.acr !== settings.requiredAcr) throw new Error('Required authentication assurance was not satisfied')
  return { issuer: claims.iss, subject: claims.sub }
}

/** issueSession(tx, user, req) inserts the existing app session inside tx and returns its Set-Cookie string. */
export function createOidcRoutes({ pool, publicOrigin, secureCookies, userFor, body, send, issueSession, rateLimit, env = process.env, client = oidcClient }) {
  const settings = readOidcSettings(env, publicOrigin)
  let discovery
  async function configuration() {
    if (!discovery) discovery = client.discovery(new URL(settings.issuer), settings.clientId, settings.clientSecret, undefined, { timeout: 10, execute: [client.enableNonRepudiationChecks,...(settings.insecureLocal ? [client.allowInsecureRequests] : [])] }).then(config => {
      const metadata = config.serverMetadata()
      if (metadata.issuer !== settings.issuer) throw new Error('OIDC issuer mismatch')
      for (const name of ['authorization_endpoint','token_endpoint','jwks_uri']) {
        const endpoint = new URL(metadata[name])
        if (endpoint.username || endpoint.password || endpoint.hash || (endpoint.protocol !== 'https:' && !(settings.insecureLocal && endpoint.protocol === 'http:' && localHost(endpoint.hostname)))) throw new Error('Unsafe OIDC endpoint')
      }
      return config
    }).catch(error => { discovery = undefined; throw error })
    return discovery
  }
  const clearFlow = () => oidcFlowCookie('', secureCookies, 0)
  async function transaction(fn) {
    const tx = await pool.connect()
    try { await tx.query('BEGIN'); const result = await fn(tx); await tx.query('COMMIT'); return result }
    catch (error) { await tx.query('ROLLBACK'); throw error } finally { tx.release() }
  }
  function failure(status, message) { const error = new Error(message); error.status = status; return error }
  async function reauthenticate(tx, user, password) {
    if (typeof password !== 'string' || password.length > 256) throw failure(400, 'Confirm your current password.')
    const result = await tx.query('SELECT id,email,role,disabled,password_hash FROM users WHERE id=$1 FOR UPDATE', [user.id])
    const account = result.rows[0]
    if (!account || account.disabled || !await verifyPassword(password, account.password_hash)) throw failure(403, 'Current password is incorrect or the account is unavailable.')
    return account
  }
  async function reauthenticationLimit(user) {
    if (rateLimit && await rateLimit(`oidc-reauth:${user.id}`)) throw failure(429,'Too many attempts. Try again in 15 minutes.')
  }
  async function start(req, res, linking) {
    const user = linking ? await userFor(req) : null
    if (linking && !user) return send(res,401,{error:'Sign in before linking an identity.'})
    const data = linking ? await body(req) : null
    const linkSession = linking ? readSessionCookie(req.headers.cookie) : null
    if (linking && !linkSession) return send(res,401,{error:'Sign in before linking an identity.'})
    if (linking) await reauthenticationLimit(user)
    const config = await configuration()
    const state = newToken(), browser = newToken(), verifier = client.randomPKCECodeVerifier(), nonce = client.randomNonce()
    const challenge = await client.calculatePKCECodeChallenge(verifier)
    const url = client.buildAuthorizationUrl(config, { redirect_uri: settings.callbackUrl, scope: 'openid', response_type: 'code', response_mode: 'query', code_challenge: challenge, code_challenge_method: 'S256', state, nonce, max_age: '300', ...(settings.requiredAcr ? { acr_values: settings.requiredAcr } : {}) })
    await transaction(async tx => {
      if (linking) {
        await reauthenticate(tx,user,data.currentPassword)
        const active = await tx.query('SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE',[hashToken(linkSession),user.id])
        if (!active.rowCount) throw failure(401,'Sign in before linking an identity.')
      }
      // Bound unauthenticated outstanding flow state; serialized count prevents limit races.
      await tx.query('SELECT pg_advisory_xact_lock(193823)')
      await tx.query('DELETE FROM oidc_login_states WHERE expires_at<=now()')
      const previous = readOidcFlowCookie(req.headers.cookie)
      if (previous) await tx.query('DELETE FROM oidc_login_states WHERE browser_hash=$1',[hashToken(previous)])
      const count = await tx.query('SELECT count(*)::int AS total FROM oidc_login_states')
      if (count.rows[0].total >= 10000) throw failure(503,'Sign-in is busy. Please retry shortly.')
      await tx.query("INSERT INTO oidc_login_states(state_hash,browser_hash,code_verifier,nonce,issuer,link_user_id,link_session_hash,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')",[hashToken(state),hashToken(browser),verifier,nonce,settings.issuer,user?.id || null,linkSession ? hashToken(linkSession) : null])
    })
    const headers = { 'Set-Cookie': oidcFlowCookie(browser,secureCookies) }
    if (linking) return send(res,200,{url:url.href},headers)
    res.writeHead(303,{Location:url.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...headers}); res.end()
  }
  async function callback(req,res) {
    const url = new URL(req.url,publicOrigin), state = url.searchParams.get('state'), browser = readOidcFlowCookie(req.headers.cookie)
    if (!state || !opaque.test(state) || !browser || url.searchParams.getAll('state').length !== 1) return send(res,400,{error:'Sign-in expired or could not be verified. Start again.'},{'Set-Cookie':clearFlow()})
    // Atomically consume before code exchange: callbacks cannot be replayed or raced.
    const consumed = await pool.query('DELETE FROM oidc_login_states WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() AND issuer=$3 RETURNING *',[hashToken(state),hashToken(browser),settings.issuer])
    const flow = consumed.rows[0]
    if (!flow) return send(res,400,{error:'Sign-in expired or could not be verified. Start again.'},{'Set-Cookie':clearFlow()})
    try {
      const config = await configuration()
      const tokens = await client.authorizationCodeGrant(config,url,{pkceCodeVerifier:flow.code_verifier,expectedState:state,expectedNonce:flow.nonce,idTokenExpected:true,maxAge:300})
      const identity = validateIdentityClaims(tokens.claims(),settings)
      const cookie = await transaction(async tx => {
        if (flow.link_user_id) {
          const accounts = await tx.query('SELECT id,email,role,disabled FROM users WHERE id=$1 FOR UPDATE',[flow.link_user_id])
          const account = accounts.rows[0]
          const session = await tx.query('SELECT 1 FROM sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE',[flow.link_session_hash,flow.link_user_id])
          if (!account || account.disabled || !session.rowCount) throw failure(401,'Your session changed. Sign in and link again.')
          await tx.query('INSERT INTO oidc_identities(issuer,subject,user_id) VALUES ($1,$2,$3)',[identity.issuer,identity.subject,account.id])
          await tx.query('INSERT INTO audit_events(actor_id,event_type) VALUES ($1,$2)',[account.id,'account.oidc_linked'])
          return null
        }
        const accounts = await tx.query('SELECT u.id,u.email,u.role,u.disabled FROM oidc_identities i JOIN users u ON u.id=i.user_id WHERE i.issuer=$1 AND i.subject=$2 FOR UPDATE OF u',[identity.issuer,identity.subject])
        const account = accounts.rows[0]
        if (!account || account.disabled) throw failure(403,'This identity is not linked to an active Skanda account. Sign in with your existing account to link it.')
        // Recheck after acquiring the user lock: unlink may have completed while this query waited.
        const stillLinked = await tx.query('SELECT 1 FROM oidc_identities WHERE issuer=$1 AND subject=$2 AND user_id=$3',[identity.issuer,identity.subject,account.id])
        if (!stillLinked.rowCount) throw failure(403,'This identity is no longer linked to an active Skanda account.')
        const cookie = await issueSession(tx,{id:account.id,email:account.email,role:account.role},req)
        await tx.query('UPDATE users SET last_login_at=now() WHERE id=$1',[account.id])
        await tx.query('INSERT INTO audit_events(actor_id,event_type) VALUES ($1,$2)',[account.id,'login.oidc'])
        return cookie
      })
      res.writeHead(303,{Location:flow.link_user_id ? '/?oidc=linked' : '/?oidc=signed-in','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':cookie ? [clearFlow(),cookie] : clearFlow()}); res.end()
    } catch (error) {
      const status = error.code === '23505' ? 409 : error.status || 400
      const message = error.code === '23505' ? 'This account or identity is already linked. Unlink it explicitly before linking another.' : error.status ? error.message : 'Identity verification failed. Start sign-in again.'
      send(res,status,{error:message},{'Set-Cookie':clearFlow()})
    }
  }
  async function route(req,res) {
    const path = new URL(req.url,publicOrigin).pathname
    const adminMapping = path.match(/^\/api\/admin\/users\/([a-f0-9-]+)\/oidc$/i)
    if (!path.startsWith('/api/oidc/') && !adminMapping) return false
    if (path === '/api/oidc/config' && req.method === 'GET') { send(res,200,{enabled:settings.enabled,providerName:settings.enabled ? settings.providerName : 'Keycloak',requiredAcr:settings.requiredAcr || null}); return true }
    if (!settings.enabled) { send(res,404,{error:'Organization sign-in is not configured.'}); return true }
    // Defense in depth: caller should also retain its global mutation-Origin guard.
    if (['POST','DELETE'].includes(req.method) && req.headers.origin !== publicOrigin) { send(res,403,{error:'Request origin is not allowed.'}); return true }
    try {
      if (path === '/api/oidc/login' && req.method === 'GET') { await start(req,res,false); return true }
      if (path === '/api/oidc/link' && req.method === 'POST') { await start(req,res,true); return true }
      if (path === '/api/oidc/callback' && req.method === 'GET') { await callback(req,res); return true }
      const user = await userFor(req)
      if (!user) { send(res,401,{error:'Sign in to continue.'}); return true }
      if (path === '/api/oidc/identity' && req.method === 'GET') {
        const result = await pool.query('SELECT issuer,subject,created_at AS "linkedAt" FROM oidc_identities WHERE user_id=$1 AND issuer=$2',[user.id,settings.issuer])
        send(res,200,result.rows[0] ? {linked:true,...result.rows[0]} : {linked:false}); return true
      }
      if (path === '/api/oidc/identity' && req.method === 'DELETE') {
        const data = await body(req)
        await reauthenticationLimit(user)
        await transaction(async tx => {
          await reauthenticate(tx,user,data.currentPassword)
          await tx.query('DELETE FROM oidc_identities WHERE user_id=$1 AND issuer=$2',[user.id,settings.issuer])
          await tx.query('DELETE FROM sessions WHERE user_id=$1',[user.id])
          await tx.query('DELETE FROM oidc_login_states WHERE link_user_id=$1',[user.id])
          await tx.query('INSERT INTO audit_events(actor_id,event_type) VALUES ($1,$2)',[user.id,'account.oidc_unlinked'])
        })
        send(res,200,{ok:true},{'Set-Cookie':sessionCookie('',secureCookies,0)}); return true
      }
      if (adminMapping && uuid.test(adminMapping[1]) && req.method === 'POST') {
        if (user.role !== 'admin') { send(res,403,{error:'Administrator access is required.'}); return true }
        const data = await body(req), target=adminMapping[1]
        if (!validOidcSubject(data.subject)) { send(res,400,{error:'Supply the exact provider subject identifier.'}); return true }
        await reauthenticationLimit(user)
        await transaction(async tx => {
          // Deterministic lock order avoids opposing administrator-link deadlocks.
          const accounts=await tx.query('SELECT id,role,disabled FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[user.id,target]])
          const actor=await reauthenticate(tx,user,data.currentPassword)
          if(actor.role!=='admin') throw failure(403,'Administrator access is required.')
          if(!accounts.rows.some(row=>row.id===target && !row.disabled)) throw failure(404,'Active user not found.')
          await tx.query('INSERT INTO oidc_identities(issuer,subject,user_id) VALUES ($1,$2,$3)',[settings.issuer,data.subject,target])
          await tx.query('INSERT INTO audit_events(actor_id,event_type) VALUES ($1,$2)',[user.id,'account.oidc_linked_admin'])
        })
        send(res,201,{linked:true}); return true
      }
      send(res,404,{error:'Endpoint not found.'}); return true
    } catch (error) {
      if(error.code==='23505') send(res,409,{error:'This account or identity is already linked.'})
      else if(error.status) send(res,error.status,{error:error.message})
      else send(res,503,{error:'Organization sign-in is unavailable. Please retry.'})
      return true
    }
  }
  return { route, enabled: settings.enabled, requiredAcr: settings.requiredAcr || null }
}
