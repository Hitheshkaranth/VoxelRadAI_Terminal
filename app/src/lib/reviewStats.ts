import type { Study } from '../types.ts'

// Reviewer decisions on model findings: quality tracking and de-identified exports for model training.
// Mirrors server/src/reviewExport.mjs so browser-only and organization views report the same numbers.

export type ReviewOutcome = 'accepted' | 'dismissed' | 'unreviewed'
export interface ReviewCounts { total: number; accepted: number; dismissed: number; unreviewed: number }
export interface ReviewGroup extends ReviewCounts { name: string }
export interface ReviewSummary { totals: ReviewCounts; byModality: ReviewGroup[]; byCategory: ReviewGroup[]; byModel: ReviewGroup[]; reports: { signed: number; edited: number } }

export function modalityGroup(sourceModality?: string, analysisModality?: string): string {
  const value = `${sourceModality || ''} ${analysisModality || ''}`
  if (/\b(CR|DX|MG)\b|x-?ray|radiograph/i.test(value)) return 'X-ray'
  if (/\bCT\b|computed tomograph/i.test(value)) return 'CT'
  if (/\bMR\b|\bMRI\b|magnetic resonance/i.test(value)) return 'MRI'
  return 'Other'
}

const blank = (): ReviewCounts => ({ total: 0, accepted: 0, dismissed: 0, unreviewed: 0 })
const list = (map: Map<string, ReviewCounts>) => [...map].map(([name, counts]) => ({ name, ...counts })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

export function summarizeStudies(studies: Study[]): ReviewSummary {
  const totals = blank(), byModality = new Map<string, ReviewCounts>(), byCategory = new Map<string, ReviewCounts>(), byModel = new Map<string, ReviewCounts>()
  const bucket = (map: Map<string, ReviewCounts>, key: string) => { let value = map.get(key); if (!value) map.set(key, value = blank()); return value }
  for (const study of studies) for (const image of study.images) {
    const analysis = image.analysis
    if (!analysis) continue
    for (const finding of analysis.findings) {
      const outcome: ReviewOutcome = finding.review ?? 'unreviewed'
      for (const counts of [totals, bucket(byModality, modalityGroup(image.sourceModality, analysis.modality)), bucket(byCategory, finding.category || 'Uncategorised'), bucket(byModel, analysis.model || 'Unknown model')]) { counts.total++; counts[outcome]++ }
    }
  }
  const signed = studies.filter((study) => study.report?.signed)
  return { totals, byModality: list(byModality), byCategory: list(byCategory).slice(0, 30), byModel: list(byModel), reports: { signed: signed.length, edited: signed.filter((study) => study.report?.edited).length } }
}

/** Share of reviewed findings the reviewer kept; null until something has been reviewed. */
export function acceptanceRate(counts: ReviewCounts): number | null {
  const reviewed = counts.accepted + counts.dismissed
  return reviewed ? counts.accepted / reviewed : null
}

async function pseudonym(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`voxelrad-export:${id}`))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

/** De-identified JSON Lines records, one per analysed image: no patient fields, pixels, masks, report text or IDs. */
export async function studyReviewRecords(studies: Study[]): Promise<unknown[]> {
  const records: unknown[] = []
  for (const study of studies) for (const image of study.images) {
    const analysis = image.analysis
    if (!analysis) continue
    const signed = !!study.report?.signed
    records.push({
      studyRef: await pseudonym(study.id), imageRef: await pseudonym(`${study.id}/${image.id}`),
      modality: modalityGroup(image.sourceModality, analysis.modality), sourceModality: image.sourceModality,
      bodyPart: analysis.bodyPart, view: analysis.view, model: analysis.model,
      analyzedAt: Number.isFinite(analysis.createdAt) ? new Date(analysis.createdAt).toISOString() : undefined,
      urgency: analysis.urgency, modelImpression: analysis.impression, reportSigned: signed,
      reportEditedBeforeSign: signed ? !!study.report?.edited : undefined,
      findings: analysis.findings.map((finding) => ({
        title: finding.title, description: finding.description, severity: finding.severity, confidence: finding.confidence,
        location: finding.location, category: finding.category, source: finding.source || 'primary',
        bbox: finding.bbox ? { x: finding.bbox.x, y: finding.bbox.y, w: finding.bbox.w, h: finding.bbox.h } : undefined,
        hasOutline: !!finding.mask,
        measurements: finding.measurements ? Object.fromEntries((['diameter_mm', 'area_mm2', 'mean_hu', 'surround_hu', 'parts'] as const).flatMap((key) => Number.isFinite(finding.measurements?.[key]) ? [[key, finding.measurements?.[key]]] : [])) : undefined,
        classifier: finding.classifier ? { kind: finding.classifier.kind, prob: finding.classifier.prob, supported: finding.classifier.supported } : undefined,
        validationIssues: finding.validationIssues, review: finding.review ?? 'unreviewed',
      })),
    })
  }
  return records
}

const counts = (value: unknown): ReviewCounts => {
  const input = value as Record<string, unknown> | null
  const read = (key: string) => { const n = input?.[key]; if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) throw new Error('Invalid review counts'); return n }
  return { total: read('total'), accepted: read('accepted'), dismissed: read('dismissed'), unreviewed: read('unreviewed') }
}
const groups = (value: unknown): ReviewGroup[] => {
  if (!Array.isArray(value)) throw new Error('Invalid review groups')
  return value.map((item) => { if (!item || typeof item.name !== 'string') throw new Error('Invalid review group'); return { name: item.name.slice(0, 120), ...counts(item) } })
}

async function adminRequest(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal })
  if (response.status === 401) throw new Error('Sign in again to continue.')
  if (response.status === 403) throw new Error('An administrator account is required.')
  if (response.status === 404) throw new Error('This server does not provide review data yet. Deploy the latest API.')
  if (!response.ok) throw new Error('Review data could not be loaded. Try again.')
  return response.json()
}

export async function fetchOrganizationReviews(signal?: AbortSignal): Promise<ReviewSummary> {
  const value = await adminRequest('/api/admin/reviews', signal) as Record<string, unknown>
  try {
    const reports = value.reports as Record<string, unknown>
    if (!Number.isSafeInteger(reports?.signed) || !Number.isSafeInteger(reports?.edited)) throw new Error()
    return { totals: counts(value.totals), byModality: groups(value.byModality), byCategory: groups(value.byCategory), byModel: groups(value.byModel), reports: { signed: reports.signed as number, edited: reports.edited as number } }
  } catch { throw new Error('The server returned invalid review data.') }
}

/** Every page of the organization export, as records. */
export async function fetchOrganizationReviewRecords(signal?: AbortSignal): Promise<unknown[]> {
  const records: unknown[] = []
  for (let offset: number | null = 0; offset !== null;) {
    const page = await adminRequest(`/api/admin/reviews/export?limit=100&offset=${offset}`, signal) as { records?: unknown; nextOffset?: unknown }
    if (!Array.isArray(page.records)) throw new Error('The server returned an invalid export page.')
    records.push(...page.records)
    offset = typeof page.nextOffset === 'number' && page.nextOffset > offset ? page.nextOffset : null
  }
  return records
}

export const toJsonLines = (records: unknown[]) => records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '')
