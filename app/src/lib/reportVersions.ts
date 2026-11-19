// Signed-report integrity: each sign-off appends an immutable version; a signed report changes only through
// addenda (appended text) or an explicit correction that becomes the next signed version.
// Imported by scripts/test-report-versions.ts under node strip-types: runtime imports need an explicit .ts extension.
import type { PatientInfo, ReportAddendum, ReportDraft, ReportFieldKey, ReportVersion } from '../types'
import { REPORT_FIELD_KEYS } from '../types.ts'

export const MAX_ADDENDUM_LENGTH = 20000

const sectionsOf = (r: ReportDraft) => Object.fromEntries(REPORT_FIELD_KEYS.map((k) => [k, r[k]])) as Record<ReportFieldKey, string>

/** Signed versions, with a legacy signed report (signed before versions existed) backfilled as version 1. */
export function signedVersions(r: ReportDraft): ReportVersion[] {
  if (r.versions?.length || !r.signed) return r.versions ?? []
  return [{
    version: 1,
    signedAt: r.signedAt ?? r.updatedAt,
    signedBy: r.radiologist,
    sections: sectionsOf(r),
    ...(r.rich ? { rich: { ...r.rich } } : {}),
    ...(r.patientSnapshot ? { patientSnapshot: { ...r.patientSnapshot } } : {}),
    ...(r.signOverrides?.length ? { signOverrides: [...r.signOverrides] } : {}),
  }]
}

export function latestVersion(r: ReportDraft): ReportVersion | undefined {
  const all = signedVersions(r)
  return all[all.length - 1]
}

/** Patch that signs the current draft and appends it as the next immutable version. */
export function signPatch(r: ReportDraft, o: { signedAt: number; signedBy: string; patient: PatientInfo; overrides?: string[] }): Partial<ReportDraft> {
  const prior = r.versions ?? []
  const overrides = o.overrides?.length ? [...o.overrides] : undefined
  const version: ReportVersion = {
    version: prior.length + 1,
    signedAt: o.signedAt,
    signedBy: o.signedBy,
    sections: sectionsOf(r),
    ...(r.rich ? { rich: { ...r.rich } } : {}),
    patientSnapshot: { ...o.patient },
    ...(overrides ? { signOverrides: overrides } : {}),
    ...(r.correction ? { corrects: r.correction.of } : {}),
  }
  return {
    signed: true,
    signedAt: o.signedAt,
    radiologist: o.signedBy,
    // Freeze the patient header: later edits to patient details must not change a signed report.
    patientSnapshot: { ...o.patient },
    // Record what was signed past so the override stays visible on the signed report.
    signOverrides: overrides,
    // Signing accepts the current draft; there is nothing left to undo back to.
    previous: undefined,
    correction: undefined,
    versions: [...prior, version],
  }
}

/** Patch that reopens a signed report as a correction draft. Prior signed versions stay, shown as superseded once re-signed. */
export function correctionPatch(r: ReportDraft, by: string, now: number): Partial<ReportDraft> {
  const versions = signedVersions(r)
  const last = versions[versions.length - 1]
  if (!r.signed || !last) return {}
  return {
    signed: false,
    signedAt: undefined,
    signOverrides: undefined,
    versions,
    correction: { of: last.version, startedAt: now, by },
    amendments: [...(r.amendments ?? []), { signedAt: last.signedAt, unlockedAt: now, by }],
  }
}

/** Patch that appends a signed addendum to the current signed version. Empty text adds nothing. */
export function addendumPatch(r: ReportDraft, o: { id: string; text: string; by: string; now: number }): Partial<ReportDraft> {
  const text = o.text.trim().slice(0, MAX_ADDENDUM_LENGTH)
  const versions = signedVersions(r)
  const last = versions[versions.length - 1]
  if (!r.signed || !last || !text) return {}
  const addendum: ReportAddendum = { id: o.id, text, createdAt: o.now, by: o.by, signedAt: o.now, version: last.version }
  return { versions, addenda: [...(r.addenda ?? []), addendum] }
}

/** Addenda printed with the report: those on the current signed version. A correction draft has none of its own yet. */
export function currentAddenda(r: ReportDraft | undefined): ReportAddendum[] {
  if (!r?.signed) return []
  const last = latestVersion(r)?.version ?? 1
  return (r.addenda ?? []).filter((a) => (a.version ?? last) === last)
}

export function addendumHeading(a: ReportAddendum): string {
  return `ADDENDUM — ${new Date(a.signedAt ?? a.createdAt).toLocaleString()} — ${a.by.trim() || '—'}`
}

export type VersionStatus = 'current' | 'superseded' | 'under-correction'

/** History rows, newest first. A version is superseded once a later one is signed. */
export function versionHistory(r: ReportDraft): { version: ReportVersion; status: VersionStatus; addenda: ReportAddendum[] }[] {
  const all = signedVersions(r)
  return all.map((version, i) => {
    const last = i === all.length - 1
    const status: VersionStatus = !last ? 'superseded' : r.signed ? 'current' : 'under-correction'
    return { version, status, addenda: (r.addenda ?? []).filter((a) => (a.version ?? all.length) === version.version) }
  }).reverse()
}

/** Plain-text line saying which signed version this is, when it corrects an earlier one. */
export function correctionNote(r: ReportDraft | undefined): string {
  const last = r?.signed ? latestVersion(r) : undefined
  if (!last?.corrects) return ''
  const prior = signedVersions(r!).find((v) => v.version === last.corrects)
  return `Corrected report (version ${last.version}) — supersedes version ${last.corrects}${prior ? ` signed ${new Date(prior.signedAt).toLocaleString()} by ${prior.signedBy || '—'}` : ''}`
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const strings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === 'string')

/** Shape check for imported or server-restored history fields. */
export function validReportHistory(r: Record<string, unknown>): boolean {
  const versions = r.versions, addenda = r.addenda, correction = r.correction
  if (versions !== undefined && !(Array.isArray(versions) && versions.length <= 100 && versions.every((v, i) => object(v) && v.version === i + 1 && finite(v.signedAt) && typeof v.signedBy === 'string' && object(v.sections) && REPORT_FIELD_KEYS.every((k) => typeof (v.sections as Record<string, unknown>)[k] === 'string') && (v.rich === undefined || object(v.rich) && Object.values(v.rich).every((h) => typeof h === 'string')) && (v.signOverrides === undefined || strings(v.signOverrides)) && (v.patientSnapshot === undefined || object(v.patientSnapshot)) && (v.corrects === undefined || Number.isInteger(v.corrects))))) return false
  if (addenda !== undefined && !(Array.isArray(addenda) && addenda.length <= 200 && addenda.every((a) => object(a) && typeof a.id === 'string' && a.id.length > 0 && a.id.length <= 64 && typeof a.text === 'string' && a.text.length <= MAX_ADDENDUM_LENGTH && finite(a.createdAt) && typeof a.by === 'string' && (a.signedAt === undefined || finite(a.signedAt)) && (a.version === undefined || Number.isInteger(a.version))))) return false
  if (correction !== undefined && !(object(correction) && Number.isInteger(correction.of) && finite(correction.startedAt) && typeof correction.by === 'string')) return false
  return true
}
