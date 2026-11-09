import assert from 'node:assert/strict'
import { normalizeAcquisition } from '../src/lib/volumeAcquisition.ts'
import { volumeFingerprint } from '../src/lib/volumeJobIdentity.ts'
import { skandaSliceInput } from '../src/lib/skandaSlice.ts'
import type { Volume } from '../src/lib/volume.ts'

const acquisition = normalizeAcquisition({ modality: 'MRI', bodyPart: ' Brain ', sequence: ' T2 ', contrast: 'without', intensityIsHU: true })
assert.deepEqual(acquisition, { modality: 'MRI', bodyPart: 'Brain', sequence: 'T2', contrast: 'without', intensityIsHU: false })
const ct = normalizeAcquisition({ ...acquisition, modality: 'CT', intensityIsHU: true })
assert.equal(ct.sequence, '')
assert.equal(ct.intensityIsHU, true)
const volume: Volume = { data: new Int16Array(8), dimensions: [2,2,2], spacing: [1,1,1], directions: [[1,0,0],[0,1,0],[0,0,1]], origin: [0,0,0], space: 'LPS', range: [0,0], worldBounds: { min: [0,0,0], max: [1,1,1] } }
const identity = await volumeFingerprint({ ...volume, acquisition })
for (const change of [{ modality: 'CT' as const }, { bodyPart: 'Chest' }, { sequence: 'T1' }, { contrast: 'with' as const }, { intensityIsHU: true }]) {
  assert.notEqual(identity, await volumeFingerprint({ ...volume, acquisition: { ...acquisition, ...change } }))
}
assert.notEqual(identity, await volumeFingerprint(volume))
assert.equal(identity, await volumeFingerprint({ ...volume, acquisition: { ...acquisition } }))
for (const intensityIsHU of [undefined, false]) {
  const result = skandaSliceInput(volume, 'axial', 0, { modality: 'CT', title: 'Brain', intensityIsHU })
  assert.equal(result.input, null)
  assert.match(result.reason!, /calibrated Hounsfield/)
}
console.log('Volume acquisition: normalized context, independent review identities and explicit CT HU confirmation passed')
