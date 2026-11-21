import assert from 'node:assert/strict'
import { NOT_ASSESSED, NO_ABNORMALITY, SUGGESTIVE, UNPLACED_TITLE, examTypeLine, parseRows, readScope, systematicExam, systematicReport, systematicRows, volumeSystematicLines } from '../src/lib/systematicReport.ts'
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
assert.equal(row('DIAPHRAGM'), NOT_ASSESSED)
assert.equal(row('UPPER ABDOMEN'), NOT_ASSESSED)
assert.doesNotMatch(d.findings, /Dismissed nodule|No acute cardiopulmonary/)
assert.equal(d.impression.split('\n')[0], SUGGESTIVE)
assert.match(d.impression, /^1\. Rib fracture/m) // accepted first
assert.equal(d.technique, 'X-RAY CHEST PA VIEW')

// A normal film: the whole-study negative stays in the impression, sections remain unassessed.
const normal = systematicReport({ images: [{ name: 'n.png', analysis: { modality: 'X-ray', bodyPart: 'Chest', view: 'PA', findings: [], pertinentNegatives: ['No acute cardiopulmonary abnormality.'] } }] } as unknown as Study)
assert.ok(normal.impression.startsWith(NO_ABNORMALITY))
assert.match(normal.impression, /The AI read states: No acute cardiopulmonary abnormality\./)
assert.ok(parseRows(normal.findings).every((r) => r.lines.join(' ') === NOT_ASSESSED))

// CT abdomen single slice: organ withheld -> its own unplaced row; read scope names the slice.
const ct = { images: [{ name: 'slice.dcm', sourceModality: 'CT', sourceBodyPart: 'Abdomen', sourceFrameIndex: 77, sourceFrameCount: 120,
  analysis: { modality: 'CT', bodyPart: 'Abdomen', view: 'axial', pertinentNegatives: [], findings: [f('Focal lesion, right side'), f('Liver lesion')] } }] } as unknown as Study
const c = systematicReport(ct)
assert.equal(systematicExam('CT Abdomen'), 'ct-abdomen')
const cr = parseRows(c.findings)
assert.equal(cr[0].title, 'LIVER')
assert.match(cr[0].lines.join(' '), /Liver lesion/)
assert.equal(cr.at(-1)!.title, UNPLACED_TITLE)
assert.match(c.technique, /^CT ABDOMEN\nRead from 1 single slice image \(slice\.dcm, frame 78 of 120\)\. Slices that were not sent were not assessed\.$/)
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
assert.match(lines.join('\n'), /^LIVER: Not assessed by the AI read/m)
const job = { id: 'j', title: 'CT abdomen', modality: 'CT', plane: 'axial', count: 1, snapshot: { model: 'm', center: 40, width: 400 },
  reads: [{ index: 0, status: 'done', analysis: { findings: [f('Liver lesion')] } }], reviews: { '0:Liver lesion': { decision: 'accepted' } } } as unknown as ReviewableVolume
assert.doesNotMatch(buildVolumeDraft(job), /SYSTEMATIC FINDINGS/)
assert.match(buildVolumeDraft(job, { systematic: true }), /LIVER: Liver lesion \(axial slice 1\)\.$/m) // accepted: no unreviewed marker
console.log('systematic report ok')
