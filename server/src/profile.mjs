// Account profile and usage: who the reader is, their centre and machines, their photo and centre logo, and how much
// they have used the hosted service (model reads = credits, studies saved, storage) by day, month and year.

export const MODALITIES = ['X-ray', 'CT', 'MRI', 'Ultrasound', 'Mammography', 'Fluoroscopy', 'Other']
const LIMITS = { fullName: 120, organization: 160, jobRole: 80, centerName: 160, centerLocation: 200, phone: 40 }
const IMAGE_MAX_CHARS = 400 * 1024 // ~300 KB of image data as base64
const clean = (v) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : null

/** A small PNG / JPEG / WebP data URL whose bytes really are that format; null clears; undefined leaves unchanged. */
export function parseImage(value, label) {
  if (value === undefined) return { value: undefined }
  if (value === null || value === '') return { value: null }
  if (typeof value !== 'string') return { error: `${label} must be an image.` }
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!m) return { error: `${label} must be a PNG, JPEG or WebP image.` }
  if (value.length > IMAGE_MAX_CHARS) return { error: `${label} must be 300 KB or smaller. Use a smaller image.` }
  const head = Buffer.from(m[2].slice(0, 24), 'base64')
  const ok = m[1] === 'png' ? head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : m[1] === 'jpeg' ? head[0] === 0xff && head[1] === 0xd8
    : head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP'
  return ok ? { value } : { error: `${label} is not a valid ${m[1].toUpperCase()} image.` }
}

/** Validates a profile update. Returns { error } or { value } with only the fields present, normalised. */
export function parseProfile(data) {
  if (!data || typeof data !== 'object') return { error: 'Request must contain a JSON object.' }
  const value = {}
  for (const [field, max] of Object.entries(LIMITS)) {
    if (!(field in data)) continue
    const v = clean(data[field])
    if (v === null) return { error: `${field} must be text.` }
    if (v.length > max) return { error: `${field} must be ${max} characters or fewer.` }
    value[field] = v
  }
  if ('equipment' in data) {
    if (!Array.isArray(data.equipment) || data.equipment.length > 20) return { error: 'List up to 20 machines.' }
    const out = []
    for (const item of data.equipment) {
      if (!item || typeof item !== 'object') return { error: 'Each machine needs a modality.' }
      const modality = MODALITIES.includes(item.modality) ? item.modality : null
      const manufacturer = clean(item.manufacturer ?? '') ?? '', model = clean(item.model ?? '') ?? '', year = clean(item.year ?? '') ?? ''
      if (!modality) return { error: `Machine modality must be one of: ${MODALITIES.join(', ')}.` }
      if (manufacturer.length > 80 || model.length > 80) return { error: 'Machine manufacturer and model must be 80 characters or fewer.' }
      if (year && !/^(19|20)\d\d$/.test(year)) return { error: 'Machine year must look like 2021.' }
      if (!manufacturer && !model) continue
      out.push({ modality, manufacturer, model, ...(year ? { year } : {}) })
    }
    value.equipment = out
  }
  for (const [field, label] of [['avatar', 'Profile photo'], ['centerLogo', 'Centre logo']]) {
    const parsed = parseImage(data[field], label)
    if (parsed.error) return { error: parsed.error }
    if (parsed.value !== undefined) value[field] = parsed.value
  }
  if (!Object.keys(value).length) return { error: 'Nothing to update.' }
  return { value }
}

const COLUMNS = { fullName: 'full_name', organization: 'organization', jobRole: 'job_role', centerName: 'center_name', centerLocation: 'center_location', phone: 'phone', equipment: 'equipment', avatar: 'avatar', centerLogo: 'center_logo' }

export async function readProfile(pool, userId) {
  const row = (await pool.query('SELECT email,role,full_name,organization,job_role,center_name,center_location,phone,equipment,avatar,center_logo,created_at,last_login_at FROM users WHERE id=$1', [userId])).rows[0]
  if (!row) return null
  return {
    email: row.email, role: row.role, fullName: row.full_name, organization: row.organization, jobRole: row.job_role,
    centerName: row.center_name, centerLocation: row.center_location, phone: row.phone,
    equipment: Array.isArray(row.equipment) ? row.equipment : [], avatar: row.avatar || null, centerLogo: row.center_logo || null,
    memberSince: row.created_at, lastSignIn: row.last_login_at,
  }
}

export async function writeProfile(pool, userId, value) {
  const fields = Object.keys(value)
  const sets = fields.map((f, i) => `${COLUMNS[f]}=$${i + 2}${f === 'equipment' ? '::jsonb' : ''}`)
  const args = fields.map((f) => (f === 'equipment' ? JSON.stringify(value[f]) : value[f]))
  await pool.query(`UPDATE users SET ${sets.join(',')} WHERE id=$1`, [userId, ...args])
}

/**
 * Usage in UTC buckets (the daily read allowance resets at 00:00 UTC): last 30 days, last 12 months, last 5 years,
 * each with model reads and new studies, plus all-time totals and today's reads against the allowance.
 */
export async function readUsage(pool, userId) {
  const series = async (unit, count) => {
    const step = unit === 'day' ? '1 day' : unit === 'month' ? '1 month' : '1 year'
    const rows = (await pool.query(`
      WITH buckets AS (
        SELECT generate_series(date_trunc('${unit}', now() AT TIME ZONE 'UTC') - interval '${step}' * ($2 - 1), date_trunc('${unit}', now() AT TIME ZONE 'UTC'), interval '${step}') AS start
      )
      SELECT to_char(b.start, 'YYYY-MM-DD') AS start,
        count(e.id) FILTER (WHERE e.kind='model_read')::int AS reads,
        count(e.id) FILTER (WHERE e.kind='study_created')::int AS studies
      FROM buckets b
      LEFT JOIN usage_events e ON e.user_id=$1 AND date_trunc('${unit}', e.created_at AT TIME ZONE 'UTC')=b.start
      GROUP BY b.start ORDER BY b.start`, [userId, count])).rows
    return rows
  }
  const [daily, monthly, yearly, totals, byModality] = await Promise.all([
    series('day', 30), series('month', 12), series('year', 5),
    pool.query(`SELECT count(*) FILTER (WHERE kind='model_read')::int AS reads, count(*) FILTER (WHERE kind='study_created')::int AS studies,
      count(*) FILTER (WHERE kind='model_read' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS "readsToday",
      count(*) FILTER (WHERE kind='model_read' AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS "readsThisMonth"
      FROM usage_events WHERE user_id=$1`, [userId]),
    // Volume jobs record "ct"/"mri"; studies record "CT"/"MRI"/"X-ray": one label per modality.
    pool.query(`SELECT CASE lower(COALESCE(modality,'')) WHEN 'ct' THEN 'CT' WHEN 'mri' THEN 'MRI' WHEN 'mr' THEN 'MRI' WHEN 'x-ray' THEN 'X-ray' WHEN 'xray' THEN 'X-ray' WHEN 'cr' THEN 'X-ray' WHEN 'dx' THEN 'X-ray' WHEN '' THEN 'Unspecified' ELSE modality END AS modality,
      count(*)::int AS n FROM usage_events WHERE user_id=$1 GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [userId]),
  ])
  return { daily, monthly, yearly, totals: totals.rows[0], byModality: byModality.rows }
}
