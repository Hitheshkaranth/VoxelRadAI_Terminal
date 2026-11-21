// Systematic report layout (diagnostic-centre style): one titled row per anatomical section, an impression that opens
// "Features suggestive of:", and a read-scope line for CT / MRI. Pure and node-tested.
//
// Honesty rule: a section states a normal only when the reader's own reply said so (a pertinent negative or a
// normal-severity finding that names that section). A section with neither a finding nor a stated negative reads
// NOT_ASSESSED. A whole-study "no acute abnormality" impression is not spread across sections.
import type { Finding, ReportDraft, Study, StudyImage } from '../types.ts'
import { findingSentence } from './findingsReport.ts'

export const NOT_ASSESSED = 'Not assessed by the AI read — radiologist to review.'
export const SUGGESTIVE = 'Features suggestive of:'
export const NO_ABNORMALITY =
  'No abnormality was reported by the AI read on the assessed images. This is not a statement that the examination is normal; radiologist to review.'

export type SystematicExam = 'cxr' | 'ct-chest' | 'ct-abdomen' | 'head' | 'other'

interface SectionDef { title: string; match: RegExp; generic?: boolean }

const BONES_CXR: SectionDef = { title: 'BONES & SOFT TISSUES', match: /\b(fractur|ribs?\b|bone|osseous|skelet|clavic|scapul|humer|spine|spinal|vertebr|soft tissue|subcutaneous|chest wall|lytic|sclerotic)/i }
// Order is the printed order. Matching tries specific sections first and `generic` ones last.
export const SCHEMES: Record<SystematicExam, SectionDef[]> = {
  cxr: [
    BONES_CXR,
    { title: 'DIAPHRAGM', match: /\b(diaphragm|hemidiaphragm|domes?\b)/i },
    { title: 'UPPER ABDOMEN', match: /\b(upper abdom|abdomen|abdominal|free (air|gas)|pneumoperitoneum|subdiaphragm|gas shadows?|bowel|gastric|stomach)/i },
    // Pleura, CP angles and hila are read with the lung fields in this layout.
    { title: 'LUNG FIELDS', generic: true, match: /\b(lung|lobe|zone|apex|apices|pulmonary|consolidat|opacit|atelecta|nodul|mass|fibros|emphysem|calcif|infiltrat|o?edema|airspace|interstitial|bronch|cavit|pleura|effusion|pneumothorax|costophrenic|cp angle|hil(a|um|ar)|vascular mark)/i },
    { title: 'MEDIASTINUM', match: /\b(mediastin|trachea|carina|aort|heart|cardi|pericard)/i },
  ],
  'ct-chest': [
    { title: 'LUNG FIELDS', generic: true, match: /\b(lung|lobe|pulmonary|consolidat|opacit|ground.glass|atelecta|nodul|mass|fibros|emphysem|bronch|airway|cavit|embol)/i },
    { title: 'PLEURA', match: /\b(pleura|effusion|pneumothorax|empyema)/i },
    { title: 'MEDIASTINUM', match: /\b(mediastin|trachea|aort|heart|cardi|pericard|lymph|node|thyroid|o?esophag)/i },
    { title: 'UPPER ABDOMEN', match: /\b(liver|hepat|spleen|adrenal|kidney|renal|pancrea|gallbladder|stomach)/i },
    { title: 'BONES & SOFT TISSUES', match: /\b(fractur|ribs?\b|bone|osseous|spine|vertebr|sternum|lytic|sclerotic|soft tissue|chest wall)/i },
  ],
  'ct-abdomen': [
    { title: 'LIVER', match: /\b(liver|hepat)/i },
    { title: 'GALLBLADDER & BILIARY TREE', match: /\b(gall ?bladder|cholecyst|biliar|bile duct|cbd|choledoch)/i },
    { title: 'PANCREAS', match: /\b(pancrea)/i },
    { title: 'SPLEEN', match: /\b(spleen|splen)/i },
    { title: 'KIDNEYS', match: /\b(kidney|renal|ureter|hydroneph|calcul)/i },
    { title: 'BOWEL', match: /\b(bowel|colon|colorectal|caecum|cecum|append|duoden|ileum|jejun|rectum|sigmoid|stomach|gastric)/i },
    { title: 'LYMPH NODES', match: /\b(lymph|node|nodal|adenopath)/i },
    { title: 'BONES', match: /\b(fractur|bone|osseous|spine|vertebr|pelvi[cs] bone|lytic|sclerotic)/i },
    { title: 'LUNG BASES', match: /\b(lung bases?|lung|basal|pleura|effusion)/i },
  ],
  head: [
    { title: 'BRAIN PARENCHYMA', generic: true, match: /\b(brain|parenchym|cerebr|infarct|ischa?em|ha?emorrhage|bleed|mass|o?edema|white matter|gr[ae]y matter|cortex|cortical|basal ganglia|thalam|midline shift|lesion)/i },
    { title: 'VENTRICLES', match: /\b(ventric|hydroceph)/i },
    { title: 'EXTRA-AXIAL SPACES', match: /\b(extra.axial|subdural|epidural|extradural|subarachnoid|meninge|sulc|cistern)/i },
    { title: 'POSTERIOR FOSSA', match: /\b(posterior fossa|cerebell|brain ?stem|pons|medulla|fourth ventricle|4th ventricle)/i },
    { title: 'BONES & SINUSES', match: /\b(bone|skull|calvari|fractur|osseous|sinus|mastoid|orbit)/i },
  ],
  other: [{ title: 'FINDINGS', generic: true, match: /./ }],
}

/** Section for findings that name no section of this exam (e.g. a CT slice lesion whose organ is withheld). */
export const UNPLACED_TITLE = 'OTHER FINDINGS (SECTION NOT CONFIRMED)'

const text = (image: StudyImage) => [image.sourceModality, image.sourceBodyPart, image.analysis?.modality, image.analysis?.bodyPart].join(' ')
const isCross = (s: string) => /\b(ct|mr|mri|computed|magnetic|tomograph)\b/i.test(s)

export function systematicExam(hints: string): SystematicExam {
  const cross = isCross(hints)
  if (/\b(head|brain|skull|cranial|intracranial|neuro)/i.test(hints)) return 'head'
  if (/\b(abdom|pelvi|liver|kidney|renal|hepat)/i.test(hints)) return cross ? 'ct-abdomen' : 'other'
  if (/\b(chest|thora|lung)/i.test(hints)) return cross ? 'ct-chest' : 'cxr'
  return 'other'
}

/** "X-RAY CHEST PA VIEW", "CT ABDOMEN", "MRI BRAIN". */
export function examTypeLine(images: StudyImage[]): string {
  const all = images.map(text).join(' ')
  const a = images.find((i) => i.analysis)?.analysis
  const modality = /\b(mr|mri|magnetic)\b/i.test(all) ? 'MRI' : /\b(ct|computed)\b/i.test(all) ? 'CT' : /x-?ray|radiograph|\b(cr|dx)\b/i.test(all) ? 'X-RAY' : (a?.modality ?? '')
  const part = (images.find((i) => i.sourceBodyPart)?.sourceBodyPart || a?.bodyPart || '').trim()
  const views = [...new Set(images.map((i) => i.analysis?.view?.trim() ?? '').filter((v) => v && !/unknown|axial|n\/a/i.test(v)))]
  const view = modality === 'X-RAY' && views.length ? ` ${views.join(' & ')} VIEW${views.length > 1 ? 'S' : ''}` : ''
  return `${modality} ${part}${view}`.replace(/\s+/g, ' ').trim().toUpperCase()
}

/** First source that names a section wins: the title before the category before the location, so "consolidation,
 *  left zone near the heart border" stays in the lung fields. */
function sectionOf(sources: string[], scheme: SectionDef[]): string | null {
  const ordered = [...scheme.filter((s) => !s.generic), ...scheme.filter((s) => s.generic)]
  for (const source of sources) {
    const hit = source.trim() && ordered.find((s) => s.match.test(source))
    if (hit) return hit.title
  }
  return null
}

/** Whole-study statements ("No acute cardiopulmonary abnormality") are not spread across sections. */
export const GLOBAL_NEGATIVE = /\b(no acute|no (significant |focal )?abnormalit|unremarkable (study|examination|chest|film)|normal (study|examination|chest|film|radiograph))/i

export interface SystematicRow { title: string; lines: string[]; status: 'finding' | 'negative' | 'not-assessed' }
export interface SystematicInput { exam: SystematicExam; findings: Finding[]; negatives: string[] }

/** Deterministic section assignment; see the honesty rule at the top of this file. */
export function systematicRows({ exam, findings, negatives }: SystematicInput): SystematicRow[] {
  const scheme = SCHEMES[exam]
  const abnormal = new Map<string, string[]>(), stated = new Map<string, string[]>()
  const add = (map: Map<string, string[]>, key: string, line: string) => map.set(key, [...(map.get(key) ?? []), line])
  for (const f of findings) {
    if (f.review === 'dismissed') continue
    const title = sectionOf([f.title, f.category ?? '', f.location], scheme) ?? UNPLACED_TITLE
    if (f.severity === 'normal') add(stated, title, findingSentence({ ...f, review: 'accepted' }))
    else add(abnormal, title, findingSentence(f))
  }
  for (const n of negatives) {
    const line = n.trim().replace(/\s+/g, ' ')
    if (!line || GLOBAL_NEGATIVE.test(line)) continue
    add(stated, sectionOf([line], scheme) ?? UNPLACED_TITLE, /[.!?]$/.test(line) ? line : `${line}.`)
  }
  const titles = [...scheme.map((s) => s.title), ...((abnormal.has(UNPLACED_TITLE) || stated.has(UNPLACED_TITLE)) ? [UNPLACED_TITLE] : [])]
  return titles.map((title) => {
    const a = abnormal.get(title) ?? [], s = stated.get(title) ?? []
    if (a.length) return { title, lines: [...a, ...s], status: 'finding' as const }
    if (s.length) return { title, lines: s, status: 'negative' as const }
    return { title, lines: [NOT_ASSESSED], status: 'not-assessed' as const }
  })
}

/** "LUNG FIELDS: line one\nline two" blocks; the print layout parses these back into rows. */
export function rowsText(rows: SystematicRow[]): string {
  return rows.map((r) => `${r.title}: ${r.lines.join('\n')}`).join('\n')
}

/** Which images / slices the read covered, for CT and MRI (a slice read does not assess the rest of the scan). */
export function readScope(images: StudyImage[]): string {
  const cross = images.filter((i) => isCross(text(i)))
  if (!cross.length) return ''
  const names = cross.map((i) => {
    const frame = i.sourceFrameIndex != null ? `, frame ${i.sourceFrameIndex + 1}${i.sourceFrameCount ? ` of ${i.sourceFrameCount}` : ''}` : ''
    return `${i.name}${frame}`
  })
  return `Read from ${cross.length} single slice image${cross.length === 1 ? '' : 's'} (${names.join('; ')}). Slices that were not sent were not assessed.`
}

const RANK = { critical: 0, significant: 1, moderate: 2, minor: 3, normal: 4 } as const

/** Systematic draft fields; same keys as findingsReport so the report data model is unchanged. */
export function systematicReport(study: Study): Pick<ReportDraft, 'technique' | 'comparison' | 'findings' | 'impression' | 'recommendations'> {
  const images = study.images.filter((image) => image.analysis)
  if (!images.length) throw new Error('Analyze at least one image before drafting a report.')
  const exam = systematicExam(images.map(text).join(' '))
  const findings = images.flatMap((i) => i.analysis!.findings)
  const negatives = images.flatMap((i) => i.analysis!.pertinentNegatives ?? [])
  const rows = systematicRows({ exam, findings, negatives })
  const ranked = findings.map((f, index) => ({ f, index }))
    .filter(({ f }) => f.review !== 'dismissed' && f.severity !== 'normal')
    .sort((a, b) => Number(b.f.review === 'accepted') - Number(a.f.review === 'accepted') || RANK[a.f.severity] - RANK[b.f.severity] || a.index - b.index)
  const globals = [...new Set(negatives.map((n) => n.trim()).filter((n) => GLOBAL_NEGATIVE.test(n)))]
  const impression = ranked.length
    ? [SUGGESTIVE, ...ranked.map(({ f }, i) => `${i + 1}. ${findingSentence({ ...f, measurements: undefined })}`)].join('\n')
    : [NO_ABNORMALITY, ...globals.map((g) => `The AI read states: ${g.replace(/[.\s]+$/, '')}.`)].join('\n')
  const scope = readScope(images)
  return {
    technique: [examTypeLine(images), scope].filter(Boolean).join('\n'),
    comparison: 'None available.',
    findings: rowsText(rows),
    impression,
    recommendations: [
      'Draft assembled from existing image findings without an additional model request. Review and edit before signing.',
      images.length < study.images.length ? `${study.images.length - images.length} image(s) have not been analyzed and are not included.` : '',
      ...findings.filter((f) => f.review !== 'dismissed' && f.recommendation).map((f) => `${f.title.trim()}: ${f.recommendation!.trim()}`),
    ].filter(Boolean).join('\n'),
  }
}

/** Parse "TITLE: text" rows back out of a (possibly edited) findings field; other lines continue the previous row. */
export function parseRows(findings: string): { title: string; lines: string[] }[] {
  const out: { title: string; lines: string[] }[] = []
  for (const raw of findings.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^([A-Z][A-Z0-9 &/().,'-]{1,60}):\s*(.*)$/)
    if (m) out.push({ title: m[1].trim(), lines: m[2] ? [m[2]] : [] })
    else if (out.length) out[out.length - 1].lines.push(line)
    else out.push({ title: 'FINDINGS', lines: [line] })
  }
  return out
}

/** Volume (CT / MRI series) draft rows from accepted slice findings; each line keeps its slice number. */
export function volumeSystematicLines(args: { title: string; modality: string; plane: string; completed: number; count: number; accepted: { index: number; finding: Finding }[] }): string[] {
  const exam = systematicExam(`${args.modality} ${args.title}`)
  const findings = args.accepted.map(({ index, finding }) => ({ ...finding, title: `${finding.title} (${args.plane} slice ${index + 1})` }))
  const rows = systematicRows({ exam, findings, negatives: [] })
  const ranked = args.accepted.filter(({ finding }) => finding.severity !== 'normal')
  return [
    'SYSTEMATIC FINDINGS',
    `Read scope: ${args.completed}/${args.count} ${args.plane} slices of one series; unread slices were not assessed.`,
    ...rows.map((r) => `${r.title}: ${r.lines.join(' ')}`),
    '',
    'IMPRESSION',
    ...(ranked.length ? [SUGGESTIVE, ...ranked.map(({ index, finding }, i) => `${i + 1}. ${finding.title} (${args.plane} slice ${index + 1}).`)] : [NO_ABNORMALITY]),
  ]
}
