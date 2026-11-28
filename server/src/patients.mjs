// Patient register: every patient gets a permanent RadGenis ID (RG-YY-NNNNNN) and can be found again by that ID, name,
// phone, ABHA number / address, or Aadhaar. Aadhaar is never stored: only a keyed one-way hash (to match it later) and
// its last four digits (to show it masked), as the Aadhaar rules require. Each reader sees only their own patients.
import { createHmac, randomBytes, randomUUID } from 'node:crypto'

// Verhoeff checksum, used by Aadhaar numbers.
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
export function verhoeffValid(digits) {
  let c = 0
  ;[...digits].reverse().forEach((d, i) => { c = D[c][P[i % 8][Number(d)]] })
  return c === 0
}

const digitsOf = (v) => (typeof v === 'string' ? v.replace(/[\s-]/g, '') : '')
/** 12 digits, not starting 0 or 1, valid checksum. Returns the digits or null. */
export function normaliseAadhaar(value) {
  const d = digitsOf(value)
  return /^[2-9]\d{11}$/.test(d) && verhoeffValid(d) ? d : null
}
/** ABHA number: 14 digits, shown as 12-3456-7890-1234. */
export function normaliseAbhaNumber(value) {
  const d = digitsOf(value)
  return /^\d{14}$/.test(d) ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10)}` : null
}
/** ABHA address, e.g. asha.rao@abdm (sbx in the ABDM sandbox). */
export function normaliseAbhaAddress(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[a-z0-9][a-z0-9._]{2,31}@(abdm|sbx)$/.test(v) ? v : null
}
export const MRN_PATTERN = /^RG-\d{2}-\d{6}$/i
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : null)

/**
 * Validates a new patient or an update. Identifiers may be given as '' or null to clear them (ABHA) — Aadhaar can be
 * added or replaced but, once stored as a hash, is cleared with aadhaar: null.
 */
export function parsePatient(data, { partial = false } = {}) {
  if (!data || typeof data !== 'object') return { error: 'Request must contain a JSON object.' }
  const v = {}
  if ('name' in data || !partial) {
    const name = clean(data.name ?? '', 120)
    if (name === null) return { error: 'Name must be text.' }
    if (!partial && !name) return { error: 'Enter the patient’s name.' }
    v.name = name
  }
  if ('sex' in data) {
    if (!['', 'M', 'F', 'O'].includes(data.sex)) return { error: 'Sex must be M, F or O.' }
    v.sex = data.sex
  }
  if ('birthDate' in data) {
    if (data.birthDate === null || data.birthDate === '') v.birthDate = null
    else if (typeof data.birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.birthDate) || Number.isNaN(Date.parse(data.birthDate)) || data.birthDate > new Date().toISOString().slice(0, 10) || data.birthDate < '1900-01-01') return { error: 'Date of birth must be a real past date.' }
    else v.birthDate = data.birthDate
  }
  if ('phone' in data) {
    const phone = clean(data.phone ?? '', 20)
    if (phone === null || (phone && !/^\+?[\d ()-]{7,20}$/.test(phone))) return { error: 'Phone must be a phone number.' }
    v.phone = phone
  }
  if ('abhaNumber' in data) {
    if (data.abhaNumber === null || data.abhaNumber === '') v.abhaNumber = null
    else if (!(v.abhaNumber = normaliseAbhaNumber(data.abhaNumber))) return { error: 'ABHA number must be 14 digits.' }
  }
  if ('abhaAddress' in data) {
    if (data.abhaAddress === null || data.abhaAddress === '') v.abhaAddress = null
    else if (!(v.abhaAddress = normaliseAbhaAddress(data.abhaAddress))) return { error: 'ABHA address looks like name@abdm.' }
  }
  if ('aadhaar' in data) {
    if (data.aadhaar === null) v.aadhaar = null
    else if (data.aadhaar !== '' && !(v.aadhaar = normaliseAadhaar(data.aadhaar))) return { error: 'That is not a valid Aadhaar number. Check the 12 digits.' }
  }
  if (partial && !Object.keys(v).length) return { error: 'Nothing to update.' }
  return { value: v }
}

/** Public shape: never includes the Aadhaar hash. */
export function patientView(row) {
  return {
    id: row.id, mrn: row.mrn, name: row.name, sex: row.sex, phone: row.phone,
    birthDate: row.birth_date ? (row.birth_date instanceof Date ? row.birth_date.toISOString().slice(0, 10) : String(row.birth_date).slice(0, 10)) : null,
    abhaNumber: row.abha_number ?? null, abhaAddress: row.abha_address ?? null,
    aadhaarMasked: row.aadhaar_last4 ? `XXXX XXXX ${row.aadhaar_last4}` : null,
    studyCount: row.study_count ?? undefined, lastStudyDate: row.last_study_date ?? undefined,
    createdAt: row.created_at,
  }
}

// Dates as text: the driver would turn a date into local midnight, which shifts the day east of UTC.
const COLUMNS = "id,mrn,name,sex,to_char(birth_date,'YYYY-MM-DD') AS birth_date,phone,abha_number,abha_address,aadhaar_last4,created_at"

export function createPatientRoutes({ pool, body, send, audit, secret = process.env.PATIENT_ID_SECRET }) {
  let pepper = secret || null
  // Without PATIENT_ID_SECRET, a random key is made once and kept in the database, so matches stay stable.
  async function key() {
    if (pepper) return pepper
    await pool.query("INSERT INTO server_secrets(name,value) VALUES ('patient_id_pepper',$1) ON CONFLICT (name) DO NOTHING", [randomBytes(32).toString('hex')])
    pepper = (await pool.query("SELECT value FROM server_secrets WHERE name='patient_id_pepper'")).rows[0].value
    return pepper
  }
  const aadhaarHash = async (digits) => createHmac('sha256', await key()).update(`aadhaar:${digits}`).digest('hex')

  /** Another of this reader's patients already holding one of these identifiers. */
  async function duplicateOf(ownerId, v, exceptId = null) {
    const checks = []
    if (v.aadhaarHash) checks.push(['aadhaar_hash', v.aadhaarHash, 'Aadhaar'])
    if (v.abhaNumber) checks.push(['abha_number', v.abhaNumber, 'ABHA number'])
    if (v.abhaAddress) checks.push(['abha_address', v.abhaAddress, 'ABHA address'])
    for (const [column, value, label] of checks) {
      const row = (await pool.query(`SELECT ${COLUMNS} FROM patients WHERE owner_id=$1 AND ${column}=$2 AND ($3::uuid IS NULL OR id<>$3)`, [ownerId, value, exceptId])).rows[0]
      if (row) return { label, patient: patientView(row) }
    }
    return null
  }

  async function search(ownerId, q) {
    const query = (q ?? '').trim().slice(0, 120)
    const base = `SELECT ${COLUMNS},
      (SELECT count(*)::int FROM studies s WHERE s.owner_id=p.owner_id AND btrim(s.payload->'patient'->>'patientId')=p.mrn) AS study_count,
      (SELECT max(s.payload->'patient'->>'studyDate') FROM studies s WHERE s.owner_id=p.owner_id AND btrim(s.payload->'patient'->>'patientId')=p.mrn) AS last_study_date
      FROM patients p WHERE p.owner_id=$1`
    if (!query) return { by: 'recent', rows: (await pool.query(`${base} ORDER BY p.updated_at DESC LIMIT 20`, [ownerId])).rows }
    const digits = digitsOf(query)
    if (/^\d{12}$/.test(digits) && !/^\+/.test(query)) {
      const aadhaar = normaliseAadhaar(digits)
      if (!aadhaar) return { error: 'That is not a valid Aadhaar number. Check the 12 digits.' }
      return { by: 'aadhaar', rows: (await pool.query(`${base} AND p.aadhaar_hash=$2`, [ownerId, await aadhaarHash(aadhaar)])).rows }
    }
    if (/^\d{14}$/.test(digits)) return { by: 'abha', rows: (await pool.query(`${base} AND p.abha_number=$2`, [ownerId, normaliseAbhaNumber(digits)])).rows }
    if (normaliseAbhaAddress(query)) return { by: 'abha', rows: (await pool.query(`${base} AND p.abha_address=$2`, [ownerId, normaliseAbhaAddress(query)])).rows }
    if (MRN_PATTERN.test(query)) return { by: 'id', rows: (await pool.query(`${base} AND p.mrn=$2`, [ownerId, query.toUpperCase()])).rows }
    if (/^\+?[\d\s()-]{7,}$/.test(query)) return { by: 'phone', rows: (await pool.query(`${base} AND regexp_replace(p.phone,'\\D','','g') LIKE '%' || $2 ORDER BY p.updated_at DESC LIMIT 20`, [ownerId, digits.slice(-10)])).rows }
    const like = `%${query.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    return { by: 'name', rows: (await pool.query(`${base} AND (lower(p.name) LIKE $2 OR lower(p.mrn) LIKE $2) ORDER BY p.updated_at DESC LIMIT 20`, [ownerId, like])).rows }
  }

  /** Handles /api/patients routes; returns true when it answered. */
  return async function handle(req, res, path, user) {
    // Search is a POST so an Aadhaar or ABHA typed into it never appears in a URL or request log.
    if (path === '/api/patients/search' && req.method === 'POST') {
      const { q } = await body(req, 1024)
      if (q !== undefined && typeof q !== 'string') return send(res, 400, { error: 'q must be text.' }), true
      const found = await search(user.id, q)
      if (found.error) return send(res, 400, { error: found.error }), true
      if (found.by === 'aadhaar' || found.by === 'abha') await audit(user.id, `patient.lookup_${found.by}`)
      return send(res, 200, { by: found.by, patients: found.rows.map(patientView) }), true
    }
    if (path === '/api/patients' && req.method === 'POST') {
      const parsed = parsePatient(await body(req, 4096))
      if (parsed.error) return send(res, 400, { error: parsed.error }), true
      const v = parsed.value
      if (v.aadhaar) v.aadhaarHash = await aadhaarHash(v.aadhaar)
      const dup = await duplicateOf(user.id, v)
      if (dup) return send(res, 409, { error: `This ${dup.label} is already registered to ${dup.patient.name || 'a patient'} (${dup.patient.mrn}).`, patient: dup.patient }), true
      const id = randomUUID()
      const row = (await pool.query(`INSERT INTO patients(id,owner_id,mrn,name,sex,birth_date,phone,abha_number,abha_address,aadhaar_hash,aadhaar_last4)
        VALUES ($1,$2,'RG-' || to_char(now() AT TIME ZONE 'UTC','YY') || '-' || lpad(nextval('patient_mrn_seq')::text,6,'0'),$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${COLUMNS}`,
        [id, user.id, v.name, v.sex ?? '', v.birthDate ?? null, v.phone ?? '', v.abhaNumber ?? null, v.abhaAddress ?? null, v.aadhaarHash ?? null, v.aadhaar ? v.aadhaar.slice(-4) : null])).rows[0]
      await audit(user.id, 'patient.registered', id)
      return send(res, 201, { patient: patientView(row) }), true
    }
    const match = /^\/api\/patients\/([0-9a-f-]{36})$/.exec(path)
    if (!match) return false
    const id = match[1]
    const current = (await pool.query(`SELECT ${COLUMNS} FROM patients WHERE id=$1 AND owner_id=$2`, [id, user.id])).rows[0]
    if (!current) return send(res, 404, { error: 'Patient not found.' }), true
    if (req.method === 'GET') return send(res, 200, { patient: patientView(current) }), true
    if (req.method === 'PATCH') {
      const parsed = parsePatient(await body(req, 4096), { partial: true })
      if (parsed.error) return send(res, 400, { error: parsed.error }), true
      const v = parsed.value
      if (v.aadhaar) v.aadhaarHash = await aadhaarHash(v.aadhaar)
      const dup = await duplicateOf(user.id, v, id)
      if (dup) return send(res, 409, { error: `This ${dup.label} is already registered to ${dup.patient.name || 'another patient'} (${dup.patient.mrn}).`, patient: dup.patient }), true
      const sets = [], args = [id, user.id]
      const put = (column, value) => { args.push(value); sets.push(`${column}=$${args.length}`) }
      if ('name' in v) put('name', v.name)
      if ('sex' in v) put('sex', v.sex)
      if ('birthDate' in v) put('birth_date', v.birthDate)
      if ('phone' in v) put('phone', v.phone)
      if ('abhaNumber' in v) put('abha_number', v.abhaNumber)
      if ('abhaAddress' in v) put('abha_address', v.abhaAddress)
      if ('aadhaar' in v) { put('aadhaar_hash', v.aadhaarHash ?? null); put('aadhaar_last4', v.aadhaar ? v.aadhaar.slice(-4) : null) }
      const row = (await pool.query(`UPDATE patients SET ${sets.join(',')},updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING ${COLUMNS}`, args)).rows[0]
      await audit(user.id, 'patient.updated', id)
      return send(res, 200, { patient: patientView(row) }), true
    }
    return send(res, 405, { error: 'Method not allowed.' }), true
  }
}
