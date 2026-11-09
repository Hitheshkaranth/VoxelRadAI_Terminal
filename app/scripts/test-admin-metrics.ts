import assert from 'node:assert/strict'
import { localMetrics, validateOrganizationMetrics, fetchOrganizationMetrics } from '../src/lib/adminMetrics.ts'
import type { Study } from '../src/types.ts'

const fixture = [{ id: 'private-id', title: 'Private patient title', patient: { name: 'PRIVATE NAME' }, images: [{ status: 'done', dataUrl: 'PRIVATE PIXELS' }, { status: 'error' }, { status: 'analyzing' }, { status: 'idle' }], report: { signed: true, findings: 'PRIVATE TEXT' } }, { images: [], report: { signed: false } }] as Study[]
assert.deepEqual(localMetrics([]), { studies: 0, images: 0, analyzed: 0, analyzing: 0, errors: 0, reports: 0, signed: 0 })
assert.deepEqual(localMetrics(fixture), { studies: 2, images: 4, analyzed: 1, analyzing: 1, errors: 1, reports: 2, signed: 1 })
assert.equal(JSON.stringify(localMetrics(fixture)).includes('PRIVATE'), false)
const valid = { scope: 'organization', generatedAt: '2026-11-10T00:00:00Z', users: { total: 10, active30d: 3 }, studies: { total: 2 }, images: { total: 4 }, reports: { total: 2, signed: 1 }, shares: { active: 1, revoked: 0 }, jobs: { queued: 0, running: 1, failed: 0 }, events: { total30d: 20 } }
assert.deepEqual(validateOrganizationMetrics({ ...valid, patientName: 'PRIVATE' }), valid)
for (const count of [-1, NaN, Infinity, 1.5, '10']) assert.throws(() => validateOrganizationMetrics({ ...valid, studies: { total: count } }))
assert.throws(() => validateOrganizationMetrics({ ...valid, generatedAt: 'invalid' }))
assert.throws(() => validateOrganizationMetrics({ ...valid, users: { total: 1, active30d: 2 } }))
assert.throws(() => validateOrganizationMetrics({ ...valid, reports: { total: 1, signed: 2 } }))
assert.throws(() => validateOrganizationMetrics({ ...valid, scope: 'global' }))
assert.throws(() => validateOrganizationMetrics({ ...valid, jobs: null }))
assert.equal(validateOrganizationMetrics({ ...valid, jobs: { ...valid.jobs, available: false } }).jobs.available, false)
assert.throws(() => validateOrganizationMetrics({ ...valid, jobs: { ...valid.jobs, available: 'false' } }))
const originalFetch = globalThis.fetch
try {
  globalThis.fetch = (async (url, init) => {
    assert.equal(url, '/api/admin/metrics'); assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.body, undefined)
    return new Response(JSON.stringify(valid), { status: 200 })
  }) as typeof fetch
  assert.deepEqual(await fetchOrganizationMetrics(), valid)
  for (const [status, message] of [[401, /Sign in/], [403, /administrator/], [404, /not configured/], [500, /could not be loaded/]] as const) {
    globalThis.fetch = (async () => new Response('', { status })) as typeof fetch
    await assert.rejects(fetchOrganizationMetrics(), message)
  }
  globalThis.fetch = (async () => new Response('<!doctype html>', { status: 200 })) as typeof fetch
  await assert.rejects(fetchOrganizationMetrics(), /valid analytics/)
} finally { globalThis.fetch = originalFetch }
console.log('Admin metrics: aggregation, privacy allowlist, validation and HTTP failure states passed')
