// Deterministic guideline lookups for the report's Recommendations. Decision support only: the reader checks that
// the guideline applies to this patient (age, risk, setting) before using the sentence. Pure; node-tested.

export interface GuidelineResult {
  /** e.g. "Lung-RADS 4A", "TR4". Absent when the guideline has no category for this input. */
  category?: string
  recommendation: string
  /** Applicability caveats the reader should check. */
  notes: string[]
  citation: string
  /** Short source name used in the inserted sentence. */
  source: string
}

export const CITATIONS = {
  fleischner: 'MacMahon H, et al. Guidelines for Management of Incidental Pulmonary Nodules Detected on CT Images: From the Fleischner Society 2017. Radiology 2017;284(1):228-243.',
  lungRads: 'American College of Radiology. Lung CT Screening Reporting and Data System (Lung-RADS) v2022.',
  tirads: 'Tessler FN, et al. ACR Thyroid Imaging, Reporting and Data System (TI-RADS): White Paper of the ACR TI-RADS Committee. J Am Coll Radiol 2017;14(5):587-595.',
  bosniak: 'Silverman SG, et al. Bosniak Classification of Cystic Renal Masses, Version 2019: An Update Proposal and Needs Assessment. Radiology 2019;292(2):475-488.',
  adrenal: 'Mayo-Smith WW, et al. Management of Incidental Adrenal Masses: A White Paper of the ACR Incidental Findings Committee. J Am Coll Radiol 2017;14(8):1038-1044.',
  birads: 'D\'Orsi CJ, et al. ACR BI-RADS Atlas, Breast Imaging Reporting and Data System, 5th ed. American College of Radiology; 2013.',
} as const

/** The sentence inserted into Recommendations. */
export function recommendationSentence(result: GuidelineResult): string {
  const text = result.recommendation.trim().replace(/\.$/, '')
  return `${result.category ? `${result.category}. ` : ''}${text} (${result.source}).`
}

const finite = (value: number, name: string) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number.`)
  return value
}

// ---- Fleischner 2017 --------------------------------------------------------------------------------------

export type NoduleType = 'solid' | 'part-solid' | 'ground-glass'

export interface FleischnerInput {
  /** Average of long and short axis, mm. Fleischner rounds to the nearest whole millimetre. */
  sizeMm: number
  type: NoduleType
  multiple: boolean
  /** Patient risk (smoking, family history, emphysema, upper lobe, spiculation...). Solid nodules only. */
  highRisk: boolean
}

/** Fleischner Society 2017 incidental pulmonary nodule recommendation (adults ≥35, incidental CT finding). */
export function fleischner(input: FleischnerInput): GuidelineResult {
  const size = Math.round(finite(input.sizeMm, 'Nodule size'))
  const notes = [
    'Applies to incidental nodules in patients aged 35 or older; not for lung cancer screening, immunocompromised patients or patients with known primary cancer.',
    'Size is the average of long and short axes, rounded to the nearest millimetre.',
  ]
  const band = size < 6 ? '<6 mm' : input.type === 'solid' ? (size <= 8 ? '6-8 mm' : '>8 mm') : '≥6 mm'
  const plural = input.multiple ? 'Multiple' : 'Single'
  const kind = input.type === 'solid' ? 'solid' : input.type === 'part-solid' ? 'part-solid' : 'ground-glass'
  let recommendation: string
  if (input.type === 'solid') {
    const risk = input.highRisk ? 'high-risk' : 'low-risk'
    const table: Record<string, Record<string, [string, string]>> = {
      single: {
        '<6 mm': ['No routine follow-up', 'Optional CT at 12 months'],
        '6-8 mm': ['CT at 6-12 months, then consider CT at 18-24 months', 'CT at 6-12 months, then CT at 18-24 months'],
        '>8 mm': ['Consider CT at 3 months, PET/CT, or tissue sampling', 'Consider CT at 3 months, PET/CT, or tissue sampling'],
      },
      multiple: {
        '<6 mm': ['No routine follow-up', 'Optional CT at 12 months'],
        '6-8 mm': ['CT at 3-6 months, then consider CT at 18-24 months', 'CT at 3-6 months, then at 18-24 months'],
        '>8 mm': ['CT at 3-6 months, then consider CT at 18-24 months', 'CT at 3-6 months, then at 18-24 months'],
      },
    }
    recommendation = `${plural} solid nodule${input.multiple ? 's' : ''} ${band}, ${risk} patient: ${table[input.multiple ? 'multiple' : 'single'][band][input.highRisk ? 1 : 0]}`
    if (input.multiple) notes.push('For multiple nodules, use the most suspicious nodule to guide management.')
  } else {
    const small = size < 6
    if (input.multiple) {
      recommendation = small
        ? 'CT at 3-6 months; if stable, consider CT at 2 and 4 years'
        : 'CT at 3-6 months; subsequent management based on the most suspicious nodule(s)'
    } else if (input.type === 'ground-glass') {
      recommendation = small ? 'No routine follow-up' : 'CT at 6-12 months to confirm persistence, then CT every 2 years until 5 years'
    } else {
      recommendation = small
        ? 'No routine follow-up'
        : 'CT at 3-6 months to confirm persistence; if unchanged and the solid component remains <6 mm, annual CT for 5 years'
      if (!small) notes.push('A persistent part-solid nodule with a solid component ≥6 mm is considered highly suspicious.')
    }
    recommendation = `${plural} ${kind} nodule${input.multiple ? 's' : ''} ${band}: ${recommendation}`
    notes.push('Subsolid nodule recommendations do not depend on patient risk.')
  }
  return { recommendation, notes, citation: CITATIONS.fleischner, source: 'Fleischner Society 2017' }
}

// ---- Lung-RADS v2022 --------------------------------------------------------------------------------------

export interface LungRadsInput {
  type: NoduleType
  /** Mean diameter, mm, to one decimal place. For part-solid nodules this is the total diameter. */
  sizeMm: number
  /** Part-solid only: mean diameter of the solid component, mm. */
  solidMm?: number
  /** Baseline screen, new on this screen, or growing (>1.5 mm increase within 12 months). */
  status: 'baseline' | 'new' | 'growing'
  /** Solid, smooth, oval/lentiform/triangular juxtapleural (perifissural) nodule. */
  juxtapleural?: boolean
}

const LUNG_RADS_MANAGEMENT: Record<string, string> = {
  '2': 'Benign appearance or behavior: continue annual screening with LDCT in 12 months',
  '3': 'Probably benign: LDCT in 6 months',
  '4A': 'Suspicious: LDCT in 3 months; PET/CT may be considered if there is a ≥8 mm solid nodule or solid component',
  '4B': 'Very suspicious: diagnostic chest CT with or without contrast; PET/CT may be considered if there is a ≥8 mm solid nodule or solid component; tissue sampling and/or referral for further clinical evaluation',
}

/** Lung-RADS v2022 category for one nodule on screening LDCT (the most suspicious nodule sets the exam category). */
export function lungRads(input: LungRadsInput): GuidelineResult {
  const size = finite(input.sizeMm, 'Nodule size')
  let category: '2' | '3' | '4A' | '4B'
  if (input.type === 'solid') {
    if (input.juxtapleural && input.status !== 'growing' && size < 10) category = '2'
    else if (input.status === 'baseline') category = size < 6 ? '2' : size < 8 ? '3' : size < 15 ? '4A' : '4B'
    else if (input.status === 'new') category = size < 4 ? '2' : size < 6 ? '3' : size < 8 ? '4A' : '4B'
    else category = size < 8 ? '4A' : '4B'
  } else if (input.type === 'ground-glass') {
    // Non-solid: <30 mm is category 2 however it behaves; ≥30 mm is 3 at baseline or new, 2 when stable or slowly growing.
    category = size < 30 || input.status === 'growing' ? '2' : '3'
  } else {
    const solid = finite(input.solidMm ?? 0, 'Solid component')
    if (solid > size) throw new Error('Solid component cannot exceed the total nodule size.')
    if (input.status === 'baseline') category = size < 6 ? '2' : solid < 6 ? '3' : solid < 8 ? '4A' : '4B'
    else if (input.status === 'new' && size < 6) category = '3'
    else category = solid < 4 ? '4A' : '4B'
  }
  const notes = [
    'Applies to lung cancer screening LDCT only; incidental nodules follow Fleischner.',
    'The exam is categorised by the most suspicious nodule. Category 4X (additional suspicious features) and the S modifier are assigned by the reader.',
  ]
  if (input.type === 'ground-glass' && input.status === 'growing' && size >= 30) notes.push('Category 2 assumes stable or slowly growing; rapid growth needs reader judgement.')
  return {
    category: `Lung-RADS ${category}`,
    recommendation: LUNG_RADS_MANAGEMENT[category],
    notes,
    citation: CITATIONS.lungRads,
    source: 'ACR Lung-RADS v2022',
  }
}

// ---- ACR TI-RADS 2017 -------------------------------------------------------------------------------------

export const TIRADS_FEATURES = {
  composition: { 'cystic or almost completely cystic': 0, spongiform: 0, 'mixed cystic and solid': 1, 'solid or almost completely solid': 2 },
  echogenicity: { anechoic: 0, 'hyperechoic or isoechoic': 1, hypoechoic: 2, 'very hypoechoic': 3 },
  shape: { 'wider-than-tall': 0, 'taller-than-wide': 3 },
  margin: { 'smooth or ill-defined': 0, 'lobulated or irregular': 2, 'extra-thyroidal extension': 3 },
  /** Echogenic foci are additive: choose every type present. */
  foci: { 'none or large comet-tail artifacts': 0, macrocalcifications: 1, 'peripheral (rim) calcifications': 2, 'punctate echogenic foci': 3 },
} as const

export interface TiradsInput {
  composition: keyof typeof TIRADS_FEATURES.composition
  echogenicity: keyof typeof TIRADS_FEATURES.echogenicity
  shape: keyof typeof TIRADS_FEATURES.shape
  margin: keyof typeof TIRADS_FEATURES.margin
  foci: (keyof typeof TIRADS_FEATURES.foci)[]
}

export function tiradsPoints(input: TiradsInput): number {
  const f = TIRADS_FEATURES
  return f.composition[input.composition] + f.echogenicity[input.echogenicity] + f.shape[input.shape] + f.margin[input.margin] +
    [...new Set(input.foci)].reduce((sum, focus) => sum + f.foci[focus], 0)
}

/** TR level from total points. ACR lists 0 → TR1 and 2 → TR2; a 1-point total is read as TR2 (management is the same). */
export function tiradsLevel(points: number): 1 | 2 | 3 | 4 | 5 {
  finite(points, 'Points')
  return points === 0 ? 1 : points <= 2 ? 2 : points === 3 ? 3 : points <= 6 ? 4 : 5
}

const TIRADS_LEVELS = {
  1: { label: 'TR1 (benign)', fna: null, follow: null },
  2: { label: 'TR2 (not suspicious)', fna: null, follow: null },
  3: { label: 'TR3 (mildly suspicious)', fna: 2.5, follow: 1.5 },
  4: { label: 'TR4 (moderately suspicious)', fna: 1.5, follow: 1.0 },
  5: { label: 'TR5 (highly suspicious)', fna: 1.0, follow: 0.5 },
} as const
const TIRADS_SCHEDULE: Record<number, string> = { 3: 'at 1, 3 and 5 years', 4: 'at 1, 2, 3 and 5 years', 5: 'annually for up to 5 years' }

/** ACR TI-RADS level and FNA / follow-up from points and maximum nodule diameter (cm). */
export function tirads(points: number, maxDiameterCm: number): GuidelineResult {
  const size = finite(maxDiameterCm, 'Nodule size')
  const level = tiradsLevel(points)
  const row = TIRADS_LEVELS[level]
  let recommendation: string
  if (row.fna == null || row.follow == null) recommendation = 'No FNA'
  else if (size >= row.fna) recommendation = `FNA recommended (size ${size} cm meets the ≥${row.fna} cm threshold)`
  else if (size >= row.follow) recommendation = `Follow-up ultrasound ${TIRADS_SCHEDULE[level]} (size ${size} cm meets the ≥${row.follow} cm follow-up threshold; FNA if ≥${row.fna} cm)`
  else recommendation = `No FNA or follow-up for size (below the ${row.follow} cm follow-up threshold)`
  return {
    category: `ACR TI-RADS ${row.label}, ${points} point${points === 1 ? '' : 's'}`,
    recommendation,
    notes: ['Size is the maximum diameter in any plane.', 'Consider FNA of at most two nodules with the highest levels; suspicious cervical lymph nodes change management.'],
    citation: CITATIONS.tirads,
    source: 'ACR TI-RADS 2017',
  }
}

// ---- Bosniak 2019 -----------------------------------------------------------------------------------------

export type BosniakClass = 'I' | 'II' | 'IIF' | 'III' | 'IV'

const BOSNIAK: Record<BosniakClass, { text: string; management: string }> = {
  I: { text: 'well-defined thin (≤2 mm) smooth wall, homogeneous simple fluid (-9 to 20 HU), no septa or calcifications', management: 'Benign; no follow-up imaging' },
  II: { text: 'few (1-3) thin enhancing septa, or a homogeneous non-enhancing or hyperattenuating (≥70 HU unenhanced) mass, or a homogeneous low-attenuation mass too small to characterise', management: 'Benign; no follow-up imaging' },
  IIF: { text: 'smooth minimally thickened (3 mm) enhancing wall or septa, or many (≥4) smooth thin enhancing septa', management: 'Follow-up CT or MRI at 6 and 12 months, then annually for 5 years' },
  III: { text: 'one or more enhancing thick (≥4 mm) or enhancing irregular (≤3 mm obtuse-margined convex protrusion) walls or septa', management: 'Indeterminate, intermediate likelihood of malignancy; urology referral for surgical management or active surveillance' },
  IV: { text: 'one or more enhancing nodules (≥4 mm obtuse-margined convex protrusion, or acute-margined convex protrusion of any size)', management: 'Likely malignant; urology referral for surgical management' },
}

export function bosniak(cls: BosniakClass): GuidelineResult {
  const row = BOSNIAK[cls]
  if (!row) throw new Error('Unknown Bosniak class.')
  return {
    category: `Bosniak ${cls} cystic renal mass (${row.text})`,
    recommendation: row.management,
    notes: ['Bosniak 2019 applies to cystic masses on renal mass protocol CT or MRI; masses with <25% solid tissue only.'],
    citation: CITATIONS.bosniak,
    source: 'Bosniak 2019',
  }
}

// ---- ACR incidental adrenal mass 2017 ---------------------------------------------------------------------

export interface AdrenalInput {
  /** Short-axis or long-axis size in cm. */
  sizeCm: number
  /** Unenhanced CT attenuation, HU; absent when no unenhanced phase. */
  unenhancedHu?: number
  macroscopicFat?: boolean
  cancerHistory?: boolean
  /** Stable for at least 1 year on prior imaging. */
  stableOneYear?: boolean
}

export function adrenal(input: AdrenalInput): GuidelineResult {
  const size = finite(input.sizeCm, 'Adrenal mass size')
  const hu = input.unenhancedHu
  const notes = ['Biochemical (hormonal) evaluation is recommended for adrenal masses where clinically indicated.', 'Applies to incidental masses in adults; not for patients with symptoms of hormone excess or suspected pheochromocytoma.']
  let recommendation: string
  if (input.macroscopicFat) recommendation = 'Macroscopic fat: benign myelolipoma; no further imaging'
  else if (hu != null && Number.isFinite(hu) && hu <= 10) recommendation = `Unenhanced attenuation ${hu} HU (≤10 HU): lipid-rich adenoma; no further imaging`
  else if (input.stableOneYear) recommendation = 'Stable for ≥1 year: benign; no further imaging'
  else if (size < 1) recommendation = 'Under 1 cm: no further imaging'
  else if (size >= 4) recommendation = input.cancerHistory ? '≥4 cm with cancer history: PET/CT or biopsy' : '≥4 cm without cancer history: consider resection'
  else if (input.cancerHistory) recommendation = '1-4 cm with cancer history: adrenal protocol CT or chemical-shift MRI, or PET/CT; consider biopsy'
  else if (size < 2) recommendation = '1-2 cm indeterminate, no cancer history: consider 12-month follow-up adrenal CT, or adrenal protocol CT / chemical-shift MRI'
  else recommendation = '2-4 cm indeterminate, no cancer history: adrenal protocol CT (washout) or chemical-shift MRI'
  if (/washout|protocol CT/.test(recommendation)) notes.push('Washout favouring adenoma: absolute ≥60% or relative ≥40%.')
  return { recommendation, notes, citation: CITATIONS.adrenal, source: 'ACR Incidental Findings Committee 2017' }
}

// ---- BI-RADS 5th edition ----------------------------------------------------------------------------------

export type BiradsCategory = '0' | '1' | '2' | '3' | '4' | '4A' | '4B' | '4C' | '5' | '6'

const BIRADS: Record<BiradsCategory, [string, string]> = {
  0: ['Incomplete: need additional imaging evaluation and/or prior mammograms for comparison', 'Recall for additional imaging and/or comparison with prior examination(s)'],
  1: ['Negative', 'Routine screening'],
  2: ['Benign', 'Routine screening'],
  3: ['Probably benign (likelihood of malignancy >0% but ≤2%)', 'Short-interval (6-month) follow-up or continued surveillance'],
  4: ['Suspicious (likelihood of malignancy >2% but <95%)', 'Tissue diagnosis'],
  '4A': ['Low suspicion for malignancy (>2% to ≤10%)', 'Tissue diagnosis'],
  '4B': ['Moderate suspicion for malignancy (>10% to ≤50%)', 'Tissue diagnosis'],
  '4C': ['High suspicion for malignancy (>50% to <95%)', 'Tissue diagnosis'],
  5: ['Highly suggestive of malignancy (≥95%)', 'Tissue diagnosis'],
  6: ['Known biopsy-proven malignancy', 'Surgical excision when clinically appropriate'],
}

export function birads(category: BiradsCategory): GuidelineResult {
  const row = BIRADS[category]
  if (!row) throw new Error('Unknown BI-RADS category.')
  return {
    category: `BI-RADS ${category}: ${row[0]}`,
    recommendation: row[1],
    notes: ['The assessment category is the reader\'s; this only supplies the standard wording and management.'],
    citation: CITATIONS.birads,
    source: 'ACR BI-RADS 5th edition',
  }
}
