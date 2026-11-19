// Exam (content) templates: normal-report prose per exam with fill-in fields, like dictation-system AutoText.
// Fields are written in brackets: [label] (replace with a value), [opt1/opt2/opt3] (pick one), [___] (free blank).
// Pure helpers only; persistence lives in examLibrary.ts so these stay testable in Node.
import type { ReportFieldKey, Study } from '../types.ts'

export type ExamModality = 'XR' | 'CT' | 'MR' | 'US' | 'OT'

export interface ExamTemplate {
  id: string
  name: string
  modality: ExamModality
  bodyPart: string
  /** Words matched against the study's body part, title and indication. */
  keywords: string[]
  /** Projection or setting words (PA, AP, portable) that make this template the better match. */
  views?: string[]
  sections: Partial<Record<ReportFieldKey, string>>
  /** Shipped with the app; read-only (duplicate to customise). */
  builtin?: boolean
  updatedAt?: string
}

export type ExamTemplateInput = Pick<ExamTemplate, 'name' | 'modality' | 'bodyPart' | 'keywords' | 'sections'> & { views?: string[] }

export interface FieldRange {
  start: number
  end: number
  /** 'choice' = picklist, 'blank' = [___], 'label' = a named value to replace. */
  kind: 'label' | 'choice' | 'blank'
  /** Text inside the brackets. */
  label: string
  options: string[]
}

// One line, no nested brackets, short enough to be a field rather than prose that happens to use brackets.
const FIELD = /\[([^[\]\n]{1,120})\]/g

export function listFields(text: string): FieldRange[] {
  const fields: FieldRange[] = []
  for (const match of text.matchAll(FIELD)) {
    const label = match[1]
    const start = match.index ?? 0
    const options = label.split('/').map((o) => o.trim()).filter(Boolean)
    const kind = /^\s*_+\s*$/.test(label) ? 'blank' : options.length > 1 ? 'choice' : 'label'
    fields.push({ start, end: start + match[0].length, kind, label: label.trim(), options: kind === 'choice' ? options : [] })
  }
  return fields
}

/** The field to move to from a selection: forward = first starting at or after its end, backward = last ending at or
 * before its start. Wraps around, so Tab cycles through every field. */
export function pickField<T extends { start: number; end: number }>(fields: T[], selStart: number, selEnd: number, direction: 1 | -1 = 1): T | null {
  if (!fields.length) return null
  if (direction === 1) return fields.find((f) => f.start >= selEnd && !(f.start === selStart && f.end === selEnd)) ?? fields[0]
  for (let i = fields.length - 1; i >= 0; i--) if (fields[i].end <= selStart && !(fields[i].start === selStart && fields[i].end === selEnd)) return fields[i]
  return fields[fields.length - 1]
}

export function nextField(text: string, cursor: number, direction: 1 | -1 = 1): FieldRange | null {
  return pickField(listFields(text), cursor, cursor, direction)
}

export function fillField(text: string, range: Pick<FieldRange, 'start' | 'end'>, value: string): string {
  return text.slice(0, range.start) + value + text.slice(range.end)
}

/** Fields still in the report text, in section order, for the sign-off checklist. */
export function unresolvedFields(sections: Partial<Record<ReportFieldKey, string>>): { section: ReportFieldKey; field: FieldRange }[] {
  const order: ReportFieldKey[] = ['technique', 'comparison', 'findings', 'impression', 'recommendations']
  return order.flatMap((section) => listFields(sections[section] ?? '').map((field) => ({ section, field })))
}

/** How a field reads in a list: options joined, blanks as a line. */
export const fieldLabel = (field: FieldRange) => (field.kind === 'blank' ? '___' : field.kind === 'choice' ? field.options.join(' / ') : field.label)

export function normalizeModality(value: string | undefined): ExamModality | undefined {
  const v = (value ?? '').toUpperCase()
  if (!v.trim()) return undefined
  if (/\bCT\b|COMPUTED TOMO/.test(v)) return 'CT'
  if (/\bMRI?\b|MAGNETIC/.test(v)) return 'MR'
  if (/\bUS\b|\bUSG\b|ULTRASO|SONO/.test(v)) return 'US'
  if (/\b(CR|DX|DR|XR)\b|X-?RAY|RADIOGRA/.test(v)) return 'XR'
  return 'OT'
}

export interface ExamHints {
  modality?: string
  bodyPart?: string
  view?: string
  /** Free text such as the study title and clinical indication. */
  text?: string
}

/** What the study says about itself: DICOM tags first, then the model's read of the image, then titles. */
export function studyExamHints(study: Pick<Study, 'title' | 'images' | 'patient'>): ExamHints {
  const image = study.images.find((i) => i.sourceModality || i.analysis) ?? study.images[0]
  return {
    modality: image?.sourceModality || image?.analysis?.modality,
    bodyPart: image?.sourceBodyPart || image?.analysis?.bodyPart,
    view: image?.analysis?.view,
    text: [study.title, study.patient.indication].filter(Boolean).join(' '),
  }
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const hasWord = (haystack: string[], needle: string) => {
  const parts = words(needle)
  if (!parts.length) return false
  return haystack.some((_, i) => parts.every((p, j) => haystack[i + j] === p))
}

/** Templates that fit the study, best first. Templates of another known modality never match. */
export function suggestTemplates(hints: ExamHints, templates: ExamTemplate[]): ExamTemplate[] {
  const modality = normalizeModality(hints.modality) ?? normalizeModality(hints.text)
  const body = words(hints.bodyPart ?? '')
  const view = words(hints.view ?? '')
  const text = words(hints.text ?? '')
  const scored = templates.map((t, index) => {
    if (modality && modality !== 'OT' && t.modality !== modality) return { t, index, score: 0 }
    let score = modality === t.modality ? 2 : 0
    const terms = [t.bodyPart, ...t.keywords]
    let anatomy = 0
    if (terms.some((k) => hasWord(body, k))) anatomy += 4
    if (terms.some((k) => hasWord(text, k))) anatomy += 2
    if (!anatomy) return { t, index, score: 0 }
    score += anatomy
    if ((t.views ?? []).some((v) => hasWord(view, v) || hasWord(text, v))) score += 2
    return { t, index, score }
  })
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.t)
}

export const hasReportText = (sections: Partial<Record<ReportFieldKey, string>>) =>
  Object.values(sections).some((v) => typeof v === 'string' && v.trim().length > 0)

/** Section text after applying a template: 'replace' overwrites the sections the template defines, 'insert' appends. */
export function mergeTemplateSections(
  current: Partial<Record<ReportFieldKey, string>>,
  template: Pick<ExamTemplate, 'sections'>,
  mode: 'replace' | 'insert',
): Partial<Record<ReportFieldKey, string>> {
  const out: Partial<Record<ReportFieldKey, string>> = {}
  for (const [key, text] of Object.entries(template.sections) as [ReportFieldKey, string][]) {
    if (!text?.trim()) continue
    const existing = (current[key] ?? '').trim()
    out[key] = mode === 'insert' && existing ? `${existing}\n${text}` : text
  }
  return out
}

const t = (id: string, name: string, modality: ExamModality, bodyPart: string, keywords: string[], sections: ExamTemplate['sections'], views?: string[]): ExamTemplate =>
  ({ id: `builtin:${id}`, name, modality, bodyPart, keywords, views, sections, builtin: true })

/** Built-in normal templates. Starting text for the reporting radiologist to edit, not a reading of any image. */
export const BUILTIN_EXAM_TEMPLATES: ExamTemplate[] = [
  t('cxr-pa', 'X-ray chest PA', 'XR', 'Chest', ['chest', 'thorax', 'lung', 'lungs', 'cxr'], {
    technique: 'Single frontal PA radiograph of the chest. [Adequate/Suboptimal] inspiration and penetration; [no/mild] rotation.',
    comparison: '[None available/Prior radiograph dated ___]',
    findings: [
      'Lungs: Clear. No focal consolidation, mass or nodule.',
      'Pleura: No pleural effusion or pneumothorax. Costophrenic angles are clear.',
      'Heart and mediastinum: Cardiothoracic ratio is within normal limits. Mediastinal contours and hila are normal. Trachea is central.',
      'Diaphragm: Both hemidiaphragms are well defined. No free subdiaphragmatic gas.',
      'Bones and soft tissues: No acute osseous abnormality.',
    ].join('\n'),
    impression: 'No acute cardiopulmonary abnormality.',
  }, ['pa', 'erect', 'posteroanterior']),
  t('cxr-ap-portable', 'X-ray chest AP portable', 'XR', 'Chest', ['chest', 'thorax', 'lung', 'lungs', 'cxr'], {
    technique: 'Single AP [portable/supine/semi-erect] radiograph of the chest. Heart size cannot be reliably assessed on an AP projection.',
    comparison: '[None available/Prior radiograph dated ___]',
    findings: [
      'Lines and tubes: [None/___].',
      'Lungs: No focal consolidation. No pulmonary oedema.',
      'Pleura: No pleural effusion. No pneumothorax within the limits of a supine film.',
      'Heart and mediastinum: Cardiomediastinal silhouette is within normal limits for an AP projection.',
      'Bones and soft tissues: No acute osseous abnormality.',
    ].join('\n'),
    impression: 'No acute cardiopulmonary abnormality on this portable radiograph.',
  }, ['ap', 'portable', 'supine', 'bedside', 'icu']),
  t('ct-brain-nc', 'CT brain non-contrast', 'CT', 'Head', ['head', 'brain', 'skull', 'cranium', 'intracranial'], {
    technique: 'Axial non-contrast CT of the brain from skull base to vertex, reviewed in brain and bone windows.',
    comparison: '[None available/Prior CT dated ___]',
    findings: [
      'No intracranial haemorrhage, extra-axial collection or territorial infarct.',
      'Grey-white matter differentiation is preserved.',
      'Ventricles and sulci are [normal/appropriate for age/prominent]. No hydrocephalus.',
      'No mass effect or midline shift. Basal cisterns are patent.',
      'Posterior fossa structures are unremarkable.',
      'Calvarium and skull base: No fracture. Visualised paranasal sinuses and mastoid air cells are clear.',
    ].join('\n'),
    impression: 'No acute intracranial abnormality.',
  }, ['non-contrast', 'plain', 'nc']),
  t('ct-chest', 'CT chest', 'CT', 'Chest', ['chest', 'thorax', 'lung', 'lungs', 'hrct'], {
    technique: 'Axial CT of the chest [without/with] intravenous contrast, with multiplanar reconstructions in lung and mediastinal windows.',
    comparison: '[None available/Prior CT dated ___]',
    findings: [
      'Lungs and airways: No consolidation, mass or suspicious pulmonary nodule. Central airways are patent.',
      'Pleura: No pleural effusion or pneumothorax.',
      'Mediastinum and hila: No enlarged mediastinal, hilar or axillary lymph nodes.',
      'Heart and great vessels: Heart size is normal. No pericardial effusion. Thoracic aorta is of normal calibre.',
      'Upper abdomen: Visualised upper abdominal organs are unremarkable.',
      'Bones and soft tissues: No suspicious osseous lesion or acute fracture.',
    ].join('\n'),
    impression: 'No acute or significant intrathoracic abnormality.',
  }),
  t('ct-abd-pelvis-contrast', 'CT abdomen and pelvis with contrast', 'CT', 'Abdomen', ['abdomen', 'pelvis', 'abdominal', 'abdominopelvic', 'kap'], {
    technique: 'Axial CT of the abdomen and pelvis in the [portal venous/arterial and portal venous] phase after intravenous contrast, with multiplanar reconstructions. Oral contrast: [given/not given].',
    comparison: '[None available/Prior CT dated ___]',
    findings: [
      'Liver: Normal in size and attenuation. No focal lesion. Hepatic and portal veins are patent.',
      'Gallbladder and bile ducts: Gallbladder is unremarkable. No biliary dilatation.',
      'Pancreas: Normal. No ductal dilatation or peripancreatic fluid.',
      'Spleen: Normal in size.',
      'Adrenals: Normal.',
      'Kidneys and ureters: Normal enhancement. No hydronephrosis or renal mass.',
      'Bowel: No bowel obstruction or wall thickening. Appendix is [normal/not visualised].',
      'Peritoneum: No free fluid or free intraperitoneal gas.',
      'Lymph nodes: No enlarged abdominal or pelvic lymph nodes.',
      'Pelvis: Urinary bladder is unremarkable. [Prostate/Uterus and adnexa] unremarkable.',
      'Vessels: Abdominal aorta is of normal calibre.',
      'Bones and abdominal wall: No suspicious osseous lesion. No abdominal wall hernia.',
    ].join('\n'),
    impression: 'No acute abnormality in the abdomen or pelvis.',
  }, ['contrast', 'cect', 'portal']),
  t('ct-kub', 'CT KUB (non-contrast)', 'CT', 'Abdomen', ['kub', 'kidney', 'kidneys', 'ureter', 'renal', 'urinary', 'stone', 'calculus', 'colic'], {
    technique: 'Axial low-dose non-contrast CT from the upper poles of the kidneys to the pubic symphysis, with coronal reconstructions.',
    comparison: '[None available/Prior CT dated ___]',
    findings: [
      'Right kidney: Measures [___] cm. No calculus. No hydronephrosis.',
      'Left kidney: Measures [___] cm. No calculus. No hydronephrosis.',
      'Ureters: No ureteric calculus. No hydroureter. No perinephric or periureteric stranding.',
      'Urinary bladder: [Adequately distended/Partially distended]. No vesical calculus.',
      'Other: Visualised solid organs are unremarkable on this non-contrast study. Appendix is [normal/not visualised]. No free fluid.',
    ].join('\n'),
    impression: 'No urinary tract calculus or hydronephrosis.',
  }, ['non-contrast', 'plain', 'low-dose']),
  t('mri-brain', 'MRI brain', 'MR', 'Head', ['head', 'brain', 'intracranial', 'cranium'], {
    technique: 'Multiplanar multisequence MRI of the brain including T1, T2, FLAIR, DWI/ADC and SWI [without/with] intravenous gadolinium.',
    comparison: '[None available/Prior MRI dated ___]',
    findings: [
      'No restricted diffusion to suggest acute infarct.',
      'No intracranial haemorrhage or abnormal susceptibility.',
      'No mass, mass effect or midline shift. No abnormal enhancement.',
      'White matter: [No significant white matter signal abnormality/Few small nonspecific T2-FLAIR white matter hyperintensities].',
      'Ventricles and sulci are appropriate for age. No hydrocephalus.',
      'Pituitary, sella and craniocervical junction are unremarkable.',
      'Major intracranial flow voids are preserved.',
      'Orbits, paranasal sinuses and mastoids are unremarkable.',
    ].join('\n'),
    impression: 'No acute intracranial abnormality.',
  }),
  t('mri-ls-spine', 'MRI lumbar spine', 'MR', 'Lumbar spine', ['lumbar', 'lumbosacral', 'lspine', 'spine', 'ls', 'back', 'sciatica'], {
    technique: 'Multiplanar multisequence MRI of the lumbar spine (sagittal T1, T2 and STIR; axial T2).',
    comparison: '[None available/Prior MRI dated ___]',
    findings: [
      'Alignment: Normal lumbar lordosis. No spondylolisthesis.',
      'Vertebral bodies: Heights are maintained. No marrow oedema or suspicious marrow lesion.',
      'Conus: Terminates at [L1/L1-L2/T12-L1] with normal signal.',
      'Discs: Disc heights and hydration are preserved.',
      'L1-L2 to L3-L4: No disc herniation, canal or foraminal stenosis.',
      'L4-L5: No disc herniation, canal or foraminal stenosis.',
      'L5-S1: No disc herniation, canal or foraminal stenosis.',
      'Paraspinal soft tissues: Unremarkable.',
    ].join('\n'),
    impression: 'No significant disc herniation, spinal canal or neural foraminal stenosis.',
  }),
  t('mri-knee', 'MRI knee', 'MR', 'Knee', ['knee', 'meniscus', 'acl', 'patella'], {
    technique: 'Multiplanar multisequence MRI of the [right/left] knee.',
    comparison: '[None available/Prior MRI dated ___]',
    findings: [
      'Menisci: Medial and lateral menisci are intact. No meniscal tear.',
      'Cruciate ligaments: Anterior and posterior cruciate ligaments are intact.',
      'Collateral ligaments: Medial and lateral collateral ligament complexes are intact.',
      'Extensor mechanism: Quadriceps and patellar tendons are intact. Patella is normally located.',
      'Cartilage: Articular cartilage is preserved in all compartments.',
      'Bone marrow: No marrow oedema, contusion or fracture.',
      'Joint: [No/Small] joint effusion. No Baker cyst.',
    ].join('\n'),
    impression: 'No internal derangement of the [right/left] knee.',
  }),
  t('usg-abdomen', 'USG abdomen', 'US', 'Abdomen', ['abdomen', 'abdominal', 'whole abdomen', 'liver', 'gallbladder', 'kidney', 'pelvis'], {
    technique: 'Real-time grey-scale ultrasound of the abdomen and pelvis.',
    comparison: '[None available/Prior ultrasound dated ___]',
    findings: [
      'Liver: Normal in size ([___] cm) with normal echotexture. No focal lesion. No intrahepatic biliary dilatation. Portal vein is normal in calibre.',
      'Gallbladder: Well distended. No calculus, sludge or wall thickening.',
      'Common bile duct: Normal in calibre ([___] mm).',
      'Pancreas: Visualised parts are normal.',
      'Spleen: Normal in size ([___] cm) and echotexture.',
      'Right kidney: Measures [___] cm. Normal corticomedullary differentiation. No calculus or hydronephrosis.',
      'Left kidney: Measures [___] cm. Normal corticomedullary differentiation. No calculus or hydronephrosis.',
      'Urinary bladder: Well distended with normal wall. No calculus.',
      '[Prostate: Normal in size (volume ___ cc)./Uterus and ovaries: Normal in size and echotexture.]',
      'No free fluid in the abdomen or pelvis. No significant lymphadenopathy.',
    ].join('\n'),
    impression: 'No significant abnormality on ultrasound of the abdomen and pelvis.',
  }),
  t('xr-knee', 'X-ray knee', 'XR', 'Knee', ['knee', 'patella', 'tibia', 'femur'], {
    technique: '[AP and lateral/AP, lateral and skyline] radiographs of the [right/left] knee.',
    comparison: '[None available/Prior radiograph dated ___]',
    findings: [
      'No acute fracture or dislocation.',
      'Joint spaces: [Preserved/Mild medial tibiofemoral joint space narrowing].',
      'No significant osteophytes or subchondral sclerosis.',
      '[No/Small] suprapatellar joint effusion.',
      'Soft tissues are unremarkable. No radio-opaque foreign body.',
    ].join('\n'),
    impression: 'No acute osseous abnormality of the [right/left] knee.',
  }),
  t('xr-ls-spine', 'X-ray lumbar spine', 'XR', 'Lumbar spine', ['lumbar', 'lumbosacral', 'lspine', 'ls', 'spine', 'back'], {
    technique: 'AP and lateral radiographs of the lumbosacral spine.',
    comparison: '[None available/Prior radiograph dated ___]',
    findings: [
      'Alignment: Normal lumbar lordosis. No spondylolisthesis.',
      'Vertebral bodies: Heights are maintained. No fracture or destructive lesion.',
      'Disc spaces: [Preserved/Reduced at ___].',
      'Posterior elements: No pars defect is seen on these views.',
      'Sacroiliac joints: Unremarkable.',
      'Paraspinal soft tissues: Unremarkable.',
    ].join('\n'),
    impression: 'No acute osseous abnormality of the lumbar spine.',
  }),
]
