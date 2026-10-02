// Unit tests for the review-aware helpers, the second-reader merge and the cross-check's failure handling. Run with:
//   node --experimental-strip-types scripts/test-pipeline.ts
import {
  activeFindings,
  crossCheck,
  deriveUrgencyFromActive,
  excludedFindings,
  findingCounts,
  flaggedFindings,
  isExcluded,
  isUnconfirmed,
  reportSourceKey,
  reportTraceLines,
  worstSeverity,
} from '../src/lib/classifier.ts'
import { findingKind, mergeSecondReader, type MairaFinding } from '../src/lib/maira.ts'
import type { AnalysisResult, ClassifierCheck, Finding, FindingReview, Severity, Study, StudyImage } from '../src/types.ts'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++
  else {
    failed++
    console.error(`  ✗ ${name}${detail ? ` → ${detail}` : ''}`)
  }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const cls = (supported: boolean | null, prob: number | null = 0.2): ClassifierCheck => ({ kind: 'effusion', prob, supported })
let n = 0
const finding = (patch: Partial<Finding> = {}): Finding => ({
  id: `f${++n}`,
  title: 'Left pleural effusion',
  description: '',
  severity: 'moderate',
  confidence: 0.9,
  location: 'Left base',
  ...patch,
})
const analysis = (findings: Finding[], patch: Partial<AnalysisResult> = {}): AnalysisResult => ({
  modality: 'Radiograph (X-ray)',
  bodyPart: 'Chest',
  view: 'PA',
  imageQuality: 'Adequate',
  findings,
  pertinentNegatives: [],
  impression: '',
  recommendations: [],
  differential: [],
  urgency: 'routine',
  rawText: '',
  model: 'medgemma-27b-it',
  durationMs: 1,
  createdAt: 1000,
  ...patch,
})
const image = (id: string, a?: AnalysisResult): StudyImage => ({
  id,
  name: `${id}.png`,
  mime: 'image/png',
  dataUrl: 'data:image/png;base64,AAAA',
  width: 10,
  height: 10,
  addedAt: 0,
  status: a ? 'done' : 'idle',
  analysis: a,
})
const study = (images: StudyImage[], indication = 'cough'): Study => ({
  id: 's1',
  title: 'Study',
  patient: {
    name: '',
    patientId: '',
    age: '60',
    sex: 'Male',
    studyDate: '2026-10-02',
    referringPhysician: '',
    indication,
    clinicalHistory: '',
  },
  images,
  createdAt: 0,
  updatedAt: 0,
})

// ---- isExcluded truth table ------------------------------------------------
const reviews: (FindingReview | undefined)[] = [undefined, 'accepted', 'dismissed']
const supports: (boolean | null | undefined)[] = [undefined, true, false, null]
for (const review of reviews)
  for (const sup of supports) {
    const f = finding({ review, classifier: sup === undefined ? undefined : cls(sup) })
    check(`isExcluded review=${review} supported=${sup}`, isExcluded(f) === (review === 'dismissed'))
    check(`isUnconfirmed review=${review} supported=${sup}`, isUnconfirmed(f) === (sup === false && review === undefined))
  }

// ---- active / flagged / counts / urgency -----------------------------------
const fs = [
  finding({ id: 'a', severity: 'critical', classifier: cls(false) }), // unsupported → still counts, unconfirmed
  finding({ id: 'b', severity: 'significant', bbox: { x: 0, y: 0, w: 0.1, h: 0.1 } }),
  finding({ id: 'c', severity: 'minor' }),
  finding({ id: 'd', severity: 'normal' }),
  finding({ id: 'e', severity: 'moderate', review: 'dismissed' }),
  finding({ id: 'g', severity: 'minor', classifier: cls(null, null) }), // not covered → still counts
]
eq('activeFindings', activeFindings(fs).map((f) => f.id), ['a', 'b', 'c', 'g'])
eq('flaggedFindings', flaggedFindings(fs).map((f) => f.id), ['e'])
eq('worstSeverity counts unconfirmed', worstSeverity(fs), 'critical')
eq('worstSeverity ignores dismissed', worstSeverity(fs.filter((f) => f.id !== 'a')), 'significant')
eq('worstSeverity empty', worstSeverity([finding({ severity: 'normal' })]), null)
eq('findingCounts', findingCounts(analysis(fs)), { active: 4, flagged: 1, normal: 1, unlocalized: [1, 3, 6] })
eq('findingCounts undefined', findingCounts(undefined), { active: 0, flagged: 0, normal: 0, unlocalized: [] })
eq('unconfirmed critical → urgent', deriveUrgencyFromActive(fs), 'urgent')
const dismissedA = fs.map((f) => (f.id === 'a' ? { ...f, review: 'dismissed' as const } : f))
eq('dismissing unsupported critical → priority', deriveUrgencyFromActive(dismissedA), 'priority')
eq('urgency routine', deriveUrgencyFromActive([finding({ severity: 'minor' })]), 'routine')

// ---- excludedFindings / trace lines ----------------------------------------
const st = study([image('i1', analysis(fs)), image('i2')])
eq(
  'excludedFindings',
  excludedFindings(st).map((x) => [x.imageId, x.imageName, x.finding.id]),
  [['i1', 'i1.png', 'e']],
)
const trace = reportTraceLines(st)
check('trace line lists dismissed', trace[0]?.startsWith('AI findings dismissed by the reviewer') ?? false, trace[0])
check('trace line lists unconfirmed with kind and prob', trace[1]?.includes('Left pleural effusion (effusion 20%)') ?? false, trace[1])
check('trace line ends with call to confirm', trace[1]?.endsWith('radiologist to confirm or dismiss.') ?? false)
eq('no trace when nothing excluded', reportTraceLines(study([image('i1', analysis([finding()]))])), [])

// ---- mergeSecondReader -----------------------------------------------------
const kinds = ['effusion', 'nodule / mass', 'atelectasis']
const maira = (title: string, severity: Severity = 'minor'): MairaFinding => ({ title, description: `${title}.`, severity })
const base = analysis([finding({ title: 'Left pleural effusion' }), finding({ title: 'No nodule', severity: 'normal' })])
const merged = mergeSecondReader(
  base,
  [
    maira('Small right pleural effusion'), // effusion already reported by MedGemma → skipped
    maira('Right upper lobe nodule', 'critical'), // added, capped at moderate
    maira('Second nodule in left lung'), // same kind again → skipped
    maira('Left basal atelectasis'), // added
    maira('Mild cardiomegaly'), // kind not enabled → skipped
    maira('No pneumothorax', 'normal'), // normal → skipped
    maira('Mass effect on the trachea'), // no kind → skipped
  ],
  kinds,
)
const added = merged.findings.filter((f) => f.source === 'maira2')
eq('merge adds only missing enabled kinds', added.map((f) => f.title), ['Right upper lobe nodule', 'Left basal atelectasis'])
eq('merge caps severity', added.map((f) => f.severity), ['moderate', 'minor'])
eq('merge fields', added.map((f) => [f.confidence, f.category]), [
  [0, 'Second reader'],
  [0, 'Second reader'],
])
check('merge ids unique', new Set(merged.findings.map((f) => f.id)).size === merged.findings.length)
eq('merge secondReader', [merged.secondReader?.status, merged.secondReader?.added], ['ok', 2])
const again = mergeSecondReader(merged, [maira('Right upper lobe nodule')], kinds)
eq('re-run replaces earlier second-reader findings', again.findings.filter((f) => f.source === 'maira2').length, 1)
eq('normal MedGemma finding does not block a kind', findingKind({ title: 'No nodule' }), 'nodule / mass')
eq('kinds gating off', mergeSecondReader(base, [maira('Left basal atelectasis')], []).findings.length, base.findings.length)

// ---- reportSourceKey -------------------------------------------------------
const k0 = reportSourceKey(st)
eq('key is stable', reportSourceKey(study([image('i1', analysis(fs)), image('i2')])), k0)
const reviewed = study([image('i1', analysis(fs.map((f) => (f.id === 'c' ? { ...f, review: 'dismissed' as const } : f)))), image('i2')])
check('key changes with review', reportSourceKey(reviewed) !== k0)
check('key changes with new analysis', reportSourceKey(study([image('i1', analysis(fs, { createdAt: 2000 })), image('i2')])) !== k0)
check('key changes with indication', reportSourceKey(study([image('i1', analysis(fs)), image('i2')], 'fever')) !== k0)
check('key changes when an image is added', reportSourceKey(study([image('i1', analysis(fs))])) !== k0)

// ---- crossCheck failure handling (stubbed fetch, no service) ---------------
const realFetch = globalThis.fetch
const a0 = analysis([finding({ id: 'x' })])
const img = image('i1', a0)
try {
  globalThis.fetch = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch
  const down = await crossCheck(img, a0)
  eq('txrv down → unavailable, findings unchanged', [down.classifierStatus, down.findings], ['unavailable', a0.findings])

  globalThis.fetch = (() => Promise.resolve(new Response('', { status: 502 }))) as typeof fetch
  eq('proxy 502 → unavailable', (await crossCheck(img, a0)).classifierStatus, 'unavailable')

  globalThis.fetch = (() => Promise.resolve(Response.json({ error: 'boom' }, { status: 500 }))) as typeof fetch
  const err = await crossCheck(img, a0)
  eq('service 500 → error with message', [err.classifierStatus, err.classifierMessage], ['error', 'boom'])

  let sent = ''
  globalThis.fetch = ((_u: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body)).image
    return Promise.resolve(
      Response.json({
        probs: { Effusion: 0.8 },
        checks: { x: { kind: 'effusion', prob: 0.8, thr: 0.4, thrSource: 'tuned', calibrated: 0.7, supported: true } },
      }),
    )
  }) as typeof fetch
  const ok = await crossCheck(img, a0, undefined, 'data:image/jpeg;base64,SMALL')
  eq('ok → status, probs, check attached', [ok.classifierStatus, ok.classifierProbs, ok.findings[0].classifier?.thr], ['ok', { Effusion: 0.8 }, 0.4])
  eq('sends the re-encoded image', sent, 'data:image/jpeg;base64,SMALL')

  const ctl = new AbortController()
  globalThis.fetch = ((_u: string, init: RequestInit) =>
    new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch
  const pending = crossCheck(img, a0, ctl.signal)
  ctl.abort()
  check('user abort re-throws', await pending.then(() => false, () => true))
} finally {
  globalThis.fetch = realFetch
}

console.log(`${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
