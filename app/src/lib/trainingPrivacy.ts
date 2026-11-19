// Pure privacy rules for model-improvement capture (no browser APIs, so tests run in Node).
import type { PatientInfo, StudyImage } from '../types.ts'
import { redactKnownIdentifiers } from './deidentify.ts'

/** Pixels are sent only for DICOM images that do not declare burned-in text. Raster uploads (unknown status) send text only. */
export const pixelsAllowed = (image: Pick<StudyImage, 'burnedInAnnotation'>) => image.burnedInAnnotation === false

const BLANK: PatientInfo = { name: '', patientId: '', age: '', sex: '', studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' }
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Volume reads have no patient record, but the volume title (often a file or patient name) reaches the model in the
 *  slice label and can be echoed back. Remove the title and any known identifiers from model text. */
export function redactVolumeText(text: string, title: string, patient: PatientInfo = BLANK): string {
  const out = redactKnownIdentifiers(text ?? '', { patient })
  const name = title.trim()
  return name.length >= 3 ? out.replace(new RegExp(escapeRegExp(name), 'gi'), '[REDACTED]') : out
}

export interface TrainingConsent { consent: boolean; consentedAt: string | null; serverEnabled: boolean }
/** Validate the consent endpoint's reply; anything unexpected reads as "not consented". */
export function parseConsent(value: unknown): TrainingConsent {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return { consent: v.consent === true, consentedAt: typeof v.consentedAt === 'string' ? v.consentedAt : null, serverEnabled: v.serverEnabled === true }
}
