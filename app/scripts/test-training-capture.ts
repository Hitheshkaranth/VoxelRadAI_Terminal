import assert from 'node:assert/strict'
import { ageBand, redactKnownIdentifiers } from '../src/lib/deidentify.ts'

const study = { patient: { name: 'Ravi Kumar', patientId: 'MRN-0042', age: '54', sex: 'Male', studyDate: '', referringPhysician: 'Dr. Anita Rao', indication: '', clinicalHistory: '' } } as never
assert.equal(redactKnownIdentifiers('Ravi kumar (MRN-0042) referred by Dr. Anita Rao: no effusion.', study), '[REDACTED] [REDACTED] ([REDACTED]) referred by Dr. [REDACTED] [REDACTED]: no effusion.')
assert.equal(redactKnownIdentifiers('Bilateral consolidation, ravine-like opacity.', study), 'Bilateral consolidation, ravine-like opacity.')
assert.equal(ageBand('54'), '50-59'); assert.equal(ageBand('93'), '90+'); assert.equal(ageBand(''), '')
console.log('Training capture de-identification: 5 checks passed')
