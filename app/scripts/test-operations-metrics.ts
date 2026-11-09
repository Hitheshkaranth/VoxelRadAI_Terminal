import assert from 'node:assert/strict'
import { fetchOperationsMetrics, validateOperationsMetrics } from '../src/components/shell/operationsMetrics.ts'

const valid = {
  scope: 'process', generatedAt: '2026-11-10T10:00:00Z', uptimeSeconds: 125,
  requests: { completed: 12, failed: 1, inFlight: 2, durationMs: 120.5, maxDurationMs: 35.5, meanDurationMs: 10 },
  statuses: { '2xx': 8, '3xx': 1, '4xx': 2, '5xx': 1 },
  database: { status: 'ready', connections: 3, idle: 1, waiting: 0 }, memory: { rssBytes: 128000000 },
  features: { accountRecovery: 'administrator-issued-token', mfa: false, sso: false, multiTenant: false, volumeStorage: false, durableInferenceJobs: false },
}
assert.deepEqual(validateOperationsMetrics(valid), valid)
assert.deepEqual(validateOperationsMetrics({ ...valid, patientName: 'must not survive', requests: { ...valid.requests, path: '/private-study' } }), valid)
assert.throws(() => validateOperationsMetrics({ ...valid, scope: 'organization' }), /invalid operational/)
assert.throws(() => validateOperationsMetrics({ ...valid, uptimeSeconds: -1 }), /invalid operational/)
assert.throws(() => validateOperationsMetrics({ ...valid, requests: { ...valid.requests, meanDurationMs: Infinity } }), /invalid operational/)
assert.throws(() => validateOperationsMetrics({ ...valid, requests: { ...valid.requests, failed: 13 } }), /invalid operational/)
assert.throws(() => validateOperationsMetrics({ ...valid, database: { ...valid.database, idle: 4 } }), /invalid operational/)
assert.throws(() => validateOperationsMetrics({ ...valid, features: { ...valid.features, sso: 'false' } }), /invalid operational/)
assert.throws(() => validateOperationsMetrics({ ...valid, statuses: undefined }), /invalid operational/)
assert.equal(validateOperationsMetrics(valid).features.mfa, false, 'Unavailable capabilities must not become enabled')
const originalFetch = globalThis.fetch
let status = 200
let payload: unknown = valid
globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
  assert.equal(url, '/api/admin/operations')
  assert.equal(options?.credentials, 'same-origin')
  assert.equal(options?.cache, 'no-store')
  assert.equal(options?.body, undefined)
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch
try {
  assert.deepEqual(await fetchOperationsMetrics(), valid)
  status = 401; await assert.rejects(fetchOperationsMetrics(), /Sign in/)
  status = 403; await assert.rejects(fetchOperationsMetrics(), /administrator/)
  status = 404; await assert.rejects(fetchOperationsMetrics(), /not available/)
  status = 503; await assert.rejects(fetchOperationsMetrics(), /could not be loaded/)
  status = 200; payload = null; await assert.rejects(fetchOperationsMetrics(), /invalid operational/)
} finally { globalThis.fetch = originalFetch }
console.log('Operations metrics: process scope, explicit privacy allowlist, honest capability flags, invalid counts and HTTP failure states passed')
