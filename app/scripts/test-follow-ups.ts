import assert from 'node:assert/strict'
import { dueDate, extractFollowUps, followUpStatus, intervalLabel, matchesFollowUpFacet, parseFollowUp, signFollowUps, studyFollowUp, syncFollowUps, undecidedFollowUps } from '../src/lib/followUps.ts'
import { undoRegenerate } from '../src/lib/reportUndo.ts'
import { validateTransferredStudy } from '../src/lib/studyTransfer.ts'
import type { FollowUp, ReportDraft, Study } from '../src/types.ts'

const DAY = 86400000
let checks = 0
const eq = (a: unknown, b: unknown, msg?: string) => { assert.deepEqual(a, b, msg ?? 'mismatch'); checks++ }

// Parsing: modality, ranges, units, words, annual.
const p = (s: string) => parseFollowUp(s)
eq(p('Recommend CT chest in 3 months.')?.modality, 'CT')
eq(p('Recommend CT chest in 3 months.')?.minMonths, 3)
eq([p('CT at 6-12 months, then consider CT at 18-24 months.')?.minMonths, p('CT at 6-12 months, then consider CT at 18-24 months.')?.maxMonths], [6, 12], 'first interval wins')
eq([p('Follow-up ultrasound in 6 to 12 weeks.')?.modality, p('Follow-up ultrasound in 6 to 12 weeks.')?.minMonths], ['Ultrasound', 1.38])
eq(p('Repeat chest radiograph in two weeks after treatment.')?.modality, 'X-ray')
eq(p('Annual low-dose CT screening.')?.minMonths, 12)
eq(p('Consider PET/CT or tissue sampling.')?.modality, 'PET-CT')
eq(p('Recommend MRI of the liver for further characterization.')?.minMonths, undefined, 'no interval → undated')
eq(p('Recommend MRI of the liver for further characterization.')?.modality, 'MRI')
eq(p('Clinical follow-up in 1 year.')?.minMonths, 12)
// Not follow-ups.
eq(p('No routine follow-up is needed.'), null)
eq(p('No follow-up imaging required.'), null)
eq(p('Correlate clinically.'), null)
eq(p('Heart size is normal.'), null)
eq(p('The CT shows a 3 mm nodule.'), null, 'modality mentioned but nothing asked')
eq(p('Follow-up CT is not recommended.'), null)

// Extraction across recommendations then impression, de-duplicated.
const report = { recommendations: 'Recommend CT chest in 3 months.\nNo routine follow-up for the thyroid.', impression: 'Right upper lobe nodule. Recommend CT chest in 3 months.' }
eq(extractFollowUps(report).map((f) => f.text), ['Recommend CT chest in 3 months.'])

// Decisions survive re-extraction (whitespace / punctuation edits) and disappear with their sentence.
const decided: FollowUp[] = [{ ...extractFollowUps(report)[0], decision: 'track' }]
eq(syncFollowUps({ ...report, recommendations: 'Recommend  CT chest in 3 months', followUps: decided })[0].decision, 'track')
eq(syncFollowUps({ recommendations: 'Recommend MRI brain in 6 months.', impression: '', followUps: decided }).map((f) => f.decision), [undefined])
eq(undecidedFollowUps(syncFollowUps({ recommendations: 'CT in 3 months. MRI in 6 months.', impression: '', followUps: decided })).length, 2)

// Sign-off: tracked items with an interval get a due date; declined and undated do not; re-signing keeps it.
const signedAt = Date.UTC(2026, 0, 1)
const text = { recommendations: 'CT chest in 3 months. MRI liver for characterization. Ultrasound in 6 months.', impression: '' }
const items = syncFollowUps(text)
const withDecisions = { ...text, followUps: [{ ...items[0], decision: 'track' as const }, { ...items[1], decision: 'track' as const }, { ...items[2], decision: 'declined' as const }] }
const signed = signFollowUps(withDecisions, signedAt)
eq(signed[0].dueAt, signedAt + 91 * DAY, '3 months ≈ 91 days')
eq(signed[1].dueAt, undefined)
eq(signed[2].dueAt, undefined)
eq(signFollowUps({ ...text, followUps: signed }, signedAt + 400 * DAY)[0].dueAt, signed[0].dueAt, 're-sign keeps original due date')
eq(dueDate({ id: 'x', text: 'x' }, signedAt), undefined)

// Status over time.
const due = signed[0].dueAt!
eq(followUpStatus(signed[0], signedAt), 'scheduled')
eq(followUpStatus(signed[0], due - 10 * DAY), 'due-soon')
eq(followUpStatus(signed[0], due + DAY), 'overdue')
eq(followUpStatus({ ...signed[0], completedAt: due }, due + DAY), 'completed')
eq(followUpStatus(signed[1], signedAt), 'undated')
eq(followUpStatus(signed[2], signedAt), 'declined')
eq(followUpStatus(items[0], signedAt), 'undecided')
eq(intervalLabel(signed[0]), 'CT · 3 mo')
eq(intervalLabel({ id: 'x', text: 'x', modality: 'CT', minMonths: 6, maxMonths: 12 }), 'CT · 6 mo–1 yr')
eq(intervalLabel(p('CT chest at 3-6 months.')!), 'CT · 3–6 mo')
eq(intervalLabel(p('Ultrasound of the thyroid in 6 weeks.')!), 'Ultrasound · 6 wk')
eq(intervalLabel(p('Follow-up ultrasound in 6 to 12 weeks.')!), 'Ultrasound · 6–12 wk')
eq(intervalLabel(p('Repeat radiograph in 10 days.')!), 'X-ray · 10 d')
eq(intervalLabel(p('CT in 1-2 years.')!), 'CT · 1–2 yr')
eq(intervalLabel(p('Recommend MRI for further characterization.')!), 'MRI')

// Study level: only signed studies, open items, earliest first; facets.
const base: ReportDraft = { technique: '', comparison: '', findings: '', impression: '', recommendations: text.recommendations, radiologist: 'Dr A', signed: true, signedAt, generated: true, updatedAt: signedAt, followUps: signed }
const study = (report: ReportDraft): Study => ({ id: '0b6f8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', title: 'T', createdAt: 0, updatedAt: 0, images: [], report,
  patient: { name: '', patientId: '', age: '', sex: '', studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' } })
const state = studyFollowUp(study(base), signedAt)
eq([state?.count, state?.item.modality, state?.status], [2, 'CT', 'scheduled'])
eq(studyFollowUp(study({ ...base, signed: false }), signedAt), null, 'drafts have no open follow-ups')
eq(matchesFollowUpFacet(study(base), 'open', signedAt), true)
eq(matchesFollowUpFacet(study(base), 'due', signedAt), false)
eq(matchesFollowUpFacet(study(base), 'due', due + DAY), true)
eq(matchesFollowUpFacet(study(base), '', signedAt), true)
eq(matchesFollowUpFacet(study({ ...base, followUps: signed.map((f) => ({ ...f, completedAt: due })) }), 'open', due), false)

// Undoing a regenerate never rolls back follow-up decisions.
const restored = undoRegenerate({ ...base, signed: false, followUps: signed, previous: { ...base, signed: false, followUps: undefined } })
eq(restored?.followUps, signed)

// Study transfer accepts valid follow-ups and rejects malformed ones.
const transfer = (followUps: unknown) => { try { validateTransferredStudy(structuredClone({ ...study(base), report: { ...base, followUps } })); return true } catch { return false } }
eq(transfer(signed), true)
eq(transfer([{ id: 'x', text: 'x', decision: 'maybe' }]), false)
eq(transfer([{ id: 'x', text: 'x', dueAt: 'soon' }]), false)

console.log(`Follow-up tracking: ${checks} checks passed`)
