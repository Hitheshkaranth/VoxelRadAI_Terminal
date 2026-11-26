// Follow-up recommendation tracking. Recommendation sentences that ask for further imaging or review are pulled
// out as structured items; the reader marks each one Track or Decline before signing, tracked ones get a due date
// at sign-off, and the worklist shows them until marked done. Text heuristics only: the reader confirms every item.
// Imported by scripts/test-follow-ups.ts: runtime imports need .ts extensions.
import type { FollowUp, ReportDraft, Study } from '../types.ts'
import { sentences } from './reportQa.ts'

const DAY_MS = 86400000
const MONTH_DAYS = 30.4375
/** Tracked items due within this many days count as "due soon". */
export const DUE_SOON_DAYS = 30

const MODALITIES: [string, RegExp][] = [
  ['PET-CT', /\bPET(?:[\s/-]*CT)?\b/i],
  ['CT', /\b(?:CT|computed tomography|CTA|HRCT)\b/i],
  ['MRI', /\b(?:MRI?|MRCP|magnetic resonance)\b/i],
  // "US" only in capitals, so the word "us" never reads as ultrasound.
  ['Ultrasound', /\b(?:[Uu]ltrasound|ULTRASOUND|US|[Ss]onograph\w*|[Dd]oppler)\b/],
  ['Mammography', /\bmammogra\w*\b/i],
  ['X-ray', /\b(?:x-?ray|radiograph\w*|CXR)\b/i],
]
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, nine: 9, ten: 10, twelve: 12, eighteen: 18, twenty: 20, 'twenty-four': 24 }
const NUM = `(\\d+(?:\\.\\d+)?|${Object.keys(WORDS).join('|')})`
const INTERVAL = new RegExp(`\\b${NUM}(?:\\s*(?:-|–|to)\\s*${NUM})?[\\s-]*(day|week|wk|month|mo|year|yr)s?\\b`, 'i')
const ANNUAL = /\b(annual(?:ly)?|yearly)\b/i
const ASKS = /\b(follow[\s-]?up|repeat|recommend\w*|suggest\w*|consider|re-?evaluat\w*|reassess\w*|re-?image|surveillance|interval|correlat\w*|biopsy|sampling|referral|refer|for (?:further )?(?:evaluation|characteri[sz]ation|assessment))\b/i
const DECLINES = /\b(no (?:routine |further |imaging )*(?:follow[\s-]?up|imaging|surveillance)|not (?:needed|required|recommended|indicated)|none (?:needed|required))\b/i
const TO_MONTHS: Record<string, number> = { day: 1 / MONTH_DAYS, week: 7 / MONTH_DAYS, wk: 7 / MONTH_DAYS, month: 1, mo: 1, year: 12, yr: 12 }

const num = (s: string) => WORDS[s.toLowerCase()] ?? Number(s)
const round = (n: number) => Math.round(n * 100) / 100

/** Stable identity for a recommendation, so a decision survives small edits like spacing or a trailing full stop. */
export function followUpId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** One recommendation sentence → a structured follow-up, or null when it does not ask for one. */
export function parseFollowUp(sentence: string): FollowUp | null {
  const text = sentence.trim()
  if (!text || DECLINES.test(text)) return null
  const modality = MODALITIES.find(([, re]) => re.test(text))?.[0]
  const m = INTERVAL.exec(text)
  let minMonths: number | undefined
  let maxMonths: number | undefined
  if (m) {
    const unit = TO_MONTHS[m[3].toLowerCase()]
    minMonths = round(num(m[1]) * unit)
    if (m[2]) maxMonths = round(num(m[2]) * unit)
  } else if (ANNUAL.test(text)) minMonths = 12
  // Needs both something to do and a reason to think it is a request: "CT in 3 months", "Recommend MRI".
  if (!(modality || /\b(follow[\s-]?up|biopsy|sampling|referral|refer)\b/i.test(text))) return null
  if (minMonths === undefined && !ASKS.test(text)) return null
  return { id: followUpId(text), text, ...(modality ? { modality } : {}), ...(minMonths !== undefined ? { minMonths } : {}), ...(maxMonths !== undefined ? { maxMonths } : {}) }
}

/** Follow-ups requested in the report's recommendations and impression, in reading order, without duplicates. */
export function extractFollowUps(report: Pick<ReportDraft, 'recommendations' | 'impression'>): FollowUp[] {
  const seen = new Set<string>()
  const out: FollowUp[] = []
  for (const sentence of [...sentences(report.recommendations ?? ''), ...sentences(report.impression ?? '')]) {
    const item = parseFollowUp(sentence)
    if (item && !seen.has(item.id)) { seen.add(item.id); out.push(item) }
  }
  return out
}

/** The report's current follow-ups: re-extracted from the text, keeping decisions already made on the same sentence. */
export function syncFollowUps(report: Pick<ReportDraft, 'recommendations' | 'impression' | 'followUps'>): FollowUp[] {
  const previous = new Map((report.followUps ?? []).map((f) => [f.id, f]))
  return extractFollowUps(report).map((item) => {
    const old = previous.get(item.id)
    return old ? { ...item, ...(old.decision ? { decision: old.decision } : {}), ...(old.dueAt ? { dueAt: old.dueAt } : {}), ...(old.completedAt ? { completedAt: old.completedAt } : {}) } : item
  })
}

/** Items with no Track / Decline decision yet. Signing past them is allowed but listed in the pre-sign checklist. */
export const undecidedFollowUps = (items: readonly FollowUp[]) => items.filter((f) => !f.decision)

/** Due date for a tracked item from the sign-off time, using the earliest interval stated. */
export function dueDate(item: FollowUp, signedAt: number): number | undefined {
  return item.minMonths === undefined ? undefined : signedAt + Math.round(item.minMonths * MONTH_DAYS) * DAY_MS
}

/** Follow-ups frozen at sign-off: tracked items get a due date (kept from an earlier signature when re-signed). */
export function signFollowUps(report: Pick<ReportDraft, 'recommendations' | 'impression' | 'followUps'>, signedAt: number): FollowUp[] {
  return syncFollowUps(report).map((f) => {
    if (f.decision !== 'track' || f.dueAt) return f
    const due = dueDate(f, signedAt)
    return due ? { ...f, dueAt: due } : f
  })
}

export type FollowUpStatus = 'undecided' | 'declined' | 'completed' | 'overdue' | 'due-soon' | 'scheduled' | 'undated'

export function followUpStatus(item: FollowUp, now: number): FollowUpStatus {
  if (!item.decision) return 'undecided'
  if (item.decision === 'declined') return 'declined'
  if (item.completedAt) return 'completed'
  if (!item.dueAt) return 'undated'
  if (item.dueAt < now) return 'overdue'
  return item.dueAt - now <= DUE_SOON_DAYS * DAY_MS ? 'due-soon' : 'scheduled'
}

/** Open (tracked, not done) follow-ups on a signed study, earliest due first; undated ones last. */
export function openFollowUps(study: Study): FollowUp[] {
  if (!study.report?.signed) return []
  return (study.report.followUps ?? []).filter((f) => f.decision === 'track' && !f.completedAt)
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
}

/** Worklist badge state for a study: the most pressing open follow-up, if any. */
export function studyFollowUp(study: Study, now: number): { item: FollowUp; status: FollowUpStatus; count: number } | null {
  const open = openFollowUps(study)
  return open.length ? { item: open[0], status: followUpStatus(open[0], now), count: open.length } : null
}

export type FollowUpFacet = '' | 'open' | 'due'

/** Worklist facet: 'open' = any tracked follow-up not done; 'due' = overdue or due within DUE_SOON_DAYS. */
export function matchesFollowUpFacet(study: Study, facet: FollowUpFacet, now: number): boolean {
  if (!facet) return true
  const state = studyFollowUp(study, now)
  if (!state) return false
  return facet === 'open' || state.status === 'overdue' || state.status === 'due-soon'
}

/** "CT · 3–6 mo" style summary for chips. Whole weeks under 3 months read as weeks, whole years as years. */
export function intervalLabel(item: FollowUp): string {
  const unit = (m: number): [number, string] => {
    const weeks = (m * MONTH_DAYS) / 7
    if (m < 3 && (!Number.isInteger(m) || m < 1) && Math.abs(weeks - Math.round(weeks)) < 0.05) return [Math.round(weeks), 'wk']
    if (m < 1) return [Math.round(m * MONTH_DAYS), 'd']
    if (m >= 12 && m % 12 === 0) return [m / 12, 'yr']
    return [m, 'mo']
  }
  let range = ''
  if (item.minMonths !== undefined) {
    const [a, ua] = unit(item.minMonths)
    if (item.maxMonths === undefined) range = `${a} ${ua}`
    else {
      const [b, ub] = unit(item.maxMonths)
      range = ua === ub ? `${a}–${b} ${ub}` : `${a} ${ua}–${b} ${ub}`
    }
  }
  return [item.modality, range].filter(Boolean).join(' · ') || 'Follow-up'
}

export function formatDue(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
