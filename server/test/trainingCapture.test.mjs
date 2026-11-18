import test from 'node:test'
import assert from 'node:assert/strict'
import { captureEnabled, createTrainingCapture, parseCase, parseDictationFeedback, ref, scrub } from '../src/trainingCapture.mjs'

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
  assert.equal(parsed.studyRef, ref('study', studyId)); assert.notEqual(parsed.studyRef, studyId)
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

test('capture is on by default and can be switched off', async () => {
  assert.equal(captureEnabled({}), true); assert.equal(captureEnabled({ TRAINING_CAPTURE: 'off' }), false)
  const queries = []
  const pool = { query: async (sql, values) => { queries.push({ sql, values }); return { rows: [] } } }
  const on = createTrainingCapture({ pool, env: {} })
  assert.equal(await on.saveCase(parseCase({ kind: 'analysis', studyId, imageId: 'i', image: png })), true)
  assert.ok(queries[0].sql.includes('training_images') && queries[1].sql.includes('training_cases'))
  const off = createTrainingCapture({ pool, env: { TRAINING_CAPTURE: 'off' } })
  assert.equal(await off.saveDictation('u', { kind: 'error' }), false); assert.equal(queries.length, 2)
})
