import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createModelProxy } from '../src/modelProxy.mjs'
import { createApiKeys, webhookSecretFor } from '../src/apiKeys.mjs'
import { createPublicApi, createReadStore, keyPseudonym, redactRequest, validateRead } from '../src/publicApi.mjs'
import { body, fakePool, listen, memoryKeyStore, memoryReadStore, send, waitFor } from './apiHelpers.mjs'

const SECRET = 's'.repeat(40)
const WEBHOOK_SECRET = 'w'.repeat(40)
const ADMIN = { id: '11111111-1111-4111-8111-111111111111', role: 'admin' }
const REPORT = { findings: [{ label: 'Example finding', box: [1, 2, 3, 4] }], impression: 'Example.' }
const IMAGE = 'data:image/png;base64,' + 'A'.repeat(2000)
const readBody = (extra = {}) => ({ model: 'skanda-v1', messages: [{ role: 'system', content: 'Read the image.' }, { role: 'user', content: [{ type: 'text', text: 'Chest PA' }, { type: 'image_url', image_url: { url: IMAGE } }] }], ...extra })

// The Space answers every read as SSE: heartbeats, then the whole report in one chunk, then [DONE].
function space({ mode = 'ok', seen = [], delay = 20 } = {}) {
  return async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    if (path === '/lmstudio/v1/models') return send(res, 200, { data: [{ id: 'skanda-v1', state: 'loaded' }] })
    seen.push({ headers: req.headers, body: await body(req, 1e7) })
    const current = typeof mode === 'function' ? mode() : mode
    if (current === 'down') { res.writeHead(503, { 'Content-Type': 'text/html' }); return res.end('<html>Sleeping</html>') }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(': queued\n\n')
    if (current === 'hang') return
    setTimeout(() => {
      res.write(': queued\n\n')
      if (current === 'error') res.write(`data: ${JSON.stringify({ error: { message: 'ZeroGPU read failed or quota exhausted. null' } })}\n\n`)
      else if (current === 'quota') res.write(`data: ${JSON.stringify({ error: { message: 'ZeroGPU read failed or quota exhausted. You have exceeded your GPU quota (60s requested vs. 10s left).' } })}\n\n`)
      else res.write(`data: ${JSON.stringify({ id: 'chatcmpl-space', object: 'chat.completion.chunk', model: 'skanda-v1', choices: [{ index: 0, delta: { content: JSON.stringify(REPORT) }, finish_reason: 'stop' }] })}\n\n`)
      res.end('data: [DONE]\n\n')
    }, delay)
  }
}

async function setup({ upstream = space(), env = {}, readStore: wrapStore, deliver, timeouts } = {}) {
  const up = await listen(upstream)
  const pool = fakePool()
  const fullEnv = { MODEL_UPSTREAM_URL: `${up.url}/lmstudio`, BRIDGE_SECRET: SECRET, API_WEBHOOK_SECRET: WEBHOOK_SECRET, ...env }
  const modelProxy = createModelProxy({ pool, body, send, env: fullEnv })
  const keyStore = memoryKeyStore(), audits = []
  const audit = async (...event) => { audits.push(event) }
  const apiKeys = createApiKeys({ store: keyStore, env: fullEnv, body, send, audit, confirmAdmin: async () => true })
  const readStore = memoryReadStore(keyStore)
  const tasks = []
  const api = createPublicApi({ readStore: wrapStore ? wrapStore(readStore) : readStore, env: fullEnv, body, send, modelProxy, apiKeys, publicOrigin: 'https://voxelradai.com',
    schedule: task => { tasks.push(task) }, resolve: async host => host === 'hooks.example.com' ? ['93.184.216.34'] : ['10.0.0.5'], deliver, timeouts: { cancelPoll: 20, ...timeouts } })
  const app = await listen(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    if (path.startsWith('/api/v1')) return api.handle(req, res, path)
    if (await apiKeys.handleAdmin(req, res, path, ADMIN)) return
    send(res, 404, {})
  })
  async function issue(data = {}) {
    const response = await fetch(`${app.url}/api/admin/api-keys`, { method: 'POST', body: JSON.stringify({ organisation: 'Acme Imaging', label: 'Bridge', kind: 'live', currentPassword: 'x', ...data }) })
    return response.json()
  }
  const call = (path, key, init = {}) => fetch(app.url + path, { ...init, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json', ...init.headers } })
  return { api, pool, readStore, keyStore, audits, tasks, issue, call, close: () => { up.close(); app.close() } }
}
const post = (ctx, path, key, data, headers = {}) => ctx.call(path, key, { method: 'POST', body: JSON.stringify(data), headers })
const counted = ctx => [...ctx.pool.counts.values()].reduce((a, b) => a + b, 0)

test('validation and request redaction', () => {
  assert.equal(validateRead({ messages: [] }).code, 'missing_model')
  assert.equal(validateRead({ model: 'gpt-4o', messages: [{ role: 'user', content: 'x' }] }).status, 404)
  assert.equal(validateRead({ model: 'skanda-v1', messages: [] }).code, 'invalid_messages')
  assert.equal(validateRead({ model: 'skanda-v1', messages: [{ role: 'tool', content: 'x' }] }).code, 'invalid_messages')
  assert.equal(validateRead({ ...readBody(), stream: 'yes' }).code, 'invalid_stream')
  assert.ok(validateRead(readBody({ max_tokens: 1536 })).payload, 'the model service cap is allowed')
  for (const max_tokens of [0, 1537, 4096, 1.5, '512']) assert.equal(validateRead(readBody({ max_tokens })).code, 'invalid_max_tokens', String(max_tokens))
  assert.equal(validateRead({ ...readBody(), webhook_url: 'https://x' }).code, 'unsupported_parameter')
  const ok = validateRead({ ...readBody(), webhook_url: 'https://x' }, { allowWebhook: true })
  assert.equal(ok.payload.stream, true, 'upstream is always asked for SSE')
  assert.equal(ok.stream, false, 'stream omitted means a JSON response for keys')
  assert.equal('webhook_url' in ok.payload, false)
  const redacted = redactRequest({ ...readBody(), skanda: { hu: [1, 2, 3] } })
  assert.ok(!JSON.stringify(redacted).includes('base64'), 'image data removed')
  assert.deepEqual(redacted.messages[1].content, [{ type: 'text', text: 'Chest PA' }, { type: 'image_url', removed: true }])
  assert.deepEqual(redacted.removed_fields, ['skanda'], 'unknown fields that may carry pixels are dropped')
})

test('key routes require a Bearer key and ignore session cookies', async () => {
  const ctx = await setup()
  try {
    const none = await ctx.call('/api/v1/models', null, { headers: { Cookie: 'skanda_session=' + 'a'.repeat(43) } })
    assert.equal(none.status, 401)
    assert.equal(none.headers.get('www-authenticate'), 'Bearer')
    assert.equal(none.headers.get('access-control-allow-origin'), null, 'no browser CORS')
    assert.deepEqual(Object.keys((await none.json()).error).sort(), ['code', 'message', 'type'])
    assert.equal((await ctx.call('/api/v1/models', 'vr_live_' + 'x'.repeat(43))).status, 401)
    const { secret } = await ctx.issue()
    const models = await ctx.call('/api/v1/models', secret)
    assert.equal(models.status, 200)
    assert.equal(models.headers.get('x-voxelrad-key-kind'), 'live')
    assert.deepEqual(await models.json(), { object: 'list', data: [{ id: 'skanda-v1', object: 'model', owned_by: 'voxelrad' }] })
    assert.equal((await ctx.call('/api/v1/models', secret, { method: 'POST', body: '{}' })).status, 405)
    assert.equal((await ctx.call('/api/v1/studies', secret)).status, 404, 'keys reach nothing outside the model API')
    assert.equal(counted(ctx), 0, 'listing models does not use reads')
  } finally { ctx.close() }
})

test('stream:false (the default for keys) returns one chat.completion JSON body', async () => {
  const seen = []
  const ctx = await setup({ upstream: space({ seen }) })
  try {
    const { secret, key } = await ctx.issue()
    const response = await post(ctx, '/api/v1/chat/completions', secret, readBody())
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /application\/json/)
    assert.equal(response.headers.get('x-voxelrad-reads-left'), '199')
    const completion = await response.json()
    assert.equal(completion.object, 'chat.completion')
    assert.equal(completion.model, 'skanda-v1')
    assert.equal(completion.id, 'chatcmpl-space')
    assert.equal(typeof completion.created, 'number')
    assert.deepEqual(completion.choices, [{ index: 0, message: { role: 'assistant', content: JSON.stringify(REPORT) }, finish_reason: 'stop' }])
    assert.equal('usage' in completion, false, 'the Space reports no usage, so none is invented')
    assert.equal(seen[0].body.stream, true)
    assert.equal(seen[0].headers['x-voxelrad-bridge'], SECRET)
    assert.equal(seen[0].headers['x-voxelrad-user'], keyPseudonym(key.id, SECRET))
    assert.equal(seen[0].headers.authorization, undefined, 'the API key never reaches the Space')
    assert.equal(counted(ctx), 1)
    const explicit = await post(ctx, '/api/v1/chat/completions', secret, readBody({ stream: false }))
    assert.equal((await explicit.json()).object, 'chat.completion')
  } finally { ctx.close() }
})

test('stream:true passes the SSE through', async () => {
  const ctx = await setup()
  try {
    const { secret } = await ctx.issue({ kind: 'test' })
    const response = await post(ctx, '/api/v1/chat/completions', secret, readBody({ stream: true }))
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/event-stream/)
    assert.equal(response.headers.get('x-voxelrad-key-kind'), 'test')
    const text = await response.text()
    assert.match(text, /^: queued/)
    assert.match(text, /\[DONE\]/)
  } finally { ctx.close() }
})

test('errors inside the stream become OpenAI error responses; only quota failures are refunded', async () => {
  let mode = 'error'
  const ctx = await setup({ upstream: space({ mode: () => mode }) })
  try {
    const { secret } = await ctx.issue()
    const failed = await post(ctx, '/api/v1/chat/completions', secret, readBody())
    assert.equal(failed.status, 502)
    assert.deepEqual((await failed.json()).error.code, 'upstream_error')
    assert.equal(counted(ctx), 1, 'a read that may have used the GPU still counts')
    mode = 'quota'
    const quota = await post(ctx, '/api/v1/chat/completions', secret, readBody())
    assert.equal(quota.status, 429)
    const error = (await quota.json()).error
    assert.equal(error.type, 'rate_limit_error')
    assert.equal(error.code, 'upstream_quota_exceeded')
    assert.equal(counted(ctx), 1, 'quota refusal is refunded')
    mode = 'down'
    const down = await post(ctx, '/api/v1/chat/completions', secret, readBody())
    assert.equal(down.status, 503)
    assert.equal((await down.json()).error.code, 'model_unavailable')
    assert.equal(counted(ctx), 1, 'a read that never started is refunded')
  } finally { ctx.close() }
})

test('per-key daily cap: 429 with Retry-After, audited', async () => {
  const ctx = await setup()
  try {
    const { secret, key } = await ctx.issue({ kind: 'test', dailyReadLimit: 1 })
    assert.equal((await post(ctx, '/api/v1/chat/completions', secret, readBody())).status, 200)
    const refused = await post(ctx, '/api/v1/chat/completions', secret, readBody())
    assert.equal(refused.status, 429)
    assert.ok(Number(refused.headers.get('retry-after')) >= 60)
    assert.equal(refused.headers.get('x-voxelrad-key-kind'), 'test')
    assert.equal((await refused.json()).error.code, 'daily_limit_reached')
    assert.deepEqual(ctx.audits.find(([, type]) => type === 'apikey.denied_limit'), [null, 'apikey.denied_limit', key.id])
    const other = await ctx.issue({ kind: 'test', dailyReadLimit: 1 })
    assert.equal((await post(ctx, '/api/v1/chat/completions', other.secret, readBody())).status, 200, 'caps are per key')
    assert.equal((await post(ctx, '/api/v1/chat/completions', secret, { model: 'nope', messages: [{ role: 'user', content: 'x' }] })).status, 404)
  } finally { ctx.close() }
})

test('async read: 202, poll to the parsed report, image data dropped, organisation scoped', async () => {
  const ctx = await setup()
  try {
    const { secret, key } = await ctx.issue()
    const sibling = await ctx.issue({ organisation: undefined, organisationId: key.organisationId, label: 'Second system' })
    const stranger = await ctx.issue({ organisation: 'Other Hospital' })
    const submitted = await post(ctx, '/api/v1/reads', secret, readBody())
    assert.equal(submitted.status, 202)
    const read = await submitted.json()
    assert.equal(read.object, 'read')
    assert.equal(read.status, 'queued')
    assert.equal(read.poll_url, `https://voxelradai.com/api/v1/reads/${read.id}`)
    assert.equal(submitted.headers.get('location'), read.poll_url)
    assert.equal(counted(ctx), 1, 'counted at submission')
    await Promise.all(ctx.tasks)
    const done = await (await ctx.call(`/api/v1/reads/${read.id}`, secret)).json()
    assert.equal(done.status, 'succeeded')
    assert.deepEqual(done.result.report, REPORT)
    assert.equal(done.result.content, JSON.stringify(REPORT))
    assert.equal(done.result.finish_reason, 'stop')
    assert.equal(done.error, null)
    assert.ok(done.started_at && done.finished_at && done.expires_at)
    const stored = ctx.readStore.reads.get(read.id)
    assert.ok(!JSON.stringify(stored.request).includes('base64'), 'image data is removed once the read finishes')
    assert.equal(stored.key_id, key.id)
    assert.equal((await ctx.call(`/api/v1/reads/${read.id}`, sibling.secret)).status, 200, 'other keys of the same organisation can poll')
    assert.equal((await ctx.call(`/api/v1/reads/${read.id}`, stranger.secret)).status, 404, 'other organisations cannot')
    assert.equal((await ctx.call('/api/v1/reads/not-a-uuid', secret)).status, 404)
    const late = await ctx.call(`/api/v1/reads/${read.id}`, secret, { method: 'DELETE' })
    assert.equal(late.status, 409)
    assert.equal((await late.json()).error.code, 'read_not_cancellable')
  } finally { ctx.close() }
})

test('a different organisation with the same name cannot see, cancel or replay reads', async () => {
  let gate = null
  const ctx = await setup({ readStore: store => ({ ...store, start: async id => { if (gate) await gate; return store.start(id) } }) })
  try {
    const owner = await ctx.issue({ organisation: 'Acme Imaging' })
    const namesake = await ctx.issue({ organisation: 'acme imaging' })
    assert.notEqual(owner.key.organisationId, namesake.key.organisationId)
    let open; gate = new Promise(resolve => { open = resolve })
    const read = await (await post(ctx, '/api/v1/reads', owner.secret, readBody(), { 'Idempotency-Key': 'shared-ref' })).json()
    assert.equal((await ctx.call(`/api/v1/reads/${read.id}`, namesake.secret)).status, 404, 'GET is scoped by organisation id, not name')
    const cancel = await ctx.call(`/api/v1/reads/${read.id}`, namesake.secret, { method: 'DELETE' })
    assert.equal(cancel.status, 404, 'DELETE is scoped by organisation id, not name')
    assert.equal(ctx.readStore.reads.get(read.id).status, 'queued', 'the other customer could not cancel it')
    const replay = await post(ctx, '/api/v1/reads', namesake.secret, readBody(), { 'Idempotency-Key': 'shared-ref' })
    assert.equal(replay.status, 202, 'idempotency keys are per API key: no replay of another customer\'s read')
    assert.notEqual((await replay.json()).id, read.id)
    open()
    await Promise.all(ctx.tasks)
    assert.equal((await ctx.call(`/api/v1/reads/${read.id}`, owner.secret)).status, 200)
  } finally { ctx.close() }
})

test('async read failures are recorded and refunded when the GPU was never reached', async () => {
  const ctx = await setup({ upstream: space({ mode: 'down' }) })
  try {
    const { secret } = await ctx.issue()
    const read = await (await post(ctx, '/api/v1/reads', secret, readBody())).json()
    await Promise.all(ctx.tasks)
    const done = await (await ctx.call(`/api/v1/reads/${read.id}`, secret)).json()
    assert.equal(done.status, 'failed')
    assert.equal(done.result, null)
    assert.equal(done.error.code, 'model_unavailable')
    assert.equal(counted(ctx), 0)
  } finally { ctx.close() }
})

test('Idempotency-Key returns the original read and rejects a different body', async () => {
  const seen = []
  const ctx = await setup({ upstream: space({ seen }) })
  try {
    const { secret } = await ctx.issue()
    const first = await (await post(ctx, '/api/v1/reads', secret, readBody(), { 'Idempotency-Key': 'order-42' })).json()
    const again = await post(ctx, '/api/v1/reads', secret, readBody(), { 'Idempotency-Key': 'order-42' })
    assert.equal(again.status, 200)
    assert.equal(again.headers.get('idempotent-replayed'), 'true')
    assert.equal((await again.json()).id, first.id)
    const conflict = await post(ctx, '/api/v1/reads', secret, readBody({ max_tokens: 99 }), { 'Idempotency-Key': 'order-42' })
    assert.equal(conflict.status, 422)
    assert.equal((await conflict.json()).error.code, 'idempotency_conflict')
    const other = await ctx.issue()
    assert.equal((await post(ctx, '/api/v1/reads', other.secret, readBody(), { 'Idempotency-Key': 'order-42' })).status, 202, 'idempotency is per key')
    assert.equal((await post(ctx, '/api/v1/reads', secret, readBody(), { 'Idempotency-Key': 'bad key' })).status, 400)
    await Promise.all(ctx.tasks)
    assert.equal(seen.length, 2, 'the replay did not start another read')
    assert.equal(counted(ctx), 2, 'the replay did not count')
  } finally { ctx.close() }
})

test('cancelling a running read aborts the upstream; a queued one is refunded', async () => {
  let upstreamClosed
  const closed = new Promise(resolve => { upstreamClosed = resolve })
  const hang = async (req, res) => { await body(req, 1e7); res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': queued\n\n'); res.on('close', upstreamClosed) }
  let gate = null
  const ctx = await setup({ upstream: hang, readStore: store => ({ ...store, start: async id => { if (gate) await gate; return store.start(id) } }) })
  try {
    const { secret } = await ctx.issue()
    const running = await (await post(ctx, '/api/v1/reads', secret, readBody())).json()
    await waitFor(() => ctx.readStore.reads.get(running.id).status === 'running')
    const cancelled = await ctx.call(`/api/v1/reads/${running.id}`, secret, { method: 'DELETE' })
    assert.equal(cancelled.status, 200)
    assert.equal((await cancelled.json()).status, 'cancelled')
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream still open')), 2000))])
    await Promise.all(ctx.tasks)
    assert.equal(ctx.readStore.reads.get(running.id).status, 'cancelled', 'a cancelled read is not overwritten')
    assert.equal(counted(ctx), 1, 'a running read may have used the GPU, so it is not refunded')
    let open; gate = new Promise(resolve => { open = resolve })
    const queued = await (await post(ctx, '/api/v1/reads', secret, readBody())).json()
    assert.equal((await ctx.call(`/api/v1/reads/${queued.id}`, secret, { method: 'DELETE' })).status, 200)
    open()
    await Promise.all(ctx.tasks)
    assert.equal(ctx.readStore.reads.get(queued.id).status, 'cancelled')
    assert.equal(counted(ctx), 1, 'the queued read was refunded')
  } finally { ctx.close() }
})

test('a refund landing after 00:00 UTC is not taken from the new day', async () => {
  let gate = null
  const ctx = await setup({ readStore: store => ({ ...store, start: async id => { if (gate) await gate; return store.start(id) } }) })
  try {
    const { secret } = await ctx.issue({ kind: 'test', dailyReadLimit: 1 })
    let open; gate = new Promise(resolve => { open = resolve })
    const queued = await (await post(ctx, '/api/v1/reads', secret, readBody())).json()
    assert.equal(counted(ctx), 1)
    ctx.pool.resetsAt = new Date(ctx.pool.resetsAt.getTime() + 86400000) // midnight passes
    assert.equal((await post(ctx, '/api/v1/chat/completions', secret, readBody())).status, 200, 'the new day starts with a fresh count')
    assert.equal(counted(ctx), 1)
    assert.equal((await ctx.call(`/api/v1/reads/${queued.id}`, secret, { method: 'DELETE' })).status, 200)
    assert.equal(counted(ctx), 1, 'cancelling yesterday\'s queued read does not refund today')
    assert.equal((await post(ctx, '/api/v1/chat/completions', secret, readBody())).status, 429, 'today\'s cap still holds')
    open(); await Promise.all(ctx.tasks)
  } finally { ctx.close() }
})

test('a read is refunded once: start fails, then a cancel of the still-queued read', async () => {
  const ctx = await setup({ readStore: store => ({ ...store, start: async () => { throw new Error('database unavailable') }, finish: async () => { throw new Error('database unavailable') } }) })
  try {
    const { secret } = await ctx.issue()
    await post(ctx, '/api/v1/chat/completions', secret, readBody())
    assert.equal(counted(ctx), 1)
    const read = await (await post(ctx, '/api/v1/reads', secret, readBody())).json()
    await Promise.all(ctx.tasks)
    assert.equal(counted(ctx), 1, 'refunded when starting it failed')
    const stored = ctx.readStore.reads.get(read.id)
    assert.equal(stored.status, 'failed', 'the executor failed the read it could not record')
    assert.equal(stored.request, null, 'and dropped its image data')
    stored.status = 'queued' // as if that write was lost too
    assert.equal((await ctx.call(`/api/v1/reads/${read.id}`, secret, { method: 'DELETE' })).status, 200)
    assert.equal(counted(ctx), 1, 'the cancel did not refund it a second time')
  } finally { ctx.close() }
})

test('a read counted in submit is refunded when storing it fails', async () => {
  const ctx = await setup({ readStore: store => ({ ...store, insert: async () => { throw new Error('database unavailable') } }) })
  try {
    const { secret } = await ctx.issue()
    const failed = await post(ctx, '/api/v1/reads', secret, readBody())
    assert.equal(failed.status, 503)
    assert.equal((await failed.json()).error.code, 'internal_error')
    assert.equal(counted(ctx), 0)
  } finally { ctx.close() }
})

test('every /api/v1 request sweeps stuck reads', async () => {
  let sweeps = 0
  const ctx = await setup({ readStore: store => ({ ...store, sweep: async () => { sweeps++ } }) })
  try {
    const { secret } = await ctx.issue()
    await ctx.call('/api/v1/models', secret)
    await ctx.call('/api/v1/reads/00000000-0000-4000-8000-000000000000', secret)
    await Promise.all(ctx.tasks)
    assert.equal(sweeps, 2)
    await ctx.call('/api/v1/models', null)
    assert.equal(sweeps, 2, 'unauthenticated requests do not touch the database beyond the key lookup')
  } finally { ctx.close() }
})

test('webhooks: https public hosts only, signed with the per-key secret', async () => {
  const deliveries = []
  const ctx = await setup({ deliver: async delivery => { deliveries.push(delivery); return { delivered: true, attempts: 1 } } })
  try {
    const { secret, key, webhookSecret } = await ctx.issue()
    for (const url of ['http://hooks.example.com/x', 'https://private.example.com/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://user:pw@hooks.example.com/x', 'https://localhost/x']) {
      const refused = await post(ctx, '/api/v1/reads', secret, readBody({ webhook_url: url }))
      assert.equal(refused.status, 400, url)
      assert.equal((await refused.json()).error.code, 'invalid_webhook_url')
    }
    assert.equal(counted(ctx), 0, 'refused submissions are not counted')
    const read = await (await post(ctx, '/api/v1/reads', secret, readBody({ webhook_url: 'https://hooks.example.com/voxelrad' }))).json()
    await Promise.all(ctx.tasks)
    assert.equal(deliveries.length, 1)
    assert.equal(deliveries[0].url, 'https://hooks.example.com/voxelrad')
    assert.equal(deliveries[0].secret, webhookSecret)
    assert.equal(webhookSecret, webhookSecretFor(key.id, { API_WEBHOOK_SECRET: WEBHOOK_SECRET }))
    assert.deepEqual(Object.keys(deliveries[0].payload), ['id', 'status', 'result'])
    assert.equal(deliveries[0].payload.id, read.id)
    assert.deepEqual(deliveries[0].payload.result.report, REPORT)
  } finally { ctx.close() }
  const off = await setup({ env: { API_WEBHOOK_SECRET: '' } })
  try {
    const { secret } = await off.issue()
    const refused = await post(off, '/api/v1/reads', secret, readBody({ webhook_url: 'https://hooks.example.com/x' }))
    assert.equal(refused.status, 400)
    assert.equal((await refused.json()).error.code, 'webhooks_not_configured')
  } finally { off.close() }
  // A key issued while webhooks were off never saw a signing secret; enabling them later does not change that.
  const later = await setup()
  try {
    const { secret, key } = await later.issue()
    later.keyStore.rows.get(key.id).webhook_secret_issued = false
    const refused = await post(later, '/api/v1/reads', secret, readBody({ webhook_url: 'https://hooks.example.com/x' }))
    assert.equal(refused.status, 400)
    const error = (await refused.json()).error
    assert.equal(error.code, 'webhooks_not_configured')
    assert.match(error.message, /without a webhook signing secret/)
    assert.equal(counted(later), 0)
    assert.equal((await post(later, '/api/v1/reads', secret, readBody())).status, 202, 'it can still submit and poll')
    await Promise.all(later.tasks)
  } finally { later.close() }
})

test('API reads are never captured for training', async () => {
  const source = await readFile(new URL('../src/publicApi.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /from '\.\/trainingCapture\.mjs'/, 'the API module does not import the capture code')
  const ctx = await setup()
  try {
    const { secret } = await ctx.issue({ dataAgreementId: 'DPA-1' })
    await post(ctx, '/api/v1/chat/completions', secret, readBody())
    await post(ctx, '/api/v1/reads', secret, readBody())
    await Promise.all(ctx.tasks)
    assert.ok(ctx.pool.queries.length > 0)
    assert.ok(ctx.pool.queries.every(sql => !/training_/i.test(sql)), 'no capture table is touched')
  } finally { ctx.close() }
})

test('the app routes /api/v1 to key auth before the session and keys nowhere else', async () => {
  const source = await readFile(new URL('../src/index.mjs', import.meta.url), 'utf8')
  const v1 = source.indexOf("path.startsWith('/api/v1/')"), session = source.indexOf('const user = await userFor(req)'), origin = source.indexOf('allowedOrigin(req.headers.origin')
  assert.ok(v1 > 0 && v1 < session && v1 < origin, '/api/v1 is answered before the Origin check and the session lookup')
  assert.equal(source.match(/apiKeys\.authenticate|publicApi\.handle/g).length, 1, 'only the /api/v1 branch accepts keys')
  assert.doesNotMatch(source.slice(source.indexOf('async function userFor'), source.indexOf('function clientIp')), /authorization/i, 'the session lookup never reads Authorization')
})
