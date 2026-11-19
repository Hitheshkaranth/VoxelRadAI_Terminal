import assert from 'node:assert/strict'
import {
  criticalMentions, dictationArtefacts, hasUncommunicatedCritical, lateralityIssues, negatedAt, omittedFromImpression, reportQa,
  sentences, sexIssues, uncommunicatedCritical, unsizedLesions,
} from '../src/lib/reportQa.ts'
import { findingsReport } from '../src/lib/findingsReport.ts'
import type { CriticalComm, Finding, ReportDraft, Study } from '../src/types.ts'

assert.deepEqual(sentences('Nodule 2.3 cm. Effusion.\nLungs: clear'), ['Nodule 2.3 cm.', 'Effusion.', 'Lungs: clear'])
assert.equal(negatedAt('No pneumothorax.', 3, 12), true)
assert.equal(negatedAt('Pneumothorax has resolved.', 0, 12), true)
assert.equal(negatedAt('No effusion; small pneumothorax.', 18, 12), false)

// Laterality: impression side contradicts the findings.
assert.equal(lateralityIssues('Large right pneumothorax.', 'Left pneumothorax.').length, 1)
assert.match(lateralityIssues('Large right pneumothorax.', '1. Left pneumothorax.')[0].message, /left pneumothorax.*on the right/)
assert.deepEqual(lateralityIssues('Large right pneumothorax.', 'Right pneumothorax.'), [])
assert.deepEqual(lateralityIssues('Bilateral pleural effusions.', 'Left effusion.'), [], 'bilateral findings cover either side')
assert.deepEqual(lateralityIssues('Right lower lobe consolidation and left pleural effusion.', 'Right lower lobe consolidation. Left effusion.'), [])
assert.equal(lateralityIssues('Right lower lobe consolidation and left pleural effusion.', 'Left lower lobe consolidation.').length, 1)
assert.deepEqual(lateralityIssues('No left pneumothorax. Right pneumothorax.', 'Right pneumothorax.'), [], 'negated mentions carry no side')
assert.deepEqual(lateralityIssues('Pneumothorax.', 'Left pneumothorax.'), [], 'no side in findings: nothing to contradict')
assert.equal(lateralityIssues('Acute subdural haematoma, left frontal convexity.', '1. Acute subdural haematoma, right frontal convexity.').length, 1,
  'the sentence side applies to a clause without one')

// Sex-specific anatomy.
assert.equal(sexIssues('The prostate is enlarged.', 'Female').length, 1)
assert.equal(sexIssues('Uterus is anteverted.', 'Male').length, 1)
assert.deepEqual(sexIssues('Uterus is anteverted.', 'Female'), [])
assert.deepEqual(sexIssues('Prostate enlarged.', ''), [], 'unknown sex is not checked')
assert.deepEqual(sexIssues('Cervical spine alignment.', 'Male'), [], 'cervical spine is not the cervix')
assert.deepEqual(sexIssues('The test was repeated.', 'Female'), [])

// Impression must mention significant and critical findings.
const f = (patch: Partial<Finding>): Finding => ({ id: Math.random().toString(36), title: 'X', description: '', severity: 'moderate', confidence: 0.5, location: '', ...patch })
assert.equal(omittedFromImpression([f({ title: 'Right pneumothorax', severity: 'critical' })], 'Cardiomegaly.').length, 1)
assert.deepEqual(omittedFromImpression([f({ title: 'Right pneumothorax', severity: 'critical' })], 'Small right apical pneumothorax.'), [])
assert.deepEqual(omittedFromImpression([f({ title: 'Pleural effusion', severity: 'significant' })], 'Bilateral effusions.'), [])
assert.deepEqual(omittedFromImpression([f({ title: 'Rib fracture', severity: 'moderate' })], 'Cardiomegaly.'), [], 'moderate findings are optional')
assert.deepEqual(omittedFromImpression([f({ title: 'Mass', severity: 'critical', review: 'dismissed' })], 'Cardiomegaly.'), [])
assert.deepEqual(omittedFromImpression([f({ title: 'Mass', severity: 'critical' })], ''), [], 'empty impression is flagged elsewhere')

// Lesions without a size.
assert.equal(unsizedLesions('Right upper lobe nodule.', '').length, 1)
assert.deepEqual(unsizedLesions('Right upper lobe nodule measuring 8 mm.', 'Right upper lobe nodule.'), [], 'impression may rely on the findings size')
assert.deepEqual(unsizedLesions('Nodule 1.2 x 0.9 cm.', ''), [])
assert.deepEqual(unsizedLesions('No focal lesion. No mass effect.', ''), [])
assert.deepEqual(unsizedLesions('Multiple tiny cysts in both kidneys.', ''), [])
assert.deepEqual(unsizedLesions('Lungs: [___]', ''), [])
assert.equal(unsizedLesions('', 'Suspicious mass in the pancreatic head.').length, 1)

// Critical results.
assert.deepEqual(criticalMentions('Large right pneumothorax. No free air.'), ['Pneumothorax'])
assert.deepEqual(criticalMentions('No pneumothorax. No pneumoperitoneum.'), [])
assert.deepEqual(criticalMentions('Acute subdural haematoma with 6 mm midline shift.'), ['Intracranial haemorrhage', 'Brain herniation or midline shift'])
assert.deepEqual(criticalMentions('Saddle PE.'), ['Pulmonary embolism'])
assert.deepEqual(criticalMentions('Type, pelvis and recipe pe.'), [], 'lower-case pe is not an abbreviation')
assert.deepEqual(criticalMentions('Rule out aortic dissection.'), [])
assert.deepEqual(criticalMentions('SAH in the basal cisterns.'), ['Intracranial haemorrhage'])

const report = (patch: Partial<ReportDraft>): ReportDraft => ({
  technique: 'CT head.', comparison: 'None available.', findings: '', impression: '', recommendations: '',
  radiologist: 'Dr A', signed: false, generated: true, updatedAt: 0, ...patch,
})
const comm = (finding: string): CriticalComm => ({ id: '1', finding, communicatedTo: 'Dr B', role: 'ED physician', method: 'phone', at: 1, by: 'Dr A' })
const ctStudy = (r?: ReportDraft, findings: Finding[] = []) => ({
  id: 's', title: 'CT', createdAt: 0, updatedAt: 0, report: r,
  patient: { name: '', patientId: '', age: '', sex: 'Male', studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' },
  images: [{ id: 'i', name: 'ct', analysis: { modality: 'CT', bodyPart: 'Head', view: 'Axial', findings } }],
}) as unknown as Study
const sdh = report({ findings: 'Acute subdural haematoma, left convexity, 9 mm.', impression: '1. Acute left subdural haematoma.' })
assert.deepEqual(uncommunicatedCritical(ctStudy(sdh)), ['Intracranial haemorrhage'])
assert.equal(hasUncommunicatedCritical(ctStudy(sdh)), true)
assert.deepEqual(uncommunicatedCritical(ctStudy({ ...sdh, criticalComms: [comm('Acute subdural haematoma')] })), [])
assert.deepEqual(uncommunicatedCritical(ctStudy({ ...sdh, criticalComms: [comm('Intracranial haemorrhage')] })), [])
assert.deepEqual(uncommunicatedCritical(ctStudy({ ...sdh, criticalComms: [comm('Rib fracture')] })), ['Intracranial haemorrhage'])
assert.equal(hasUncommunicatedCritical(ctStudy(undefined, [f({ title: 'Tension pneumothorax', severity: 'critical', review: 'accepted' })])), true)
assert.equal(hasUncommunicatedCritical(ctStudy(undefined, [f({ title: 'Tension pneumothorax', severity: 'critical' })])), false, 'unreviewed candidates are not critical results yet')
assert.equal(hasUncommunicatedCritical(ctStudy(undefined, [f({ title: 'Odd critical thing', severity: 'critical', review: 'accepted' })])), true)
assert.equal(hasUncommunicatedCritical(ctStudy(report({ criticalComms: [comm('Odd critical thing')] }), [f({ title: 'Odd critical thing', severity: 'critical', review: 'accepted' })])), false)
assert.equal(hasUncommunicatedCritical(ctStudy(report({ findings: 'No acute haemorrhage.' }))), false)

// Dictation artefacts.
assert.equal(dictationArtefacts(report({ findings: 'The the heart is enlarged.' })).length, 1)
assert.equal(dictationArtefacts(report({ impression: 'Effusion scratch that consolidation.' })).length, 1)
assert.equal(dictationArtefacts(report({ findings: 'Effusion new paragraph Lungs.' })).length, 1)
assert.deepEqual(dictationArtefacts(report({ findings: 'He said that that was new.' })), [])
assert.deepEqual(dictationArtefacts(report({ findings: 'Normal sinus drainage. 2 2 mm' })), [], 'numbers are not repeated words')
assert.match(dictationArtefacts(report({ recommendations: 'Um, follow up.' }))[0].message, /recommendations/)

// Whole check on a male patient with several problems, and on the generated draft itself.
const issues = reportQa(ctStudy(report({
  findings: 'Right pneumothorax. Prostate noted. Nodule in the right upper lobe.',
  impression: 'Left pneumothorax.',
  recommendations: 'Follow up follow up.',
}), [f({ title: 'Pulmonary embolism', severity: 'critical' })]), report({
  findings: 'Right pneumothorax. Uterus noted. Nodule in the right upper lobe.',
  impression: 'Left pneumothorax.',
  recommendations: 'Follow up follow up.',
}))
assert.deepEqual(issues.map((i) => i.kind).sort(), ['critical', 'dictation', 'impression', 'laterality', 'sex', 'size'])

const draftStudy = ctStudy(undefined, [f({ title: 'Acute subdural haematoma', location: 'Left frontal convexity', severity: 'critical', review: 'accepted' })])
const draft = report(findingsReport(draftStudy))
const draftIssues = reportQa(draftStudy, draft)
assert.deepEqual(draftIssues.map((i) => i.kind), ['critical'], 'a fresh draft only needs the critical result logged')
assert.deepEqual(reportQa(draftStudy, { ...draft, criticalComms: [comm('Subdural haematoma')] }), [])
console.log('Report QA: laterality, sex-specific anatomy, impression coverage, lesion size, critical communication and dictation artefacts passed')
