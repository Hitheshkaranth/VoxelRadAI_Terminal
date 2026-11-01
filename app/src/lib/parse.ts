// OWNER: Agent 1 (AI engine). Robust, pure JSON extraction + normalisation. DOM-free so Node can
// import it (see scripts/test-parse.ts). The id resolver uses crypto.randomUUID() — identical to
// store's uid().

import type { AnalysisResult, BBox, Finding, Severity } from '../types'

export interface NormalizationMeta {
  rawText: string
  model: string
  durationMs: number
  /** The output was cut off (closing brackets appended, or the server reported finish_reason "length"). */
  truncated?: boolean
}

// ---- JSON extraction -------------------------------------------------------

export interface JsonExtraction {
  value: unknown
  /** Quote / trailing-comma repair was needed before the fragment parsed. */
  repaired: boolean
  /** The fragment was unbalanced (truncated stream) and closing brackets were appended. */
  closedContainers: boolean
}

/**
 * Extract a JSON value from messy text (markdown fences, leading/trailing prose, trailing commas,
 * smart quotes, and truncated streams). Returns the parsed value. Throws when no object/array can
 * be found. Pure and DOM-free.
 */
export function extractJson(text: string): unknown {
  return extractJsonWithInfo(text).value
}

/**
 * As extractJson, but reports which repairs were needed. Valid JSON is always parsed as-is first;
 * repairs only run when that fails, so they can never corrupt a valid value.
 */
export function extractJsonWithInfo(text: string): JsonExtraction {
  const src = typeof text === 'string' ? text : ''
  if (!src.trim()) throw new Error('No JSON content found in model output.')

  const raw = balancedFragment(src)
  try {
    return { value: JSON.parse(raw.fragment), repaired: false, closedContainers: false }
  } catch {
    // fall through to repair
  }

  // Re-scan after quote repair so braces inside curly-quoted strings are not miscounted.
  const fixed = balancedFragment(repairQuotes(src))
  const repaired = dropTrailingCommas(fixed.fragment)
  try {
    return { value: JSON.parse(repaired), repaired: true, closedContainers: false }
  } catch {
    // fall through to truncation repair
  }

  // A balanced fragment that still fails is malformed, not truncated: never cut content from it.
  if (fixed.balanced) throw new Error('Unable to parse JSON from model output.')
  for (const candidate of truncationCandidates(repaired)) {
    const closed = closeOpenContainers(candidate)
    if (closed === candidate) continue
    try {
      return { value: JSON.parse(dropTrailingCommas(closed)), repaired: true, closedContainers: true }
    } catch {
      // try a shorter prefix
    }
  }
  throw new Error('Unable to parse JSON from model output.')
}

/** First balanced {…}/[…] fragment (string-aware, backticks skipped), or the unbalanced tail. */
function balancedFragment(src: string): { fragment: string; balanced: boolean } {
  let out = ''
  let inString = false
  let escape = false
  let depth = 0
  let started = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inString) {
      out += ch
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '`') continue // skip fence/backtick characters
    if (ch === '"') {
      if (started) out += ch
      inString = started
      continue
    }
    if (ch === '{' || ch === '[') {
      depth++
      started = true
      out += ch
      continue
    }
    if (ch === '}' || ch === ']') {
      if (depth > 0) depth--
      if (started) out += ch
      if (started && depth === 0) return { fragment: out, balanced: true }
      continue
    }
    if (started) out += ch
  }
  return { fragment: started ? out : src.trim(), balanced: false }
}

const SMART_DQ = /[\u201C\u201D\u201E\u201F]/
const OPEN_CTX = new Set(['{', '[', ',', ':'])
const CLOSE_CTX = new Set(['}', ']', ',', ':'])

function prevNonSpace(s: string, i: number): string {
  for (let j = i - 1; j >= 0; j--) if (!/\s/.test(s[j])) return s[j]
  return ''
}
function nextNonSpace(s: string, i: number): string {
  for (let j = i + 1; j < s.length; j++) if (!/\s/.test(s[j])) return s[j]
  return ''
}

/**
 * Map curly / low-9 double quotes to '"' only where they act as JSON delimiters (opening after
 * `{ [ , :`, closing before `} ] , :` or end of text). Smart quotes inside a curly-delimited
 * string value become escaped \". Smart quotes inside a straight-quoted string are valid JSON and
 * are left untouched. Superscripts (², ³) and primes are never touched.
 */
function repairQuotes(s: string): string {
  let out = ''
  let inString: '' | 'straight' | 'smart' = ''
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const smart = SMART_DQ.test(ch)
    if (inString) {
      if (escape) {
        escape = false
        out += ch
        continue
      }
      if (ch === '\\') {
        escape = true
        out += ch
        continue
      }
      const closes = CLOSE_CTX.has(nextNonSpace(s, i)) || nextNonSpace(s, i) === ''
      if (ch === '"') {
        if (inString === 'straight' || closes) inString = ''
        out += inString ? '\\"' : '"'
        continue
      }
      if (smart && inString === 'smart') {
        if (closes) {
          inString = ''
          out += '"'
        } else out += '\\"'
        continue
      }
      out += ch
      continue
    }
    if (ch === '"') {
      inString = 'straight'
      out += ch
      continue
    }
    if (smart && (OPEN_CTX.has(prevNonSpace(s, i)) || prevNonSpace(s, i) === '')) {
      inString = 'smart'
      out += '"'
      continue
    }
    out += ch
  }
  return out
}

/** Remove commas directly before `}` / `]` (string-aware). */
function dropTrailingCommas(s: string): string {
  let out = ''
  let inString = false
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      out += ch
      continue
    }
    if (ch === '"') inString = true
    if (ch === ',') {
      const nx = nextNonSpace(s, i)
      if (nx === '}' || nx === ']') continue
    }
    out += ch
  }
  return out
}

/**
 * Prefixes to try when closing a truncated fragment: the whole thing first, then cut back to each
 * structural comma (newest first) so a dangling key or half-written value is dropped.
 */
function truncationCandidates(s: string): string[] {
  const cuts: number[] = []
  let inString = false
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === ',') cuts.push(i)
  }
  return [s, ...cuts.reverse().slice(0, 40).map((i) => s.slice(0, i))]
}

/** Append `]`/`}` to balance a truncated (unclosed) JSON fragment. String-aware. */
function closeOpenContainers(s: string): string {
  let inString = false
  let escape = false
  const stack: string[] = []
  for (const ch of s) {
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}') stack.pop()
    else if (ch === ']') stack.pop()
  }
  // Close the open string first (it is the innermost, last-opened token), then containers LIFO.
  return s + (inString ? '"' : '') + stack.reverse().join('')
}

// ---- Small coercion helpers ------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asString(v: unknown, def = ''): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return def
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function asConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  if (!Number.isFinite(n)) return 0.5
  const scaled = n > 1 ? n / 100 : n
  return clamp01(scaled)
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

/** Round to 6 decimal places to cancel floating-point division artefacts (e.g. 0.30000000000000004). */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

const SEVERITIES: Severity[] = ['critical', 'significant', 'moderate', 'minor', 'normal']

function mapSeverity(raw: unknown): Severity {
  const s = asString(raw).toLowerCase().trim()
  if (!s) return 'minor'
  if (SEVERITIES.includes(s as Severity)) return s as Severity
  const synonyms: Record<string, Severity> = {
    severe: 'significant',
    serious: 'significant',
    high: 'significant',
    criticals: 'critical',
    urgent: 'critical',
    'life-threatening': 'critical',
    'life threatening': 'critical',
    emergency: 'critical',
    moderate2: 'moderate',
    mild: 'minor',
    minimal: 'minor',
    low: 'minor',
    incidental: 'minor',
    none: 'normal',
    nil: 'normal',
    normal: 'normal',
    unremarkable: 'normal',
    'no abnormality': 'normal',
    'no finding': 'normal',
  }
  return synonyms[s] ?? 'minor'
}

export function toBBox(raw: unknown): BBox | undefined {
  if (raw == null) return undefined

  // Bare [ymin, xmin, ymax, xmax] array.
  if (Array.isArray(raw) && raw.length === 4) {
    const d = fromPair(asNumber(raw[0]), asNumber(raw[1]), asNumber(raw[2]), asNumber(raw[3]))
    if (d) return d
  }

  if (!isObject(raw)) return undefined

  // {box_2d:[ymin,xmin,ymax,xmax]} 0..1000
  const b2d = raw.box_2d
  if (Array.isArray(b2d) && b2d.length === 4) {
    const d = fromPair(asNumber(b2d[0]), asNumber(b2d[1]), asNumber(b2d[2]), asNumber(b2d[3]))
    if (d) return d
  }

  // {bbox:[x,y,w,h]} at 0..1
  const bb = raw.bbox
  if (Array.isArray(bb) && bb.length === 4 && bb.every((n) => typeof n === 'number')) {
    const d = direct(bb[0], bb[1], bb[2], bb[3])
    if (d) return d
  }
  if (isObject(bb) && 'x' in bb && 'y' in bb && 'w' in bb && 'h' in bb) {
    const d = direct(asNumber(bb.x), asNumber(bb.y), asNumber(bb.w), asNumber(bb.h))
    if (d) return d
  }

  // {ymin,xmin,ymax,xmax} keys
  if ([raw.ymin, raw.xmin, raw.ymax, raw.xmax].every((n) => typeof n === 'number')) {
    const d = fromPair(asNumber(raw.ymin), asNumber(raw.xmin), asNumber(raw.ymax), asNumber(raw.xmax))
    if (d) return d
  }
  return undefined
}

function asNumber(v: unknown): number {
  return typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
}

/** [ymin,xmin,ymax,xmax] either 0..1 or 0..1000; swaps inverted coords, clips to 0..1. */
function fromPair(ymin: number, xmin: number, ymax: number, xmax: number): BBox | undefined {
  let [a, b, c, d] = [asNumber(ymin), asNumber(xmin), asNumber(ymax), asNumber(xmax)]
  if (Math.max(a, b, c, d) > 1.001) {
    ;[a, b, c, d] = [a / 1000, b / 1000, c / 1000, d / 1000]
  }
  let [y0, x0, y1, x1] = [a, b, c, d]
  if (y0 > y1) [y0, y1] = [y1, y0]
  if (x0 > x1) [x0, x1] = [x1, x0]
  return direct(x0, y0, x1 - x0, y1 - y0)
}

/** x,y absolute; w,h widths. Clamps, clips, and drops degenerate / out-of-range boxes. */
function direct(x: number, y: number, w: number, h: number): BBox | undefined {
  const nx = round6(clamp01(asNumber(x)))
  const ny = round6(clamp01(asNumber(y)))
  let nw = Math.max(0, round6(asNumber(w)))
  let nh = Math.max(0, round6(asNumber(h)))
  if (nw <= 0 || nh <= 0) return undefined
  if (nx + nw > 1) nw = 1 - nx
  if (ny + nh > 1) nh = 1 - ny
  return { x: round6(nx), y: round6(ny), w: round6(nw), h: round6(nh) }
}

// "line" and "lead" alone are not enough: Kerley B lines, the pleural line and the line of the
// diaphragm are anatomy or pathology. A line needs device context (central, PICC, venous, ...).
const DEVICE_RX = /pacemaker|defibrillator|\bicd\b|(pacing|pacemaker|cardiac|monitoring|ecg|ekg) (wires?|leads?)|catheter|\bpicc\b|port-?a-?cath|(chest|chemo(therapy)?|implanted|subcutaneous|venous access|infusion) port|(central|venous|arterial|picc|midline|hickman|dialysis|swan[- ]?ganz|jugular|ij|subclavian) (venous )?lines?|endotracheal|\bet tube|tracheostomy|nasogastric|\bng tube|feeding tube|chest (tube|drain)|sternotomy|surgical clips?|\bclips?\b|sternal wires?|\bwires?\b|prosthe|hardware|stent|valve replacement|electrode/i
function isDevice(title: string, category: string): boolean {
  return /device|tube|hardware|lines?\s*(\/|&|and)/i.test(category) || DEVICE_RX.test(title)
}

function normalizeFinding(raw: unknown, index: number): Finding {
  if (!isObject(raw)) {
    return {
      id: uid(),
      title: `Finding ${index + 1}`,
      description: '',
      severity: 'minor',
      confidence: 0.5,
      location: '',
      category: '',
    }
  }
  const title = asString(raw.title, `Finding ${index + 1}`)
  const category = asString(raw.category)
  let severity = mapSeverity(raw.severity)
  // Support devices in a satisfactory position are not pathology: the model tends to report them as
  // "minor", which inflates abnormal counts and urgency. Malpositioned devices (moderate+) keep their severity.
  if (severity === 'minor' && isDevice(title, category)) severity = 'normal'
  return {
    id: uid(),
    title,
    description: asString(raw.description) || asString(raw.evidence),
    severity,
    confidence: asConfidence(raw.confidence),
    location: asString(raw.location),
    bbox: toBBox(raw.box_2d ?? raw.bbox),
    mask: typeof raw.mask_png === 'string' && raw.mask_png.startsWith('data:image/png;base64,') ? raw.mask_png : undefined,
    category: category || (isDevice(title, '') ? 'Devices' : ''),
    recommendation: asString(raw.recommendation),
  }
}

function toTextList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean)
  const s = asString(v)
  return s ? [s] : []
}

export function deriveUrgency(findings: Finding[]): AnalysisResult['urgency'] {
  if (findings.some((f) => f.severity === 'critical')) return 'urgent'
  if (findings.some((f) => f.severity === 'significant')) return 'priority'
  return 'routine'
}

export function sortBySeverity(list: Finding[]): Finding[] {
  const rank = (s: Severity) => SEVERITIES.indexOf(s)
  return [...list].sort((a, b) => {
    const d = rank(a.severity) - rank(b.severity)
    return d !== 0 ? d : b.confidence - a.confidence
  })
}

/**
 * Coerce an arbitrary model object into a typed AnalysisResult with safe defaults. Pure.
 * A top-level array of finding objects is read as the findings list. Anything without a findings array throws the
 * parse error (so the caller retries) rather than turning an unreadable answer into a normal read.
 */
export function normalizeAnalysis(input: unknown, meta: NormalizationMeta): AnalysisResult {
  // A bare array is accepted only when it is a non-empty list of finding objects: `[]` or a list of
  // strings says nothing about the image and must not become a normal read.
  const listOfFindings = Array.isArray(input) && input.length > 0 && input.every(isObject)
  const obj = listOfFindings ? { findings: input } : input
  if (!isObject(obj) || !Array.isArray(obj.findings)) throw new Error('Unable to parse JSON from model output.')
  const findings = sortBySeverity(asArray(obj.findings).map((f, i) => normalizeFinding(f, i)))
  return {
    modality: asString(obj.modality, 'Radiograph (X-ray)'),
    bodyPart: asString(obj.bodyPart, 'Chest'),
    view: asString(obj.view, 'Unknown'),
    imageQuality: asString(obj.imageQuality, 'Adequate'),
    findings,
    pertinentNegatives: toTextList(obj.pertinentNegatives),
    impression: asString(obj.impression),
    recommendations: toTextList(obj.recommendations),
    differential: toTextList(obj.differential),
    urgency: deriveUrgency(findings),
    rawText: meta.rawText,
    model: meta.model,
    durationMs: meta.durationMs,
    createdAt: Date.now(),
    ...(meta.truncated ? { truncated: true } : {}),
  }
}

// ---- Report normalisation --------------------------------------------------

export interface ReportFields {
  technique: string
  comparison: string
  findings: string
  impression: string
  recommendations: string
}

/** Turn a raw report object into five clean strings (arrays joined by newlines; impression numbered). */
export function normalizeReport(obj: unknown): ReportFields {
  if (!isObject(obj)) {
    return {
      technique: '',
      comparison: 'None available.',
      findings: '',
      impression: '',
      recommendations: '',
    }
  }
  const impression = numbered(impressionLines(obj.impression))
  const findings = toTextList(obj.findings).join('\n')
  return {
    technique: asString(obj.technique, 'Standard radiographic technique.') || '',
    comparison: asString(obj.comparison, 'None available.') || 'None available.',
    findings,
    impression,
    recommendations: toTextList(obj.recommendations).join('\n'),
  }
}

function impressionLines(v: unknown): string[] {
  const raw = typeof v === 'string' ? v.split(/\r?\n/) : toTextList(v)
  return raw.map((l) => l.replace(/^\s*\d+[\s.)-]+\s*/, '').trim()).filter(Boolean)
}

function numbered(lines: string[]): string {
  return lines.map((line, i) => `${i + 1}. ${line.trim()}`).join('\n')
}

// ---- id generation (Node-compatible) ---------------------------------------

function uid(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `f${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}
// ---- Lung-pattern second pass ---------------------------------------------

export interface LungPattern {
  grade: 0 | 1 | 2 | 3
  evidence: string
}

export function parseLungPattern(obj: unknown): LungPattern | null {
  if (!isObject(obj)) return null
  const g = Math.round(asNumber(obj.grade))
  if (!(g >= 0 && g <= 3)) return null
  return { grade: g as LungPattern['grade'], evidence: asString(obj.evidence) }
}

const PATTERN_COVERED = /bronchovascular|perihilar|interstitial|o?edema|cuffing|kerley|congestion|reticul|ground.glass|air.?space|markings/i

/** Adds a diffuse lung-pattern finding when the graded check is abnormal and the main read didn't already report one. Pure. */
export function mergeLungPattern(a: AnalysisResult, p: LungPattern | null): AnalysisResult {
  if (!p || p.grade < 2 || !/chest|thora|lung/i.test(a.bodyPart)) return a
  if (a.findings.some((f) => f.severity !== 'normal' && PATTERN_COVERED.test(`${f.title} ${f.description}`))) return a
  const marked = p.grade === 3
  const extra: Finding = {
    id: uid(),
    title: marked ? 'Extensive perihilar / interstitial opacity' : 'Increased bronchovascular markings / perihilar opacity',
    description: p.evidence || 'Bronchovascular markings appear increased or indistinct in the perihilar regions.',
    severity: marked ? 'significant' : 'moderate',
    confidence: marked ? 0.75 : 0.6,
    location: 'Perihilar regions, bilateral',
    category: 'Lungs',
    recommendation: 'Correlate clinically (infection, bronchitis, fluid overload); radiologist review of lung markings.',
  }
  // Drop a lone "Normal study" placeholder — the study is no longer being called normal.
  const kept = a.findings.filter((f) => !(f.severity === 'normal' && /normal/i.test(f.title)))
  const findings = sortBySeverity([...kept, extra])
  const note = `Graded lung-pattern review: ${extra.title.toLowerCase()}.`
  return { ...a, findings, impression: a.impression ? `${a.impression}\n${note}` : note, urgency: deriveUrgency(findings) }
}
