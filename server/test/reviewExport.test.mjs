import test from 'node:test'
import assert from 'node:assert/strict'
import { modalityGroup, reviewRecord, summarizeReviews, toCsv, pseudonym } from '../src/reviewExport.mjs'

test('modality groups prefer DICOM source codes', () => {
  assert.equal(modalityGroup('DX', ''), 'X-ray')
  assert.equal(modalityGroup('', 'Radiograph (X-ray)'), 'X-ray')
  assert.equal(modalityGroup('CT', 'whatever'), 'CT')
  assert.equal(modalityGroup('MR', ''), 'MRI')
  assert.equal(modalityGroup('', 'Ultrasound'), 'Other')
})

test('review summary counts decisions by modality, category and model', () => {
  const summary = summarizeReviews([
    { source_modality: 'CT', modality: '', category: 'Lungs', model: 'skanda-v1', review: 'accepted', n: 3 },
    { source_modality: 'CT', modality: '', category: 'Lungs', model: 'skanda-v1', review: null, n: 2 },
    { source_modality: '', modality: 'Radiograph', category: null, model: 'skanda-v1', review: 'dismissed', n: 1 },
    { source_modality: '', modality: 'Radiograph', category: 'Lungs', model: 'skanda-v1', review: 'bogus', n: 1 },
  ])
  assert.deepEqual(summary.totals, { total: 7, accepted: 3, dismissed: 1, unreviewed: 3 })
  assert.deepEqual(summary.byModality.map(m => [m.name, m.total]), [['CT', 5], ['X-ray', 2]])
  assert.equal(summary.byCategory.find(c => c.name === 'Uncategorised').dismissed, 1)
  assert.equal(summary.byModel[0].name, 'skanda-v1')
})

test('export records drop identifiers, pixels, masks and raw text', () => {
  const record = reviewRecord({
    study_id: 'study-1', image_id: 'img-1', source_modality: 'CT', signed: 'true', edited: 'true',
    analysis: { modality: 'CT', model: 'skanda-v1', createdAt: 0, impression: 'Nodule.', rawText: 'secret', findings: [
      { id: 'f1', title: 'Nodule', description: 'RUL nodule', severity: 'moderate', confidence: 0.7, location: 'RUL', mask: 'data:image/png;base64,AAA', bbox: { x: 0.1, y: 0.2, w: 0.1, h: 0.1 }, measurements: { source: 'outline', diameter_mm: 8, side: 'right' }, review: 'accepted' },
    ] },
  })
  const json = JSON.stringify(record)
  assert.ok(!json.includes('study-1') && !json.includes('img-1') && !json.includes('secret') && !json.includes('base64'))
  assert.equal(record.studyRef, pseudonym('study-1'))
  assert.equal(record.findings[0].hasOutline, true)
  assert.deepEqual(record.findings[0].measurements, { diameter_mm: 8 })
  assert.equal(record.reportEditedBeforeSign, true)
  assert.equal(record.findings[0].review, 'accepted')
})

test('CSV cells are quoted and neutralise spreadsheet formulas', () => {
  assert.equal(toCsv(['a', 'b'], [['=1+1', 'x,"y"']]), 'a,b\r\n\'=1+1,"x,""y"""\r\n')
})
