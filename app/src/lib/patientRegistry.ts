// Patient register (hosted site): permanent RadGenis IDs, found again by name, ID, phone, ABHA or Aadhaar.
// Aadhaar is sent once to be matched or registered; the server keeps only a one-way hash and the last four digits.
import type { PatientInfo } from '../types'

export interface RegistryPatient {
  id: string; mrn: string; name: string; sex: '' | 'M' | 'F' | 'O'; phone: string; birthDate: string | null
  abhaNumber: string | null; abhaAddress: string | null; aadhaarMasked: string | null
  studyCount?: number; lastStudyDate?: string | null
}
export interface RegistryInput { name?: string; sex?: '' | 'M' | 'F' | 'O'; phone?: string; birthDate?: string | null; abhaNumber?: string | null; abhaAddress?: string | null; aadhaar?: string | null }

export class DuplicatePatientError extends Error {
  readonly patient: RegistryPatient
  constructor(message: string, patient: RegistryPatient) { super(message); this.patient = patient }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init, headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) } })
  const body = await r.json().catch(() => ({}))
  if (r.status === 409 && body.patient) throw new DuplicatePatientError(body.error, body.patient)
  if (!r.ok) throw new Error(typeof body.error === 'string' ? body.error : r.status === 401 ? 'Your session expired. Sign in again.' : 'The patient register is unavailable. Try again.')
  return body as T
}

export const searchPatients = (q: string, signal?: AbortSignal) =>
  call<{ by: string; patients: RegistryPatient[] }>('/api/patients/search', { method: 'POST', body: JSON.stringify({ q }), signal })
export const registerPatient = (input: RegistryInput) =>
  call<{ patient: RegistryPatient }>('/api/patients', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.patient)
export const updateRegistryPatient = (id: string, patch: RegistryInput) =>
  call<{ patient: RegistryPatient }>(`/api/patients/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => r.patient)
export const getRegistryPatient = (id: string) => call<{ patient: RegistryPatient }>(`/api/patients/${id}`).then((r) => r.patient)

const SEX_TO_STUDY = { M: 'Male', F: 'Female', O: 'Other', '': '' } as const
export const studySexToRegistry = (sex: PatientInfo['sex']): RegistryInput['sex'] => (sex === 'Male' ? 'M' : sex === 'Female' ? 'F' : sex === 'Other' ? 'O' : '')

/** Age in whole years on a given day (yyyy-mm-dd), from a date of birth. */
export function ageOn(birthDate: string, day: string): string {
  const [by, bm, bd] = birthDate.split('-').map(Number), [y, m, d] = day.split('-').map(Number)
  const age = y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
  return Number.isFinite(age) && age >= 0 ? String(age) : ''
}

/** Study patient fields after choosing a registered patient: their ID, name, sex and (if known) age at the study. */
export function linkPatient(current: PatientInfo, p: RegistryPatient): Partial<PatientInfo> {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(current.studyDate) ? current.studyDate : new Date().toISOString().slice(0, 10)
  return {
    registryId: p.id, patientId: p.mrn, name: p.name || current.name,
    sex: SEX_TO_STUDY[p.sex] || current.sex,
    ...(p.birthDate ? { age: ageOn(p.birthDate, day) || current.age } : {}),
  }
}
