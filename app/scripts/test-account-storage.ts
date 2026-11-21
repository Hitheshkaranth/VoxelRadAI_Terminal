import assert from 'node:assert/strict'
import { formatStorage, parseAccountStorage, refreshAccountStorage, storageLevel, useAccountStorage } from '../src/lib/accountStorage.ts'

const GiB = 1024 ** 3
const sample = { quotaBytes: 10 * GiB, usedBytes: 2.5e9, availableBytes: 0, counts: { studies: 12, volumes: 2, feedback: 3 }, breakdown: { scans: 2.2e9, patientAndReports: 1e8, analysis: 1.9e8, feedback: 1e7 } }
const parsed = parseAccountStorage(sample)!
assert.equal(parsed.availableBytes, 10 * GiB - 2.5e9, 'free space is recomputed, not trusted')
assert.equal(parseAccountStorage({ ...sample, breakdown: { ...sample.breakdown, scans: -1 } }), null)
assert.equal(parseAccountStorage({ ...sample, quotaBytes: '10' }), null)
assert.equal(parseAccountStorage(null), null)
assert.equal(formatStorage(10 * GiB), '10.7 GB')
assert.equal(formatStorage(2.5e9), '2.5 GB')
assert.equal(formatStorage(350e6), '350 MB')
assert.equal(formatStorage(4.2e6), '4.2 MB')
assert.equal(formatStorage(900), '900 B')
assert.deepEqual(storageLevel({ usedBytes: 1, quotaBytes: 10 }), { percent: 10, tone: 'ok' })
assert.equal(storageLevel({ usedBytes: 8, quotaBytes: 10 }).tone, 'warn')
assert.equal(storageLevel({ usedBytes: 12, quotaBytes: 10 }).percent, 100)
assert.equal(storageLevel({ usedBytes: 0, quotaBytes: 0 }).tone, 'full')

const originalFetch = globalThis.fetch
try {
  let calls = 0
  globalThis.fetch = (async (url, init) => {
    calls++
    assert.equal(url, '/api/account/storage'); assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store')
    return new Response(JSON.stringify(sample), { status: 200 })
  }) as typeof fetch
  await Promise.all([refreshAccountStorage(), refreshAccountStorage()])
  assert.equal(calls, 1, 'concurrent refreshes share one request')
  assert.equal(useAccountStorage.getState().storage?.usedBytes, 2.5e9)
  globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch
  await refreshAccountStorage()
  assert.equal(useAccountStorage.getState().error, true)
  assert.equal(useAccountStorage.getState().storage?.usedBytes, 2.5e9, 'the last good figure stays on screen')
} finally { globalThis.fetch = originalFetch }
console.log('Account storage: parsing, units, levels and refresh passed')
