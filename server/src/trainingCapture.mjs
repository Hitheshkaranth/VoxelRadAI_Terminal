// Model-improvement capture: de-identified analysis cases, signed-report ground truth and
// dictation clips that failed or were corrected. Opt-in twice: the operator sets TRAINING_CAPTURE=on with a
// TRAINING_PSEUDONYM_SECRET, and each user consents in Settings. Either missing means nothing is kept.
import { createHash, createHmac } from 'node:crypto'

export const TRAINING_BODY_LIMIT = (process.env.VERCEL ? 4 : 10) * 1024 * 1024
export const DICTATION_FEEDBACK_LIMIT = 3 * 1024 * 1024
const secretOf = env => (typeof env.TRAINING_PSEUDONYM_SECRET === 'string' ? env.TRAINING_PSEUDONYM_SECRET.trim() : '')
const switchedOn = env => /^(on|true|1|yes)$/i.test(env.TRAINING_CAPTURE ?? '')
/** Server-side switch: explicitly on and keyed with a private secret. A public default key would make pseudonyms reversible. */
export const captureEnabled = (env = process.env) => switchedOn(env) && secretOf(env).length > 0
let warned = false
export function warnIfUnkeyed(env = process.env, log = console.warn) {
  if (warned || !switchedOn(env) || secretOf(env)) return false
  warned = true
  log('TRAINING_CAPTURE is on but TRAINING_PSEUDONYM_SECRET is empty; model-improvement capture is disabled.')
  return true
}
export const retentionDays = (env = process.env) => Math.min(3650, Math.max(7, Number(env.TRAINING_RETENTION_DAYS) || 365))

/** One-way, keyed pseudonym so records join across events without revealing the source ID. Never keyed with a default. */
export function ref(kind, id, env = process.env) {
  const secret = secretOf(env)
  if (!secret) throw Object.assign(new Error('Training capture is not configured.'), { status: 503 })
  return createHmac('sha256', secret).update(`${kind}:${id}`).digest('hex').slice(0, 20)
}

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

// Identity labels whose value (to the end of the clause) is a name or ID: "Patient: Ravi Kumar", "MRN# 0042", "UHID no. A12".
const LABELLED = /\b(patient(?:'s)?\s+name|patient|name|pt|mrn|uhid|ip\s*no|op\s*no|hospital\s+(?:no|number|id)|accession(?:\s+(?:no|number))?|aadhaa?r)\b\s*(?:[:#=]|no\.|number\b)\s*[^\n,;.]{1,60}/gi
const ADDRESS_PIN = /\b(address|addr|road|rd|street|nagar|colony|layout|district|dist|city|village|pin\s*code|pincode|pin)\b([^\n]{0,60}?)\b\d{3}\s?\d{3}\b/gi
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,5}\)[\s-]?)?\d(?:[\s-]?\d){7,}/g
// Measurements such as 12x10mm or 120ml are clinical content, not identifiers.
const MEASURE = /^\d+(?:x\d+)*(?:mm|cm|ml|mg|hu|kg|cc|mls?)?$/i
/** MRN-like token: 6+ digits, or 6+ letters and digits mixed with at least 4 digits (AB123456, MRN-0042). */
const idLike = token => {
  const bare = token.replace(/-/g, '')
  if (MEASURE.test(bare)) return /^\d{6,}$/.test(bare)
  return bare.length >= 6 && (bare.match(/\d/g)?.length ?? 0) >= 4
}
/** Remove contact details, ID-like tokens, labelled names and full dates from free text. Known patient names are removed client-side. */
export function scrub(text) {
  return str(text, 20000)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]')
    .replace(LABELLED, (_, label) => `${label}: [REDACTED]`)
    .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, '[DATE]')
    // Aadhaar-like 12 digits (often grouped 4-4-4), before the phone rule so it is labelled as an ID.
    .replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, '[ID]')
    .replace(ADDRESS_PIN, (_, word, between) => `${word}${between}[PIN]`)
    // Phone numbers (+91 98765 43210, (080) 2345-6789); runs of single digits such as level lists are left alone.
    .replace(PHONE, m => (/\d{3}/.test(m) ? '[NUMBER]' : m))
    .replace(/\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g, m => (idLike(m) ? '[ID]' : m))
}

const SEVERITY = ['critical', 'significant', 'moderate', 'minor', 'normal']
const REVIEW = ['accepted', 'dismissed']
function finding(f) {
  if (!object(f)) return null
  const bbox = object(f.bbox) && ['x', 'y', 'w', 'h'].every(k => num(f.bbox[k]) !== undefined) ? { x: f.bbox.x, y: f.bbox.y, w: f.bbox.w, h: f.bbox.h } : undefined
  return {
    title: scrub(str(f.title, 200)), description: scrub(str(f.description, 2000)), location: str(f.location, 200),
    severity: SEVERITY.includes(f.severity) ? f.severity : 'moderate', confidence: num(f.confidence) ?? null,
    review: REVIEW.includes(f.review) ? f.review : 'unreviewed', source: str(f.source, 40) || 'model', category: str(f.category, 80),
    edited: f.edited === true, bbox,
  }
}
const SECTIONS = ['technique', 'comparison', 'findings', 'impression', 'recommendations']
const sections = v => (object(v) ? Object.fromEntries(SECTIONS.map(k => [k, scrub(str(v[k], 20000))])) : null)

const IMAGE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/
export function decodeImage(dataUrl) {
  const match = typeof dataUrl === 'string' && dataUrl.match(IMAGE)
  if (!match) return null
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length < 100 || bytes.length > 8 * 1024 * 1024) return null
  return { mime: match[1], bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Validate and de-identify a capture request. Unknown fields, including any patient fields, are dropped. */
export function parseCase(data, userId = '', env = process.env) {
  if (!object(data) || !['analysis', 'signed'].includes(data.kind) || typeof data.studyId !== 'string' || !UUID.test(data.studyId)) {
    throw Object.assign(new Error('Invalid training case.'), { status: 400 })
  }
  const imageId = typeof data.imageId === 'string' && data.imageId.length <= 64 ? data.imageId : null
  const findings = Array.isArray(data.findings) ? data.findings.slice(0, 200).map(finding).filter(Boolean) : []
  const patient = object(data.patient) ? { ageBand: str(data.patient.ageBand, 10), sex: ['Male', 'Female', 'Other'].includes(data.patient.sex) ? data.patient.sex : '' } : undefined
  const payload = {
    modality: str(data.modality, 40), bodyPart: str(data.bodyPart, 80), view: str(data.view, 40), model: str(data.model, 120),
    impression: scrub(str(data.impression, 4000)), findings, patient,
    width: num(data.width), height: num(data.height), durationMs: num(data.durationMs),
    ...(data.kind === 'signed' ? { aiDraft: sections(data.aiDraft), final: sections(data.final), draftMethod: str(data.draftMethod, 20), signOverrides: Array.isArray(data.signOverrides) ? data.signOverrides.slice(0, 20).map(s => str(s, 300)) : [] } : {}),
  }
  // The user ID is part of the key so a capture can never join another account's records for the same study ID.
  const owner = `${userId}:${data.studyId}`
  return {
    kind: data.kind, studyRef: ref('study', owner, env), imageRef: imageId ? ref('image', `${owner}/${imageId}`, env) : null,
    modality: payload.modality, model: payload.model, payload, image: data.kind === 'analysis' ? decodeImage(data.image) : null,
  }
}

const AUDIO = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/mpeg']
export function parseDictationFeedback(data) {
  if (!object(data) || !['undone', 'corrected'].includes(data.kind)) throw Object.assign(new Error('Invalid dictation feedback.'), { status: 400 })
  const mime = str(data.mime, 60).split(';')[0].trim().toLowerCase()
  const audio = typeof data.audio === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(data.audio) && AUDIO.includes(mime) ? Buffer.from(data.audio, 'base64') : null
  return { kind: data.kind, language: str(data.language, 12), transcript: scrub(str(data.transcript, 4000)), corrected: scrub(str(data.corrected, 4000)), audio, mime: audio ? mime : null }
}

export function createTrainingCapture({ pool, env = process.env }) {
  const enabled = () => captureEnabled(env)
  const consent = async userId => {
    const result = await pool.query('SELECT training_consent AS consent,training_consent_at AS "consentedAt",training_volume_consent AS volumes,training_volume_consent_at AS "volumesConsentedAt" FROM users WHERE id=$1', [userId])
    return view(result.rows[0])
  }
  // Whole saved volumes (scripts/export-training-volumes) need the general consent too: it is off whenever that is off.
  const view = row => ({ consent: row?.consent === true, consentedAt: row?.consentedAt ?? null, volumes: row?.consent === true && row?.volumes === true, volumesConsentedAt: row?.consent === true && row?.volumes === true ? row?.volumesConsentedAt ?? null : null })
  /** On for this user only when the server is on and they have consented. */
  const enabledFor = async userId => Boolean(userId) && enabled() && (await consent(userId)).consent
  return {
    enabled, consent, enabledFor,
    /** `volumes` is optional; withdrawing the general consent withdraws the volume consent as well. */
    async setConsent(userId, value, volumes) {
      const general = value === true, wholeVolumes = general && (volumes === undefined ? null : volumes === true)
      // SET expressions read the old row, so the timestamp moves only when the volume consent actually changes.
      const next = 'CASE WHEN NOT $2 THEN false WHEN $3::boolean IS NULL THEN training_volume_consent ELSE $3 END'
      const result = await pool.query(`UPDATE users SET training_consent=$2,training_consent_at=now(),training_volume_consent=${next},
        training_volume_consent_at=CASE WHEN ${next} IS DISTINCT FROM training_volume_consent THEN now() ELSE training_volume_consent_at END
        WHERE id=$1 RETURNING training_consent AS consent,training_consent_at AS "consentedAt",training_volume_consent AS volumes,training_volume_consent_at AS "volumesConsentedAt"`, [userId, general, wholeVolumes])
      return view(result.rows[0])
    },
    /** Who may attach a capture to this study ID: its owner, or anyone when it is not a server study (browser-local). */
    async studyAllowed(userId, studyId) {
      const result = await pool.query('SELECT owner_id FROM studies WHERE id=$1', [studyId])
      return !result.rows[0] || result.rows[0].owner_id === userId
    },
    async saveCase(parsed, userId) {
      if (!await enabledFor(userId)) return false
      if (parsed.image) {
        await pool.query('INSERT INTO training_images(sha256,mime,bytes,width,height) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (sha256) DO NOTHING',
          [parsed.image.sha256, parsed.image.mime, parsed.image.bytes, parsed.payload.width ?? null, parsed.payload.height ?? null])
      }
      await pool.query('INSERT INTO training_cases(kind,study_ref,image_ref,image_sha256,modality,model,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [parsed.kind, parsed.studyRef, parsed.imageRef, parsed.image?.sha256 ?? null, parsed.modality, parsed.model, JSON.stringify(parsed.payload)])
      return true
    },
    async saveDictation(userId, event) {
      if (!await enabledFor(userId)) return false
      await pool.query('INSERT INTO dictation_events(kind,user_ref,language,transcript,corrected,error,audio,audio_mime) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [event.kind, ref('user', userId, env), event.language || '', event.transcript || '', event.corrected || '', event.error || '', event.audio ?? null, event.audio ? event.mime : null])
      return true
    },
    /** Unsynced records with their image or audio bytes, oldest first, for the durable-storage sync. */
    async unsyncedBatch(limit = 40) {
      const cases = await pool.query(`SELECT c.id::text,c.kind,c.study_ref,c.image_ref,c.image_sha256,c.modality,c.model,c.payload,c.created_at,i.mime,encode(i.bytes,'base64') AS image_b64
        FROM training_cases c LEFT JOIN training_images i ON i.sha256=c.image_sha256 WHERE c.synced_at IS NULL ORDER BY c.id LIMIT $1`, [limit])
      const dictation = await pool.query(`SELECT id::text,kind,user_ref,language,transcript,corrected,error,audio_mime,encode(audio,'base64') AS audio_b64,created_at
        FROM dictation_events WHERE synced_at IS NULL ORDER BY id LIMIT $1`, [limit])
      return { cases: cases.rows, dictation: dictation.rows }
    },
    async markSynced({ cases = [], dictation = [] }) {
      const ids = list => (Array.isArray(list) ? list.filter(id => typeof id === 'string' && /^\d{1,18}$/.test(id)).slice(0, 1000) : [])
      await pool.query('UPDATE training_cases SET synced_at=now() WHERE id = ANY($1::bigint[])', [ids(cases)])
      await pool.query('UPDATE dictation_events SET synced_at=now() WHERE id = ANY($1::bigint[])', [ids(dictation)])
    },
    async cleanup() {
      const days = retentionDays(env)
      await pool.query('DELETE FROM training_cases WHERE created_at<now()-make_interval(days=>$1::int)', [days])
      await pool.query('DELETE FROM dictation_events WHERE created_at<now()-make_interval(days=>$1::int)', [days])
      await pool.query('DELETE FROM training_images i WHERE NOT EXISTS (SELECT 1 FROM training_cases c WHERE c.image_sha256=i.sha256)')
    },
  }
}
