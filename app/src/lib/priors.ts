import type { Study } from '../types.ts'

/** Only explicitly identified patients and earlier dated studies qualify as priors. */
export function priorStudies(current: Study, studies: Study[]): Study[] {
  const id = current.patient.patientId.trim()
  const date = current.patient.studyDate
  if (!id || !validDate(date)) return []
  return studies.filter((s) => s.id !== current.id && s.patient.patientId.trim() === id &&
    validDate(s.patient.studyDate) && s.patient.studyDate < date && s.images.length > 0)
    .sort((a, b) => b.patient.studyDate.localeCompare(a.patient.studyDate))
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}
