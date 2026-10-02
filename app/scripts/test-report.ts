// OWNER: Agent 4 (Report). Unit tests for the plain-text / JSON report export. Run with:
//   node --experimental-strip-types scripts/test-report.ts
import { DISCLAIMER, reportToPlainText, splitFindings, studyFileName, studyToJson } from '../src/lib/reportExport.ts'
import type { Finding, PatientInfo, ReportDraft, Study } from '../src/types.ts'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++
  else {
    failed++
    console.error(`  ✗ ${name}${detail ? ` → ${detail}` : ''}`)
  }
}

// ---- fixtures ---------------------------------------------------------------
const patient: PatientInfo = {
  name: 'Jane Doe',
  patientId: 'MRN-1234',
  age: '54',
  sex: 'Female',
  studyDate: '2026-10-01',
  referringPhysician: 'Dr. Smith',
  indication: 'Cough',
  clinicalHistory: '',
}

const finding = (id: string, patch: Partial<Finding>): Finding => ({
  id,
  title: 'Finding ' + id,
  description: '',
  severity: 'moderate',
  confidence: 0.92,
  location: 'Right lower zone',
  ...patch,
})

const report: ReportDraft = {
  technique: 'PA chest',
  comparison: 'None',
  findings: 'Consolidation in the right lower zone.',
  impression: 'Right lower zone consolidation.',
  recommendations: 'Clinical correlation.',
  radiologist: 'Dr. Ray',
  signed: false,
  generated: true,
  updatedAt: Date.UTC(2026, 9, 1),
}

function makeStudy(r: ReportDraft | undefined = report, p: PatientInfo = patient): Study {
  return {
    id: 'study-1',
    title: 'Jane Doe / Chest: 2026?',
    patient: p,
    createdAt: Date.UTC(2026, 9, 1),
    updatedAt: Date.UTC(2026, 9, 1),
    report: r,
    images: [
      {
        id: 'img-1',
        name: 'doe_jane_mrn1234.png',
        mime: 'image/png',
        dataUrl: 'data:image/png;base64,AAAA',
        width: 100,
        height: 100,
        addedAt: Date.UTC(2026, 9, 1),
        status: 'done',
        analysis: {
          modality: 'Radiograph (X-ray)',
          bodyPart: 'Chest',
          view: 'PA',
          imageQuality: 'Adequate',
          findings: [
            finding('a', { title: 'Right lower lobe consolidation', classifier: { kind: 'opacity', prob: 0.81, thr: 0.5, supported: true } }),
            finding('b', { title: 'Left pleural effusion', classifier: { kind: 'effusion', prob: 0.04, thr: 0.3, supported: false } }),
            finding('c', { title: 'Cardiomegaly', review: 'dismissed' }),
            finding('d', { title: 'No pneumothorax', severity: 'normal' }),
            finding('e', { title: 'Small right apical nodule', source: 'maira2', classifier: { kind: 'nodule / mass', prob: 0.71, supported: true } }),
            finding('f', { title: 'Right pneumothorax', classifier: { kind: 'pneumothorax', prob: 0.1, supported: false }, review: 'accepted' }),
          ],
          pertinentNegatives: [],
          impression: '',
          recommendations: [],
          differential: [],
          urgency: 'priority',
          rawText: '',
          model: 'medgemma-27b-it',
          durationMs: 1,
          createdAt: Date.UTC(2026, 9, 1),
        },
      },
    ],
  }
}

const settings = { institution: 'Skanda Radiology' }

// ---- reportToPlainText --------------------------------------------------------
const text = reportToPlainText(makeStudy(), settings)
const lines = text.split('\n')

check('disclaimer present (draft)', text.includes(DISCLAIMER))
check('disclaimer present (no report)', reportToPlainText(makeStudy(undefined), settings).includes(DISCLAIMER))
check('disclaimer present (signed)', reportToPlainText(makeStudy({ ...report, signed: true, signedAt: 1 }), settings).includes(DISCLAIMER))
check('disclaimer wording', DISCLAIMER.includes('Not a diagnosis') && DISCLAIMER.includes('qualified radiologist'))
check('header says AI-assisted draft', text.includes('Radiology Report — AI-assisted draft'))
check('header never says Diagnostic', !/diagnostic/i.test(lines.slice(0, 3).join(' ')))
check('normal item skipped', !text.includes('No pneumothorax'))
check('confidence labelled as model self-reported', text.includes('model self-reported, uncalibrated'))
check('MAIRA-2 marked', /Small right apical nodule.*\(MAIRA-2 second reader\)/.test(text))

// Classifier-unsupported findings stay in the summary, marked unconfirmed; only dismissed ones are "not included".
const notIncludedAt = lines.findIndex((l) => l === 'AI findings not included in this report')
check('not-included section present', notIncludedAt > 0)
const effusionLines = lines.map((l, i) => [l, i] as const).filter(([l]) => l.includes('Left pleural effusion'))
check('unconfirmed finding listed once', effusionLines.length === 1)
check('unconfirmed finding in the summary, before not-included', effusionLines.every(([, i]) => i < notIncludedAt))
check(
  'unconfirmed finding flagged',
  effusionLines.every(([l]) => l.includes('[unconfirmed: not supported by classifier cross-check — verify]')),
)
check('accepted unsupported finding not flagged', !(lines.find((l) => l.includes('Right pneumothorax')) ?? '').includes('unconfirmed'))
const cardioLine = lines.find((l) => l.includes('Cardiomegaly')) ?? ''
check('dismissed finding flagged', cardioLine.includes('[dismissed by reviewer — not in report]'))
check('dismissed finding after not-included header', lines.indexOf(cardioLine) > notIncludedAt)
const ptxLine = lines.findIndex((l) => l.includes('Right pneumothorax'))
check('reviewer-accepted override stays included', ptxLine > 0 && ptxLine < notIncludedAt)

// Signed report uses the frozen patient snapshot, not later edits.
const signedReport: ReportDraft = {
  ...report,
  signed: true,
  signedAt: Date.UTC(2026, 9, 1, 12),
  patientSnapshot: patient,
  amendments: [{ signedAt: Date.UTC(2026, 9, 1, 10), unlockedAt: Date.UTC(2026, 9, 1, 11), by: 'Dr. Ray' }],
}
const edited = { ...patient, name: 'Changed Name', patientId: 'MRN-9999' }
const signedText = reportToPlainText(makeStudy(signedReport, edited), settings)
check('signed uses patientSnapshot name', signedText.includes('Jane Doe') && !signedText.includes('Changed Name'))
check('signed uses patientSnapshot id', signedText.includes('MRN-1234') && !signedText.includes('MRN-9999'))
check('signed lists amendments', signedText.includes('Amendments') && signedText.includes('unlocked for amendment'))
const unsignedEdited = reportToPlainText(makeStudy({ ...report, patientSnapshot: patient }, edited), settings)
check('unsigned uses live patient', unsignedEdited.includes('Changed Name'))

// ---- splitFindings ------------------------------------------------------------
const split = splitFindings(makeStudy())
check('split included', split.included.map((r) => r.finding.id).join() === 'a,b,e,f')
check('split excluded', split.excluded.map((r) => r.finding.id).join() === 'c')
check('split keeps image-local refs', split.excluded[0].ref === '3')

// ---- studyToJson --------------------------------------------------------------
const plainJson = studyToJson(makeStudy(signedReport))
check('json keeps identifiers by default', plainJson.patient.name === 'Jane Doe' && plainJson.patient.patientId === 'MRN-1234')
check('json omits data URLs by default', plainJson.images.every((i) => i.thumbnailUrl === undefined))
check('json carries disclaimer', plainJson.disclaimer === DISCLAIMER)
check('json model from analyses', plainJson.model === 'medgemma-27b-it')

const anon = studyToJson(makeStudy(signedReport), { anonymise: true })
check('anon blanks name', anon.patient.name === '')
check('anon blanks patientId', anon.patient.patientId === '')
check('anon blanks referring physician', anon.patient.referringPhysician === '')
check('anon blanks snapshot', anon.report?.patientSnapshot?.name === '' && anon.report?.patientSnapshot?.patientId === '')
check('anon keeps clinical fields', anon.patient.age === '54' && anon.patient.indication === 'Cough')
check('anon renames image files', anon.images.every((i) => !i.name.includes('doe')))
check('anon flag', anon.anonymised === true)
check('anon leaves no identifier anywhere', !/Jane Doe|MRN-1234|Dr\. Smith|doe_jane/.test(JSON.stringify(anon)))
check('anon does not mutate the study', makeStudy().patient.name === 'Jane Doe')

// ---- studyFileName ------------------------------------------------------------
const fname = studyFileName(makeStudy(), 'txt')
check('file name sanitised', /^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.txt$/.test(fname), fname)
check('file name slug', fname.startsWith('jane-doe-chest-2026-'), fname)
check('empty title falls back', studyFileName({ ...makeStudy(), title: '///' }, 'json').startsWith('study-'))

console.log(`${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
