import assert from 'node:assert/strict'
import { priorStudies } from '../src/lib/priors.ts'
import type { Study } from '../src/types.ts'
const study = (id: string, patientId: string, date: string, images = true): Study => ({
  id, title: id, patient: { name: 'Same name', patientId, studyDate: date, age: '', sex: '', referringPhysician: '', indication: '', clinicalHistory: '' },
  images: images ? [{ id: id + '-image', name: 'test', dataUrl: '', mime: 'image/png', width: 1, height: 1, addedAt: 0, status: 'idle' }] : [], createdAt: 0, updatedAt: 0,
})
const current = study('current', 'P100', '2026-11-01')
const older = study('older', 'P100', '2025-01-01')
const recent = study('recent', 'P100', '2026-10-01')
const candidates = [current, older, recent, study('other patient', 'P200', '2026-01-01'), study('missing ID', '', '2026-01-01'), study('future', 'P100', '2027-01-01'), study('same day', 'P100', '2026-11-01'), study('empty', 'P100', '2026-01-01', false), study('invalid date', 'P100', '2026-02-31')]
assert.deepEqual(priorStudies(current, candidates).map((s) => s.id), ['recent', 'older'])
assert.deepEqual(priorStudies(study('blank', '', '2026-11-01'), candidates), [])
assert.deepEqual(priorStudies(study('invalid', 'P100', 'not-a-date'), candidates), [])
assert.deepEqual(priorStudies(study('trimmed', ' P100 ', '2026-11-01'), [older]), [older])
console.log('Prior matching: 4 checks passed (identity, date, images, ordering)')
