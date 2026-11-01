import assert from 'node:assert/strict'
import { filterWorklist, needsReview, studyPriority, workflowLabel } from '../src/lib/worklist.ts'
import type { Study } from '../src/types.ts'

function study(id: string, updatedAt: number, urgency?: 'routine' | 'priority' | 'urgent', signed = false): Study {
  return {
    id, title: `Study ${id}`, createdAt: 1, updatedAt,
    patient: { name: `Patient ${id}`, patientId: `MRN-${id}`, age: '', sex: '', studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' },
    images: urgency ? [{ id: `image-${id}`, name: 'test.png', mime: 'image/png', dataUrl: '', width: 1, height: 1, addedAt: 1, status: 'done', analysis: { urgency } }] : [],
    ...(signed ? { report: { signed: true } } : {}),
  } as Study
}
const recent = study('A', 30, 'routine')
const urgent = study('B', 10, 'urgent')
const signed = study('C', 20, 'priority', true)
const empty = study('D', 40)
const records = [urgent, recent, signed, empty]
assert.deepEqual(filterWorklist(records, '', 'all', 'recent').map(s => s.id), ['D', 'A', 'C', 'B'])
assert.deepEqual(filterWorklist(records, '', 'all', 'priority').map(s => s.id), ['B', 'C', 'D', 'A'])
assert.deepEqual(filterWorklist(records, '', 'review', 'recent').map(s => s.id), ['A', 'B'])
assert.deepEqual(filterWorklist(records, '', 'signed', 'recent').map(s => s.id), ['C'])
assert.deepEqual(filterWorklist(records, ' patient MRN-b ', 'all', 'recent').map(s => s.id), ['B'])
assert.equal(filterWorklist(records, 'missing', 'all', 'recent').length, 0)
assert.deepEqual(records.map(s => s.id), ['B', 'A', 'C', 'D'], 'filtering must not mutate stored order')
assert.equal(needsReview(empty), false)
assert.equal(needsReview(signed), false)
assert.equal(studyPriority(empty), 0)
assert.equal(workflowLabel(empty), 'Add images')
assert.equal(workflowLabel(recent), 'Review findings')
assert.equal(workflowLabel(signed), 'Signed')
const running = { ...urgent, images: urgent.images.map(i => ({ ...i, status: 'analyzing' as const })) }
assert.equal(workflowLabel(running), 'Analyzing')
const failed = { ...urgent, images: urgent.images.map(i => ({ ...i, status: 'error' as const })) }
assert.equal(workflowLabel(failed), 'Analysis error')
const preview = { ...recent, images: recent.images.map(i => ({ ...i, analysis: undefined, sourceModality: 'CT', status: 'idle' as const })) }
assert.equal(workflowLabel(preview), 'Ready to analyze')
assert.equal(needsReview(preview), false)
console.log('Worklist: 17 checks passed')
