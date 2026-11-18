import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSpeechRequest, transcribe } from '../src/speech.mjs'
const audio = Buffer.alloc(400, 1).toString('base64')
test('validates dictation requests', () => {
  assert.equal(parseSpeechRequest({ audio, mime: 'audio/webm;codecs=opus' }).language, 'en-IN')
  assert.throws(() => parseSpeechRequest({ audio, mime: 'text/html' }), /Unsupported audio/)
  assert.throws(() => parseSpeechRequest({ audio: 'not base64!', mime: 'audio/webm' }), /base64/)
  assert.throws(() => parseSpeechRequest({ audio, mime: 'audio/webm', language: 'xx' }), /language/)
})
test('sends the key only in the Sarvam header and returns the transcript', async () => {
  let seen
  const fetchImpl = async (url, init) => { seen = { url, init }; return new Response(JSON.stringify({ transcript: ' Bilateral consolidation. ', language_code: 'en-IN' }), { status: 200 }) }
  const result = await transcribe(parseSpeechRequest({ audio, mime: 'audio/webm' }), { apiKey: 'k', fetchImpl })
  assert.equal(result.transcript, 'Bilateral consolidation.')
  assert.equal(seen.url, 'https://api.sarvam.ai/speech-to-text')
  assert.equal(seen.init.headers['api-subscription-key'], 'k')
  assert.equal(seen.init.body.get('model'), 'saaras:v4')
})
test('reports missing configuration and provider errors', async () => {
  await assert.rejects(transcribe(parseSpeechRequest({ audio, mime: 'audio/webm' }), { apiKey: '' }), e => e.status === 503)
  await assert.rejects(transcribe(parseSpeechRequest({ audio, mime: 'audio/webm' }), { apiKey: 'k', fetchImpl: async () => new Response('{}', { status: 429 }) }), e => e.status === 429)
  await assert.rejects(transcribe(parseSpeechRequest({ audio, mime: 'audio/webm' }), { apiKey: 'k', fetchImpl: async () => new Response('{}', { status: 500 }) }), e => e.status === 502)
})
