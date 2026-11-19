import assert from 'node:assert/strict'
import { parseConsent, pixelsAllowed, redactVolumeText, volumePixelsAllowed } from '../src/lib/trainingPrivacy.ts'
import { skandaBodyPart } from '../src/lib/skandaSlice.ts'
import { burnedIn, burnedInTag, createDicomFrameDecoder } from '../src/lib/dicomIntake.ts'

// Minimal implicit-VR little-endian 2x2 8-bit image, optionally with SOP Class UID and Burned In Annotation.
function element(group: number, tag: number, value: Buffer) {
  const header = Buffer.alloc(8)
  header.writeUInt16LE(group); header.writeUInt16LE(tag, 2); header.writeUInt32LE(value.length, 4)
  return Buffer.concat([header, value])
}
const text = (value: string) => Buffer.from(value.length % 2 ? `${value} ` : value)
const us = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b }
const dicom = (modality: string, burned?: string, sopClass?: string) => new Uint8Array(Buffer.concat([
  ...(sopClass ? [element(0x0008, 0x0016, text(sopClass))] : []),
  element(0x0008, 0x0060, text(modality)),
  element(0x0028, 0x0002, us(1)), element(0x0028, 0x0004, text('MONOCHROME2')),
  element(0x0028, 0x0010, us(2)), element(0x0028, 0x0011, us(2)), element(0x0028, 0x0100, us(8)), element(0x0028, 0x0101, us(8)),
  ...(burned ? [element(0x0028, 0x0301, text(burned))] : []),
  element(0x7fe0, 0x0010, Buffer.from([0, 64, 128, 255])),
]))

let checks = 0
const equal = (actual: unknown, expected: unknown, description: string) => { assert.deepEqual(actual, expected, description); checks++ }

equal(pixelsAllowed({ burnedInAnnotation: false, burnedInTag: 'NO' }), true, 'explicit Burned In Annotation = NO may send pixels')
equal(pixelsAllowed({ burnedInAnnotation: true, burnedInTag: 'YES' }), false, 'burned-in annotation: text only')
equal(pixelsAllowed({}), false, 'raster upload or missing tag (unknown status): text only')
equal(pixelsAllowed({ burnedInAnnotation: false }), false, 'legacy image (absent tag read as NO before the fix) is treated as unknown')
equal(pixelsAllowed({ burnedInAnnotation: true, burnedInTag: 'NO' }), false, 'contradictory fields fail closed')

const ds = (value?: string) => ({ string: (tag: string) => (tag === 'x00280301' ? value : undefined) })
equal(burnedIn(ds('YES')), true, 'YES is burned in'); equal(burnedIn(ds(' yes ')), true, 'case and padding tolerated')
equal(burnedIn(ds('NO')), false, 'NO is clean'); equal(burnedIn(ds()), undefined, 'absent tag is unknown, not NO')
equal(burnedIn(ds('')), undefined, 'empty value is unknown'); equal(burnedIn(ds('MAYBE')), undefined, 'unexpected value is unknown')
equal(burnedInTag(ds('no ')), 'NO', 'verbatim tag recorded'); equal(burnedInTag(ds()), undefined, 'no tag recorded when missing')

// Real 2D DICOM intake: the decoder records the tag only when present, so missing-tag US/SC/OT/XA/ES/SM/CR/DX images
// (and Secondary Capture objects) never qualify for pixel sharing.
for (const [modality, tag, allowed] of [['US', undefined, false], ['OT', undefined, false], ['SC', undefined, false], ['XA', undefined, false], ['ES', undefined, false], ['SM', undefined, false], ['CR', undefined, false], ['DX', undefined, false], ['CT', undefined, false], ['US', 'YES', false], ['US', 'NO', true], ['DX', 'NO', true]] as const) {
  const decoded = createDicomFrameDecoder(dicom(modality, tag)).decode(0)
  equal(pixelsAllowed(decoded), allowed, `${modality} with Burned In Annotation ${tag ?? 'missing'}`)
}
const secondaryCapture = createDicomFrameDecoder(dicom('OT', undefined, '1.2.840.10008.5.1.4.1.1.7')).decode(0)
equal(pixelsAllowed(secondaryCapture), false, 'Secondary Capture SOP class without the tag: text only')

// Volume slices: NRRD sends pixels; a DICOM-derived volume only when every slice said NO.
equal(volumePixelsAllowed({}), true, 'NRRD volume (no burned-in overlay)')
equal(volumePixelsAllowed({ fromDicom: true, burnedInAnnotation: false }), true, 'DICOM series, all slices NO')
equal(volumePixelsAllowed({ fromDicom: true }), false, 'DICOM series with unknown status')
equal(volumePixelsAllowed({ fromDicom: true, burnedInAnnotation: true }), false, 'DICOM series with burned-in text')

equal(redactVolumeText('Mass in RAVI_KUMAR_CT_HEAD slice; no bleed.', 'Ravi_Kumar_CT_Head'), 'Mass in [REDACTED] slice; no bleed.', 'volume title echoed by the model is removed')
equal(redactVolumeText('Mass seen.', 'CT'), 'Mass seen.', 'very short titles are not used as patterns')
equal(redactVolumeText('Seen by Anita', 'scan', { name: 'Anita Rao', patientId: '', age: '', sex: '', studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' }), 'Seen by [REDACTED]', 'known identifiers are removed too')

equal(skandaBodyPart({ bodyPart: 'HEAD' }), 'HEAD', 'DICOM body part is sent')
equal(skandaBodyPart({}), 'Unknown', 'volume title is never sent as the body part')
equal(skandaBodyPart({ bodyPart: '  ' }), 'Unknown', 'blank body part is Unknown')

equal(parseConsent({ consent: true, consentedAt: '2026-11-19T00:00:00Z', serverEnabled: true }), { consent: true, consentedAt: '2026-11-19T00:00:00Z', serverEnabled: true }, 'consent reply parsed')
equal(parseConsent({ consent: 'yes' }), { consent: false, consentedAt: null, serverEnabled: false }, 'malformed reply is not consent')
equal(parseConsent(null), { consent: false, consentedAt: null, serverEnabled: false }, 'missing reply is not consent')
console.log(`Training privacy: ${checks} checks passed`)
