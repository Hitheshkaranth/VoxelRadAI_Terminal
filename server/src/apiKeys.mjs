// Administrator-issued API keys for server-to-server model reads at /api/v1. A key authorises only the
// /api/v1 model routes, never studies, sharing, administration or any other app API. Plaintext keys are
// returned once at creation and stored only as SHA-256 hashes.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { hashToken } from './security.mjs'

export const KEY_PATTERN = /^vr_(live|test)_[A-Za-z0-9_-]{43}$/
export const KEY_KINDS = ['live', 'test']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TEXT = /^[^\u0000-\u001f\u007f]+$/

export const newApiKey = kind => `vr_${kind}_${randomBytes(32).toString('base64url')}`
export const keyPrefix = key => key.slice(0, 12)

function limitFrom(value, fallback) {
  const number = Number(value)
  return value !== undefined && value !== '' && Number.isInteger(number) && number >= 0 && number <= 10000 ? number : fallback
}
/** Default daily read caps per key kind; a key's own daily_read_limit overrides them. */
export const defaultLimits = (env = process.env) => ({ live: limitFrom(env.API_LIVE_DAILY_READS, 200), test: limitFrom(env.API_TEST_DAILY_READS, 20) })
export const webhooksConfigured = (env = process.env) => typeof env.API_WEBHOOK_SECRET === 'string' && env.API_WEBHOOK_SECRET.length >= 32

/** Per-key webhook signing secret, derived so it never has to be stored: HMAC(API_WEBHOOK_SECRET, key id). */
export function webhookSecretFor(keyId, env = process.env) {
  if (!webhooksConfigured(env)) return null
  return 'whsec_' + createHmac('sha256', env.API_WEBHOOK_SECRET).update(`voxelrad-webhook:${keyId}`).digest('base64url')
}

/** The key in `Authorization: Bearer vr_…`, '' when the header is absent, or null when it is malformed. */
export function bearerKey(header) {
  if (header === undefined || header === '') return ''
  if (typeof header !== 'string') return null
  const match = header.match(/^Bearer\s+(\S+)\s*$/i)
  return match && KEY_PATTERN.test(match[1]) ? match[1] : null
}

export const effectiveLimit = (key, env = process.env) => key.daily_read_limit ?? defaultLimits(env)[key.kind]

/**
 * Admin create body → { value } or { error }. A key belongs either to a new organisation (`organisation`, its
 * name) or to an existing one (`organisationId`, chosen from the list); names may repeat and grant nothing.
 */
export function parseKeyRequest(data) {
  const text = (value, max) => typeof value === 'string' && value.trim() && value.trim().length <= max && TEXT.test(value.trim()) ? value.trim() : null
  const given = value => value !== undefined && value !== null && value !== ''
  let organisationId = null, organisation = null
  if (given(data.organisationId)) {
    if (given(data.organisation)) return { error: 'Choose an existing organisation or enter a new one, not both.' }
    if (typeof data.organisationId !== 'string' || !UUID.test(data.organisationId)) return { error: 'Choose an organisation from the list.' }
    organisationId = data.organisationId.toLowerCase()
  } else {
    organisation = text(data.organisation, 120)
    if (!organisation) return { error: 'Enter the organisation name (up to 120 characters).' }
  }
  const label = text(data.label, 120)
  if (!label) return { error: 'Enter a label for this key (up to 120 characters).' }
  if (!KEY_KINDS.includes(data.kind)) return { error: 'Choose a live or test key.' }
  let dailyReadLimit = null
  if (given(data.dailyReadLimit)) {
    if (!Number.isInteger(data.dailyReadLimit) || data.dailyReadLimit < 0 || data.dailyReadLimit > 10000) return { error: 'Daily read limit must be a whole number from 0 to 10,000.' }
    dailyReadLimit = data.dailyReadLimit
  }
  let dataAgreementId = null
  if (given(data.dataAgreementId)) {
    dataAgreementId = text(data.dataAgreementId, 200)
    if (!dataAgreementId) return { error: 'Data agreement reference must be up to 200 characters.' }
  }
  return { value: { organisationId, organisation, label, kind: data.kind, dailyReadLimit, dataAgreementId } }
}

const COLUMNS = ['id', 'organisation_id', 'owner_id', 'label', 'prefix', 'kind', 'daily_read_limit', 'data_agreement_id', 'webhook_secret_issued', 'created_at', 'last_used_at', 'revoked_at']
const KEY_COLUMNS = COLUMNS.map(column => `k.${column}`).join(',') + ',o.name AS organisation'
const KEYS = 'api_keys k JOIN api_organisations o ON o.id=k.organisation_id'

/** SQL persistence for keys and organisations, and the throttle used for denied-use audit events. */
export function createKeyStore(pool) {
  return {
    /**
     * Insert a key and, when `organisation` (a name) is given, its new organisation, in one statement.
     * With `organisation` null the key joins the existing `organisationId`; returns null when that does not exist.
     */
    async insert(row) {
      const result = await pool.query(`WITH new_org AS (INSERT INTO api_organisations(id,name) SELECT $2::uuid,$3::text WHERE $3::text IS NOT NULL RETURNING id,name),
 o AS (SELECT id,name FROM new_org UNION ALL SELECT id,name FROM api_organisations WHERE id=$2::uuid AND $3::text IS NULL),
 k AS (INSERT INTO api_keys(id,organisation_id,owner_id,label,prefix,key_hash,kind,daily_read_limit,data_agreement_id,webhook_secret_issued) SELECT $1,o.id,$4,$5,$6,$7,$8,$9,$10,$11 FROM o RETURNING ${COLUMNS.join(',')})
 SELECT ${KEY_COLUMNS} FROM k JOIN o ON o.id=k.organisation_id`, [row.id, row.organisationId, row.organisation, row.ownerId, row.label, row.prefix, row.keyHash, row.kind, row.dailyReadLimit, row.dataAgreementId, row.webhookSecretIssued])
      return result.rows[0] || null
    },
    async list() { return (await pool.query(`SELECT ${KEY_COLUMNS} FROM ${KEYS} ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC LIMIT 500`)).rows },
    async organisations() {
      return (await pool.query('SELECT o.id,o.name,o.created_at,(count(k.id) FILTER (WHERE k.revoked_at IS NULL))::int AS active_keys FROM api_organisations o LEFT JOIN api_keys k ON k.organisation_id=o.id GROUP BY o.id ORDER BY lower(o.name),o.created_at LIMIT 500')).rows
    },
    /** Returns { row, changed } (changed is false when it was already revoked), or null for an unknown key. */
    async revoke(id) {
      const result = await pool.query(`WITH k AS (UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING *) SELECT ${KEY_COLUMNS} FROM k JOIN api_organisations o ON o.id=k.organisation_id`, [id])
      if (result.rows[0]) return { row: result.rows[0], changed: true }
      const existing = await pool.query(`SELECT ${KEY_COLUMNS} FROM ${KEYS} WHERE k.id=$1`, [id])
      return existing.rows[0] ? { row: existing.rows[0], changed: false } : null
    },
    async findByHash(hash) { return (await pool.query(`SELECT ${KEY_COLUMNS},k.key_hash FROM ${KEYS} WHERE k.key_hash=$1`, [hash])).rows[0] || null },
    // last_used_at is refreshed at most once a minute to limit writes.
    touch: id => pool.query("UPDATE api_keys SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at<now()-interval '1 minute')", [id]),
    /** True the first time `bucket` is seen in a one-minute window (login_attempts upsert pattern). */
    async firstInWindow(bucket) {
      const result = await pool.query("INSERT INTO login_attempts(key_hash,attempts,resets_at) VALUES ($1,1,now()+interval '1 minute') ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN login_attempts.resets_at<now() THEN 1 ELSE login_attempts.attempts+1 END,resets_at=CASE WHEN login_attempts.resets_at<now() THEN now()+interval '1 minute' ELSE login_attempts.resets_at END RETURNING attempts", [hashToken(bucket)])
      return result.rows[0].attempts === 1
    },
  }
}

const view = (row, env) => ({
  id: row.id, organisationId: row.organisation_id, organisation: row.organisation, label: row.label, prefix: row.prefix, kind: row.kind,
  webhooks: row.webhook_secret_issued === true,
  dailyReadLimit: effectiveLimit(row, env), customLimit: row.daily_read_limit !== null && row.daily_read_limit !== undefined,
  dataAgreementId: row.data_agreement_id ?? null, createdAt: row.created_at, lastUsedAt: row.last_used_at ?? null, revokedAt: row.revoked_at ?? null,
})

/**
 * `audit(actorId, eventType, subjectId)` records events; `confirmAdmin(user, password)` re-checks the administrator's password.
 * `apiAvailable` reports whether the hosted model bridge is configured.
 */
export function createApiKeys({ store, env = process.env, body, send, audit, confirmAdmin, apiAvailable = () => true }) {
  const reply = (...args) => { send(...args); return true }
  /** Denied use of an existing key (revoked, over its cap). At most one audit event per key and reason per minute. */
  async function auditDenied(keyId, reason) {
    try { if (await store.firstInWindow(`apikey-denied:${reason}:${keyId}`)) await audit(null, `apikey.denied_${reason}`, keyId) } catch { /* auditing must not change the response */ }
  }

  /** Resolve the Bearer key on a request. Returns { key } or { error: { status, code, message } }. */
  async function authenticate(req) {
    const plain = bearerKey(req.headers.authorization)
    if (plain === '') return { error: { status: 401, code: 'missing_api_key', message: 'Send your API key as Authorization: Bearer vr_live_… (or vr_test_…).' } }
    if (!plain) return { error: { status: 401, code: 'invalid_api_key', message: 'The API key is not valid.' } }
    const hash = hashToken(plain)
    const row = await store.findByHash(hash)
    // The row was found by its hash; compare again in constant time before trusting it.
    const matches = row && typeof row.key_hash === 'string' && row.key_hash.length === hash.length && timingSafeEqual(Buffer.from(row.key_hash), Buffer.from(hash))
    if (!matches || row.kind !== plain.split('_')[1]) return { error: { status: 401, code: 'invalid_api_key', message: 'The API key is not valid.' } }
    if (row.revoked_at) {
      await auditDenied(row.id, 'revoked')
      return { error: { status: 401, code: 'key_revoked', message: 'This API key has been revoked. Ask your RadGenie administrator for a new key.' } }
    }
    await store.touch(row.id).catch(() => {})
    // `webhooks` is false for a key issued before API_WEBHOOK_SECRET was set: it was never shown a signing secret.
    return { key: { id: row.id, organisationId: row.organisation_id, organisation: row.organisation, label: row.label, kind: row.kind, dailyReadLimit: effectiveLimit(row, env), webhooks: row.webhook_secret_issued === true && webhooksConfigured(env) } }
  }

  /** Admin endpoints under /api/admin/api-keys. The caller has already checked the session is an administrator. */
  async function handleAdmin(req, res, path, user) {
    if (path === '/api/admin/api-keys' && req.method === 'GET') {
      const rows = await store.list()
      const organisations = (await store.organisations()).map(row => ({ id: row.id, name: row.name, createdAt: row.created_at, activeKeys: Number(row.active_keys) || 0 }))
      return reply(res, 200, { keys: rows.map(row => view(row, env)), organisations, defaults: defaultLimits(env), webhooksConfigured: webhooksConfigured(env), apiAvailable: apiAvailable() })
    }
    if (path === '/api/admin/api-keys' && req.method === 'POST') {
      const data = await body(req, 4096)
      const parsed = parseKeyRequest(data)
      if (parsed.error) return reply(res, 400, { error: parsed.error })
      if (!await confirmAdmin(user, data.currentPassword)) return reply(res, 403, { error: 'Administrator password is incorrect.' })
      const secret = newApiKey(parsed.value.kind)
      const id = randomUUID(), webhookSecretIssued = webhooksConfigured(env)
      const row = await store.insert({ id, ownerId: user.id, prefix: keyPrefix(secret), keyHash: hashToken(secret), webhookSecretIssued, ...parsed.value, organisationId: parsed.value.organisationId ?? randomUUID() })
      if (!row) return reply(res, 400, { error: 'That organisation no longer exists. Reload the list and choose again.' })
      await audit(user.id, 'apikey.created', row.id)
      // The only time the key and its webhook secret are ever returned.
      return reply(res, 201, { key: view(row, env), secret, webhookSecret: webhookSecretIssued ? webhookSecretFor(row.id, env) : null })
    }
    const revoke = path.match(/^\/api\/admin\/api-keys\/([^/]+)\/revoke$/)
    if (revoke && req.method === 'POST') {
      if (!UUID.test(revoke[1])) return reply(res, 404, { error: 'API key not found.' })
      const revoked = await store.revoke(revoke[1])
      if (!revoked) return reply(res, 404, { error: 'API key not found.' })
      if (revoked.changed) await audit(user.id, 'apikey.revoked', revoked.row.id)
      return reply(res, 200, { key: view(revoked.row, env) })
    }
    if (path === '/api/admin/api-keys' || path.startsWith('/api/admin/api-keys/')) return reply(res, 404, { error: 'Endpoint not found.' })
    return false
  }

  return { authenticate, auditDenied, handleAdmin }
}
