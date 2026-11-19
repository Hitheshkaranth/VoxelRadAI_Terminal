// Server-side proxy to Sarvam speech-to-text so the API key never reaches the browser.
// Sarvam's REST endpoint accepts up to 30 s of audio per request; the client sends one utterance at a time.
export const STT_BODY_LIMIT = 3 * 1024 * 1024
const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/mpeg']
const LANGUAGES = /^(?:unknown|[a-z]{2,3}-IN)$/
const KEYTERMS = ['consolidation', 'pleural effusion', 'pneumothorax', 'cardiomegaly', 'atelectasis', 'hilar', 'mediastinum',
  'costophrenic', 'opacity', 'nodule', 'Hounsfield', 'hyperdense', 'hypodense', 'parenchyma', 'ventricles', 'sulci',
  'infarct', 'haemorrhage', 'fracture', 'impression', 'recommendations', 'bilateral', 'unremarkable']
// The radiologist's own word list is sent as extra hints; cap it so a request stays a sensible size.
const MAX_KEYTERMS = 50
const KEYTERM = /^[\p{L}\p{N}][\p{L}\p{N} .'()/-]{0,59}$/u

function parseKeyterms(value) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw Object.assign(new Error('Keyterms must be a list of words.'), { status: 400 })
  const seen = new Set(KEYTERMS.map((t) => t.toLowerCase()))
  const terms = []
  for (const item of value) {
    const term = typeof item === 'string' ? item.trim() : ''
    if (!KEYTERM.test(term) || seen.has(term.toLowerCase())) continue
    seen.add(term.toLowerCase())
    terms.push(term)
    if (terms.length + KEYTERMS.length >= MAX_KEYTERMS) break
  }
  return terms
}

export function parseSpeechRequest(data) {
  const mime = typeof data.mime === 'string' ? data.mime.split(';')[0].trim().toLowerCase() : ''
  if (!AUDIO_TYPES.includes(mime)) throw Object.assign(new Error('Unsupported audio format.'), { status: 400 })
  if (typeof data.audio !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.audio)) throw Object.assign(new Error('Audio must be base64.'), { status: 400 })
  const audio = Buffer.from(data.audio, 'base64')
  if (audio.length < 200) throw Object.assign(new Error('Audio is too short.'), { status: 400 })
  const language = data.language === undefined ? 'en-IN' : data.language
  if (typeof language !== 'string' || !LANGUAGES.test(language)) throw Object.assign(new Error('Unsupported language code.'), { status: 400 })
  return { audio, mime, language, keyterms: parseKeyterms(data.keyterms) }
}

export async function transcribe({ audio, mime, language, keyterms = [] }, { apiKey, fetchImpl = fetch, endpoint = 'https://api.sarvam.ai/speech-to-text' }) {
  if (!apiKey) throw Object.assign(new Error('Dictation is not configured. Set SARVAM_API_KEY on the server.'), { status: 503 })
  const form = new FormData()
  form.append('file', new Blob([audio], { type: mime }), `dictation.${mime.split('/')[1]}`)
  form.append('model', 'saaras:v4')
  form.append('mode', 'transcribe')
  form.append('language_code', language)
  form.append('keyterms', JSON.stringify([...keyterms, ...KEYTERMS].slice(0, MAX_KEYTERMS)))
  let response
  try {
    response = await fetchImpl(endpoint, { method: 'POST', headers: { 'api-subscription-key': apiKey }, body: form, signal: AbortSignal.timeout(25000) })
  } catch {
    throw Object.assign(new Error('Speech service did not respond. Try again.'), { status: 502 })
  }
  if (response.status === 429) throw Object.assign(new Error('Speech service rate limit reached. Wait a moment and retry.'), { status: 429 })
  if (!response.ok) throw Object.assign(new Error(`Speech service error (HTTP ${response.status}).`), { status: 502 })
  const result = await response.json().catch(() => null)
  if (!result || typeof result.transcript !== 'string') throw Object.assign(new Error('Speech service returned no transcript.'), { status: 502 })
  return { transcript: result.transcript.trim(), language: typeof result.language_code === 'string' ? result.language_code : language }
}
