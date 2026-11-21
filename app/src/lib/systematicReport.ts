// Systematic report layout (diagnostic-centre style): one titled row per anatomical section, an impression that opens
// "Features suggestive of:", and a read-scope line for CT / MRI. Pure and node-tested.
//
// Honesty rule: a section states a normal only when the reader's own reply said so (a pertinent negative or a
// normal-severity finding that names that section). A section with neither is left EMPTY for the radiologist (heading
// and a blank line in the editor) and is omitted from the printed report while still empty. A whole-study "no acute
// abnormality" statement is not spread across sections; it becomes the impression in the model's own words.
// The only AI wording on a printed report is the unsigned-draft box and the footer disclaimer.
import type { Finding, ReportDraft, Study, StudyImage } from '../types.ts'
import { measurementPhrase } from './findingsReport.ts'

export const SUGGESTIVE = 'Features suggestive of:'

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
/** A finding as placed in a systematic row; `slice` is its 1-based slice label in a volume read ("axial slice 81"). */
export type SystematicFinding = Finding & { slice?: string }
export interface SystematicInput { exam: SystematicExam; findings: SystematicFinding[]; negatives: string[]; sliceIndexFromZero?: boolean }

/** The measurement code's own sentence from a description ("Measured from the outline: …" / "Measured from the scan:
 *  …"), nothing else of the free text. `fromZero`: slice numbers in it count from 0 (server volume index) and are
 *  printed counting from 1, so the report shows one numbering. */
export function measuredText(description: string | undefined, fromZero = false): string {
  const m = (description ?? '').match(/Measured from the (?:outline|scan):[\s\S]*?(?=\s*(?:Location by\b|$))/)
  if (!m) return ''
  let text = m[0].trim().replace(/\s+/g, ' ')
  if (fromZero) {
    text = text.replace(/\bslices \((\d+)\s*[-–]\s*(\d+)\)/g, (_, a, b) => `slices ${+a + 1}–${+b + 1}`)
      .replace(/\bslice (\d+)\b/g, (_, a) => `slice ${+a + 1}`)
  }
  return /[.!?]$/.test(text) ? text : `${text}.`
}

const SIDE = /\bpatient(?:'s)?\s+(right|left|both)(?:\s+sides?)?\b/i
/** Title, location and measurements as printed in a row. "Liver lesion, right" + "liver patient right" becomes
 *  "Liver lesion, patient's right side": the organ word the title already names is not repeated. */
export function systematicSentence(f: SystematicFinding, fromZero = false, withMeasure = true): string {
  let title = (f.title || 'Finding').trim().replace(/[.\s]+$/, '')
  title = title.charAt(0).toUpperCase() + title.slice(1)
  const loc = (f.location ?? '').trim().replace(/[.\s]+$/, '')
  const side = loc.match(SIDE)?.[1]?.toLowerCase()
  const titleWords = new Set(title.toLowerCase().split(/[^a-z]+/).filter(Boolean))
  // Only the "<organ> patient <side>" form is rewritten; the organ word is dropped when the title already names it.
  const left = side ? loc.replace(SIDE, ' ').replace(/\s+/g, ' ').trim() : loc
  const rest = side && left.split(' ').every((w) => titleWords.has(w.toLowerCase())) ? '' : left
  if (side) title = title.replace(/,\s*(right|left|both)\s*$/i, '')
  const parts = [f.slice ? `${title} (${f.slice})` : title]
  if (rest && !title.toLowerCase().includes(rest.toLowerCase())) parts.push(/^[A-Z][a-z]/.test(rest) ? rest.charAt(0).toLowerCase() + rest.slice(1) : rest)
  if (side) parts.push(side === 'both' ? 'both sides' : `patient's ${side} side`)
  const measured = withMeasure ? (measuredText(f.description, fromZero) || (measurementPhrase(f.measurements) ? `${measurementPhrase(f.measurements).replace(/^measuring/, 'Measuring')}.` : '')) : ''
  return `${parts.join(', ')}.${measured ? ` ${measured}` : ''}`
}

/** Identical lines merge into one with a count: "… (×2)". */
export function mergeDuplicates(lines: string[]): string[] {
  const counts = new Map<string, number>()
  for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1)
  return [...counts].map(([l, n]) => (n > 1 ? `${l} (×${n})` : l))
}

/** Deterministic section assignment; see the honesty rule at the top of this file. */
export function systematicRows({ exam, findings, negatives, sliceIndexFromZero = false }: SystematicInput): SystematicRow[] {
  const scheme = SCHEMES[exam]
  const abnormal = new Map<string, string[]>(), stated = new Map<string, string[]>()
  const add = (map: Map<string, string[]>, key: string, line: string) => map.set(key, [...(map.get(key) ?? []), line])
  for (const f of findings) {
    if (f.review === 'dismissed') continue
    const title = sectionOf([f.title, f.category ?? '', f.location], scheme) ?? UNPLACED_TITLE
    if (f.severity === 'normal') add(stated, title, systematicSentence({ ...f, review: 'accepted' }, sliceIndexFromZero))
    else add(abnormal, title, systematicSentence(f, sliceIndexFromZero))
  }
  for (const n of negatives) {
    const line = n.trim().replace(/\s+/g, ' ')
    if (!line || GLOBAL_NEGATIVE.test(line)) continue
    add(stated, sectionOf([line], scheme) ?? UNPLACED_TITLE, /[.!?]$/.test(line) ? line : `${line}.`)
  }
  const titles = [...scheme.map((s) => s.title), ...((abnormal.has(UNPLACED_TITLE) || stated.has(UNPLACED_TITLE)) ? [UNPLACED_TITLE] : [])]
  return titles.map((title) => {
    const a = mergeDuplicates(abnormal.get(title) ?? []), s = mergeDuplicates(stated.get(title) ?? [])
    if (a.length) return { title, lines: [...a, ...s], status: 'finding' as const }
    if (s.length) return { title, lines: s, status: 'negative' as const }
    return { title, lines: [], status: 'not-assessed' as const }
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
  return `Single-slice read: ${names.join('; ')}.`
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
  // No finding: the impression is what the model said (its impression, or its whole-study negative); else blank.
  const said = [...images.map((i) => i.analysis!.impression ?? ''), ...negatives.filter((n) => GLOBAL_NEGATIVE.test(n))]
  const impression = ranked.length
    ? [SUGGESTIVE, ...mergeDuplicates(ranked.map(({ f }) => systematicSentence(f, false, false))).map((l, i) => `${i + 1}. ${l}`)].join('\n')
    : modelImpression(said)
  const scope = readScope(images)
  return {
    technique: [examTypeLine(images), scope].filter(Boolean).join('\n'),
    comparison: 'None available.',
    findings: rowsText(rows),
    impression,
    // Only the findings' own recommendations; the app's draft notes stay in the app UI, not on the report.
    recommendations: [
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

/** The model's own no-finding statement, once; "on this slice" from per-slice reads becomes "in this series". Only
 *  statements that report no abnormality are used, so a finding impression is never repeated as a negative. */
export function modelImpression(statements: string[], series = false): string {
  const clean = [...new Set(statements.map((t) => t.trim().replace(/\s+/g, ' ')).filter((t) => t && /^no\b/i.test(t))
    .map((t) => (series ? t.replace(/\bon this slice\b/i, 'in this series') : t)).map((t) => (/[.!?]$/.test(t) ? t : `${t}.`)))]
  return clean.join('\n')
}

/** Volume (CT / MRI series) draft rows from accepted slice findings; each line keeps its slice number. */
export function volumeSystematicLines(args: { title: string; modality: string; plane: string; completed: number; count: number; accepted: { index: number; finding: Finding }[]; impressions?: string[] }): string[] {
  const exam = systematicExam(`${args.modality} ${args.title}`)
  // Read indices count from 0; every printed slice number counts from 1, including numbers inside measurement text.
  const findings: SystematicFinding[] = args.accepted.map(({ index, finding }) => ({ ...finding, slice: `${args.plane} slice ${index + 1}` }))
  const rows = systematicRows({ exam, findings, negatives: [], sliceIndexFromZero: true })
  const ranked = findings.filter((f) => f.severity !== 'normal')
  return [
    'SYSTEMATIC FINDINGS',
    `Volume read: ${args.completed === args.count ? args.count : `${args.completed} of ${args.count}`} ${args.plane} slices (slice numbers count from 1).`,
    ...rows.map((r) => `${r.title}: ${r.lines.join('\n')}`),
    '',
    'IMPRESSION',
    ...(ranked.length ? [SUGGESTIVE, ...mergeDuplicates(ranked.map((f) => systematicSentence(f, true, false))).map((l, i) => `${i + 1}. ${l}`)] : [modelImpression(args.impressions ?? [], true)]),
  ]
}
