import assert from 'node:assert/strict'
import { buildSlicePrompt } from '../src/lib/prompts.ts'
import { isCrossSectional } from '../src/lib/modality.ts'
const patient = { name: '', patientId: '', age: '', sex: '' as const, studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' }
for (const modality of ['CT', 'MR', 'MRI']) {
  const text = buildSlicePrompt(modality, 'axial 39/76 · W 100 / L 40', patient)
  assert.ok(isCrossSectional({ sourceModality: modality }))
  assert.ok(text.includes('one displayed slice, not the complete scan'))
  assert.ok(text.includes('axial 39/76 · W 100 / L 40'))
  assert.ok(!/chest radiograph|pneumothorax|CXR/.test(text))
}
assert.equal(isCrossSectional({ sourceModality: 'CR' }), false)
console.log('CT/MRI prompt routing: 13 checks passed')
