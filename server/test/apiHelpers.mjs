// In-memory stand-ins for the api_keys / api_reads SQL stores, with the same semantics the API relies on.
import http from 'node:http'
import { once } from 'node:events'

export function send(res, status, body, extra = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra }); res.end(JSON.stringify(body)) }
export async function body(req, limit = 8192) {
  const chunks = []; let bytes = 0
  for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) throw Object.assign(new Error('Request exceeds the allowed size'), { status: 413 }); chunks.push(chunk) }
  try { const data = JSON.parse(Buffer.concat(chunks).toString() || '{}'); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data } catch { throw Object.assign(new Error('Request must contain a JSON object'), { status: 400 }) }
}
export async function listen(handler) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => { server.close(); server.closeAllConnections() } }
}
// login_attempts stand-in: one counter per key for the current "day" (`pool.resetsAt`). Moving `resetsAt` forward
// starts a new day: the next reservation resets the counter, and a refund only applies to the day it names.
export function fakePool() {
  const counts = new Map(), days = new Map(), queries = [], usage = []
  const pool = { counts, queries, usage, resetsAt: new Date(Date.now() + 3600000), async query(sql, [key, resetsAt]) {
    queries.push(sql)
    // Usage history rows are recorded separately: they are not part of the read allowance.
    if (sql.startsWith('INSERT INTO usage_events')) { usage.push({ userId: key, modality: resetsAt }); return { rows: [] } }
    if (sql.startsWith('INSERT')) {
      if (+days.get(key) !== +pool.resetsAt) { counts.set(key, 0); days.set(key, pool.resetsAt) }
      counts.set(key, counts.get(key) + 1)
      return { rows: [{ attempts: counts.get(key), resets_at: pool.resetsAt }] }
    }
    if (resetsAt === undefined || +days.get(key) === +resetsAt) counts.set(key, Math.max(0, (counts.get(key) || 0) - 1))
    return { rows: [] }
  } }
  return pool
}

export function memoryKeyStore() {
  const rows = new Map(), organisations = new Map(), windows = new Map()
  const strip = row => { const { key_hash: _hash, ...rest } = row; return { ...rest, organisation: organisations.get(row.organisation_id).name } }
  return {
    rows, organisations,
    async insert(row) {
      if (row.organisation !== null) organisations.set(row.organisationId, { id: row.organisationId, name: row.organisation, created_at: new Date() })
      else if (!organisations.has(row.organisationId)) return null
      const stored = { id: row.id, organisation_id: row.organisationId, owner_id: row.ownerId, label: row.label, prefix: row.prefix, key_hash: row.keyHash, kind: row.kind, daily_read_limit: row.dailyReadLimit, data_agreement_id: row.dataAgreementId, webhook_secret_issued: row.webhookSecretIssued, created_at: new Date(), last_used_at: null, revoked_at: null }
      rows.set(row.id, stored); return strip(stored)
    },
    async list() { return [...rows.values()].map(strip) },
    async organisations() { return [...organisations.values()].map(org => ({ ...org, active_keys: [...rows.values()].filter(row => row.organisation_id === org.id && !row.revoked_at).length })) },
    async revoke(id) { const row = rows.get(id); if (!row) return null; const changed = !row.revoked_at; if (changed) row.revoked_at = new Date(); return { row: strip(row), changed } },
    async findByHash(hash) { const row = [...rows.values()].find(item => item.key_hash === hash); return row ? { ...row, organisation: organisations.get(row.organisation_id).name } : null },
    async touch(id) { rows.get(id).last_used_at = new Date() },
    async firstInWindow(bucket) { const count = (windows.get(bucket) || 0) + 1; windows.set(bucket, count); return count === 1 },
  }
}

export function memoryReadStore(keyStore) {
  const reads = new Map()
  let notified = 0
  const org = keyId => keyStore.rows.get(keyId)?.organisation_id
  const view = row => { const { request: _request, idempotency_key: _idem, quota_resets_at: _day, refunded_at: _refunded, attempts: _attempts, lease_owner: _owner, lease_expires_at: _lease, available_at: _available, ...rest } = row; return { ...rest } }
  const visible = (row, organisationId) => row && org(row.key_id) === organisationId && row.expires_at > new Date()
  return {
    reads,
    async findIdempotent(keyId, idem) { const row = [...reads.values()].find(item => item.key_id === keyId && item.idempotency_key === idem && item.expires_at > new Date()); return row ? view(row) : null },
    async insert({ id, keyId, request, requestHash, idempotencyKey, webhookUrl, quotaResetsAt }) {
      if (idempotencyKey && [...reads.values()].some(item => item.key_id === keyId && item.idempotency_key === idempotencyKey)) return null
      const row = { id, key_id: keyId, status: 'queued', request: structuredClone(request), request_hash: requestHash, idempotency_key: idempotencyKey, result: null, error: null, webhook_url: webhookUrl, quota_resets_at: quotaResetsAt, refunded_at: null, attempts: 0, lease_owner: null, lease_expires_at: null, available_at: new Date(), created_at: new Date(), started_at: null, finished_at: null, expires_at: new Date(Date.now() + 86400000) }
      reads.set(id, row); return view(row)
    },
    // Queue semantics of the SQL store: leases, claims, recovery. `lapse(id)` simulates an executor dying.
    async start(id, lease) { const row = reads.get(id); if (row?.status !== 'queued' || row.available_at > new Date()) return false; Object.assign(row, { status: 'running', started_at: row.started_at || new Date(), attempts: row.attempts + 1, lease_owner: lease?.owner ?? null, lease_expires_at: new Date(Date.now() + 1000 * (lease?.seconds ?? 60)) }); return true },
    async claim(lease, limit, { retriesOnly = false } = {}) {
      const rows = [...reads.values()].filter(row => row.status === 'queued' && row.available_at <= new Date() && (!retriesOnly || row.attempts > 0)).slice(0, limit)
      for (const row of rows) await this.start(row.id, lease)
      return rows.map(row => ({ id: row.id, key_id: row.key_id, request: structuredClone(row.request), webhook_url: row.webhook_url, created_at: row.created_at, attempts: row.attempts, webhook_secret_issued: keyStore.rows.get(row.key_id)?.webhook_secret_issued ?? false }))
    },
    async heartbeat(id, lease) { const row = reads.get(id); if (row?.status === 'running' && row.lease_owner === lease.owner) { row.lease_expires_at = new Date(Date.now() + 1000 * lease.seconds); return 'running' } return row?.status === 'cancelled' ? 'cancelled' : 'lost' },
    async release(id, lease) { const row = reads.get(id); if (row?.status === 'running' && row.lease_owner === lease.owner) Object.assign(row, { status: 'queued', lease_owner: null, lease_expires_at: null, available_at: new Date(), attempts: Math.max(0, row.attempts - 1) }) },
    async depth() { const all = [...reads.values()]; return { queued: all.filter(row => row.status === 'queued').length, running: all.filter(row => row.status === 'running').length } },
    async notify() { notified++ },
    get notified() { return notified },
    lapse(id) { const row = reads.get(id); row.lease_expires_at = new Date(Date.now() - 1000) },
    async finish(id, { status, result, error, request, owner = null }) { const row = reads.get(id); if (!['queued', 'running'].includes(row?.status) || (row.lease_owner && row.lease_owner !== owner)) return false; Object.assign(row, { status, result, error, request, finished_at: new Date(), lease_expires_at: null }); return true },
    async abandon(id) { const row = reads.get(id); if (['queued', 'running'].includes(row?.status)) Object.assign(row, { status: 'failed', error: { code: 'interrupted' }, request: null, finished_at: new Date() }) },
    async markRefunded(id) { const row = reads.get(id); if (!row || row.refunded_at || !row.quota_resets_at) return null; row.refunded_at = new Date(); return row.quota_resets_at },
    async get(id, organisationId) { const row = reads.get(id); return visible(row, organisationId) ? view(row) : null },
    async cancel(id, organisationId) {
      const row = reads.get(id)
      if (!visible(row, organisationId)) return null
      if (!['queued', 'running'].includes(row.status)) return { row: view(row) }
      const was = row.status; row.status = 'cancelled'; row.finished_at = new Date()
      return { row: view(row), was }
    },
    async sweep({ maxAttempts = 2, queueTtlSeconds = 600 } = {}) {
      const now = new Date(), expired = []
      for (const row of reads.values()) {
        if (row.status === 'running' && row.lease_expires_at && row.lease_expires_at < now) {
          if (row.attempts < maxAttempts && row.request) Object.assign(row, { status: 'queued', lease_owner: null, lease_expires_at: null, available_at: now })
          else Object.assign(row, { status: 'failed', error: { code: 'interrupted' }, request: null, finished_at: now })
        } else if (row.status === 'queued' && now - row.created_at > queueTtlSeconds * 1000) {
          Object.assign(row, { status: 'failed', error: { code: row.attempts ? 'interrupted' : 'queue_timeout' }, request: null, finished_at: now })
          if (!row.attempts) expired.push({ id: row.id, key_id: row.key_id })
        }
      }
      return { expired }
    },
    async cleanup(settings) { return this.sweep(settings) },
  }
}

export const waitFor = async (check, ms = 3000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)) }
  throw new Error('condition not reached')
}
