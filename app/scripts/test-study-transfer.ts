import assert from 'node:assert/strict'
import { validateTransferredStudy } from '../src/lib/studyTransfer.ts'
const study = { id: '01234567-1234-1234-1234-123456789abc', title: 'Transfer fixture', createdAt: 1, updatedAt: 2, patient: { name: '', patientId: '', age: '', sex: '', studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' }, images: [{ id: 'image', name: 'image.png', mime: 'image/png', dataUrl: 'data:image/png;base64,aA==', width: 1, height: 1, addedAt: 1, status: 'analyzing', stage: 'reading' }] }
const result = validateTransferredStudy(study)
assert.equal(result.images[0].status, 'idle')
assert.equal(study.images[0].status, 'analyzing', 'validation does not mutate source')
assert.equal(result.images[0].stage, undefined)
assert.throws(() => validateTransferredStudy({ ...study, patient: null }))
assert.throws(() => validateTransferredStudy({ ...study, id: '-'.repeat(36) }))
assert.throws(() => validateTransferredStudy({ ...study, images: [{ ...study.images[0], dataUrl: 'javascript:alert(1)' }] }))
assert.throws(() => validateTransferredStudy({ ...study, images: [{ ...study.images[0], dataUrl: 'data:image/svg+xml;base64,aA==' }] }))
assert.throws(() => validateTransferredStudy({ ...study, report: { signed: true } }))
assert.throws(() => validateTransferredStudy({ ...study, images: [{ ...study.images[0], analysis: { findings: null } }] }))
const analysis = { modality: 'X-ray', bodyPart: 'Chest', view: 'AP', imageQuality: '', impression: '', rawText: '', model: 'test', durationMs: 1, createdAt: 1, urgency: 'routine', pertinentNegatives: [], recommendations: [], differential: [], findings: [{ id: 'finding', title: 'Finding', description: '', location: '', confidence: .5, severity: 'minor' }] }
assert.equal(validateTransferredStudy({ ...study, images: [{ ...study.images[0], status: 'done', analysis }] }).images[0].analysis?.findings.length, 1)
assert.throws(() => validateTransferredStudy({ ...study, images: [{ ...study.images[0], analysis: { ...analysis, findings: [{ ...analysis.findings[0], category: {} }] } }] }))
assert.throws(() => validateTransferredStudy({ ...study, images: [{ ...study.images[0], analysis: { ...analysis, heatmaps: { chest: {} } } }] }))
const dicomImage = { ...study.images[0], sourceFrameCount: 2, sourceFrameIndex: 1, sourceSeriesUid: '1.2.3', sourceSopInstanceUid: '1.2.3.4' }
assert.equal(validateTransferredStudy({ ...study, images: [dicomImage] }).images[0].sourceFrameIndex, 1)
assert.equal(validateTransferredStudy({ ...study, images: [dicomImage] }).images[0].sourceSeriesUid, '1.2.3')
for (const patch of [{ sourceFrameIndex: -1 }, { sourceFrameIndex: 2 }, { sourceFrameIndex: 0.5 }, { sourceFrameCount: 0 }, { sourceSeriesUid: 'patient-name' }, { sourceSopInstanceUid: '1.'.repeat(40) }]) {
  assert.throws(() => validateTransferredStudy({ ...study, images: [{ ...dicomImage, ...patch }] }))
}
console.log('Study transfer: safe restore, DICOM source/frame validation, malformed input rejection and transient reset passed')
