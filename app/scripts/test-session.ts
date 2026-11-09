import assert from 'node:assert/strict'
import { login, readSession, useSession } from '../src/lib/session.ts'
const originalFetch = globalThis.fetch
const user = { id: 'u1', email: 'clinician@example.test', role: 'clinician' }
try {
  globalThis.fetch = (async (url, init) => {
    assert.equal(url, '/api/session'); assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store')
    return new Response(JSON.stringify({ user }), { status: 200 })
  }) as typeof fetch
  assert.deepEqual(await readSession(), user)
  globalThis.fetch = (async () => new Response('', { status: 401 })) as typeof fetch
  assert.equal(await readSession(), null)
  await assert.rejects(login('test@example.test', 'not-a-password'), /incorrect/)
  globalThis.fetch = (async (url, init) => {
    assert.equal(url, '/api/login'); assert.equal(init?.method, 'POST'); assert.equal(init?.credentials, 'same-origin')
    assert.deepEqual(JSON.parse(init?.body as string), { email: 'test@example.test', password: 'secret-password' })
    return new Response(JSON.stringify({ user, password: 'do-not-store' }), { status: 200 })
  }) as typeof fetch
  assert.deepEqual(await login(' test@example.test ', 'secret-password'), user)
  assert.equal(useSession.getState().user, null, 'adapter does not mutate session before workspace storage setup')
  globalThis.fetch = (async () => new Response(JSON.stringify({ user: { ...user, role: 'superadmin' } }), { status: 200 })) as typeof fetch
  await assert.rejects(readSession(), /invalid/)
  globalThis.fetch = (async () => new Response('', { status: 429 })) as typeof fetch
  await assert.rejects(login('test@example.test', 'secret-password'), /Too many/)
} finally { globalThis.fetch = originalFetch }
console.log('Session adapter: credentials, failure states, validation and no premature identity mutation passed')
