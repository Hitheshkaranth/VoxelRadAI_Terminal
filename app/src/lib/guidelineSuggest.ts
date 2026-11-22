// Spot findings in the dictated report that a guideline helper covers, and pre-fill the helper from the words that
// were actually said. Pattern matching only: nothing is inferred that the text does not state, unspoken inputs are left
// for the reader, and nothing reaches Recommendations until the reader inserts it. Pure; node-tested
// (scripts/test-guideline-suggest.ts), so runtime imports need .ts extensions.
import { negatedAt, sentences } from './reportQa.ts'
import type { BiradsCategory, BosniakClass, NoduleType, TiradsInput } from './guidelines.ts'

export type GuidelineKind = 'fleischner' | 'lungRads' | 'tirads' | 'bosniak' | 'adrenal' | 'birads'

export interface GuidelinePrefill {
  /** In the unit the helper asks for: mm for lung nodules, cm for thyroid and adrenal. */
  size?: number
  solidMm?: number
  type?: NoduleType
  multiple?: boolean
  status?: 'baseline' | 'new' | 'growing' | 'stable'
  juxtapleural?: boolean
  /** Only when the sentence says the attenuation is unenhanced (non-contrast). */
  hu?: number
  fat?: boolean
  bosniakClass?: BosniakClass
  biradsCategory?: BiradsCategory
  /** Only the TI-RADS features that were dictated. */
  tirads?: Partial<TiradsInput>
}

export interface GuidelineSuggestion {
  /** Stable while the sentence is unchanged, so a dismissal sticks until the text changes. */
  id: string
  kind: GuidelineKind
  /** Short chip text, e.g. "Fleischner · solid nodule, 8 mm". */
  label: string
  /** The dictated sentence the suggestion came from. */
  evidence: string
  prefill: GuidelinePrefill
}

export interface SuggestContext {
  /** Clinical indication and technique: "screening" / "low-dose" switch lung nodules to Lung-RADS. */
  indication?: string
  technique?: string
  /**
   * Every image is a plain radiograph. Fleischner, Lung-RADS, the adrenal algorithm and Bosniak apply to CT/MR
   * findings, so they are not suggested: a nodule on a chest film needs CT characterisation first.
   */
  radiograph?: boolean
}

/** Source names the helper writes into Recommendations (see guidelines.ts), used to hide applied suggestions. */
export const GUIDELINE_SOURCE: Record<GuidelineKind, string> = {
  fleischner: 'Fleischner Society 2017',
  lungRads: 'ACR Lung-RADS v2022',
  tirads: 'ACR TI-RADS 2017',
  bosniak: 'Bosniak 2019',
  adrenal: 'ACR Incidental Findings Committee 2017',
  birads: 'ACR BI-RADS 5th edition',
}

export const GUIDELINE_NAME: Record<GuidelineKind, string> = {
  fleischner: 'Fleischner',
  lungRads: 'Lung-RADS',
  tirads: 'TI-RADS',
  bosniak: 'Bosniak',
  adrenal: 'Adrenal incidentaloma',
  birads: 'BI-RADS',
}

/** True when `pattern` occurs in the sentence and that occurrence is not denied ("no nodule", "nodule has resolved"). */
function affirmed(sentence: string, pattern: RegExp): boolean {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  for (const match of sentence.matchAll(global)) if (!negatedAt(sentence, match.index, match[0].length)) return true
  return false
}

const MEASURE = /(\d+(?:\.\d+)?)(?:\s*(?:x|×|by)\s*(\d+(?:\.\d+)?))?(?:\s*(?:x|×|by)\s*(\d+(?:\.\d+)?))?\s*(mm|cm|millimet(?:er|re)s?|centimet(?:er|re)s?)\b/i

/** First measurement in the text, every dimension converted to mm, in the order dictated. */
export function firstMeasurementMm(text: string): number[] | null {
  const match = text.match(MEASURE)
  if (!match) return null
  const factor = /^c/i.test(match[4]) ? 10 : 1
  return [match[1], match[2], match[3]].filter((v): v is string => v != null).map((v) => Number(v) * factor)
}

const round1 = (value: number) => Math.round(value * 10) / 10
/** Fleischner / Lung-RADS: average of long and short axis (the first two dimensions given); one dimension as is. */
const meanAxisMm = (dims: number[]) => round1(dims.length >= 2 ? (dims[0] + dims[1]) / 2 : dims[0])
const maxCm = (dims: number[]) => round1(Math.max(...dims) / 10)
const fmt = (value: number) => String(round1(value))

// ---- Lung nodules ------------------------------------------------------------------------------------------

const NODULE = /\bnodul(?:e|es|ar|arity)\b/i
const LUNG = /\b(lungs?|lobes?|lobar|pulmonary|lingula\w*|perifissural|subpleural|juxtapleural|fissure|RUL|RML|RLL|LUL|LLL)\b/i
const OTHER_ORGAN = /\b(thyroid|isthmus|adrenal|renal|kidneys?|liver|hepatic|breast|lymph|nodes?|splenic|spleen|pancrea\w*|prostat\w*)\b/i
// Benign calcification patterns and granulomas are outside Fleischner.
const BENIGN = /\b(calcified|granulomas?|granulomatous|hamartoma)\b/i
const SOLID_COMPONENT = /\bsolid component(?: of| measuring)?\s*/i
const SCREENING = /\b(screening|low[- ]dose|LDCT)\b/i

function lungNodule(sentence: string): GuidelinePrefill | null {
  if (!affirmed(sentence, NODULE) || !LUNG.test(sentence) || OTHER_ORGAN.test(sentence) || BENIGN.test(sentence)) return null
  const prefill: GuidelinePrefill = {}
  // The solid component is its own measurement; take it out before reading the nodule size.
  let rest = sentence
  const component = sentence.match(SOLID_COMPONENT)
  if (component) {
    const after = sentence.slice(component.index! + component[0].length)
    const dims = firstMeasurementMm(after)
    if (dims && after.search(MEASURE) < 4) {
      prefill.solidMm = meanAxisMm(dims)
      rest = sentence.slice(0, component.index) + after.replace(MEASURE, '')
    }
  }
  const dims = firstMeasurementMm(rest)
  if (dims) prefill.size = meanAxisMm(dims)
  if (/\b(part[- ]?solid|semi[- ]?solid)\b/i.test(sentence)) prefill.type = 'part-solid'
  else if (/\b(ground[- ]glass|GGO|GGN|non[- ]?solid|pure ground)\b/i.test(sentence)) prefill.type = 'ground-glass'
  else if (/\bsolid\b/i.test(sentence) && !/\bsub[- ]?solid\b/i.test(sentence)) prefill.type = 'solid'
  if (/\bnodules\b|\b(multiple|several|few|numerous|bilateral|scattered)\b/i.test(sentence)) prefill.multiple = true
  if (/\b(perifissural|juxtapleural)\b/i.test(sentence)) prefill.juxtapleural = true
  // "No new nodules" is not a new nodule; affirmed() skips denied mentions.
  if (affirmed(sentence, /\b(new|newly)\b/i)) prefill.status = 'new'
  else if (affirmed(sentence, /\b(increas\w*|grow\w*|enlarg\w*)\b/i)) prefill.status = 'growing'
  else if (affirmed(sentence, /\b(stable|unchanged)\b/i)) prefill.status = 'stable'
  return prefill
}

function lungLabel(prefill: GuidelinePrefill): string {
  const type = prefill.type === 'part-solid' ? 'part-solid' : prefill.type === 'ground-glass' ? 'ground-glass' : prefill.type === 'solid' ? 'solid' : ''
  const noun = prefill.multiple ? 'nodules' : 'nodule'
  return `${type ? `${type} ` : ''}${noun}${prefill.size != null ? `, ${fmt(prefill.size)} mm` : ''}`
}

// ---- Thyroid nodules (ACR TI-RADS) -------------------------------------------------------------------------

const THYROID = /\b(thyroid|isthmus)\b/i
const THYROID_LESION = /\b(nodules?|lesions?|mass)\b/i

function tiradsFeatures(s: string): Partial<TiradsInput> {
  const has = (pattern: RegExp) => affirmed(s, pattern)
  const features: Partial<TiradsInput> = {}
  if (has(/\bspongiform\b/i)) features.composition = 'spongiform'
  else if (has(/\b(mixed|solid and cystic|cystic and solid|partially cystic|predominantly (solid|cystic)|complex)\b/i)) features.composition = 'mixed cystic and solid'
  else if (has(/\b(almost completely|completely|entirely|purely) cystic\b|\bsimple cyst\b/i)) features.composition = 'cystic or almost completely cystic'
  else if (has(/\bsolid\b/i)) features.composition = 'solid or almost completely solid'
  if (has(/\b(very|markedly) hypoechoic\b/i)) features.echogenicity = 'very hypoechoic'
  else if (has(/\bhypoechoic\b/i)) features.echogenicity = 'hypoechoic'
  else if (has(/\b(iso|hyper)echoic\b/i)) features.echogenicity = 'hyperechoic or isoechoic'
  else if (has(/\banechoic\b/i)) features.echogenicity = 'anechoic'
  if (has(/\btaller[- ]than[- ]wide\b/i)) features.shape = 'taller-than-wide'
  else if (has(/\bwider[- ]than[- ]tall\b/i)) features.shape = 'wider-than-tall'
  if (has(/\bextra-?thyroidal (extension|spread)\b/i)) features.margin = 'extra-thyroidal extension'
  else if (has(/\b(lobulated|irregular)\b/i)) features.margin = 'lobulated or irregular'
  else if (has(/\b(smooth|ill[- ]defined)\b/i)) features.margin = 'smooth or ill-defined'
  const foci: TiradsInput['foci'] = []
  if (has(/\b(punctate echogenic foci|micro-?calcifications?)\b/i)) foci.push('punctate echogenic foci')
  if (has(/\b(peripheral|rim) calcifications?\b/i)) foci.push('peripheral (rim) calcifications')
  if (has(/\b(macro-?calcifications?|coarse calcifications?)\b/i)) foci.push('macrocalcifications')
  if (!foci.length && has(/\bcomet[- ]tail\b/i)) foci.push('none or large comet-tail artifacts')
  if (foci.length) features.foci = foci
  return features
}

// ---- Adrenal, renal cyst, BI-RADS ---------------------------------------------------------------------------

const ADRENAL = /\badrenal\b/i
const ADRENAL_LESION = /\b(nodules?|mass(?:es)?|lesions?|adenomas?|incidentalomas?)\b/i
const UNENHANCED = /\b(unenhanced|non-?contrast|noncontrast|pre-?contrast|without contrast)\b/i
const HU = /(minus\s*|-\s*)?(\d+(?:\.\d+)?)\s*(?:HU|hounsfield units?)\b/i

function adrenalPrefill(s: string): GuidelinePrefill {
  const prefill: GuidelinePrefill = {}
  // Sizes need a mm/cm unit, so an attenuation like "8 HU" is never read as a size.
  const dims = firstMeasurementMm(s)
  if (dims) prefill.size = maxCm(dims)
  const hu = s.match(HU)
  // Attenuation counts only when the sentence says it is unenhanced: ≤10 HU on a contrast phase is not an adenoma.
  if (hu && UNENHANCED.test(s)) prefill.hu = (hu[1] ? -1 : 1) * Number(hu[2])
  if (affirmed(s, /\b(macroscopic fat|myelolipoma)\b/i)) prefill.fat = true
  return prefill
}

const BOSNIAK = /\bbosniak\s*(?:class|category|type)?\s*(II\s?F|2\s?F|IV|III|II|I|4|3|2|1)\b/i
const BOSNIAK_MAP: Record<string, BosniakClass> = { I: 'I', II: 'II', IIF: 'IIF', '2F': 'IIF', III: 'III', IV: 'IV', 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }
const RENAL_CYSTIC = /\b(complex|septated|septations?|cystic (lesion|mass)|bosniak)\b/i
const BIRADS = /\bBI[- ]?RADS\s*(?:category\s*)?(0|1|2|3|4\s?[ABC]?|5|6)\b/i

// ---- Entry point ----------------------------------------------------------------------------------------------

/** Guideline suggestions for the findings and impression text, most relevant first. */
export function suggestGuidelines(text: string, context: SuggestContext = {}): GuidelineSuggestion[] {
  const all = sentences(text)
  const out: GuidelineSuggestion[] = []
  const screening = SCREENING.test(`${context.indication ?? ''} ${context.technique ?? ''}`) || /\blung[- ]?rads\b/i.test(text)

  // Lung: one suggestion for the exam, driven by the largest nodule ("the most suspicious nodule guides management").
  const crossSectional = !context.radiograph
  const lung = !crossSectional ? [] : all.map((s) => ({ s, p: lungNodule(s) })).filter((x): x is { s: string; p: GuidelinePrefill } => x.p != null)
  if (lung.length) {
    const lead = lung.reduce((best, x) => ((x.p.size ?? -1) > (best.p.size ?? -1) ? x : best))
    const prefill = { ...lead.p, multiple: lung.length > 1 || lead.p.multiple || undefined }
    if (!prefill.multiple) delete prefill.multiple
    if (!screening) { delete prefill.status; delete prefill.juxtapleural; delete prefill.solidMm }
    const kind: GuidelineKind = screening ? 'lungRads' : 'fleischner'
    out.push({ id: `${kind}:${lead.s}`, kind, label: `${GUIDELINE_NAME[kind]} · ${lungLabel(prefill)}`, evidence: lead.s, prefill })
  }

  // Thyroid: ACR advises FNA of at most two nodules, so at most two suggestions.
  for (const s of all.filter((x) => THYROID.test(x) && affirmed(x, THYROID_LESION)).slice(0, 2)) {
    const dims = firstMeasurementMm(s)
    const prefill: GuidelinePrefill = { tirads: tiradsFeatures(s) }
    if (dims) prefill.size = maxCm(dims)
    out.push({ id: `tirads:${s}`, kind: 'tirads', label: `TI-RADS · thyroid nodule${prefill.size != null ? `, ${fmt(prefill.size)} cm` : ''}`, evidence: s, prefill })
  }

  for (const s of all.filter((x) => crossSectional && ADRENAL.test(x) && affirmed(x, ADRENAL_LESION)).slice(0, 2)) {
    const prefill = adrenalPrefill(s)
    const bits = [prefill.size != null ? `${fmt(prefill.size)} cm` : '', prefill.hu != null ? `${prefill.hu} HU unenhanced` : '', prefill.fat ? 'fat' : ''].filter(Boolean)
    out.push({ id: `adrenal:${s}`, kind: 'adrenal', label: `Adrenal · ${bits.length ? bits.join(', ') : 'mass'}`, evidence: s, prefill })
  }

  const renal = !crossSectional ? undefined : all.find((s) => BOSNIAK.test(s) || (/\b(renal|kidneys?)\b/i.test(s) && /\bcyst/i.test(s) && affirmed(s, RENAL_CYSTIC)))
  if (renal) {
    const raw = renal.match(BOSNIAK)?.[1].replace(/\s/g, '').toUpperCase()
    const cls = raw ? BOSNIAK_MAP[raw] : undefined
    out.push({ id: `bosniak:${renal}`, kind: 'bosniak', label: `Bosniak · ${cls ? `class ${cls}` : 'cystic renal mass'}`, evidence: renal, prefill: cls ? { bosniakClass: cls } : {} })
  }

  const breast = all.find((s) => BIRADS.test(s))
  if (breast) {
    const category = breast.match(BIRADS)![1].replace(/\s/g, '').toUpperCase() as BiradsCategory
    out.push({ id: `birads:${breast}`, kind: 'birads', label: `BI-RADS · category ${category}`, evidence: breast, prefill: { biradsCategory: category } })
  }
  return out
}

/** Drop suggestions already applied: one inserted sentence citing the guideline covers one suggestion of that kind. */
export function unappliedSuggestions(suggestions: GuidelineSuggestion[], recommendations: string): GuidelineSuggestion[] {
  const used: Partial<Record<GuidelineKind, number>> = {}
  for (const kind of Object.keys(GUIDELINE_SOURCE) as GuidelineKind[]) used[kind] = recommendations.split(GUIDELINE_SOURCE[kind]).length - 1
  return suggestions.filter((s) => {
    if ((used[s.kind] ?? 0) > 0) { used[s.kind]!--; return false }
    return true
  })
}
