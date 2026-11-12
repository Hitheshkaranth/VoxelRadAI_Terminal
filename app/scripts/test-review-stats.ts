import assert from 'node:assert/strict'
import { acceptanceRate, modalityGroup, studyReviewRecords, summarizeStudies, toJsonLines } from '../src/lib/reviewStats.ts'
import type { Study } from '../src/types.ts'

const finding = (id: string, review?: 'accepted' | 'dismissed', category = 'Lungs') => ({ id, title: id, description: 'd', severity: 'moderate' as const, confidence: 0.5, location: 'RUL', category, review, mask: 'data:image/png;base64,MASK' })
const study = (id: string, sourceModality: string, findings: ReturnType<typeof finding>[], signed = false, edited = false): Study => ({
  id, title: 'T', createdAt: 0, updatedAt: 0,
  patient: { name: 'Private Patient', patientId: 'MRN-1', age: '', sex: '', studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' },
  images: [{ id: `${id}-img`, name: 'n', mime: 'image/png', dataUrl: 'data:image/png;base64,PIXELS', width: 1, height: 1, addedAt: 0, status: 'done', sourceModality,
    analysis: { modality: '', bodyPart: 'Chest', view: '', imageQuality: '', findings, pertinentNegatives: [], impression: 'imp', recommendations: [], differential: [], urgency: 'routine', rawText: 'RAW', model: 'skanda-v1', durationMs: 1, createdAt: 0 } }],
  report: { technique: '', comparison: '', findings: 'Report text', impression: '', recommendations: '', radiologist: 'Dr Private', signed, generated: true, edited, updatedAt: 0 },
})

assert.equal(modalityGroup('DX'), 'X-ray'); assert.equal(modalityGroup('', 'CT abdomen'), 'CT'); assert.equal(modalityGroup('MR'), 'MRI')
const studies = [study('a', 'CT', [finding('1', 'accepted'), finding('2', 'dismissed', 'Pleura'), finding('3')], true, true), study('b', 'DX', [finding('4', 'accepted')], true)]
const summary = summarizeStudies(studies)
assert.deepEqual(summary.totals, { total: 4, accepted: 2, dismissed: 1, unreviewed: 1 })
assert.deepEqual(summary.byModality.map((group) => group.name), ['CT', 'X-ray'])
assert.deepEqual(summary.reports, { signed: 2, edited: 1 })
assert.equal(acceptanceRate(summary.totals), 2 / 3)
assert.equal(acceptanceRate({ total: 1, accepted: 0, dismissed: 0, unreviewed: 1 }), null)

const records = await studyReviewRecords(studies)
const text = toJsonLines(records)
assert.equal(text.trim().split('\n').length, 2)
for (const secret of ['Private Patient', 'MRN-1', 'PIXELS', 'MASK', 'RAW', 'Report text', 'Dr Private', '"a"', 'a-img']) assert.ok(!text.includes(secret), secret)
assert.match(text, /"hasOutline":true/)
assert.match(text, /"reportEditedBeforeSign":true/)
assert.equal(toJsonLines([]), '')
console.log('review stats: ok')
