import type { Finding } from '../types.ts'
import type { SliceRead } from './volumeAnalysis.ts'
import { volumeCoverage } from './volumeAnalysis.ts'

export interface VolumeFindingReview {
  decision: 'accepted' | 'dismissed' | 'pending'
  description?: string
  updatedAt: number
}
export interface VolumeFindingGroup {
  id: string
  label: string
  members: string[]
  createdAt: number
}
export interface VolumeDraftReport {
  text: string
  sourceKey: string
  updatedAt: number
  reviewedAt?: number
}
export interface ReviewableVolume {
  id: string; title: string; modality: string; plane: string; count: number
  snapshot: { model: string; center: number; width: number }
  reads: SliceRead[]
  reviews?: Record<string, VolumeFindingReview>
  findingGroups?: VolumeFindingGroup[]
  draftReport?: VolumeDraftReport
}
export const volumeFindingKey = (index: number, findingId: string) => `${index}:${findingId}`
export function volumeFindingRows(job: ReviewableVolume) {
  return job.reads.flatMap((read) => (read.analysis?.findings ?? []).filter((f) => f.severity !== 'normal').map((finding) => {
    const key = volumeFindingKey(read.index, finding.id), review = job.reviews?.[key]
    return { index: read.index, key, finding, decision: review?.decision ?? 'pending', description: review?.description ?? finding.description, edited: review?.description !== undefined, incomplete: !!read.analysis?.truncated }
  }))
}
export function nextPendingFinding(rows: ReturnType<typeof volumeFindingRows>, currentKey: string | null, direction: 1 | -1 = 1) {
  const start = rows.findIndex(row => row.key === currentKey)
  for (let step = 1; step <= rows.length; step++) {
    const index = ((start < 0 ? (direction === 1 ? -1 : 0) : start) + direction * step + rows.length) % rows.length
    const row = rows[index]
    if (row.key !== currentKey && row.decision === 'pending') return row
  }
  return undefined
}
/** Explicit reviewer associations preserve every original slice observation. */
export function validateFindingGroup(job: ReviewableVolume, label: string, members: string[]) {
  const name = label.trim()
  if (!name || name.length > 120) throw new Error('Enter a group name of 1–120 characters.')
  const unique = [...new Set(members)]
  const rows = volumeFindingRows(job)
  if (unique.some(key => !rows.some(row => row.key === key))) throw new Error('A selected observation is no longer available.')
  if (unique.length < 2 || new Set(rows.filter(row => unique.includes(row.key)).map(row => row.index)).size < 2) throw new Error('Select observations from at least two slices.')
  if (job.findingGroups?.some(group => group.members.some(key => unique.includes(key)))) throw new Error('An observation already belongs to a group. Ungroup it first.')
  return { label: name, members: unique }
}
/** Derived overlay for viewers; the recorded model output remains untouched. */
export function reviewedVolumeReads(job: Pick<ReviewableVolume, 'reads' | 'reviews'>): SliceRead[] {
  return job.reads.map((read) => ({ ...read, analysis: read.analysis ? { ...read.analysis, findings: read.analysis.findings.map((finding): Finding => {
    const review = job.reviews?.[volumeFindingKey(read.index, finding.id)]
    return review ? { ...finding, description: review.description ?? finding.description, review: review.decision === 'pending' ? undefined : review.decision } : finding
  }) } : undefined }))
}
export function volumeReportSourceKey(job: ReviewableVolume): string {
  return JSON.stringify({ id: job.id, count: job.count, snapshot: job.snapshot,
    reads: job.reads.map((r) => [r.index, r.error, r.analysis?.truncated, r.analysis?.createdAt, r.analysis?.findings.map((f) => [f.id,f.title,f.description,f.severity])]),
    findingGroups: job.findingGroups ?? [],
    reviews: Object.entries(job.reviews ?? {}).sort(([a],[b]) => a.localeCompare(b)),
  })
}
export function buildVolumeDraft(job: ReviewableVolume): string {
  const coverage = volumeCoverage(job.reads,job.count), rows = volumeFindingRows(job)
  const accepted = rows.filter((row) => row.decision === 'accepted' && !row.incomplete)
  const pending = rows.filter((row) => row.decision === 'pending').length
  const rejected = rows.filter((row) => row.decision === 'dismissed').length
  const lines = [
    'DRAFT REPORT · Not signed', job.title, `${job.modality} · Patient identity not linked`, '',
    'REVIEW SCOPE', `${coverage.completed}/${job.count} acquired ${job.plane} slices reviewed independently by ${job.snapshot.model}.`,
    `Display window ${job.snapshot.width}, level ${job.snapshot.center}. One window and one series; no combined 3D model interpretation.`,
    coverage.complete ? 'All submitted slices returned complete model responses.' : 'INCOMPLETE COVERAGE: unreviewed, failed or truncated slices remain.', '',
    'ACCEPTED FINDINGS',
    ...accepted.map((row) => `Slice ${row.index + 1}: ${row.finding.title}. ${row.description}${row.finding.location ? ` Location: ${row.finding.location}.` : ''}`),
    ...(accepted.length ? [] : ['No findings have been accepted for this draft. This does not establish a normal examination.']), '',
    'REVIEW STATUS', `${accepted.length} accepted findings included; ${pending} pending; ${rejected} rejected. Findings from incomplete responses are excluded.`,
    'Review source images and edit this draft before clinical use. Separate slice findings have not been merged into lesions.',
  ]
  return lines.join('\n')
}
