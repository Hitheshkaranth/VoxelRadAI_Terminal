// Regression tests for report safety fixes: undo keeps history, insert into a signed report, dictation bound to its
// study, and locked critical-communication entries during a correction.
import assert from 'node:assert/strict'
import { undoRegenerate } from '../src/lib/reportUndo.ts'
import { insertIntoReport, insertResultLabel } from '../src/lib/reportInsert.ts'
import { useSectionEditors, type SectionEditorHandle } from '../src/lib/sectionEditors.ts'
import { Dictation, guardStudy } from '../src/lib/dictation.ts'
import { commRemovable, latestSignedAt, type LoggedComm } from '../src/lib/reportQa.ts'
import type { CriticalComm, ReportDraft } from '../src/types.ts'

const base = (patch: Partial<ReportDraft> = {}): ReportDraft => ({
  technique: '', comparison: '', findings: '', impression: '', recommendations: '', radiologist: 'Dr A',
  signed: false, generated: true, updatedAt: 1, ...patch,
})
const comm = (id: string, extra: Partial<LoggedComm> = {}): LoggedComm =>
  ({ id, finding: 'Pneumothorax', communicatedTo: 'Dr B', role: 'ED', method: 'phone', at: 5, by: 'Dr A', ...extra })

// 3. Undo Regenerate restores draft text but keeps critical comms and the rest of the post-sign history.
{
  const previous = base({ findings: 'old findings', criticalComms: [] })
  const comms: CriticalComm[] = [comm('c1')]
  const versions = [{ version: 1, signedAt: 10, signedBy: 'Dr A', sections: { technique: '', comparison: '', findings: 'x', impression: '', recommendations: '' } }]
  const current = base({ findings: 'new findings', previous, criticalComms: comms, versions, addenda: [], correction: { of: 1, startedAt: 11, by: 'Dr A' }, amendments: [] })
  const restored = undoRegenerate(current)!
  assert.equal(restored.findings, 'old findings')
  assert.equal(restored.previous, undefined)
  assert.deepEqual(restored.criticalComms, comms, 'critical comms logged after the snapshot survive undo')
  assert.equal(restored.versions, versions)
  assert.deepEqual(restored.correction, current.correction)
  assert.equal(undoRegenerate(base()), null)
}

// 5. Inserting into a read-only (signed) section falls back to the clipboard and says so.
{
  let copied = ''
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (t: string) => { copied = t } } } })
  const handle = (accept: boolean): SectionEditorHandle => ({ focus() {}, exec() {}, insertText: () => accept })
  useSectionEditors.setState({ active: null, editors: { findings: handle(false) } })
  const readOnly = await insertIntoReport('12 mm')
  assert.equal(readOnly, 'copied-read-only')
  assert.equal(copied, '12 mm')
  assert.doesNotMatch(insertResultLabel(readOnly), /Inserted/)
  assert.match(insertResultLabel(readOnly), /read-only.*clipboard/)
  useSectionEditors.setState({ editors: { findings: handle(true) } })
  assert.equal(await insertIntoReport('12 mm'), 'inserted')
  useSectionEditors.setState({ editors: {} })
  assert.equal(await insertIntoReport('12 mm'), 'copied')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
  useSectionEditors.setState({ editors: { findings: handle(false) } })
  assert.equal(await insertIntoReport('12 mm'), 'read-only')
  assert.doesNotMatch(insertResultLabel('read-only'), /Inserted/)
}

// 6. Dictation events are dropped once the active study changes; a late discard aborts an in-flight clip.
{
  let live: string | null = 'study-a'
  const received: string[] = []
  const handler = guardStudy('study-a', () => live, (text: string) => received.push(text))
  handler('first')
  live = 'study-b'
  handler('late transcript')
  live = null
  handler('after unmount')
  assert.deepEqual(received, ['first'])

  const states: string[] = []
  const dictation = new Dictation({ language: 'en-IN', onEvent: () => {}, onState: (s) => states.push(s) })
  await dictation.stop(false)
  const signal = (dictation as unknown as { abort: AbortController }).abort.signal
  assert.equal(signal.aborted, false)
  await dictation.stop(true)
  assert.equal(signal.aborted, true, 'discard after a normal stop still aborts pending transcription')
}

// 7. Communication logged on a signed version cannot be removed during a correction.
{
  const versions = [{ version: 1, signedAt: 100, signedBy: 'Dr A', sections: { technique: '', comparison: '', findings: '', impression: '', recommendations: '' } }]
  assert.equal(latestSignedAt({ versions, signedAt: 50 }), 100)
  assert.equal(latestSignedAt({}), null)
  const correcting = { signed: false, versions, signedAt: 100 }
  assert.equal(commRemovable(comm('old', { loggedAt: 90 }), correcting), false)
  assert.equal(commRemovable(comm('legacy'), correcting), false, 'entries without a logged time stay once a version is signed')
  assert.equal(commRemovable(comm('legacy-backdated', { at: 200 }), correcting), false, 'the editable communication time does not unlock an entry')
  assert.equal(commRemovable(comm('new', { loggedAt: 150 }), correcting), true)
  assert.equal(commRemovable(comm('new', { loggedAt: 150 }), { ...correcting, signed: true }), false)
  assert.equal(commRemovable(comm('draft'), { signed: false }), true, 'never-signed reports allow removal')
}

console.log('Report safety: undo history, signed insert fallback, dictation study guard and locked critical comms passed')
