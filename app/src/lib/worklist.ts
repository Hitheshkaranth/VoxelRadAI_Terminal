import { analysisEligibility } from './modality.ts'
import type { Study } from '../types'

export type WorklistFilter = 'all' | 'review' | 'signed'
export type WorklistSort = 'recent' | 'priority'

export function needsReview(study: Study): boolean {
  return !study.report?.signed && study.images.some((image) => !!image.analysis)
}

/** Priority comes from the model's recorded urgency, never from a fabricated triage score. */
export function studyPriority(study: Study): number {
  return study.images.reduce((rank, image) => Math.max(rank,
    image.analysis?.urgency === 'urgent' ? 2 : image.analysis?.urgency === 'priority' ? 1 : 0), 0)
}

export function filterWorklist(studies: Study[], query: string, filter: WorklistFilter, sort: WorklistSort): Study[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return studies.filter((study) => {
    const haystack = [study.title, study.patient.name, study.patient.patientId].join(' ').toLowerCase()
    return terms.every((term) => haystack.includes(term)) &&
      (filter === 'all' || (filter === 'review' ? needsReview(study) : !!study.report?.signed))
  }).sort((a, b) => (sort === 'priority' ? studyPriority(b) - studyPriority(a) : 0) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
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
