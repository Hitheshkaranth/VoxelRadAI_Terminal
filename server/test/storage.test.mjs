import test from 'node:test'
import assert from 'node:assert/strict'
import { GiB, defaultQuota, studySizes, storageUsage, validQuota } from '../src/storage.mjs'

test('default allowance is 10 GiB, configurable in bytes or GiB, bounded', () => {
  assert.equal(defaultQuota({}), 10 * GiB)
  assert.equal(defaultQuota({ STORAGE_QUOTA_GB: '25' }), 25 * GiB)
  assert.equal(defaultQuota({ STORAGE_QUOTA_BYTES: '1000' }), 1000)
  assert.equal(defaultQuota({ STORAGE_QUOTA_GB: 'lots' }), 10 * GiB)
  assert.equal(defaultQuota({ STORAGE_QUOTA_GB: '5000' }), 10 * GiB, 'over 1 TiB is ignored')
  assert.ok(validQuota(null) && validQuota(0) && validQuota(5 * GiB))
  assert.ok(!validQuota(-1) && !validQuota(1.5) && !validQuota('10') && !validQuota(2 ** 41))
})

test('study sizes separate scan images from analysis', () => {
  const study = { id: 'x', images: [{ id: 'i', dataUrl: 'data:image/png;base64,AAAA', analysis: { findings: [{ label: 'x', review: 'accepted' }] } }, { id: 'j', dataUrl: 'B' }], report: { findings: 'Clear.' } }
  const sizes = studySizes(study)
  assert.equal(sizes.payloadBytes, Buffer.byteLength(JSON.stringify(study)))
  assert.equal(sizes.analysisBytes, Buffer.byteLength(JSON.stringify(study.images[0].analysis)))
  assert.equal(sizes.imageBytes, Buffer.byteLength(JSON.stringify({ id: 'i', dataUrl: 'data:image/png;base64,AAAA' })) + Buffer.byteLength(JSON.stringify(study.images[1])))
  assert.ok(sizes.payloadBytes > sizes.imageBytes + sizes.analysisBytes)
})

test('usage breakdown adds studies, volumes and feedback against the quota', async () => {
  const db = { async query(sql) {
    if (sql.includes('storage_quota_bytes')) return { rows: [{ storage_quota_bytes: String(2 * GiB) }] }
    if (sql.includes('FROM studies')) return { rows: [{ n: 3, total: '1000', images: '600', analysis: '150' }] }
    if (sql.includes('FROM volume_objects')) return { rows: [{ n: 1, total: '5000' }] }
    return { rows: [{ n: 2, total: '40' }] }
  } }
  const usage = await storageUsage(db, 'u1', { TRAINING_PSEUDONYM_SECRET: 'k'.repeat(40) })
  assert.deepEqual(usage.breakdown, { scans: 5600, patientAndReports: 250, analysis: 150, feedback: 40 })
  assert.equal(usage.usedBytes, 6040)
  assert.equal(usage.quotaBytes, 2 * GiB)
  assert.deepEqual(usage.counts, { studies: 3, volumes: 1, feedback: 2 })
  const unkeyed = await storageUsage(db, 'u1', {})
  assert.equal(unkeyed.breakdown.feedback, 0, 'without a pseudonym key no feedback can be attributed')
})
