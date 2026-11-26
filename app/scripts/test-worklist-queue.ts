import assert from 'node:assert/strict'
import { activeFacetCount, adjacentStudy, DEFAULT_PREFS, filterWorklist, formatAge, hasUrgentCandidate, modalityLabel, NO_FACETS, nextStudy, parseWorklistPrefs, studyDay, studyModalities, studyStatus, turnaround, worklistModalities, type WorklistView } from '../src/lib/worklist.ts'
import type { Study } from '../src/types.ts'

type Urgency = 'routine' | 'priority' | 'urgent'
function study(id: string, updatedAt: number, opts: { urgency?: Urgency; modality?: string; aiModality?: string; report?: 'draft' | 'signed'; images?: number; studyDate?: string; createdAt?: number; analysedAt?: number } = {}): Study {
  const count = opts.images ?? 1
  return {
    id, title: `Study ${id}`, createdAt: opts.createdAt ?? 0, updatedAt,
    patient: { name: `Patient ${id}`, patientId: `MRN-${id}`, age: '', sex: '', studyDate: opts.studyDate ?? '', referringPhysician: '', indication: '', clinicalHistory: '' },
    images: Array.from({ length: count }, (_, i) => ({
      id: `${id}-${i}`, name: 'x.png', mime: 'image/png', dataUrl: '', width: 1, height: 1, addedAt: 1, status: opts.urgency ? 'done' : 'idle',
      ...(opts.modality ? { sourceModality: opts.modality } : {}),
      ...(opts.urgency ? { analysis: { urgency: opts.urgency, modality: opts.aiModality ?? '', createdAt: opts.analysedAt ?? 0 } } : {}),
    })),
    ...(opts.report ? { report: { signed: opts.report === 'signed' } } : {}),
  } as Study
}

const unread = study('U', 50, { modality: 'CT', studyDate: '2026-11-01' })
const review = study('R', 40, { urgency: 'urgent', modality: 'DX', studyDate: '2026-11-05' })
const draft = study('D', 30, { urgency: 'priority', aiModality: 'Radiograph (X-ray)', report: 'draft', studyDate: '2026-11-10' })
const signed = study('S', 20, { urgency: 'routine', modality: 'MR', report: 'signed', studyDate: '2026-11-15' })
const routine = study('P', 10, { urgency: 'routine', modality: 'CR', studyDate: '2026-11-20' })
const all = [unread, review, draft, signed, routine]
const ids = (list: Study[]) => list.map((s) => s.id)

// Status is exclusive.
assert.deepEqual(all.map(studyStatus), ['unread', 'review', 'draft', 'signed', 'review'])
assert.deepEqual(ids(filterWorklist(all, '', 'review', 'recent')), ['R', 'P'])
assert.deepEqual(ids(filterWorklist(all, '', 'draft', 'recent')), ['D'])
assert.deepEqual(ids(filterWorklist(all, '', 'unread', 'recent')), ['U'])

// Modality: DICOM metadata first, model read second; families collapse CR/DX.
assert.equal(modalityLabel('dx'), 'XR')
assert.equal(modalityLabel('Radiograph (X-ray)'), 'XR')
assert.equal(modalityLabel('MRI'), 'MR')
assert.equal(modalityLabel('Computed tomography'), 'CT')
assert.equal(modalityLabel(''), '')
assert.deepEqual(studyModalities(draft), ['XR'])
assert.deepEqual(worklistModalities(all), ['CT', 'MR', 'XR'])
assert.deepEqual(ids(filterWorklist(all, '', 'all', 'recent', { ...NO_FACETS, modality: 'XR' })), ['R', 'D', 'P'])

// Urgency: routine needs an analysis, so unread studies are not "routine".
assert.deepEqual(ids(filterWorklist(all, '', 'all', 'recent', { ...NO_FACETS, urgency: 'urgent' })), ['R'])
assert.deepEqual(ids(filterWorklist(all, '', 'all', 'recent', { ...NO_FACETS, urgency: 'routine' })), ['S', 'P'])
assert.equal(hasUrgentCandidate(review), true)
assert.equal(hasUrgentCandidate(draft), false)

// Dates are inclusive; created day is the fallback.
assert.deepEqual(ids(filterWorklist(all, '', 'all', 'recent', { ...NO_FACETS, from: '2026-11-05', to: '2026-11-15' })), ['R', 'D', 'S'])
const created = new Date(2026, 0, 2, 13).getTime()
assert.equal(studyDay(study('X', 1, { createdAt: created })), '2026-01-02')
assert.equal(activeFacetCount({ modality: 'CT', urgency: '', from: '2026-01-01', to: '2026-02-01' }), 2)

// Sign and next: next unsigned in the visible order, wrapping, never the current one or a signed one.
const view: WorklistView = { query: '', filter: 'all', sort: 'recent', facets: NO_FACETS }
assert.equal(nextStudy(all, 'U', view)?.id, 'R')
assert.equal(nextStudy(all, 'D', view)?.id, 'P', 'signed S is skipped')
assert.equal(nextStudy(all, 'P', view)?.id, 'U', 'wraps to the top')
assert.equal(nextStudy(all, 'missing', view)?.id, 'U')
assert.equal(nextStudy(all, 'R', { ...view, sort: 'priority' })?.id, 'D')
assert.equal(nextStudy(all, 'R', { ...view, filter: 'review' })?.id, 'P')
assert.equal(nextStudy([review], 'R', view), null)
assert.equal(nextStudy([review, signed], 'R', view), null)

// N / Shift+N stop at the ends.
const list = filterWorklist(all, '', 'all', 'recent')
assert.equal(adjacentStudy(list, 'U', 1)?.id, 'R')
assert.equal(adjacentStudy(list, 'U', -1), null)
assert.equal(adjacentStudy(list, 'P', 1), null)
assert.equal(adjacentStudy(list, null, -1)?.id, 'P')
assert.equal(adjacentStudy([], null, 1), null)

// Turnaround for unsigned studies only.
const hour = 3600000
const waiting = study('W', 1, { urgency: 'routine', createdAt: 0, analysedAt: 2 * hour })
assert.deepEqual(turnaround(waiting, 5 * hour, 4 * hour), { sinceCreated: 5 * hour, sinceAnalysis: 3 * hour, overdue: true })
assert.deepEqual(turnaround(unread, 1 * hour, 4 * hour), { sinceCreated: hour, overdue: false })
assert.equal(turnaround(waiting, 5 * hour, 0)?.overdue, false, '0 turns highlighting off')
assert.equal(turnaround(signed, 5 * hour, hour), null)
assert.equal(turnaround(study('E', 1, { images: 0 }), 5 * hour, hour), null)
assert.equal(formatAge(30000), '<1m')
assert.equal(formatAge(45 * 60000), '45m')
assert.equal(formatAge(90 * 60000), '1h 30m')
assert.equal(formatAge(26 * hour), '26h')
assert.equal(formatAge(72 * hour), '3d')

// Stored preferences are validated.
assert.deepEqual(parseWorklistPrefs(null), DEFAULT_PREFS)
assert.deepEqual(parseWorklistPrefs('not json'), DEFAULT_PREFS)
assert.deepEqual(parseWorklistPrefs('[1]'), DEFAULT_PREFS)
assert.deepEqual(parseWorklistPrefs(JSON.stringify({ filter: 'draft', sort: 'priority', modality: 'CT', urgency: 'urgent', from: '2026-01-01', to: 'bad', overdueHours: 24 })),
  { filter: 'draft', sort: 'priority', modality: 'CT', urgency: 'urgent', from: '2026-01-01', to: '', followUp: '', overdueHours: 24 })
assert.equal(parseWorklistPrefs(JSON.stringify({ followUp: 'due' })).followUp, 'due')
assert.equal(parseWorklistPrefs(JSON.stringify({ followUp: 'soon' })).followUp, '')
assert.deepEqual(parseWorklistPrefs(JSON.stringify({ filter: 'drop table', modality: '<script>', overdueHours: 5 })), DEFAULT_PREFS)
console.log('Worklist queue: filters, sign-and-next, turnaround and stored preferences checked')
