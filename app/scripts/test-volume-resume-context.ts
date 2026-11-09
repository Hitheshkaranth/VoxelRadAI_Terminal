import assert from 'node:assert/strict'
import { assertVolumeResumeContext } from '../src/lib/volumeResume.ts'
import type { VolumeAcquisition } from '../src/lib/volumeAcquisition.ts'

const acquisition: VolumeAcquisition = { modality: 'MRI', bodyPart: 'Brain', sequence: 'T2', contrast: 'without', intensityIsHU: false }
const current = { identity: 'voxel-and-acquisition-hash:MRI', modality: 'MRI', acquisition }
const saved = { identity: current.identity, modality: 'MRI', snapshot: { acquisition } }
assert.doesNotThrow(() => assertVolumeResumeContext(saved, current))
assert.doesNotThrow(() => assertVolumeResumeContext({ ...saved, modality: 'mri' }, current))
assert.doesNotThrow(() => assertVolumeResumeContext({ identity: 'legacy', modality: 'CT', snapshot: {} }, { identity: 'legacy', modality: 'CT' }))
for (const changed of [
  { ...current, identity: 'other-volume:MRI' },
  { ...current, modality: 'CT' },
  { ...current, acquisition: undefined },
  { ...current, acquisition: { ...acquisition, sequence: 'T1 post-contrast' } },
  { ...current, acquisition: { ...acquisition, bodyPart: 'Spine' } },
  { ...current, acquisition: { ...acquisition, contrast: 'with' as const } },
]) assert.throws(() => assertVolumeResumeContext(saved, changed), /different acquisition/)
const ct = { ...acquisition, modality: 'CT' as const, sequence: '', intensityIsHU: true }
assert.throws(() => assertVolumeResumeContext({ ...saved, modality: 'CT', snapshot: { acquisition: ct } }, { ...current, modality: 'CT', acquisition: { ...ct, intensityIsHU: false } }), /different acquisition/)
console.log('Resume acceptance matrix: matching/legacy context allowed; source, modality, sequence, region, contrast and HU mismatch rejected')
