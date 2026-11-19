import assert from 'node:assert/strict'
import { parseConsent, pixelsAllowed, redactVolumeText } from '../src/lib/trainingPrivacy.ts'
import { skandaBodyPart } from '../src/lib/skandaSlice.ts'
import { burnedIn } from '../src/lib/dicomIntake.ts'

let checks = 0
const equal = (actual: unknown, expected: unknown, description: string) => { assert.deepEqual(actual, expected, description); checks++ }

equal(pixelsAllowed({ burnedInAnnotation: false }), true, 'DICOM without burned-in text may send pixels')
equal(pixelsAllowed({ burnedInAnnotation: true }), false, 'burned-in annotation: text only')
equal(pixelsAllowed({}), false, 'raster upload (unknown status): text only')

const ds = (value?: string) => ({ string: (tag: string) => (tag === 'x00280301' ? value : undefined) })
equal(burnedIn(ds('YES')), true, 'YES is burned in'); equal(burnedIn(ds(' yes ')), true, 'case and padding tolerated')
equal(burnedIn(ds('NO')), false, 'NO is clean'); equal(burnedIn(ds()), false, 'absent tag reads as NO')

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
