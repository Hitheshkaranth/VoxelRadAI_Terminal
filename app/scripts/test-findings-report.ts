import assert from 'node:assert/strict'
import { findingsReport, findingSentence, measurementPhrase } from '../src/lib/findingsReport.ts'
import type { Study } from '../src/types.ts'

const study = { images: [
  { name: 'source.png', analysis: { modality: 'X-ray', bodyPart: 'Chest', view: 'PA', findings: [
    { title: 'Reviewed candidate', description: 'Source evidence', review: 'accepted', location: 'Source location', severity: 'minor', category: 'Lungs' },
    { title: 'Pending candidate', description: 'Unverified evidence', recommendation: 'Unverified suggestion', severity: 'moderate', category: 'Pleura' },
    { title: 'Dismissed candidate', description: 'Do not include this', review: 'dismissed', recommendation: 'Hidden suggestion', severity: 'critical' },
  ] } },
  { name: 'unread.png' },
] } as unknown as Study
const before = JSON.stringify(study)
const draft = findingsReport(study)
assert.match(draft.findings, /^Lungs: Reviewed candidate, source location\.$/m)
assert.match(draft.findings, /^Pleura: Pending candidate\. \[unreviewed AI candidate\]$/m)
assert.doesNotMatch(draft.findings + draft.impression + draft.recommendations, /Dismissed candidate|Do not include this|Hidden suggestion/)
assert.match(draft.recommendations, /1 image\(s\) have not been analyzed/)
assert.match(draft.recommendations, /without an additional model request/)
assert.match(draft.recommendations, /Pending candidate: Unverified suggestion \[unreviewed AI candidate\]/)
assert.equal(JSON.stringify(study), before)

// CXR systems in reporting order; systems without findings are left blank, never called normal.
const order = draft.findings.split('\n').map((line) => line.split(':')[0])
assert.deepEqual(order, ['Lines and devices', 'Lungs', 'Pleura', 'Heart and mediastinum', 'Bones', 'Soft tissues and upper abdomen'])
assert.match(draft.findings, /^Heart and mediastinum: \[___\]$/m)
assert.doesNotMatch(draft.findings + draft.impression, /\bnormal\b|unremarkable|no acute/i)
assert.equal(draft.comparison, 'None available.')
assert.match(draft.technique, /X-ray, Chest; PA view\./)

// Impression: accepted first even when less severe, then by severity; numbered; markers kept.
assert.deepEqual(draft.impression.split('\n'), ['1. Reviewed candidate, source location.', '2. Pending candidate. [unreviewed AI candidate]'])

// Measurements from the outline are formatted as cm / HU; side is added when not already stated.
const nodule = { id: 'n', title: 'Pulmonary nodule', description: '', severity: 'significant', confidence: 0.5, location: 'Right upper lobe',
  review: 'accepted', category: 'Lungs', measurements: { source: 'outline', diameter_mm: 23.4, area_mm2: 410, mean_hu: 34.6 } } as const
assert.equal(findingSentence(nodule), 'Pulmonary nodule, right upper lobe, measuring 2.3 cm (area 4.1 cm², mean 35 HU, measured from the outline).')
assert.equal(measurementPhrase(undefined), '')
assert.equal(measurementPhrase({ source: 'outline', mean_hu: -5 }), '(mean -5 HU, measured from the outline)')
assert.equal(findingSentence({ ...nodule, location: '', measurements: { source: 'outline', side: 'left' } }), 'Pulmonary nodule, left side.')

// CT head: haemorrhage types land in the right compartment; prior studies give a comparison line.
const head = { images: [{ name: 'ct.dcm', sourceModality: 'CT', analysis: { modality: 'CT', bodyPart: 'Head', view: 'Axial', findings: [
  { title: 'Acute subdural haematoma', location: 'Left frontoparietal convexity', severity: 'critical', review: 'accepted' },
  { title: 'Hydrocephalus', location: 'Lateral ventricles', severity: 'significant' },
  { title: 'Skull fracture', location: 'Left parietal bone', severity: 'moderate', review: 'accepted' },
] } }] } as unknown as Study
const prior = { id: 'p', title: 'Old', patient: { studyDate: '2025-03-04' }, images: [{ sourceModality: 'CT', sourceBodyPart: 'Head' }] } as unknown as Study
const headDraft = findingsReport(head, [prior])
assert.match(headDraft.findings, /^Extra-axial spaces: Acute subdural haematoma, left frontoparietal convexity\.$/m)
assert.match(headDraft.findings, /^Ventricles: Hydrocephalus, lateral ventricles\. \[unreviewed AI candidate\]$/m)
assert.match(headDraft.findings, /^Bones and calvarium: Skull fracture/m)
assert.match(headDraft.findings, /^Brain parenchyma: \[___\]$/m)
assert.equal(headDraft.comparison, 'Compared with CT Head of 2025-03-04.')
assert.match(headDraft.impression, /^1\. Acute subdural haematoma.*\n2\. Skull fracture.*\n3\. Hydrocephalus.*\[unreviewed AI candidate\]$/)
assert.match(findingsReport(head, [prior, prior]).comparison, /1 earlier prior study is also available/)

const empty = { images: [{ name: 'source.png', analysis: { modality: 'X-ray', findings: [
  { title: 'Discarded', review: 'dismissed' },
] } }] } as unknown as Study
assert.match(findingsReport(empty).impression, /requires source-image review/)
assert.doesNotMatch(findingsReport(empty).findings, /No acute abnormality/)
assert.throws(() => findingsReport({ images: [] } as unknown as Study), /Analyze at least one image/)
console.log('Findings draft: system prose, measurements, severity-ordered impression, unreviewed markers, blanks instead of normal, comparison and immutable source passed')
