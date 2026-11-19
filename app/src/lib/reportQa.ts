// Pure sign-off checks on the report text. Heuristic text matching: each issue is a prompt for the reader to look
// again, never an automatic correction. Imported by scripts/test-report-qa.ts: runtime imports need .ts extensions.
import type { CriticalComm, Finding, ReportDraft, ReportFieldKey, Study } from '../types'

export type QaKind = 'laterality' | 'sex' | 'impression' | 'size' | 'critical' | 'dictation'
export interface QaIssue { kind: QaKind; message: string }

const SECTIONS: ReportFieldKey[] = ['technique', 'comparison', 'findings', 'impression', 'recommendations']

/** Sentences, split at full stops followed by space and at line breaks; decimals like 2.3 stay whole. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
}

const NEGATION = /\b(no|not|without|negative for|free of|resolved|resolution of|rule out|ruled out|to exclude|excluded|evaluate for|assess for|no evidence of|absence of)\b/i
const RESOLVED_AFTER = /^\W*(has |have )?(resolved|no longer (seen|visible|present))\b/i

/** True when the match at `index` is denied in its clause ("No pneumothorax", "pneumothorax has resolved"). */
export function negatedAt(sentence: string, index: number, length: number): boolean {
  const before = sentence.slice(0, index).split(/[;:]|\bbut\b|\bhowever\b|\balthough\b/i).pop() ?? ''
  return NEGATION.test(before) || RESOLVED_AFTER.test(sentence.slice(index + length))
}

function affirmed(sentence: string, pattern: RegExp): boolean {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')
  for (const match of sentence.matchAll(global)) if (!negatedAt(sentence, match.index, match[0].length)) return true
  return false
}

// ---- Critical results ------------------------------------------------------------------------------------

export const CRITICAL_RESULTS: { label: string; match: RegExp }[] = [
  { label: 'Pneumothorax', match: /\bpneumothora(x|ces)\b/i },
  { label: 'Free intraperitoneal air', match: /\b(pneumoperitoneum|free (intra-?peritoneal |intra-?abdominal |sub-?diaphragmatic )?(air|gas))\b/i },
  { label: 'Intracranial haemorrhage', match: /\b(intracranial|intracerebral|intraparenchymal|intraventricular|subarachnoid|subdural|extradural|epidural) (haemorrhage|hemorrhage|haematoma|hematoma|bleed)\b/i },
  // Abbreviations are matched case-sensitively so "pe" or "sah" inside ordinary words never count.
  { label: 'Intracranial haemorrhage', match: /\b(ICH|SAH|SDH|EDH)\b/ },
  { label: 'Aortic dissection', match: /\b(aortic dissection|dissection of the (thoracic |abdominal )?aorta|intramural ha?ematoma)\b/i },
  { label: 'Ruptured aneurysm', match: /\b(ruptured (abdominal )?(aortic )?aneurysm|aneurysm(al)? rupture|aortic rupture)\b/i },
  { label: 'Pulmonary embolism', match: /\b(pulmonary (arterial |artery )?(embolism|embolus|emboli|thromboembolism)|saddle embol(us|ism))\b/i },
  { label: 'Pulmonary embolism', match: /\bPE\b/ },
  { label: 'Brain herniation or midline shift', match: /\b((uncal|subfalcine|tonsillar|transtentorial|cerebral|brain) herniation|midline shift)\b/i },
  { label: 'Acute infarct or vessel occlusion', match: /\b(large vessel occlusion|acute (cerebral |territorial |cerebellar )?infarct(ion)?|hyperdense (mca|vessel) sign)\b/i },
  { label: 'Spinal cord compression', match: /\b((spinal )?cord compression|cauda equina compression)\b/i },
  { label: 'Bowel perforation or ischaemia', match: /\b((bowel|viscus) perforation|perforated (bowel|viscus|appendix|diverticulum)|(bowel|mesenteric) isch(a)?emia|pneumatosis intestinalis|portal venous gas)\b/i },
  { label: 'Volvulus', match: /\bvolvulus\b/i },
  { label: 'Testicular or ovarian torsion', match: /\b(testicular|ovarian|adnexal) torsion\b/i },
  { label: 'Ectopic pregnancy', match: /\bectopic pregnancy\b/i },
  { label: 'Cardiac tamponade', match: /\b(cardiac )?tamponade\b/i },
  { label: 'Malpositioned tube or line', match: /\b((malpositioned|misplaced) ((endotracheal|nasogastric|enteric|feeding) )?(tube|line|catheter)|(nasogastric|enteric|feeding) tube (in|within) the (airway|trachea|bronch\w*|lung))\b/i },
  { label: 'Epiglottitis', match: /\bepiglottitis\b/i },
]

/** Critical-result labels affirmatively mentioned in the text (negated mentions do not count). */
export function criticalMentions(text: string): string[] {
  const found = new Set<string>()
  for (const sentence of sentences(text)) {
    for (const item of CRITICAL_RESULTS) if (affirmed(sentence, item.match)) found.add(item.label)
  }
  return [...found]
}

const STOP = new Set(['left', 'right', 'upper', 'lower', 'middle', 'small', 'large', 'mild', 'moderate', 'severe', 'possible', 'probable',
  'likely', 'acute', 'chronic', 'with', 'from', 'zone', 'lobe', 'side', 'bilateral', 'suspected', 'finding', 'area', 'region', 'there',
  'this', 'that', 'minimal', 'subtle', 'focal', 'diffuse', 'new', 'candidate'])

/** Distinctive words of a label: "Right apical pneumothorax" → ["apical", "pneumothorax"]. */
function keywords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((word) => !STOP.has(word))
}

/** Loose overlap on word stems (first 6 letters), so "effusion"/"effusions" and "haemorrhage"/"haemorrhagic" meet. */
function overlaps(label: string, text: string): boolean {
  const words = keywords(label)
  const haystack = text.toLowerCase()
  return words.length > 0 && words.some((word) => haystack.includes(word.slice(0, 6)))
}

function covered(label: string, comms: CriticalComm[]): boolean {
  const group = CRITICAL_RESULTS.filter((item) => item.label === label)
  return comms.some((comm) => group.some((item) => item.match.test(comm.finding)) ||
    comm.finding.toLowerCase().includes(label.toLowerCase()) || overlaps(label, comm.finding))
}

/** Critical results in the report text or accepted as critical, with no matching logged communication. */
export function uncommunicatedCritical(study: Study, report: ReportDraft | undefined = study.report): string[] {
  const labels = new Set(report ? criticalMentions(`${report.findings}\n${report.impression}`) : [])
  for (const image of study.images) {
    for (const finding of image.analysis?.findings ?? []) {
      if (finding.severity !== 'critical' || finding.review !== 'accepted') continue
      const group = CRITICAL_RESULTS.find((item) => item.match.test(finding.title))
      labels.add(group?.label ?? finding.title.trim())
    }
  }
  const comms = report?.criticalComms ?? []
  return [...labels].filter((label) => label && !covered(label, comms))
}

/** One log entry as a line for text exports and print. */
export function criticalCommLine(c: CriticalComm): string {
  const how = c.method === 'in person' ? 'in person' : c.method === 'other' ? 'by other means' : `by ${c.method}`
  return `${c.finding}: communicated ${how} to ${c.communicatedTo}${c.role ? ` (${c.role})` : ''} on ${new Date(c.at).toLocaleString()}${c.by ? `, by ${c.by}` : ''}.`
}

/** Worklist badge: the study has a critical result that nobody has logged as communicated. */
export const hasUncommunicatedCritical = (study: Study): boolean => uncommunicatedCritical(study).length > 0

// ---- Laterality ------------------------------------------------------------------------------------------

const ENTITIES: [string, RegExp][] = [
  ['pneumothorax', /\bpneumothora(x|ces)\b/i],
  ['effusion', /\beffusions?\b/i],
  ['consolidation', /\bconsolidat\w*/i],
  ['nodule', /\bnodul\w*/i],
  ['mass', /\bmass(es)?\b(?! effect)/i],
  ['fracture', /\bfractur\w*/i],
  ['opacity', /\bopacit\w*/i],
  ['atelectasis', /\b(atelecta\w*|collapse)\b/i],
  ['haemorrhage', /\b(ha?emorrhag\w*|ha?ematoma|bleed)\b/i],
  ['infarct', /\binfarct\w*/i],
  ['hydronephrosis', /\bhydroneph\w*/i],
  ['calculus', /\b(calcul\w*|stones?)\b/i],
  ['cyst', /\bcysts?\b/i],
  ['lesion', /\blesions?\b/i],
  ['kidney', /\b(kidneys?|renal)\b/i],
  ['adrenal', /\badrenals?\b/i],
  ['ovary', /\b(ovary|ovarian)\b/i],
  ['breast', /\bbreasts?\b/i],
]

type SideMap = Map<string, Set<string>>

function sideIn(text: string): string {
  const both = /\b(bilateral(ly)?|both)\b/i.test(text) || (/\bleft\b/i.test(text) && /\bright\b/i.test(text))
  return both ? 'bilateral' : /\bleft\b/i.test(text) ? 'left' : /\bright\b/i.test(text) ? 'right' : ''
}

/** entity → sides it is affirmatively described on. The clause's side wins ("right effusion and left nodule");
 * a clause without one takes the sentence's ("Nodule, left upper lobe."); both sides or "bilateral" count as both. */
function sidesOf(text: string): SideMap {
  const map: SideMap = new Map()
  for (const sentence of sentences(text)) {
    const sentenceSide = sideIn(sentence)
    for (const clause of sentence.split(/[,;]|\band\b/i)) {
      const side = sideIn(clause) || sentenceSide
      if (!side) continue
      for (const [name, pattern] of ENTITIES) {
        if (!affirmed(clause, pattern)) continue
        map.set(name, (map.get(name) ?? new Set()).add(side))
      }
    }
  }
  return map
}

/** Impression places an entity on a side the findings never describe it on. */
export function lateralityIssues(findings: string, impression: string): QaIssue[] {
  const described = sidesOf(findings)
  const concluded = sidesOf(impression)
  const issues: QaIssue[] = []
  for (const [entity, sides] of concluded) {
    const known = described.get(entity)
    if (!known?.size || known.has('bilateral')) continue
    for (const side of sides) {
      if (side === 'bilateral' || known.has(side)) continue
      issues.push({ kind: 'laterality', message: `Laterality: the impression has a ${side} ${entity}; the findings describe it on the ${[...known].join(' and ')}.` })
    }
  }
  return issues
}

// ---- Sex-specific anatomy --------------------------------------------------------------------------------

const FEMALE = /\b(uter(us|ine)|ovar(y|ies|ian)|endometri\w*|fallopian|adnex(a|al)|cervix|vagina\w*|gravid)\b/i
const MALE = /\b(prostat\w*|testis|testes|testic\w*|scrot(um|al)|seminal vesicles?|epididym\w*|penile|penis)\b/i

export function sexIssues(text: string, sex: string): QaIssue[] {
  const mismatch = sex === 'Male' ? text.match(FEMALE) : sex === 'Female' ? text.match(MALE) : null
  return mismatch ? [{ kind: 'sex', message: `Patient sex is ${sex.toLowerCase()} but the report mentions "${mismatch[0]}". Check the patient or the template.` }] : []
}

// ---- Impression coverage ---------------------------------------------------------------------------------

/** Significant or critical findings kept in the draft that the impression never mentions. */
export function omittedFromImpression(findings: Finding[], impression: string): QaIssue[] {
  if (!impression.trim()) return []
  return findings
    .filter((finding) => (finding.severity === 'critical' || finding.severity === 'significant') && finding.review !== 'dismissed')
    .filter((finding) => keywords(finding.title).length > 0 && !overlaps(finding.title, impression))
    .map((finding) => ({ kind: 'impression' as const, message: `Impression does not mention the ${finding.severity} finding "${finding.title.trim()}".` }))
}

// ---- Lesion size -----------------------------------------------------------------------------------------

const LESION = /\b(lesion|nodule|mass|tumou?r|cyst|neoplasm)(es|s)?\b(?! effect)/i
const SIZE = /\d+(\.\d+)?\s*(x\s*\d+(\.\d+)?\s*)*(mm|cm|millimet(er|re)s?|centimet(er|re)s?)\b|\bsub-?centimet|\btoo small to (characteri[sz]e|measure)|\b(tiny|punctate|innumerable|numerous|miliary|multiple)\b/i

/** Lesion-type words mentioned without a size; impression mentions are fine when the findings give the size. */
export function unsizedLesions(findings: string, impression: string): QaIssue[] {
  const unsized = (text: string) => sentences(text).filter((s) => !s.includes('[___]') && affirmed(s, LESION) && !SIZE.test(s))
  const sizedInFindings = new Set(sentences(findings).filter((s) => SIZE.test(s)).map((s) => s.match(LESION)?.[1].toLowerCase()).filter(Boolean))
  const fromImpression = unsized(impression).filter((s) => !sizedInFindings.has(s.match(LESION)?.[1].toLowerCase()))
  return [...unsized(findings), ...fromImpression].map((sentence) => ({
    kind: 'size' as const,
    message: `No size given: "${sentence.length > 90 ? `${sentence.slice(0, 87)}…` : sentence}"`,
  }))
}

// ---- Dictation artefacts ---------------------------------------------------------------------------------

const COMMAND = /\b(scratch that|delete that|undo that|new line|new paragraph|next section|previous section|go to (technique|comparison|findings?|impressions?|recommendations?)|stop dictation|full stop|bullet point|numbered list)\b|\b(um+|uh+|erm)\b|\[inaudible\]/i
const REPEAT_OK = new Set(['that', 'had'])

export function dictationArtefacts(report: Pick<ReportDraft, ReportFieldKey>): QaIssue[] {
  const issues: QaIssue[] = []
  for (const key of SECTIONS) {
    const text = report[key] ?? ''
    const command = text.match(COMMAND)
    if (command) issues.push({ kind: 'dictation', message: `Possible dictation artefact in ${key}: "${command[0]}".` })
    const repeat = [...text.matchAll(/\b([a-z]+(?:\s+[a-z]+){0,2})\s+\1\b/gi)].find((m) => !REPEAT_OK.has(m[1].toLowerCase()))
    if (repeat) issues.push({ kind: 'dictation', message: `Repeated words in ${key}: "${repeat[0]}".` })
  }
  return issues
}

// ---- All checks ------------------------------------------------------------------------------------------

/** Every QA check for the sign-off checklist. Empty → nothing to flag. */
export function reportQa(study: Study, report: ReportDraft): QaIssue[] {
  const sex = (report.signed && report.patientSnapshot ? report.patientSnapshot : study.patient).sex
  const findings = study.images.flatMap((image) => image.analysis?.findings ?? [])
  const critical = uncommunicatedCritical(study, report)
  return [
    ...lateralityIssues(report.findings, report.impression),
    ...sexIssues(SECTIONS.map((key) => report[key]).join('\n'), sex),
    ...omittedFromImpression(findings, report.impression),
    ...unsizedLesions(report.findings, report.impression),
    ...(critical.length ? [{ kind: 'critical' as const, message: `Critical result without a logged communication: ${critical.join(', ')}. Record who was told, how and when.` }] : []),
    ...dictationArtefacts(report),
  ]
}
