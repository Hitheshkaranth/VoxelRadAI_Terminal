import test from 'node:test'
import assert from 'node:assert/strict'
import { captureEnabled, createTrainingCapture, parseCase, parseDictationFeedback, ref, scrub, warnIfUnkeyed } from '../src/trainingCapture.mjs'

process.env.TRAINING_PSEUDONYM_SECRET = 'test-secret'
const ON = { TRAINING_CAPTURE: 'on', TRAINING_PSEUDONYM_SECRET: 'test-secret' }

const studyId = '1b4e28ba-2fa1-41d2-883f-0016d3cca427'
const png = 'data:image/png;base64,' + Buffer.alloc(300, 9).toString('base64')

test('scrubs contact details, ID-like numbers and dates', () => {
  assert.equal(scrub('Call 080 1234 5678 or a.b@x.org on 2026-11-18'), 'Call [NUMBER] or [EMAIL] on [DATE]')
  assert.equal(scrub('Left mid zone consolidation, 3 cm.'), 'Left mid zone consolidation, 3 cm.')
})

test('cases drop patient identifiers and pseudonymise IDs', () => {
  const parsed = parseCase({ kind: 'analysis', studyId, imageId: 'img-1', modality: 'X-ray', model: 'skanda-v1', image: png,
    patient: { name: 'Ravi Kumar', patientId: 'MRN-9', ageBand: '50-59', sex: 'Male' },
    findings: [{ title: 'Nodule', description: 'Seen', severity: 'moderate', confidence: 0.8, review: 'accepted', bbox: { x: 0.1, y: 0.2, w: 0.1, h: 0.1 }, evil: '<script>' }] })
  const json = JSON.stringify(parsed.payload)
  assert.ok(!json.includes('Ravi') && !json.includes('MRN-9') && !json.includes(studyId) && !json.includes('evil'))
  assert.deepEqual(parsed.payload.patient, { ageBand: '50-59', sex: 'Male' })
  assert.equal(parsed.studyRef, ref('study', `:${studyId}`)); assert.notEqual(parsed.studyRef, studyId)
  assert.equal(parsed.image.mime, 'image/png'); assert.equal(parsed.payload.findings[0].review, 'accepted')
})

test('signed cases keep AI draft and final report; reject malformed input', () => {
  const parsed = parseCase({ kind: 'signed', studyId, aiDraft: { impression: 'Consolidation' }, final: { impression: 'No consolidation. Seen 01/02/2026' }, image: png })
  assert.equal(parsed.payload.aiDraft.impression, 'Consolidation'); assert.equal(parsed.payload.final.impression, 'No consolidation. Seen [DATE]')
  assert.equal(parsed.image, null)
  assert.throws(() => parseCase({ kind: 'other', studyId }), /Invalid/)
  assert.throws(() => parseCase({ kind: 'analysis', studyId: 'x' }), /Invalid/)
})

test('dictation feedback keeps audio only for known formats', () => {
  const audio = Buffer.alloc(400, 3).toString('base64')
  assert.equal(parseDictationFeedback({ kind: 'undone', transcript: 'plural effusion', audio, mime: 'audio/webm;codecs=opus' }).audio.length, 400)
  assert.equal(parseDictationFeedback({ kind: 'corrected', transcript: 'x', audio, mime: 'text/html' }).audio, null)
  assert.throws(() => parseDictationFeedback({ kind: 'deleted' }), /Invalid/)
})

test('capture is off unless switched on with a private key', () => {
  assert.equal(captureEnabled({}), false)
  assert.equal(captureEnabled({ TRAINING_CAPTURE: 'on' }), false)
  assert.equal(captureEnabled({ TRAINING_CAPTURE: 'on', TRAINING_PSEUDONYM_SECRET: '   ' }), false)
  assert.equal(captureEnabled(ON), true); assert.equal(captureEnabled({ ...ON, TRAINING_CAPTURE: 'off' }), false)
  assert.throws(() => ref('study', 'x', {}), /not configured/)
  assert.notEqual(ref('study', 'x', ON), ref('study', 'x', { TRAINING_PSEUDONYM_SECRET: 'other' }))
  const logs = []
  assert.equal(warnIfUnkeyed({ TRAINING_CAPTURE: 'on' }, m => logs.push(m)), true)
  assert.match(logs[0], /TRAINING_PSEUDONYM_SECRET/)
})

const consentPool = (consent, queries = [], owner = null) => ({ query: async (sql, values) => {
  queries.push({ sql, values })
  if (sql.includes('FROM users')) return { rows: [{ consent, consentedAt: consent ? new Date() : null }] }
  if (sql.includes('FROM studies')) return { rows: owner ? [{ owner_id: owner }] : [] }
  return { rows: [] }
} })

test('saving requires the server switch and the user consent', async () => {
  const queries = []
  const on = createTrainingCapture({ pool: consentPool(true, queries), env: ON })
  assert.equal(await on.saveCase(parseCase({ kind: 'analysis', studyId, imageId: 'i', image: png }, 'u1'), 'u1'), true)
  assert.ok(queries.some(q => q.sql.includes('training_images')) && queries.some(q => q.sql.includes('INSERT INTO training_cases')))
  assert.equal(await on.saveCase(parseCase({ kind: 'signed', studyId }), ''), false)
  const declined = createTrainingCapture({ pool: consentPool(false, queries), env: ON })
  const before = queries.length
  assert.equal(await declined.enabledFor('u1'), false)
  assert.equal(await declined.saveDictation('u1', { kind: 'error' }), false)
  assert.equal(await declined.saveCase(parseCase({ kind: 'signed', studyId }), 'u1'), false)
  assert.ok(!queries.slice(before).some(q => q.sql.startsWith('INSERT')))
  const off = createTrainingCapture({ pool: consentPool(true, queries), env: { TRAINING_CAPTURE: 'off' } })
  assert.equal(await off.enabledFor('u1'), false); assert.equal(await off.saveDictation('u1', { kind: 'error' }), false)
})

test('consent is stored per user with a timestamp', async () => {
  const queries = []
  const capture = createTrainingCapture({ pool: { query: async (sql, values) => { queries.push({ sql, values }); return { rows: [{ consent: values[1], consentedAt: new Date() }] } } }, env: ON })
  assert.equal((await capture.setConsent('u1', true)).consent, true)
  assert.deepEqual(queries[0].values, ['u1', true, null]); assert.ok(queries[0].sql.includes('training_consent_at=now()'))
  assert.equal((await capture.setConsent('u1', 'yes')).consent, false)
})

test('captures attach only to studies the user owns, and are keyed per user', async () => {
  assert.equal(await createTrainingCapture({ pool: consentPool(true, [], 'owner'), env: ON }).studyAllowed('owner', studyId), true)
  assert.equal(await createTrainingCapture({ pool: consentPool(true, [], 'owner'), env: ON }).studyAllowed('intruder', studyId), false)
  assert.equal(await createTrainingCapture({ pool: consentPool(true), env: ON }).studyAllowed('anyone', studyId), true)
  const a = parseCase({ kind: 'analysis', studyId, imageId: 'i' }, 'user-a'), b = parseCase({ kind: 'analysis', studyId, imageId: 'i' }, 'user-b')
  assert.notEqual(a.studyRef, b.studyRef); assert.notEqual(a.imageRef, b.imageRef)
})

test('scrub removes labelled names, MRNs, phones, Aadhaar-like and PIN codes but keeps clinical text', () => {
  assert.equal(scrub('Patient: Ravi Kumar, 54M with cough'), 'Patient: [REDACTED], 54M with cough')
  assert.equal(scrub('Name: Anita Rao; UHID no. AB12345'), 'Name: [REDACTED]; UHID: [REDACTED]')
  assert.equal(scrub('Ref MRN-004213 and 1234567'), 'Ref [ID] and [ID]')
  assert.equal(scrub('Aadhaar 1234 5678 9012'), 'Aadhaar [ID]')
  assert.equal(scrub('lives at 12 MG Road, Bengaluru 560 001'), 'lives at 12 MG Road, Bengaluru [PIN]')
  assert.equal(scrub('+91 98765 43210 or (080) 2345-6789'), '[NUMBER] or [NUMBER]')
  const clinical = 'Lesion 12x10mm on T2-FLAIR at L4-L5, levels 1 2 3 4 5 6 7 8; patient no longer has effusion, 120ml.'
  assert.equal(scrub(clinical), clinical)
})

test('sync batches read unsynced rows and mark only numeric IDs', async () => {
  const queries = []
  const pool = { query: async (sql, values) => { queries.push({ sql, values }); return { rows: sql.includes('training_cases c') ? [{ id: '1' }] : [] } } }
  const capture = createTrainingCapture({ pool, env: ON })
  const batch = await capture.unsyncedBatch(5)
  assert.deepEqual(batch.cases, [{ id: '1' }]); assert.ok(queries[0].sql.includes('synced_at IS NULL'))
  await capture.markSynced({ cases: ['1', "2; DROP TABLE x", 3], dictation: ['4'] })
  assert.deepEqual(queries.at(-2).values, [['1']]); assert.deepEqual(queries.at(-1).values, [['4']])
})
