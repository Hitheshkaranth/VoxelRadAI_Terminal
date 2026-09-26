// OWNER: Agent 1 (AI engine). Unit tests for the pure parser. Run with:
//   node --experimental-strip-types scripts/test-parse.ts
import {
  extractJson,
  normalizeAnalysis,
  normalizeReport, mergeLungPattern, parseLungPattern,
  type ReportFields,
} from '../src/lib/parse.ts'

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

// ---- extractJson -----------------------------------------------------------
check('plain object', JSON.stringify(extractJson('{"a":1,"b":2}')) === '{"a":1,"b":2}')
check('json fence', JSON.stringify(extractJson("```json\n{\"a\":1}\n```")) === '{"a":1}')
check('prose before/after', JSON.stringify(extractJson('Here you go: ```json\n{"ok":true}\n```\nHope that helps!')) === '{"ok":true}')
check('trailing commas', JSON.stringify(extractJson('{"a":1,"b":[1,2,],}')) === '{"a":1,"b":[1,2]}')
check('smart quotes', JSON.stringify(extractJson('{\u201Ctitle\u201D: \u201Chi\u201D, \u201Cn\u201D: 1}')) === '{"title":"hi","n":1}')
check('truncated array', JSON.stringify(extractJson('{"a":1,"b":[1,2,3')) === '{"a":1,"b":[1,2,3]}')
check('truncated string', JSON.stringify(extractJson('{"a":1,"tags":["x","y","')) === '{"a":1,"tags":["x","y",""]}')
check('only numbers', JSON.stringify(extractJson('42')) === '42')
check('missing throws', (() => { try { extractJson('no json here'); return false } catch { return true } })())

// ---- normalizeAnalysis -----------------------------------------------------
const meta = { rawText: 'x', model: 'medgemma-27b-it', durationMs: 123 }

const result = normalizeAnalysis(
  {
    modality: 'Radiograph (X-ray)',
    bodyPart: 'Chest',
    view: 'PA',
    imageQuality: 'Adequate',
    findings: [
      { title: 'Minor nodule', description: 'small', severity: 'mild', confidence: 85, location: 'LUL', box_2d: [500, 500, 500, 500] },
      { title: 'Tension PTX', description: 'big', severity: 'severe', confidence: 0.95, location: 'RPTX', box_2d: [100, 200, 300, 400] },
      { title: 'Normal heart', description: '', severity: 'normal', confidence: 0.2 },
      { title: 'No label', severity: 'something-weird', confidence: -5 },
    ],
    pertinentNegatives: ['No effusion', 'No fracture'],
    impression: 'Tension pneumothorax',
    recommendations: ['Immediate decompression', 'Repeat CXR in 2h'],
    differential: ['hemothorax', 'consolidation'],
  },
  meta,
)

eq('modality', result.modality, 'Radiograph (X-ray)')
eq('bodyPart', result.bodyPart, 'Chest')
eq('view', result.view, 'PA')
eq('finding count', result.findings.length, 4)
// sorted: critical(significant→ 'severe' mapped), then by confidence
eq('first title (worst)', result.findings[0].title, 'Tension PTX')
eq('first severity', result.findings[0].severity, 'significant')
eq('confidence clamped 85→0.85', result.findings.find((f) => f.title === 'Minor nodule')!.confidence, 0.85)
eq('confidence clamp <0→0', result.findings.find((f) => f.title === 'No label')!.confidence, 0)
eq('unknown severity→minor', result.findings.find((f) => f.title === 'No label')!.severity, 'minor')
eq('normal severity', result.findings.find((f) => f.title === 'Normal heart')!.severity, 'normal')
eq('box_2d 0-1000→bbox', result.findings.find((f) => f.title === 'Tension PTX')!.bbox, { x: 0.2, y: 0.1, w: 0.2, h: 0.2 })
eq('degenerate box dropped', result.findings.find((f) => f.title === 'Minor nodule')!.bbox, undefined)
eq('boxless finding has no bbox', result.findings.find((f) => f.title === 'Normal heart')!.bbox, undefined)
eq('pertinent negatives', result.pertinentNegatives, ['No effusion', 'No fracture'])
eq('recommendations', result.recommendations, ['Immediate decompression', 'Repeat CXR in 2h'])
eq('differential', result.differential, ['hemothorax', 'consolidation'])
eq('urgency (significant→priority)', result.urgency, 'priority')
eq('model from meta', result.model, 'medgemma-27b-it')
check('createdAt is number', typeof result.createdAt === 'number')
check('each finding has id', result.findings.every((f) => typeof f.id === 'string' && f.id.length > 0))

// urgency mapping per spec: critical→urgent, significant→priority, else routine
eq('urgency critical', normalizeAnalysis({ findings: [{ title: 'x', severity: 'critical' }] }, meta).urgency, 'urgent')
eq('urgency significant', normalizeAnalysis({ findings: [{ title: 'x', severity: 'significant' }] }, meta).urgency, 'priority')
eq('urgency moderate', normalizeAnalysis({ findings: [{ title: 'x', severity: 'moderate' }] }, meta).urgency, 'routine')
eq('urgency normal', normalizeAnalysis({ findings: [{ title: 'x', severity: 'normal' }] }, meta).urgency, 'routine')

// empty / malformed
const empty = normalizeAnalysis(null, meta)
eq('empty findings', empty.findings.length, 0)
eq('empty urgency', empty.urgency, 'routine')
const arr = normalizeAnalysis(['not', 'an', 'object'], meta)
eq('array object→empty', arr.findings.length, 0)

// box acceptance: inverted coords are swapped
const bb = normalizeAnalysis({ findings: [{ title: 'b', box_2d: [400, 600, 100, 200] }] }, meta).findings[0]
eq('box invert-swap', bb.bbox, { x: 0.2, y: 0.1, w: 0.4, h: 0.3 })

// ---- normalizeReport -------------------------------------------------------
const report = normalizeReport({
  technique: 'Chest PA view',
  comparison: 'None available.',
  findings: ['Consolidation in RML.', 'Pleural effusion on the right.'],
  impression: ['1. Tension pneumothorax', 'massive effusion', '3 needs followup'],
  recommendations: ['Consult surgery', 'Follow-up CXR 4 weeks'],
})
const r = report as ReportFields
eq('report technique', r.technique, 'Chest PA view')
eq('report comparison', r.comparison, 'None available.')
eq('report impression numbered', r.impression, '1. Tension pneumothorax\n2. massive effusion\n3. needs followup')
eq('report findings joined', r.findings, 'Consolidation in RML.\nPleural effusion on the right.')
check('report findings has newline', r.findings.includes('\n'))
eq('report recommendations', r.recommendations, 'Consult surgery\nFollow-up CXR 4 weeks')

// report fallback
const emptyReport = normalizeReport(null)
eq('report fallback comparison', emptyReport.comparison, 'None available.')

// ---- devices ------------------------------------------------------------------
const dev = normalizeAnalysis({ findings: [
  { title: 'Pacemaker', severity: 'minor', category: 'Devices' },
  { title: 'Central venous catheter', severity: 'minor' },
  { title: 'Endotracheal tube too low, in right mainstem bronchus', severity: 'significant', category: 'Devices' },
  { title: 'Right lower lobe consolidation', severity: 'minor', category: 'Lungs' },
] }, meta)
eq('device minor → normal', dev.findings.find((f) => f.title === 'Pacemaker')?.severity, 'normal')
eq('device inferred category', dev.findings.find((f) => f.title === 'Central venous catheter')?.category, 'Devices')
eq('malpositioned device keeps severity', dev.findings.find((f) => f.title.startsWith('Endotracheal'))?.severity, 'significant')
eq('non-device minor unchanged', dev.findings.find((f) => f.title.startsWith('Right lower'))?.severity, 'minor')

// ---- lung-pattern merge -------------------------------------------------------
const chestNormal = normalizeAnalysis({ bodyPart: 'Chest', impression: 'Normal chest radiograph.', findings: [{ title: 'Normal study', severity: 'normal' }] }, meta)
eq('pattern parse', parseLungPattern({ grade: '2', evidence: 'x' }), { grade: 2, evidence: 'x' })
eq('pattern parse bad', parseLungPattern({ grade: 7 }), null)
eq('pattern grade 0 unchanged', mergeLungPattern(chestNormal, { grade: 0, evidence: '' }), chestNormal)
eq('pattern grade 1 unchanged', mergeLungPattern(chestNormal, { grade: 1, evidence: '' }), chestNormal)
const m2 = mergeLungPattern(chestNormal, { grade: 2, evidence: 'Indistinct perihilar markings.' })
eq('pattern adds 1 finding, drops normal placeholder', m2.findings.map((f) => f.severity), ['moderate'])
check('pattern impression noted', m2.impression.includes('Graded lung-pattern review'))
eq('pattern grade 3 → significant/priority', [mergeLungPattern(chestNormal, { grade: 3, evidence: '' }).findings[0].severity, mergeLungPattern(chestNormal, { grade: 3, evidence: '' }).urgency], ['significant', 'priority'])
const covered = normalizeAnalysis({ bodyPart: 'Chest', findings: [{ title: 'Diffuse interstitial markings', severity: 'moderate' }] }, meta)
eq('pattern not duplicated when covered', mergeLungPattern(covered, { grade: 3, evidence: '' }).findings.length, 1)
const knee = normalizeAnalysis({ bodyPart: 'Knee', findings: [] }, meta)
eq('pattern ignored for non-chest', mergeLungPattern(knee, { grade: 3, evidence: '' }).findings.length, 0)

console.log(`\nparse tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)