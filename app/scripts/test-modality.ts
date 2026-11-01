import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analysisEligibility, isCrossSectional } from '../src/lib/modality.ts'
import { decodeDicomFrame } from '../src/lib/dicomIntake.ts'

let checks = 0
for (const [filename, modality, rows, cols, levels] of [
  ['CT_small.dcm', 'CT', 128, 128, 241],
  ['MR_small.dcm', 'MR', 64, 64, 203],
] as const) {
  const bytes = readFileSync(new URL(`./fixtures/dicom/${filename}`, import.meta.url))
  const decoded = decodeDicomFrame(bytes)
  assert.equal(decoded.sourceModality, modality, `${filename}: retain the DICOM modality`)
  assert.deepEqual([decoded.rows, decoded.cols], [rows, cols], `${filename}: read actual x-prefixed dimension tags`)
  assert.equal(decoded.sourceFrameCount, 1, `${filename}: retain single-frame source information`)
  assert.equal(decoded.gray.length, rows * cols, `${filename}: complete image output`)
  assert.equal(new Set(decoded.gray).size, levels, `${filename}: pixel values survive decoding`)
  assert.equal(analysisEligibility(decoded).supported, true, `${filename}: CT/MR analysis available`)
  assert.equal(isCrossSectional(decoded), true, `${filename}: bypass chest-only models`)
  assert.throws(() => decodeDicomFrame(bytes.subarray(0, bytes.length - 2048)), /truncated|parse|pixel data/i, `${filename}: reject incomplete input`)
  checks += 8
}

for (const input of [
  { sourceModality: 'CT', sourceBodyPart: 'CHEST' }, { sourceModality: 'MR' },
  {}, { sourceModality: 'CR' }, { sourceModality: 'DX', sourceBodyPart: 'CHEST' },
  { sourceModality: ' cr ', sourceBodyPart: ' thorax ' },
]) {
  assert.equal(analysisEligibility(input).supported, true, 'legacy and chest-radiograph inputs remain usable')
  checks++
}
for (const input of [
  { sourceModality: 'US' },
  { sourceModality: 'DX', sourceBodyPart: 'HAND' },
  { sourceBodyPart: 'ABDOMEN' },
]) {
  const eligibility = analysisEligibility(input)
  assert.equal(eligibility.supported, false)
  assert.match(eligibility.reason!, /preview only.*chest radiographs/i)
  checks++
}
console.log(`DICOM intake and modality scope: ${checks} checks passed`)
