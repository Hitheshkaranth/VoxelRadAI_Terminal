import assert from 'node:assert/strict'
import { accountRequest } from '../src/components/shell/accountRequests.ts'

const originalFetch = globalThis.fetch
const requests: { url: string; init: RequestInit }[] = []
let status = 200
let payload: unknown = { ok: true }
globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
  requests.push({ url: String(url), init })
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch
try {
  await accountRequest('/api/password-recovery', { token: 'one-use-secret', password: 'new-secret-password' })
  assert.equal(requests[0].url, '/api/password-recovery')
  assert.equal(requests[0].init.credentials, 'same-origin')
  assert.equal(requests[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(String(requests[0].init.body)), { token: 'one-use-secret', password: 'new-secret-password' })
  await assert.rejects(accountRequest('https://other.example/api/password-recovery', { token: 'secret' }), /Invalid account action/)
  await assert.rejects(accountRequest('/api/password-recovery?token=secret', { password: 'secret' }), /Invalid account action/)
  assert.equal(requests.length, 1, 'Invalid destinations must not receive credentials')
  status = 429
  await assert.rejects(accountRequest('/api/account/password', {}), /Too many attempts/)
  status = 403
  await assert.rejects(accountRequest('/api/account/password', {}), /credentials could not be verified/)
  status = 400
  await assert.rejects(accountRequest('/api/password-recovery', {}), /expired or already been used/)
  status = 200; payload = null
  await assert.rejects(accountRequest('/api/password-recovery', {}), /invalid account response/)
  payload = []
  await assert.rejects(accountRequest('/api/account/password', {}), /invalid account response/)
  payload = { ok: false }
  await assert.rejects(accountRequest('/api/account/password', {}), /did not confirm/)
  payload = { token: 'code', expiresAt: 'invalid' }
  await assert.rejects(accountRequest('/api/admin/users/example/recovery', {}), /invalid recovery response/)
  console.log('Account security: same-origin credential bodies, destination restrictions, throttling, expired codes and malformed responses passed')
} finally { globalThis.fetch = originalFetch }
