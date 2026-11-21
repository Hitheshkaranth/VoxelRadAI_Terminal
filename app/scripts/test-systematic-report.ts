import assert from 'node:assert/strict'
import { SUGGESTIVE, UNPLACED_TITLE, examTypeLine, parseRows, readScope, systematicExam, systematicReport, systematicRows, volumeSystematicLines } from '../src/lib/systematicReport.ts'
import { buildVolumeDraft, type ReviewableVolume } from '../src/lib/volumeReview.ts'
import type { Finding, Study } from '../src/types.ts'

const f = (title: string, extra: Partial<Finding> = {}) => ({ id: title, title, description: '', severity: 'significant', confidence: 0.5, location: '', ...extra }) as Finding

// Chest X-ray: deterministic mapping; cardiomegaly to mediastinum even when a lung finding mentions the heart border.
const cxr = { images: [{ name: 'film.png', analysis: { modality: 'X-ray', bodyPart: 'Chest', view: 'PA', pertinentNegatives: ['No pneumothorax', 'No acute cardiopulmonary abnormality'], findings: [
  f('Rib fracture', { location: 'left lateral 5th rib', review: 'accepted' }),
  f('Pleural effusion', { location: 'left lower zone' }),
  f('Consolidation', { location: 'left lower zone near the heart border' }),
  f('Cardiomegaly', { severity: 'moderate' }),
  f('Dismissed nodule', { review: 'dismissed' }),
] } }] } as unknown as Study
const before = JSON.stringify(cxr)
const d = systematicReport(cxr)
assert.equal(JSON.stringify(cxr), before)
const rows = parseRows(d.findings)
assert.deepEqual(rows.map((r) => r.title), ['BONES & SOFT TISSUES', 'DIAPHRAGM', 'UPPER ABDOMEN', 'LUNG FIELDS', 'MEDIASTINUM'])
const row = (t: string) => rows.find((r) => r.title === t)!.lines.join(' ')
assert.match(row('BONES & SOFT TISSUES'), /^Rib fracture, left lateral 5th rib\.$/)
assert.match(row('LUNG FIELDS'), /Pleural effusion/)
assert.match(row('LUNG FIELDS'), /Consolidation/)
assert.match(row('LUNG FIELDS'), /No pneumothorax\./)
assert.match(row('MEDIASTINUM'), /Cardiomegaly/)
// Honesty: no stated negative for the diaphragm or upper abdomen, so they are not called normal.
assert.equal(row('DIAPHRAGM'), '')
assert.equal(row('UPPER ABDOMEN'), '')
assert.match(d.findings, /^DIAPHRAGM: $/m) // heading + blank for the radiologist
assert.doesNotMatch(JSON.stringify(d), /not assessed|AI read|radiologist to review|unreviewed|Draft assembled/i)
assert.doesNotMatch(d.findings, /Dismissed nodule|No acute cardiopulmonary/)
assert.equal(d.impression.split('\n')[0], SUGGESTIVE)
assert.match(d.impression, /^1\. Rib fracture/m) // accepted first
assert.equal(d.technique, 'X-RAY CHEST PA VIEW')

// A normal film: the impression is the model's own statement; sections stay empty, never called normal.
const normal = systematicReport({ images: [{ name: 'n.png', analysis: { modality: 'X-ray', bodyPart: 'Chest', view: 'PA', findings: [], impression: 'No acute cardiopulmonary abnormality.', pertinentNegatives: [] } }] } as unknown as Study)
assert.equal(normal.impression, 'No acute cardiopulmonary abnormality.')
assert.ok(parseRows(normal.findings).every((r) => r.lines.join(' ') === ''))

// CT abdomen single slice: organ withheld -> its own unplaced row; read scope names the slice.
const ct = { images: [{ name: 'slice.dcm', sourceModality: 'CT', sourceBodyPart: 'Abdomen', sourceFrameIndex: 77, sourceFrameCount: 120,
  analysis: { modality: 'CT', bodyPart: 'Abdomen', view: 'axial', pertinentNegatives: [], findings: [f('Focal lesion, right side'), f('Liver lesion')] } }] } as unknown as Study
const c = systematicReport(ct)
assert.equal(systematicExam('CT Abdomen'), 'ct-abdomen')
const cr = parseRows(c.findings)
assert.equal(cr[0].title, 'LIVER')
assert.match(cr[0].lines.join(' '), /Liver lesion/)
assert.equal(cr.at(-1)!.title, UNPLACED_TITLE)
assert.equal(c.technique, 'CT ABDOMEN\nSingle-slice read: slice.dcm, frame 78 of 120.')
assert.equal(readScope([{ name: 'x.png', analysis: { modality: 'X-ray' } }] as never), '')

// MRI brain: head scheme.
assert.equal(systematicExam('MR Brain'), 'head')
const head = systematicRows({ exam: 'head', findings: [f('Acute infarct', { location: 'left MCA territory' }), f('Cerebellar lesion')], negatives: ['No hydrocephalus'] })
assert.deepEqual(head.map((r) => r.status), ['finding', 'negative', 'not-assessed', 'finding', 'not-assessed'])
assert.equal(examTypeLine([{ name: 'a', sourceModality: 'MR', sourceBodyPart: 'Brain', analysis: { modality: 'MR', bodyPart: 'Brain', view: 'axial' } }] as never), 'MRI BRAIN')

// Edited text: continuation lines join their row; unknown first lines become FINDINGS.
assert.deepEqual(parseRows('free text\nLUNG FIELDS: a\nb'), [{ title: 'FINDINGS', lines: ['free text'] }, { title: 'LUNG FIELDS', lines: ['a', 'b'] }])

// Volume drafts: systematic rows only when asked, slice numbers kept.
const lines = volumeSystematicLines({ title: 'CT abdomen', modality: 'CT', plane: 'axial', completed: 11, count: 11, accepted: [{ index: 5, finding: f('Focal lesion, right side') }] })
assert.match(lines.join('\n'), /OTHER FINDINGS \(SECTION NOT CONFIRMED\): Focal lesion, right side \(axial slice 6\)/)
assert.match(lines.join('\n'), /^LIVER: $/m)
assert.equal(volumeSystematicLines({ title: 'MRI brain', modality: 'MR brain', plane: 'axial', completed: 2, count: 2, accepted: [], impressions: ['No focal abnormality on this slice.', 'No focal abnormality on this slice.'] }).at(-1), 'No focal abnormality in this series.')
const job = { id: 'j', title: 'CT abdomen', modality: 'CT', plane: 'axial', count: 1, snapshot: { model: 'm', center: 40, width: 400 },
  reads: [{ index: 0, status: 'done', analysis: { findings: [f('Liver lesion')] } }], reviews: { '0:Liver lesion': { decision: 'accepted' } } } as unknown as ReviewableVolume
assert.doesNotMatch(buildVolumeDraft(job), /SYSTEMATIC FINDINGS/)
assert.match(buildVolumeDraft(job, { systematic: true }), /LIVER: Liver lesion \(axial slice 1\)\.$/m) // accepted: no unreviewed marker
// Measurements from the measurement code only; location rewrite; one numbering; exact duplicates merged.
import { measuredText, mergeDuplicates, systematicSentence } from '../src/lib/systematicReport.ts'
const ctDesc = 'Measured from the scan: long axis 59.0 mm, seen over 57.0 mm of slices (66-103), median attenuation 34 HU. Location by the anatomy model: liver.'
assert.equal(measuredText(ctDesc, true), 'Measured from the scan: long axis 59.0 mm, seen over 57.0 mm of slices 67–104, median attenuation 34 HU.')
assert.equal(measuredText('High FLAIR signal, irregular. Measured from the outline: about 6 mm across on this slice (area 29 mm²).'), 'Measured from the outline: about 6 mm across on this slice (area 29 mm²).')
assert.equal(measuredText('Dependent opacity with a meniscus.'), '')
const lesion = f('Liver lesion, right', { location: 'liver patient right', description: ctDesc, review: 'accepted', slice: 'axial slice 81' } as never)
assert.equal(systematicSentence(lesion, true), 'Liver lesion (axial slice 81), patient\'s right side. Measured from the scan: long axis 59.0 mm, seen over 57.0 mm of slices 67–104, median attenuation 34 HU.')
assert.doesNotMatch(systematicSentence(lesion, true), /liver patient|slices \(66/)
assert.deepEqual(mergeDuplicates(['a.', 'b.', 'a.']), ['a. (×2)', 'b.'])
const vol = volumeSystematicLines({ title: 'CT abdomen', modality: 'CT', plane: 'axial', completed: 3, count: 3, accepted: [0, 0].map(() => ({ index: 1, finding: f('Liver lesion', { location: 'liver patient left', review: 'accepted' }) })) }).join('\n')
assert.match(vol, /^Volume read: 3 axial slices \(slice numbers count from 1\)\.$/m)
assert.match(vol, /^LIVER: Liver lesion \(axial slice 2\), patient's left side\. \(×2\)$/m)
console.log('systematic report ok')
