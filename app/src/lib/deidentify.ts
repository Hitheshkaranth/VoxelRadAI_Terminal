// Pure de-identification helpers for model-improvement capture (no app imports, so tests run in Node).
import type { PatientInfo } from '../types'

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Remove the study's own identifiers (patient name parts, patient ID, referring physician) from text. */
export function redactKnownIdentifiers(text: string, study: { patient: PatientInfo }): string {
  const p = study.patient
  const tokens = [p.patientId, p.referringPhysician, ...p.name.split(/\s+/), ...p.referringPhysician.split(/\s+/)]
    .map((t) => t.trim().replace(/[.,]/g, ''))
    .filter((t) => t.length >= 3 && !/^(dr|mr|mrs|ms)$/i.test(t))
  return tokens.reduce((out, token) => out.replace(new RegExp(`\\b${escapeRegExp(token)}\\b`, 'gi'), '[REDACTED]'), text)
}

export function ageBand(age: string): string {
  const years = Number.parseInt(age, 10)
  if (!Number.isFinite(years) || years < 0) return ''
  if (years >= 90) return '90+'
  const low = Math.floor(years / 10) * 10
  return `${low}-${low + 9}`
}
