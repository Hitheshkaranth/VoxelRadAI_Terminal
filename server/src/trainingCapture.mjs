// Model-improvement capture: de-identified analysis cases, signed-report ground truth and
// dictation clips that failed or were corrected. On by default; TRAINING_CAPTURE=off disables it.
import { createHash, createHmac } from 'node:crypto'

export const TRAINING_BODY_LIMIT = (process.env.VERCEL ? 4 : 10) * 1024 * 1024
export const DICTATION_FEEDBACK_LIMIT = 3 * 1024 * 1024
export const captureEnabled = (env = process.env) => !/^(off|false|0|no)$/i.test(env.TRAINING_CAPTURE ?? 'on')
export const retentionDays = (env = process.env) => Math.min(3650, Math.max(7, Number(env.TRAINING_RETENTION_DAYS) || 365))

const SECRET = () => process.env.TRAINING_PSEUDONYM_SECRET || 'voxelrad-training'
/** One-way, keyed pseudonym so records join across events without revealing the source ID. */
export const ref = (kind, id) => createHmac('sha256', SECRET()).update(`${kind}:${id}`).digest('hex').slice(0, 20)

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Remove contact details, ID-like numbers and full dates from free text. Known patient names are removed client-side. */
export function scrub(text) {
  return str(text, 20000)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]')
    .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, '[DATE]')
    .replace(/\b(?:\+?\d[\d -]{8,}\d)\b/g, '[NUMBER]')
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
export function parseCase(data) {
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
  return {
    kind: data.kind, studyRef: ref('study', data.studyId), imageRef: imageId ? ref('image', `${data.studyId}/${imageId}`) : null,
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
  return {
    enabled,
    async saveCase(parsed) {
      if (!enabled()) return false
      if (parsed.image) {
        await pool.query('INSERT INTO training_images(sha256,mime,bytes,width,height) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (sha256) DO NOTHING',
          [parsed.image.sha256, parsed.image.mime, parsed.image.bytes, parsed.payload.width ?? null, parsed.payload.height ?? null])
      }
      await pool.query('INSERT INTO training_cases(kind,study_ref,image_ref,image_sha256,modality,model,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [parsed.kind, parsed.studyRef, parsed.imageRef, parsed.image?.sha256 ?? null, parsed.modality, parsed.model, JSON.stringify(parsed.payload)])
      return true
    },
    async saveDictation(userId, event) {
      if (!enabled()) return false
      await pool.query('INSERT INTO dictation_events(kind,user_ref,language,transcript,corrected,error,audio,audio_mime) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [event.kind, ref('user', userId), event.language || '', event.transcript || '', event.corrected || '', event.error || '', event.audio ?? null, event.audio ? event.mime : null])
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
