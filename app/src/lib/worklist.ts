import { analysisEligibility } from './modality.ts'
import type { Study } from '../types'

/** Mutually exclusive reading states: a study sits in exactly one queue. */
export type WorklistStatus = 'unread' | 'review' | 'draft' | 'signed'
export type WorklistFilter = 'all' | WorklistStatus
export type WorklistSort = 'recent' | 'priority'
export type WorklistUrgency = '' | 'routine' | 'priority' | 'urgent'

/** Facets beyond the status pill. Empty strings mean "any". Dates are local yyyy-mm-dd, inclusive. */
export interface WorklistFacets {
  modality: string
  urgency: WorklistUrgency
  from: string
  to: string
}
export const NO_FACETS: WorklistFacets = { modality: '', urgency: '', from: '', to: '' }

export function needsReview(study: Study): boolean {
  return !study.report?.signed && study.images.some((image) => !!image.analysis)
}

export function studyStatus(study: Study): WorklistStatus {
  if (study.report?.signed) return 'signed'
  if (study.report) return 'draft'
  return needsReview(study) ? 'review' : 'unread'
}

/** Priority comes from the model's recorded urgency, never from a fabricated triage score. */
export function studyPriority(study: Study): number {
  return study.images.reduce((rank, image) => Math.max(rank,
    image.analysis?.urgency === 'urgent' ? 2 : image.analysis?.urgency === 'priority' ? 1 : 0), 0)
}

/** Model-flagged urgent candidates. A badge only: the reader still decides what is critical. */
export function hasUrgentCandidate(study: Study): boolean {
  return studyPriority(study) === 2
}

/** One label per modality family, from DICOM metadata first and the model's read second. */
export function modalityLabel(source: string | undefined): string {
  const value = source?.trim().toUpperCase() ?? ''
  if (!value) return ''
  if (['CR', 'DX', 'XR', 'DR'].includes(value) || /RADIOGRAPH|X-?RAY/.test(value)) return 'XR'
  if (value === 'CT' || /\bCT\b|COMPUTED TOMOGRAPHY/.test(value)) return 'CT'
  if (['MR', 'MRI'].includes(value) || /\bMRI?\b|MAGNETIC RESONANCE/.test(value)) return 'MR'
  if (value === 'US' || /ULTRASOUND/.test(value)) return 'US'
  return /^[A-Z]{2,4}$/.test(value) ? value : 'Other'
}

export function studyModalities(study: Study): string[] {
  const found = new Set<string>()
  for (const image of study.images) {
    const label = modalityLabel(image.sourceModality) || modalityLabel(image.analysis?.modality)
    if (label) found.add(label)
  }
  return [...found].sort()
}

/** Modalities present across the worklist, for the filter menu. */
export function worklistModalities(studies: Study[]): string[] {
  return [...new Set(studies.flatMap(studyModalities))].sort()
}

/** The study's own date when entered, else the day it was created (local time). */
export function studyDay(study: Study): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(study.patient.studyDate)) return study.patient.studyDate
  const d = new Date(study.createdAt)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function matchesFacets(study: Study, facets: WorklistFacets): boolean {
  if (facets.modality && !studyModalities(study).includes(facets.modality)) return false
  if (facets.urgency) {
    const rank = studyPriority(study)
    // 'routine' means analysed and not escalated; unread studies have no urgency to match.
    const wanted = facets.urgency === 'urgent' ? 2 : facets.urgency === 'priority' ? 1 : 0
    if (rank !== wanted || (wanted === 0 && !study.images.some((image) => image.analysis))) return false
  }
  const day = studyDay(study)
  if (facets.from && day < facets.from) return false
  if (facets.to && day > facets.to) return false
  return true
}

export function filterWorklist(studies: Study[], query: string, filter: WorklistFilter, sort: WorklistSort, facets: WorklistFacets = NO_FACETS): Study[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return studies.filter((study) => {
    const haystack = [study.title, study.patient.name, study.patient.patientId].join(' ').toLowerCase()
    return terms.every((term) => haystack.includes(term)) &&
      (filter === 'all' || studyStatus(study) === filter) && matchesFacets(study, facets)
  }).sort((a, b) => (sort === 'priority' ? studyPriority(b) - studyPriority(a) : 0) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

export interface WorklistView {
  query: string
  filter: WorklistFilter
  sort: WorklistSort
  facets: WorklistFacets
}

/**
 * The next unsigned study after `currentId` in the reader's current filtered and sorted order, wrapping
 * around. Call it with the list as the reader saw it (before signing reorders it by update time); the
 * current study itself is always skipped. Null when no other unsigned study is in view.
 */
export function nextStudy(studies: Study[], currentId: string | null, view: WorklistView): Study | null {
  const list = filterWorklist(studies, view.query, view.filter, view.sort, view.facets)
  const start = list.findIndex((s) => s.id === currentId)
  for (let step = 1; step <= list.length; step++) {
    const candidate = list[(start + step) % list.length]
    if (candidate.id !== currentId && !candidate.report?.signed) return candidate
  }
  return null
}

/** Neighbour in the visible list for N / Shift+N. No wrap, so the ends of the queue are obvious. */
export function adjacentStudy(list: Study[], currentId: string | null, direction: 1 | -1): Study | null {
  const index = list.findIndex((s) => s.id === currentId)
  if (index === -1) return list[direction === 1 ? 0 : list.length - 1] ?? null
  return list[index + direction] ?? null
}

export interface Turnaround {
  sinceCreated: number
  /** Since the most recent completed analysis; absent until a read finishes. */
  sinceAnalysis?: number
  overdue: boolean
}

/** Waiting time for unsigned studies. Signed and empty studies have nothing outstanding. */
export function turnaround(study: Study, now: number, thresholdMs: number): Turnaround | null {
  if (study.report?.signed || !study.images.length) return null
  const analysedAt = study.images.reduce((latest, image) => Math.max(latest, image.analysis?.createdAt ?? 0), 0)
  const sinceCreated = Math.max(0, now - study.createdAt)
  return { sinceCreated, ...(analysedAt ? { sinceAnalysis: Math.max(0, now - analysedAt) } : {}), overdue: thresholdMs > 0 && sinceCreated > thresholdMs }
}

export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h${minutes % 60 && hours < 10 ? ` ${minutes % 60}m` : ''}`
  return `${Math.floor(hours / 24)}d`
}

export const OVERDUE_CHOICES = [0, 1, 4, 24, 72] as const
export interface WorklistPrefs extends WorklistFacets {
  filter: WorklistFilter
  sort: WorklistSort
  /** Hours before an unsigned study is highlighted; 0 turns highlighting off. */
  overdueHours: number
}
export const DEFAULT_PREFS: WorklistPrefs = { ...NO_FACETS, filter: 'all', sort: 'recent', overdueHours: 4 }
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Stored preferences are untrusted: keep only known values so a stale or edited entry cannot break the list. */
export function parseWorklistPrefs(raw: string | null): WorklistPrefs {
  let data: Record<string, unknown> = {}
  try { const parsed = raw ? JSON.parse(raw) : null; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed } catch { /* fall back to defaults */ }
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback
  return {
    filter: pick(data.filter, ['all', 'unread', 'review', 'draft', 'signed'] as const, DEFAULT_PREFS.filter),
    sort: pick(data.sort, ['recent', 'priority'] as const, DEFAULT_PREFS.sort),
    urgency: pick(data.urgency, ['', 'routine', 'priority', 'urgent'] as const, ''),
    modality: typeof data.modality === 'string' && /^[A-Za-z]{0,8}$/.test(data.modality) ? data.modality : '',
    from: typeof data.from === 'string' && DAY.test(data.from) ? data.from : '',
    to: typeof data.to === 'string' && DAY.test(data.to) ? data.to : '',
    overdueHours: OVERDUE_CHOICES.includes(data.overdueHours as never) ? data.overdueHours as number : DEFAULT_PREFS.overdueHours,
  }
}

export function activeFacetCount(facets: WorklistFacets): number {
  return [facets.modality, facets.urgency, facets.from || facets.to].filter(Boolean).length
}

export function workflowLabel(study: Study): string {
  if (study.images.some((image) => image.status === 'analyzing')) return 'Analyzing'
  if (study.report?.signed) return 'Signed'
  if (study.images.some((image) => image.status === 'error')) return 'Analysis error'
  if (!study.images.length) return 'Add images'
  if (study.report) return 'Draft report'
  if (study.images.every((image) => !analysisEligibility(image).supported)) return 'Preview only'
  if (needsReview(study)) return 'Review findings'
  return 'Ready to analyze'
}
