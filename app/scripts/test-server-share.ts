import assert from 'node:assert/strict'
import { createHostedShare, listHostedShares, revokeHostedShare } from '../src/lib/serverShare.ts'
import type { Study } from '../src/types.ts'

const originalFetch = globalThis.fetch
const originalWindow = globalThis.window
Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://skanda.example' } } })
const study = { id: 'study-id', title: 'Synthetic fixture', images: [], patient: {} } as Study
const expiresAt = '2026-11-11T12:00:00Z'
const options = { expiresInHours: 24, includeIdentity: false, includeImages: false }
try {
  const calls: Array<{ path: string; init: RequestInit | undefined }> = []
  globalThis.fetch = (async (path, init) => {
    calls.push({ path: String(path), init })
    return new Response(JSON.stringify(calls.length === 1 ? { ok: true } : { share: { id: 'share-id', expiresAt, url: '/api/shared/synthetic-token' } }))
  }) as typeof fetch
  const result = await createHostedShare(study, options)
  assert.equal(result.url, 'https://skanda.example/api/shared/synthetic-token')
  assert.equal(result.expiresAt, Date.parse(expiresAt))
  assert.equal(calls[0].path, '/api/studies')
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), study)
  assert.equal(calls[1].path, '/api/studies/study-id/shares')
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), options)
  assert.equal(calls[1].init?.credentials, 'same-origin')
  globalThis.fetch = (async () => new Response(JSON.stringify({ shares: [{ id: 'share-id', createdAt: '2026-11-10T12:00:00Z', expiresAt, revokedAt: null, url: 'TOKEN_MUST_NOT_SURVIVE' }] }))) as typeof fetch
  const history = await listHostedShares(study.id)
  assert.equal(history.length, 1)
  assert.equal(JSON.stringify(history).includes('TOKEN_MUST_NOT_SURVIVE'), false)
  for (const url of ['javascript:alert(1)', 'https://other.example/api/shared/token', '/api/admin/metrics']) {
    globalThis.fetch = (async () => new Response(JSON.stringify({ share: { id: 'share-id', expiresAt, url } }))) as typeof fetch
    await assert.rejects(createHostedShare(study, options), /unexpected share address/)
  }
  globalThis.fetch = (async (path, init) => { assert.equal(path, '/api/shares/share-id'); assert.equal(init?.method, 'DELETE'); return new Response('{"ok":true}') }) as typeof fetch
  await revokeHostedShare('share-id')
  for (const status of [401, 403, 413, 500]) {
    globalThis.fetch = (async () => new Response('', { status })) as typeof fetch
    await assert.rejects(createHostedShare(study, options))
  }
} finally {
  globalThis.fetch = originalFetch
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
}
console.log('Hosted sharing client: explicit upload, recipient scope, same-origin URL, metadata allowlist, revocation and error states passed')
