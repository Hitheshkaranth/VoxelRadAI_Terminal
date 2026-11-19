import type { Finding, ReportDraft, Severity, Study, StudyImage } from '../types.ts'

/** Placeholder for text the reader still has to write; never replaced with an implied normal. */
export const BLANK = '[___]'
export const UNREVIEWED = '[unreviewed AI candidate]'

type Exam = 'cxr' | 'ct-chest' | 'head' | 'abdomen' | 'other'
// `generic` systems catch broad words ("zone", "lesion"), so they are matched only after the specific ones.
interface System { name: string; match: RegExp; generic?: boolean }

// Order is reporting order; matching runs device-first so "right IJ line" is a device, not a lung finding.
const DEVICES: System = { name: 'Lines and devices', match: /\b(devices?|tubes?|(central|venous|arterial|picc|jugular|subclavian|femoral) lines?|catheters?|picc|pacemakers?|pacers?|icd|pacing leads?|stents?|surgical clips?|drains?|hardware|prosthes[ie]s|prosthetic|ports?|sternotomy wires?|ett|ngt|cvc)\b/i }
const SYSTEMS: Record<Exam, System[]> = {
  cxr: [
    DEVICES,
    { name: 'Lungs', generic: true, match: /\b(lung|lobe|zone|pulmonary|consolidat|opacit|atelecta|nodule|mass|infiltrat|edema|oedema|airspace|interstitial|emphysem|hyperinfl|bronch|cavit)/i },
    { name: 'Pleura', match: /\b(pleura|effusion|pneumothorax|costophrenic|hydropneumo|empyema)/i },
    { name: 'Heart and mediastinum', match: /\b(heart|cardi|mediastin|hil(um|ar)|aort|trachea|pericard|thymus)/i },
    { name: 'Bones', match: /\b(bone|rib|fracture|spine|vertebr|clavic|scapul|humer|osseous|skelet|lytic|sclerotic)/i },
    { name: 'Soft tissues and upper abdomen', match: /\b(soft tissue|subcutaneous|emphysema of the chest wall|breast|axilla|diaphragm|free air|pneumoperitoneum|subdiaphragm)/i },
  ],
  'ct-chest': [
    DEVICES,
    { name: 'Lungs and airways', generic: true, match: /\b(lung|lobe|pulmonary|consolidat|opacit|ground.glass|atelecta|nodule|mass|emphysem|bronch|airway|trachea|cavit|embol)/i },
    { name: 'Pleura', match: /\b(pleura|effusion|pneumothorax|empyema)/i },
    { name: 'Heart and mediastinum', match: /\b(heart|cardi|mediastin|hil(um|ar)|aort|pericard|lymph|node|thyroid|oesophag|esophag)/i },
    { name: 'Upper abdomen', match: /\b(liver|hepat|spleen|adrenal|kidney|renal|pancrea|gallbladder|stomach)/i },
    { name: 'Bones', match: /\b(bone|rib|fracture|spine|vertebr|sternum|osseous|lytic|sclerotic)/i },
    { name: 'Soft tissues', match: /\b(soft tissue|subcutaneous|chest wall|breast|axilla)/i },
  ],
  head: [
    { name: 'Brain parenchyma', generic: true, match: /\b(brain|parenchym|cerebr|cerebell|infarct|ischaem|ischem|haemorrhage|hemorrhage|bleed|lesion|mass|oedema|edema|white matter|grey matter|gray matter|cortex|cortical|basal ganglia|thalam|brainstem|pons|midbrain|midline shift)/i },
    { name: 'Ventricles', match: /\b(ventric|hydroceph|sulc|cistern|csf)/i },
    { name: 'Extra-axial spaces', match: /\b(extra.axial|subdural|epidural|extradural|subarachnoid|meninge|haematoma|hematoma)/i },
    { name: 'Bones and calvarium', match: /\b(bone|skull|calvari|fracture|osseous|vault|base of skull)/i },
    { name: 'Sinuses, mastoids and orbits', match: /\b(sinus|mastoid|orbit|globe|nasal|middle ear)/i },
    { name: 'Scalp and soft tissues', match: /\b(scalp|soft tissue|subgaleal)/i },
  ],
  abdomen: [
    DEVICES,
    { name: 'Liver and biliary', match: /\b(liver|hepat|biliar|bile|gallbladder|cholecyst|portal)/i },
    { name: 'Pancreas and spleen', match: /\b(pancrea|spleen|splen)/i },
    { name: 'Adrenals and kidneys', match: /\b(adrenal|kidney|renal|ureter|hydroneph|calcul)/i },
    { name: 'Bowel and peritoneum', match: /\b(bowel|colon|caecum|cecum|append|stomach|duoden|ileum|jejun|perito|ascites|free air|free gas|pneumoperitoneum|mesenter|obstruct)/i },
    { name: 'Pelvis', match: /\b(bladder|uter|ovar|adnex|prostat|pelvi)/i },
    { name: 'Vessels and lymph nodes', match: /\b(aort|vessel|vascular|ivc|vein|arter|lymph|node)/i },
    { name: 'Bones and soft tissues', match: /\b(bone|spine|vertebr|fracture|osseous|soft tissue|hernia|abdominal wall)/i },
  ],
  other: [],
}

const RANK: Record<Severity, number> = { critical: 0, significant: 1, moderate: 2, minor: 3, normal: 4 }

function examOf(images: StudyImage[]): Exam {
  const text = images.map((image) => [image.sourceModality, image.sourceBodyPart, image.analysis?.modality, image.analysis?.bodyPart].join(' ')).join(' ')
  const cross = /\b(ct|mr|mri|computed|magnetic|tomograph)/i.test(text)
  if (/\b(head|brain|skull|cranial|intracranial)/i.test(text)) return 'head'
  if (/\b(abdom|pelvi|liver|kidney|renal)/i.test(text)) return 'abdomen'
  if (/\b(chest|thora|lung)/i.test(text)) return cross ? 'ct-chest' : 'cxr'
  if (/\b(x-?ray|radiograph|cr|dx)\b/i.test(text) && !cross) return 'cxr'
  return 'other'
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const lowerFirst = (text: string) => /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text
const fixed = (value: number) => String(Number(value.toFixed(1)))

/** "measuring 3.2 cm (area 4.5 cm², mean 35 HU, measured from the outline)"; empty when nothing was measured. */
export function measurementPhrase(m: Finding['measurements']): string {
  if (!m) return ''
  const extra = [
    Number.isFinite(m.area_mm2) ? `area ${fixed(m.area_mm2! / 100)} cm²` : '',
    Number.isFinite(m.mean_hu) ? `mean ${Math.round(m.mean_hu!)} HU` : '',
    Number.isFinite(m.surround_hu) ? `surrounding ${Math.round(m.surround_hu!)} HU` : '',
    Number.isFinite(m.parts) && m.parts! > 1 ? `${m.parts} parts` : '',
  ].filter(Boolean)
  if (!Number.isFinite(m.diameter_mm) && !extra.length) return ''
  const size = Number.isFinite(m.diameter_mm) ? `measuring ${fixed(m.diameter_mm! / 10)} cm ` : ''
  return `${size}(${[...extra, 'measured from the outline'].join(', ')})`
}

function marker(finding: Finding): string {
  if (finding.review === 'accepted') return ''
  return ` ${UNREVIEWED}`
}

/** One radiologist-style sentence from the structured fields; the model's free text stays in the findings table. */
export function findingSentence(finding: Finding): string {
  const title = capital((finding.title || 'Finding').trim().replace(/[.\s]+$/, ''))
  const location = (finding.location ?? '').trim().replace(/[.\s]+$/, '')
  const said = `${title} ${location}`.toLowerCase()
  const side = finding.measurements?.side?.trim().toLowerCase()
  const parts = [title]
  if (location && !title.toLowerCase().includes(location.toLowerCase())) parts.push(lowerFirst(location))
  if (side && !said.includes(side)) parts.push(`${side} side`)
  const measured = measurementPhrase(finding.measurements)
  return `${parts.join(', ')}${measured ? `, ${measured}` : ''}.${marker(finding)}`
}

function systemOf(finding: Finding, systems: System[]): string {
  const category = finding.category?.trim() ?? ''
  const text = `${category} ${finding.title} ${finding.location}`
  if (/device|tube|line/i.test(category) && systems.includes(DEVICES)) return DEVICES.name
  const ordered = [...systems.filter((system) => !system.generic), ...systems.filter((system) => system.generic)]
  // Category first (it is the reader's own grouping), then title and location.
  for (const source of [category, text]) {
    const hit = source && ordered.find((system) => system.match.test(source))
    if (hit) return hit.name
  }
  return category ? capital(category) : 'Other'
}

function comparisonText(priors: Study[]): string {
  const prior = priors[0]
  if (!prior) return 'None available.'
  const image = prior.images.find((i) => i.analysis) ?? prior.images[0]
  const modality = [image?.sourceModality || image?.analysis?.modality, image?.sourceBodyPart || image?.analysis?.bodyPart]
    .filter(Boolean).join(' ').trim() || prior.title || 'prior study'
  const more = priors.length > 1 ? ` ${priors.length - 1} earlier prior stud${priors.length === 2 ? 'y is' : 'ies are'} also available.` : ''
  return `Compared with ${modality} of ${prior.patient.studyDate}.${more}`
}

function techniqueText(images: StudyImage[]): string {
  const groups = new Map<string, Set<string>>()
  for (const image of images) {
    const a = image.analysis!
    const key = [a.modality, a.bodyPart].filter(Boolean).join(', ') || 'Imaging'
    const views = groups.get(key) ?? new Set<string>()
    if (a.view && !/unknown/i.test(a.view)) views.add(a.view)
    groups.set(key, views)
  }
  const lines = [...groups].map(([key, views]) => `${key}${views.size ? `; ${[...views].join(', ')} ${views.size === 1 ? 'view' : 'views'}` : ''}.`)
  return `${lines.join('\n')}\n${images.length} analysed image${images.length === 1 ? '' : 's'}.`
}

/** Assemble existing evidence only; no new inference and no implied normal result. `priors` from priorStudies(). */
export function findingsReport(study: Study, priors: Study[] = []): Pick<ReportDraft, 'technique' | 'comparison' | 'findings' | 'impression' | 'recommendations'> {
  const images = study.images.filter((image) => image.analysis)
  if (!images.length) throw new Error('Analyze at least one image before drafting a report.')
  const retained = images.flatMap((image) => image.analysis!.findings
    .filter((finding) => finding.review !== 'dismissed')
    .map((finding) => ({ image, finding })))
  const systems = SYSTEMS[examOf(images)]

  // Systems with retained findings get prose; expected systems without any get a blank for the reader, not "normal".
  const bySystem = new Map<string, string[]>(systems.map((system) => [system.name, []]))
  for (const { finding } of retained) {
    const name = systemOf(finding, systems)
    bySystem.set(name, [...(bySystem.get(name) ?? []), findingSentence(finding)])
  }
  const findings = retained.length || systems.length
    ? [...bySystem].map(([name, sentences]) => `${name}: ${sentences.length ? sentences.join(' ') : BLANK}`).join('\n') +
      (systems.length ? '' : `\nOther structures: ${BLANK}`)
    : `No retained findings are available for this draft. Review the source images and complete this section: ${BLANK}`

  // Accepted findings first, then by severity; normal-severity items (e.g. a device in position) stay in Findings only.
  const ranked = retained
    .map((row, index) => ({ ...row, index }))
    .filter(({ finding }) => finding.severity !== 'normal')
    .sort((a, b) => Number(b.finding.review === 'accepted') - Number(a.finding.review === 'accepted') ||
      RANK[a.finding.severity] - RANK[b.finding.severity] || a.index - b.index)
  const impression = ranked.length
    ? ranked.map(({ finding }, index) => `${index + 1}. ${findingSentence({ ...finding, measurements: undefined })}`).join('\n')
    : `Impression requires source-image review. No conclusion of normality has been made: ${BLANK}`

  return {
    technique: techniqueText(images),
    comparison: comparisonText(priors),
    findings,
    impression,
    recommendations: [
      'Draft assembled from existing image findings without an additional model request. Review and edit before signing.',
      images.length < study.images.length ? `${study.images.length - images.length} image(s) have not been analyzed and are not included.` : '',
      ...retained.filter(({ finding }) => finding.recommendation).map(({ finding }) =>
        `${capital(finding.title.trim())}: ${finding.recommendation!.trim()}${marker(finding)}`),
    ].filter(Boolean).join('\n'),
  }
}
