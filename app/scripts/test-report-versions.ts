// Signed-report integrity: immutable versions, addenda, corrections, and the revision-checked server save.
import assert from 'node:assert/strict'
import { addendumPatch, correctionNote, correctionPatch, currentAddenda, signPatch, signedVersions, validReportHistory, versionHistory } from '../src/lib/reportVersions.ts'
import { reportToPlainText, studyToJson } from '../src/lib/reportExport.ts'
import { validateTransferredStudy } from '../src/lib/studyTransfer.ts'
import { StudyConflictError, knownRevision, saveStudyToServer, setServerRevisionListener, withServerRevision } from '../src/lib/studySync.ts'
import type { PatientInfo, ReportDraft, Study } from '../src/types.ts'

const patient: PatientInfo = { name: 'Synthetic Patient', patientId: 'SYN-1', age: '50', sex: 'Female', studyDate: '2026-01-01', referringPhysician: '', indication: 'Cough', clinicalHistory: '' }
const draft: ReportDraft = { technique: 'PA chest', comparison: 'None', findings: 'Clear lungs.', impression: 'Normal.', recommendations: '', radiologist: 'Dr A', signed: false, generated: true, updatedAt: 1, rich: { findings: '<p>Clear lungs.</p>' } }
const apply = (r: ReportDraft, patch: Partial<ReportDraft>): ReportDraft => ({ ...r, ...patch })

// Signing appends version 1 with all sections, rich text, patient snapshot and overrides.
const signed1 = apply(draft, signPatch(draft, { signedAt: 100, signedBy: 'Dr A', patient, overrides: ['Empty section'] }))
assert.equal(signed1.signed, true)
assert.equal(signed1.versions?.length, 1)
const v1 = signed1.versions![0]
assert.deepEqual(v1.sections, { technique: 'PA chest', comparison: 'None', findings: 'Clear lungs.', impression: 'Normal.', recommendations: '' })
assert.equal(v1.rich?.findings, '<p>Clear lungs.</p>')
assert.deepEqual(v1.patientSnapshot, patient)
assert.deepEqual(v1.signOverrides, ['Empty section'])
assert.equal(v1.corrects, undefined)
// The version is a copy: later draft edits cannot reach it.
assert.notEqual(v1.patientSnapshot, patient)

// Addenda append without changing the signed text.
assert.deepEqual(addendumPatch(signed1, { id: 'a0', text: '   ', by: 'Dr A', now: 150 }), {})
assert.deepEqual(addendumPatch(draft, { id: 'a0', text: 'x', by: 'Dr A', now: 150 }), {}, 'unsigned drafts take edits, not addenda')
const withAddendum = apply(signed1, addendumPatch(signed1, { id: 'a1', text: ' Missed rib fracture noted. ', by: 'Dr B', now: 200 }))
assert.equal(withAddendum.findings, 'Clear lungs.')
assert.deepEqual(withAddendum.addenda, [{ id: 'a1', text: 'Missed rib fracture noted.', createdAt: 200, by: 'Dr B', signedAt: 200, version: 1 }])
assert.deepEqual(withAddendum.versions, signed1.versions)
assert.equal(currentAddenda(withAddendum).length, 1)

const study: Study = { id: '31f37b3e-946a-452c-a666-a1de7c06a47b', title: 'T', patient, images: [], report: withAddendum, createdAt: 1, updatedAt: 1 }
const text = reportToPlainText(study, { institution: 'Test' })
assert.match(text, /ADDENDUM — .+ — Dr B\nMissed rib fracture noted\./)
assert.ok(text.indexOf('Findings:       Clear lungs.') < text.indexOf('ADDENDUM'), 'addendum follows the signed text')
const json = studyToJson(study, { anonymise: true })
assert.equal(json.report?.versions.length, 1)
assert.equal(json.report?.versions[0].patientSnapshot?.name, '', 'anonymised export blanks names in signed versions too')
assert.equal(json.report?.addenda[0].text, 'Missed rib fracture noted.')

// Correction reopens a draft but keeps version 1 untouched; re-signing makes version 2 that supersedes it.
const correcting = apply(withAddendum, correctionPatch(withAddendum, 'Dr B', 300))
assert.equal(correcting.signed, false)
assert.deepEqual(correcting.correction, { of: 1, startedAt: 300, by: 'Dr B' })
assert.deepEqual(correcting.versions, signed1.versions)
assert.equal(correcting.amendments?.length, 1)
assert.deepEqual(currentAddenda(correcting), [], 'a correction draft prints no addenda of its own')
assert.deepEqual(versionHistory(correcting).map((r) => r.status), ['under-correction'])
const edited = { ...correcting, findings: 'Right 6th rib fracture.' }
const signed2 = apply(edited, signPatch(edited, { signedAt: 400, signedBy: 'Dr B', patient }))
assert.equal(signed2.versions?.length, 2)
assert.deepEqual(signed2.versions![0], v1, 'earlier signed version is never rewritten')
assert.equal(signed2.versions![1].corrects, 1)
assert.equal(signed2.versions![1].sections.findings, 'Right 6th rib fracture.')
assert.equal(signed2.correction, undefined)
assert.deepEqual(versionHistory(signed2).map((r) => [r.version.version, r.status, r.addenda.length]), [[2, 'current', 0], [1, 'superseded', 1]])
assert.deepEqual(currentAddenda(signed2), [], 'addenda stay with the version they were added to')
assert.match(correctionNote(signed2), /^Corrected report \(version 2\) — supersedes version 1 signed .+ by Dr A$/)
assert.match(reportToPlainText({ ...study, report: signed2 }, { institution: '' }), /supersedes version 1/)

// Back-compat: a report signed before versions existed loads, and its text is backfilled before any change.
const legacy: ReportDraft = { ...draft, signed: true, signedAt: 50, patientSnapshot: patient }
assert.equal(signedVersions(legacy).length, 1)
assert.equal(signedVersions(legacy)[0].sections.findings, 'Clear lungs.')
const legacyAdd = apply(legacy, addendumPatch(legacy, { id: 'l1', text: 'Note', by: 'Dr A', now: 60 }))
assert.equal(legacyAdd.versions?.length, 1)
assert.equal(legacyAdd.addenda?.[0].version, 1)
const legacyFix = apply(legacy, correctionPatch(legacy, 'Dr A', 70))
assert.equal(legacyFix.versions?.[0].signedAt, 50, 'legacy signed text is kept as version 1 when corrected')
assert.equal(validateTransferredStudy({ ...study, report: legacy }).report?.signed, true)

// Imported history is shape-checked.
assert.equal(validReportHistory(signed2 as unknown as Record<string, unknown>), true)
assert.equal(validReportHistory({ versions: [{ ...v1, version: 2 }] }), false, 'versions are numbered from 1 in order')
assert.equal(validReportHistory({ addenda: [{ id: '', text: 'x', createdAt: 1, by: '' }] }), false)
assert.throws(() => validateTransferredStudy({ ...study, report: { ...signed2, versions: [{ version: 1 }] } }))

// Revision-checked save: the header names the revision of THIS copy of the study; 409 surfaces as a conflict error.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } } })
const originalFetch = globalThis.fetch
const stamped: [string, number][] = []
setServerRevisionListener((id, revision) => { stamped.push([id, revision]) })
try {
  const headers: (string | undefined)[] = []
  let reply: Response = new Response(JSON.stringify({ id: study.id, revision: 1 }))
  globalThis.fetch = (async (_path: string, init?: RequestInit) => { headers.push((init?.headers as Record<string, string>)['X-Study-Revision']); return reply }) as typeof fetch
  assert.equal(knownRevision(study), undefined)
  assert.equal(await saveStudyToServer(study), 1)
  assert.equal(headers[0], 'new', 'first save expects no server copy')
  assert.deepEqual(stamped.at(-1), [study.id, 1], 'a successful save stamps the study copy with its new revision')
  let copy = withServerRevision(study, 1)
  assert.equal(knownRevision(copy), 1)
  reply = new Response(JSON.stringify({ id: study.id, revision: 2 }))
  await saveStudyToServer(copy)
  assert.equal(headers[1], '1')
  copy = withServerRevision(copy, 2)
  reply = new Response(JSON.stringify({ code: 'stale', error: 'Server copy changed.', revision: 5 }), { status: 409 })
  await assert.rejects(saveStudyToServer(copy), (e: unknown) => e instanceof StudyConflictError && e.code === 'stale' && e.message === 'Server copy changed.')
  assert.deepEqual(stamped.at(-1), [study.id, 2], 'a refused save does not stamp a revision')
  reply = new Response(JSON.stringify({ code: 'signed-history', error: 'x' }), { status: 409 })
  await assert.rejects(saveStudyToServer(copy), (e: unknown) => e instanceof StudyConflictError && e.code === 'signed-history')
  reply = new Response(JSON.stringify({ revision: 6 }))
  await saveStudyToServer(copy, { overwrite: true })
  assert.equal(headers[headers.length - 1], undefined, 'explicit overwrite skips the revision check')
  assert.deepEqual(stamped.at(-1), [study.id, 6])
  assert.equal(withServerRevision(copy, 'junk').serverRevision, undefined, 'an unusable revision is not kept')

  // Two tabs opened the same server revision 3. Tab A saves (server -> 4). Tab B still holds revision 3 and must
  // send 3, not the 4 that tab A saw: the revision lives on each tab's copy, not in shared browser storage.
  const tabA = withServerRevision(study, 3), tabB = withServerRevision(study, 3)
  reply = new Response(JSON.stringify({ revision: 4 }))
  await saveStudyToServer(tabA)
  assert.equal(headers.at(-1), '3')
  reply = new Response(JSON.stringify({ code: 'stale', error: 'Server copy changed.' }), { status: 409 })
  await assert.rejects(saveStudyToServer(tabB), (e: unknown) => e instanceof StudyConflictError && e.code === 'stale')
  assert.equal(headers.at(-1), '3', 'tab B sends its own (older) revision and is refused')
  // A re-imported older file carries the revision it was exported at, so it conflicts too.
  const reimported = withServerRevision(study, 2)
  await assert.rejects(saveStudyToServer(reimported))
  assert.equal(headers.at(-1), '2')

  // Migration: a study saved before serverRevision existed falls back to the legacy browser map once; after a
  // successful save the study carries its own revision and the legacy entry is dropped.
  const legacyStudy = { ...study, id: '00000000-0000-4000-8000-000000000001' }
  store.set('voxelrad.studyRevisions', JSON.stringify({ [legacyStudy.id]: 7, other: 9 }))
  assert.equal(knownRevision(legacyStudy), 7)
  assert.equal(knownRevision(withServerRevision(legacyStudy, 8)), 8, 'the study field wins over the legacy map')
  reply = new Response(JSON.stringify({ revision: 8 }))
  await saveStudyToServer(legacyStudy)
  assert.equal(headers.at(-1), '7')
  assert.deepEqual(JSON.parse(store.get('voxelrad.studyRevisions')!), { other: 9 }, 'legacy entry read once, then dropped')
  assert.equal(knownRevision(legacyStudy), undefined)
} finally {
  globalThis.fetch = originalFetch
  setServerRevisionListener(undefined)
}
console.log('report versions: ok')
