import assert from 'node:assert/strict'
import { safeShareImage, shareReportText, studyShareHtml } from '../src/lib/studyShare.ts'
import type { Study } from '../src/types.ts'

const study: Study = {
  id: 'private-study-id', title: 'Patient Secret', createdAt: 1, updatedAt: 1,
  patient: { name: 'Live Secret', patientId: 'LIVE-ID', referringPhysician: 'Live Referrer', age: '45', sex: 'Female', studyDate: '2026-11-09', indication: 'Review', clinicalHistory: '' },
  images: [{ id: 'image-1', name: 'private-file.png', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', width: 10, height: 10, addedAt: 1, status: 'idle' }],
  report: { technique: 'X-ray', comparison: '', findings: '<script>alert("unsafe")</script>', impression: 'Review required', recommendations: '', radiologist: 'Reader', signed: true, signedAt: 1, generated: true, updatedAt: 1,
    patientSnapshot: { name: 'Signed Secret', patientId: 'SIGNED-ID', referringPhysician: 'Signed Referrer', age: '45', sex: 'Female', studyDate: '2026-11-09', indication: 'Review', clinicalHistory: '' } },
}
const options = { includeIdentity: false, includeImages: false }
const text = shareReportText(study, 'Institution', options)
for (const secret of ['Live Secret', 'LIVE-ID', 'Signed Secret', 'SIGNED-ID', 'Signed Referrer', 'private-file']) assert.ok(!text.includes(secret), secret)
assert.ok(shareReportText(study, 'Institution', { ...options, includeIdentity: true }).includes('Signed Secret'))
assert.equal(study.report?.patientSnapshot?.name, 'Signed Secret', 'source is not mutated')
const html = studyShareHtml(study, 'Institution', options)
assert.ok(!html.includes('<script>'))
assert.ok(html.includes('&lt;script&gt;'))
assert.ok(!html.includes('<img'))
assert.ok(html.includes("default-src 'none'"))
assert.ok(!html.includes('private-study-id'))
assert.ok(studyShareHtml(study, '', { ...options, includeImages: true }).includes('<img src="data:image/png;base64,AAAA"'))
assert.ok(safeShareImage('data:image/jpeg;base64,AAAA=='))
for (const url of ['https://example.com/track.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,AAAA" onerror="bad']) assert.equal(safeShareImage(url), false)
const unsafe = { ...study, images: [{ ...study.images[0], dataUrl: 'https://example.com/track.png' }] }
assert.ok(!studyShareHtml(unsafe, '', { ...options, includeImages: true }).includes('src="https'))
assert.ok(studyShareHtml(unsafe, '', { ...options, includeImages: true }).includes('could not be included'))
console.log('Study sharing: identity defaults, signed snapshots, HTML escaping, raster allowlist, no mutation and export scope passed.')
