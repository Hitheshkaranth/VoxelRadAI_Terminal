import test from 'node:test'
import assert from 'node:assert/strict'
import { KEY_PATTERN, bearerKey, createApiKeys, createKeyStore, defaultLimits, keyPrefix, newApiKey, parseKeyRequest, webhookSecretFor } from '../src/apiKeys.mjs'
import { hashToken } from '../src/security.mjs'
import { body, listen, memoryKeyStore, send } from './apiHelpers.mjs'

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', role: 'admin' }
const WEBHOOK_SECRET = 'w'.repeat(40)

async function setup(env = { API_WEBHOOK_SECRET: WEBHOOK_SECRET }) {
  const store = memoryKeyStore(), audits = []
  const keys = createApiKeys({ store, env, body, send, audit: async (...event) => { audits.push(event) }, confirmAdmin: async (_user, password) => password === 'correct horse battery' })
  const app = await listen(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    if (path === '/whoami') { const auth = await keys.authenticate(req); return send(res, auth.key ? 200 : auth.error.status, auth) }
    if (!await keys.handleAdmin(req, res, path, ADMIN)) send(res, 404, { error: 'Endpoint not found.' })
  })
  const call = (path, init = {}) => fetch(app.url + path, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
  return { store, audits, keys, call, close: app.close }
}
const create = (ctx, data) => ctx.call('/api/admin/api-keys', { method: 'POST', body: JSON.stringify({ organisation: 'Acme Imaging', label: 'PACS bridge', kind: 'live', currentPassword: 'correct horse battery', ...data }) })

test('key format, prefix, defaults and webhook secret derivation', () => {
  const live = newApiKey('live'), testKey = newApiKey('test')
  assert.match(live, /^vr_live_[A-Za-z0-9_-]{43}$/)
  assert.match(testKey, /^vr_test_/)
  assert.ok(KEY_PATTERN.test(live))
  assert.equal(keyPrefix(live).length, 12)
  assert.notEqual(newApiKey('live'), live)
  assert.deepEqual(defaultLimits({}), { live: 200, test: 20 })
  assert.deepEqual(defaultLimits({ API_LIVE_DAILY_READS: '500', API_TEST_DAILY_READS: '0' }), { live: 500, test: 0 })
  assert.deepEqual(defaultLimits({ API_LIVE_DAILY_READS: 'many', API_TEST_DAILY_READS: '-1' }), { live: 200, test: 20 })
  assert.equal(webhookSecretFor('k1', {}), null, 'no server secret, no webhooks')
  assert.equal(webhookSecretFor('k1', { API_WEBHOOK_SECRET: 'short' }), null)
  const secret = webhookSecretFor('k1', { API_WEBHOOK_SECRET: WEBHOOK_SECRET })
  assert.match(secret, /^whsec_[A-Za-z0-9_-]{43}$/)
  assert.equal(secret, webhookSecretFor('k1', { API_WEBHOOK_SECRET: WEBHOOK_SECRET }), 'derived, so it never needs storing')
  assert.notEqual(secret, webhookSecretFor('k2', { API_WEBHOOK_SECRET: WEBHOOK_SECRET }))
  assert.equal(bearerKey(undefined), '')
  assert.equal(bearerKey(`Bearer ${live}`), live)
  assert.equal(bearerKey(`bearer ${live}`), live)
  assert.equal(bearerKey('Bearer vr_live_short'), null)
  assert.equal(bearerKey(`Basic ${live}`), null)
})

test('create validation', () => {
  assert.match(parseKeyRequest({ label: 'x', kind: 'live' }).error, /organisation/)
  assert.match(parseKeyRequest({ organisation: 'A', label: 'x', kind: 'prod' }).error, /live or test/)
  assert.match(parseKeyRequest({ organisation: 'A', label: 'x', kind: 'live', dailyReadLimit: 10001 }).error, /0 to 10,000/)
  assert.match(parseKeyRequest({ organisation: 'A', label: 'x', kind: 'live', dailyReadLimit: '5' }).error, /whole number/)
  assert.match(parseKeyRequest({ organisation: 'A\u0000', label: 'x', kind: 'live' }).error, /organisation/)
  assert.deepEqual(parseKeyRequest({ organisation: ' Acme ', label: 'Bridge', kind: 'test', dailyReadLimit: 5, dataAgreementId: 'DPA-2026-01' }).value, { organisationId: null, organisation: 'Acme', label: 'Bridge', kind: 'test', dailyReadLimit: 5, dataAgreementId: 'DPA-2026-01' })
  const orgId = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'
  assert.deepEqual(parseKeyRequest({ organisationId: orgId, label: 'Bridge', kind: 'live' }).value, { organisationId: orgId.toLowerCase(), organisation: null, label: 'Bridge', kind: 'live', dailyReadLimit: null, dataAgreementId: null })
  assert.match(parseKeyRequest({ organisationId: orgId, organisation: 'Acme', label: 'x', kind: 'live' }).error, /not both/)
  assert.match(parseKeyRequest({ organisationId: 'acme', label: 'x', kind: 'live' }).error, /from the list/)
})

test('admin creates a key: plaintext shown once, only the hash stored, audited', async () => {
  const ctx = await setup()
  try {
    assert.equal((await create(ctx, { currentPassword: 'wrong' })).status, 403, 'administrator password re-confirmation is required')
    assert.equal(ctx.store.rows.size, 0)
    const response = await create(ctx, { dataAgreementId: 'DPA-7' })
    assert.equal(response.status, 201)
    const created = await response.json()
    assert.match(created.secret, /^vr_live_/)
    assert.match(created.webhookSecret, /^whsec_/)
    assert.equal(created.key.prefix, created.secret.slice(0, 12))
    assert.equal(created.key.dailyReadLimit, 200)
    assert.equal(created.key.dataAgreementId, 'DPA-7')
    const stored = ctx.store.rows.get(created.key.id)
    assert.equal(stored.key_hash, hashToken(created.secret))
    assert.ok(!JSON.stringify(stored).includes(created.secret), 'plaintext never stored')
    assert.ok(!JSON.stringify(stored).includes(created.webhookSecret), 'webhook secret never stored')
    assert.deepEqual(ctx.audits.at(-1), [ADMIN.id, 'apikey.created', created.key.id])
    const list = await (await ctx.call('/api/admin/api-keys')).json()
    assert.equal(list.keys.length, 1)
    assert.ok(!JSON.stringify(list).includes(created.secret), 'list never returns the key')
    assert.ok(!('secret' in list.keys[0]) && !('key_hash' in list.keys[0]))
    assert.deepEqual(list.defaults, { live: 200, test: 20 })
    assert.equal(list.webhooksConfigured, true)
  } finally { ctx.close() }
})

test('webhook secret is null when the server has no API_WEBHOOK_SECRET', async () => {
  const ctx = await setup({})
  try {
    const created = await (await create(ctx, { kind: 'test', dailyReadLimit: 3 })).json()
    assert.equal(created.webhookSecret, null)
    assert.equal(created.key.webhooks, false, 'recorded: this key never received a webhook secret')
    assert.equal(ctx.store.rows.get(created.key.id).webhook_secret_issued, false)
    assert.equal(created.key.kind, 'test')
    assert.equal(created.key.dailyReadLimit, 3)
  } finally { ctx.close() }
})

test('keys belong to an organisation record: new by name, or an existing one by id', async () => {
  const ctx = await setup()
  try {
    const first = await (await create(ctx)).json()
    assert.match(first.key.organisationId, /^[0-9a-f-]{36}$/)
    const same = await (await create(ctx, { organisation: undefined, organisationId: first.key.organisationId, label: 'Second system' })).json()
    assert.equal(same.key.organisationId, first.key.organisationId, 'joined the chosen organisation')
    assert.equal(same.key.organisation, 'Acme Imaging')
    const namesake = await (await create(ctx, { label: 'Other customer' })).json()
    assert.notEqual(namesake.key.organisationId, first.key.organisationId, 'a repeated name is a new organisation')
    const unknown = await create(ctx, { organisation: undefined, organisationId: '00000000-0000-4000-8000-000000000000' })
    assert.equal(unknown.status, 400)
    assert.match((await unknown.json()).error, /no longer exists/)
    const list = await (await ctx.call('/api/admin/api-keys')).json()
    assert.equal(list.organisations.length, 2)
    assert.deepEqual(list.organisations.map(org => [org.name, org.activeKeys]).sort(), [['Acme Imaging', 1], ['Acme Imaging', 2]])
  } finally { ctx.close() }
})

test('authentication accepts a valid key, rejects unknown and revoked keys, and records use', async () => {
  const ctx = await setup()
  try {
    const created = await (await create(ctx)).json()
    const who = key => ctx.call('/whoami', { headers: key === undefined ? {} : { Authorization: `Bearer ${key}` } })
    const ok = await who(created.secret)
    assert.equal(ok.status, 200)
    assert.deepEqual((await ok.json()).key, { id: created.key.id, organisationId: created.key.organisationId, organisation: 'Acme Imaging', label: 'PACS bridge', kind: 'live', dailyReadLimit: 200, webhooks: true })
    assert.ok(ctx.store.rows.get(created.key.id).last_used_at, 'last_used_at recorded')
    assert.equal((await (await who(undefined)).json()).error.code, 'missing_api_key')
    assert.equal((await (await who(newApiKey('live'))).json()).error.code, 'invalid_api_key')
    assert.equal((await (await who(created.secret.replace('vr_live_', 'vr_test_'))).json()).error.code, 'invalid_api_key', 'kind in the key must match')
    const revoke = await ctx.call(`/api/admin/api-keys/${created.key.id}/revoke`, { method: 'POST', body: '{}' })
    assert.equal(revoke.status, 200)
    assert.ok((await revoke.json()).key.revokedAt)
    assert.deepEqual(ctx.audits.at(-1), [ADMIN.id, 'apikey.revoked', created.key.id])
    const denied = await who(created.secret)
    assert.equal(denied.status, 401)
    assert.equal((await denied.json()).error.code, 'key_revoked')
    await who(created.secret)
    assert.equal(ctx.audits.filter(([, type]) => type === 'apikey.denied_revoked').length, 1, 'denied use is audited, at most once a minute per key')
    assert.deepEqual(ctx.audits.find(([, type]) => type === 'apikey.denied_revoked'), [null, 'apikey.denied_revoked', created.key.id])
    await ctx.call(`/api/admin/api-keys/${created.key.id}/revoke`, { method: 'POST', body: '{}' })
    assert.equal(ctx.audits.filter(([, type]) => type === 'apikey.revoked').length, 1, 'revoking twice audits once')
    assert.equal((await ctx.call('/api/admin/api-keys/00000000-0000-4000-8000-000000000000/revoke', { method: 'POST', body: '{}' })).status, 404)
  } finally { ctx.close() }
})

test('SQL store inserts the hash, never the plaintext', async () => {
  const queries = []
  const store = createKeyStore({ async query(sql, values) { queries.push({ sql, values }); return { rows: [{ id: values[0] }], rowCount: 1 } } })
  const secret = newApiKey('live')
  await store.insert({ id: 'id-1', organisationId: 'org-1', ownerId: ADMIN.id, organisation: 'Acme', label: 'L', prefix: keyPrefix(secret), keyHash: hashToken(secret), kind: 'live', dailyReadLimit: null, dataAgreementId: null, webhookSecretIssued: true })
  assert.match(queries[0].sql, /INSERT INTO api_keys/)
  assert.ok(queries[0].values.includes(hashToken(secret)))
  assert.ok(!queries[0].values.includes(secret))
})
