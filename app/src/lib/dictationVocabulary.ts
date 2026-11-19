// Radiology vocabulary for dictation: fixes common speech-recognition mis-hearings after transcription,
// plus a per-browser custom word list. Learned replacements are only suggested; the user must confirm them.

export interface VocabularyEntry {
  /** What the recogniser writes. Empty means "just bias recognition towards `to`". */
  from: string
  to: string
}

// Lower-case "heard" phrase -> intended term. Spaces in a key also match hyphens.
const BUILTIN: Array<[string, string]> = [
  // Chest
  ['plural effusions', 'pleural effusions'],
  ['plural effusion', 'pleural effusion'],
  ['plural thickening', 'pleural thickening'],
  ['plural space', 'pleural space'],
  ['plural fluid', 'pleural fluid'],
  ['new mo thorax', 'pneumothorax'],
  ['new motor ax', 'pneumothorax'],
  ['new mothorax', 'pneumothorax'],
  ['numo thorax', 'pneumothorax'],
  ['neumo thorax', 'pneumothorax'],
  ['pneumo thorax', 'pneumothorax'],
  ['neumothorax', 'pneumothorax'],
  ['a telectasis', 'atelectasis'],
  ['at electasis', 'atelectasis'],
  ['atelectesis', 'atelectasis'],
  ['attelectasis', 'atelectasis'],
  ['ground glass capacities', 'ground-glass opacities'],
  ['ground glass capacity', 'ground-glass opacity'],
  ['ground glass opacities', 'ground-glass opacities'],
  ['ground glass opacity', 'ground-glass opacity'],
  ['cardio megaly', 'cardiomegaly'],
  ['cardiac megaly', 'cardiomegaly'],
  ['costo phrenic', 'costophrenic'],
  ['costa frenic', 'costophrenic'],
  ['costo frenic', 'costophrenic'],
  ['media stinum', 'mediastinum'],
  ['media steinum', 'mediastinum'],
  ['media stinal', 'mediastinal'],
  ['bronchi ectasis', 'bronchiectasis'],
  ['bronco ectasis', 'bronchiectasis'],
  ['bronchiectesis', 'bronchiectasis'],
  ['consolidaton', 'consolidation'],
  ['opecity', 'opacity'],
  ['opasity', 'opacity'],
  ['nodual', 'nodule'],
  ['lymph adeno pathy', 'lymphadenopathy'],
  ['lymph adenopathy', 'lymphadenopathy'],
  // Densities and signal
  ['hyper dense', 'hyperdense'],
  ['hypo dense', 'hypodense'],
  ['iso dense', 'isodense'],
  ['hyper intense', 'hyperintense'],
  ['hypo intense', 'hypointense'],
  ['hyper echoic', 'hyperechoic'],
  ['hypo echoic', 'hypoechoic'],
  ['an echoic', 'anechoic'],
  ['hounds field', 'Hounsfield'],
  ['hans field', 'Hounsfield'],
  // Neuro
  ['sub dural', 'subdural'],
  ['extra dural', 'extradural'],
  ['sub arachnoid', 'subarachnoid'],
  ['intra parenchymal', 'intraparenchymal'],
  ['paren chyma', 'parenchyma'],
  ['parenkyma', 'parenchyma'],
  ['peri ventricular', 'periventricular'],
  ['ventricals', 'ventricles'],
  ['sul sigh', 'sulci'],
  ['infraction', 'infarction'],
  ['infract', 'infarct'],
  ['para nasal', 'paranasal'],
  // Abdomen and MSK
  ['hepato spleno megaly', 'hepatosplenomegaly'],
  ['hepato megaly', 'hepatomegaly'],
  ['spleno megaly', 'splenomegaly'],
  ['hydro nephrosis', 'hydronephrosis'],
  ['hydro ureter', 'hydroureter'],
  ['spondy losis', 'spondylosis'],
  ['spondylo sis', 'spondylosis'],
  ['osteo phytes', 'osteophytes'],
  ['bila teral', 'bilateral'],
  ['un remarkable', 'unremarkable'],
  // Indian-English spellings and spoken abbreviations
  ['hemorrage', 'haemorrhage'],
  ['hamrage', 'haemorrhage'],
  ['haemorrage', 'haemorrhage'],
  ['h r c t', 'HRCT'],
  ['c e c t', 'CECT'],
  ['n c c t', 'NCCT'],
  ['u s g', 'USG'],
  ['m r i', 'MRI'],
  ['c t', 'CT'],
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const pattern = (from: string) => new RegExp(`(?<![\\p{L}\\p{N}])${from.trim().split(/[\s-]+/).map(escape).join('[\\s-]+')}(?![\\p{L}\\p{N}])`, 'giu')
const BUILTIN_PATTERNS = BUILTIN.map(([from, to]) => [pattern(from), to] as const)

/** Keep a capital the recogniser put at the start of a sentence. */
function matchCase(found: string, to: string) {
  return /^\p{Lu}/u.test(found) && /^\p{Ll}/u.test(to) ? to[0].toUpperCase() + to.slice(1) : to
}

/** Apply the user's list first (it wins over built-ins), longest phrases first so they beat their own fragments. */
export function applyVocabulary(text: string, custom: VocabularyEntry[] = []): string {
  const user = custom.filter((e) => e.from.trim() && e.to.trim()).sort((a, b) => b.from.length - a.from.length)
  let out = text
  for (const entry of user) out = out.replace(pattern(entry.from), (m) => matchCase(m, entry.to.trim()))
  for (const [re, to] of BUILTIN_PATTERNS) out = out.replace(re, (m) => matchCase(m, to))
  return out
}

/** Terms to send to the recogniser as hints. */
export function vocabularyKeyterms(custom: VocabularyEntry[]): string[] {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const { to } of custom) {
    const term = to.trim()
    if (term && !seen.has(term.toLowerCase())) { seen.add(term.toLowerCase()); terms.push(term) }
  }
  return terms
}

const words = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' ').split(/\s+/).filter(Boolean)

function similarity(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = row[j]
      row[j] = next
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length, 1)
}

/**
 * Compare a phrase that was undone with what the user said or typed instead, and propose the replacement
 * that would have fixed it. Returns null when the two are unrelated (the user simply dictated something else).
 */
export function suggestReplacement(heard: string, corrected: string): VocabularyEntry | null {
  const a = words(heard)
  const b = words(corrected)
  if (!a.length || !b.length) return null
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  let s = 0
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++
  const from = a.slice(p, a.length - s).join(' ')
  const to = b.slice(p, b.length - s).join(' ')
  if (!from || !to || from === to) return null
  if (a.length - p - s > 4 || b.length - p - s > 4) return null
  // Either the rest of the phrase matches, or the changed words sound alike on their own.
  const shared = p + s >= Math.max(1, Math.floor(Math.min(a.length, b.length) / 2))
  if (!shared && similarity(from.replace(/\s+/g, ''), to.replace(/\s+/g, '')) < 0.6) return null
  return { from, to }
}

const STORAGE_KEY = 'voxelrad.dictationVocabulary'
const MAX_ENTRIES = 200

export function loadVocabulary(): VocabularyEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string' && e.to.trim())
      .slice(0, MAX_ENTRIES)
      .map((e) => ({ from: e.from.slice(0, 80), to: e.to.slice(0, 80) }))
  } catch {
    return []
  }
}

export function saveVocabulary(entries: VocabularyEntry[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES))) } catch { /* optional preference */ }
}

/** Add or replace the entry for the same heard phrase (or the same hint term). */
export function upsertVocabulary(entries: VocabularyEntry[], entry: VocabularyEntry): VocabularyEntry[] {
  const from = entry.from.trim()
  const to = entry.to.trim()
  if (!to) return entries
  const key = (e: VocabularyEntry) => (e.from.trim() ? `f:${e.from.trim().toLowerCase()}` : `t:${e.to.trim().toLowerCase()}`)
  const next = { from, to }
  return [next, ...entries.filter((e) => key(e) !== key(next))].slice(0, MAX_ENTRIES)
}
