// Per-user storage allowance. Counted: saved studies (scan images, patient data, reports, AI analysis and the
// user's review decisions, all inside the study payload), uploaded volumes, and the user's dictation feedback clips.
// Not counted: de-identified training cases, which are pseudonymous organisation data with their own retention.
import { ref } from './trainingCapture.mjs'

export const GiB = 1024 ** 3
const MAX_QUOTA = 1024 ** 4

/** Server default from STORAGE_QUOTA_BYTES (bytes) or STORAGE_QUOTA_GB (GiB); 10 GiB when unset. */
export function defaultQuota(env = process.env) {
  const bytes = Number(env.STORAGE_QUOTA_BYTES)
  if (env.STORAGE_QUOTA_BYTES && Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= MAX_QUOTA) return bytes
  const gb = Number(env.STORAGE_QUOTA_GB)
  if (env.STORAGE_QUOTA_GB && Number.isFinite(gb) && gb >= 0 && gb * GiB <= MAX_QUOTA) return Math.round(gb * GiB)
  return 10 * GiB
}

/** A quota an administrator may set: whole bytes up to 1 TiB, or null for the server default. */
export const validQuota = value => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= MAX_QUOTA)

/** Sizes the study write path records: the whole payload, scan images (without analysis) and analysis. */
export function studySizes(study) {
  const images = Array.isArray(study?.images) ? study.images : []
  let imageBytes = 0, analysisBytes = 0
  for (const image of images) {
    if (!image || typeof image !== 'object') continue
    const { analysis, ...scan } = image
    imageBytes += Buffer.byteLength(JSON.stringify(scan))
    if (analysis !== undefined) analysisBytes += Buffer.byteLength(JSON.stringify(analysis))
  }
  return { payloadBytes: Buffer.byteLength(JSON.stringify(study)), imageBytes, analysisBytes }
}

function feedbackRef(userId, env) { try { return ref('user', userId, env) } catch { return null } }

/** Usage and quota for one user. `db` is a pool or a transaction client. */
export async function storageUsage(db, userId, env = process.env) {
  const userRef = feedbackRef(userId, env)
  const [user, studies, volumes, feedback] = await Promise.all([
    db.query('SELECT storage_quota_bytes FROM users WHERE id=$1', [userId]),
    db.query('SELECT count(*)::int AS n,COALESCE(sum(payload_bytes),0)::bigint AS total,COALESCE(sum(image_bytes),0)::bigint AS images,COALESCE(sum(analysis_bytes),0)::bigint AS analysis FROM studies WHERE owner_id=$1', [userId]),
    db.query("SELECT count(*)::int AS n,COALESCE(sum(size_bytes),0)::bigint AS total FROM volume_objects WHERE owner_id=$1 AND (state<>'pending' OR upload_expires_at>now())", [userId]),
    userRef ? db.query('SELECT count(*)::int AS n,COALESCE(sum(octet_length(transcript)+octet_length(corrected)+octet_length(error)+COALESCE(octet_length(audio),0)),0)::bigint AS total FROM dictation_events WHERE user_ref=$1', [userRef]) : { rows: [{ n: 0, total: 0 }] },
  ])
  const s = studies.rows[0], v = volumes.rows[0], f = feedback.rows[0]
  const studyTotal = Number(s.total), images = Number(s.images), analysis = Number(s.analysis)
  const quotaBytes = user.rows[0]?.storage_quota_bytes == null ? defaultQuota(env) : Number(user.rows[0].storage_quota_bytes)
  const breakdown = {
    scans: images + Number(v.total), // study images plus uploaded CT/MR volumes
    patientAndReports: Math.max(0, studyTotal - images - analysis), // patient fields, report text, versions, study metadata
    analysis, // AI findings, boxes, measurements and the user's accept/dismiss decisions
    feedback: Number(f.total), // dictation corrections and clips
  }
  const usedBytes = Object.values(breakdown).reduce((a, b) => a + b, 0)
  return { quotaBytes, usedBytes, availableBytes: Math.max(0, quotaBytes - usedBytes), counts: { studies: s.n, volumes: v.n, feedback: f.n }, breakdown }
}

export function formatBytes(n) {
  for (const [unit, size] of [['GB', GiB], ['MB', 1024 ** 2], ['KB', 1024]]) if (n >= size) return `${(n / size).toFixed(n >= 10 * size ? 0 : 1)} ${unit}`
  return `${n} B`
}
export const quotaError = (usage, extraBytes) => Object.assign(new Error(`This would exceed your storage allowance (${formatBytes(usage.usedBytes)} of ${formatBytes(usage.quotaBytes)} used; this save needs ${formatBytes(extraBytes)}). Delete studies or volumes, or ask an administrator for more space.`), { status: 413, code: 'storage_quota_exceeded', extraBytes })

/**
 * Refuse a write that would take the user over their allowance. Call inside the write transaction after locking
 * the user row (SELECT … FOR UPDATE), so concurrent saves are counted one after another. `releasedBytes` is what the
 * write replaces (the previous version of a study).
 */
export async function ensureRoom(client, userId, addBytes, releasedBytes = 0, env = process.env) {
  const usage = await storageUsage(client, userId, env)
  if (usage.usedBytes - releasedBytes + addBytes > usage.quotaBytes) throw quotaError(usage, addBytes)
  return usage
}
