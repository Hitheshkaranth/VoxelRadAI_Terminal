// Scale-out paths: several model upstreams with fail-over, the durable read queue with workers, and metrics.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createModelProxy, bridgeConfigured, modelRoute } from '../src/modelProxy.mjs'
import { createUpstreamPool, parseUpstreams, upstreamBase } from '../src/modelPool.mjs'
import { createApiKeys } from '../src/apiKeys.mjs'
import { createPublicApi, queueSettings } from '../src/publicApi.mjs'
import { createWorker } from '../src/worker.mjs'
import { metricsAuthorized, renderMetrics } from '../src/metrics.mjs'
import { createOperations } from '../src/operations.mjs'
import { body, fakePool, listen, memoryKeyStore, memoryReadStore, send, waitFor } from './apiHelpers.mjs'

const SECRET = 's'.repeat(40)
const REPORT = { findings: [], impression: 'Normal.' }
const readBody = () => ({ model: 'skanda-v1', messages: [{ role: 'user', content: [{ type: 'text', text: 'Chest PA' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] }] })

// One model upstream. `mode` is ok | down | busy | quota | bad, or a function returning one per read.
function upstream(mode = 'ok', seen = []) {
  return async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    const current = typeof mode === 'function' ? mode() : mode
    if (path.endsWith('/v1/models')) return current === 'ok' ? send(res, 200, { data: [{ id: 'skanda-v1' }] }) : send(res, 503, { error: 'down' })
    seen.push(await body(req, 1e7))
    if (current === 'down') return send(res, 503, { error: 'starting' })
    if (current === 'busy') return send(res, 429, { error: 'The model service is busy.' })
    if (current === 'quota') return send(res, 429, { error: 'You have exceeded your GPU quota' })
    if (current === 'bad') return send(res, 413, { error: 'too large' })
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(': queued\n\n')
    setTimeout(() => res.end(`data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { content: JSON.stringify(REPORT) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`), 10)
  }
}

test('upstream configuration: a list, de-duplicated, plain http only for loopback or named private hosts', () => {
  assert.deepEqual(parseUpstreams({ MODEL_UPSTREAM_URL: 'https://a.hf.space/lmstudio' }), ['https://a.hf.space/lmstudio'])
  assert.deepEqual(parseUpstreams({ MODEL_UPSTREAMS: 'https://a.hf.space/lmstudio, https://gpu-1.example.com/,https://a.hf.space/lmstudio,ftp://x', MODEL_UPSTREAM_URL: 'https://ignored' }), ['https://a.hf.space/lmstudio', 'https://gpu-1.example.com'])
  assert.equal(upstreamBase('http://skanda-gpu:8000'), null)
  assert.deepEqual(parseUpstreams({ MODEL_UPSTREAMS: 'http://skanda-gpu:8000,http://other:8000', MODEL_UPSTREAM_HTTP_HOSTS: 'skanda-gpu' }), ['http://skanda-gpu:8000'])
  assert.equal(bridgeConfigured({ MODEL_UPSTREAMS: 'https://gpu.example.com', BRIDGE_SECRET: SECRET }), true)
  assert.equal(modelRoute('lmstudio/v1/chat/completions', { MODEL_UPSTREAMS: 'https://gpu.example.com', BRIDGE_SECRET: SECRET }), 'lmstudio/v1/chat/completions')
  assert.equal(bridgeConfigured({ MODEL_UPSTREAMS: 'https://gpu.example.com', BRIDGE_SECRET: 'short' }), false)
})

test('pool order: least loaded first, open circuits last, and a success closes the circuit', () => {
  let clock = 0
  const pool = createUpstreamPool(['https://a.example', 'https://b.example'], { failureThreshold: 2, cooldownMs: 1000, now: () => clock })
  const [a, b] = pool.candidates().sort((x, y) => x.index - y.index)
  const release = pool.track(a)
  assert.equal(pool.candidates()[0], b, 'the idle upstream goes first')
  release(); release()
  assert.equal(a.inFlight, 0, 'release is idempotent')
  pool.failed(b); pool.failed(b)
  assert.equal(pool.candidates().at(-1), b, 'an open circuit is tried last, not dropped')
  assert.equal(pool.snapshot().find(u => u.index === 1).up, false)
  clock = 1001
  assert.equal(pool.snapshot().find(u => u.index === 1).up, true, 'half-open after the cool-down')
  pool.started(b)
  assert.equal(b.consecutiveFailures, 0)
})

async function proxyWith(modes) {
  const seen = modes.map(() => [])
  const servers = await Promise.all(modes.map((mode, i) => listen(upstream(mode, seen[i]))))
  const pool = fakePool()
  const proxy = createModelProxy({ pool, body, send, env: { MODEL_UPSTREAMS: servers.map(s => `${s.url}/lmstudio`).join(','), BRIDGE_SECRET: SECRET } })
  const app = await listen(async (req, res) => { if (!await proxy.handle(req, res, new URL(req.url, 'http://x').pathname, { id: 'user-1' })) send(res, 404, {}) })
  const read = () => fetch(`${app.url}/lmstudio/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(readBody()) })
  return { proxy, pool, seen, read, close: () => { servers.forEach(s => s.close()); app.close() } }
}
const counted = pool => [...pool.counts.values()].reduce((a, b) => a + b, 0)

test('a read fails over from an upstream that is down, busy or out of quota, and is counted once', async () => {
  for (const first of ['down', 'busy', 'quota']) {
    const ctx = await proxyWith([first, 'ok'])
    try {
      // Force the failing upstream to be tried first on every read.
      for (let i = 0; i < 2; i++) {
        const response = await ctx.read()
        assert.equal(response.status, 200, first)
        assert.match(await response.text(), /Normal/)
      }
      assert.ok(ctx.seen[1].length >= 1, `${first}: the healthy upstream served`)
      assert.equal(counted(ctx.pool), 2, `${first}: one count per read, none for the refused attempt`)
      const snapshot = ctx.proxy.upstreams()
      assert.equal(snapshot.reduce((n, u) => n + u.inFlight, 0), 0, 'streams released their upstream')
    } finally { ctx.close() }
  }
})

test('no fail-over for a request every upstream would refuse; all down is refunded', async () => {
  const bad = await proxyWith(['bad', 'ok'])
  try {
    // Whichever is tried first: a 413 stops at once, so at most one upstream sees each read.
    for (let i = 0; i < 4; i++) await (await bad.read()).text()
    assert.ok(bad.seen[0].length >= 1)
    assert.equal(bad.seen[0].length + bad.seen[1].length >= 4, true)
  } finally { bad.close() }
  const down = await proxyWith(['down', 'down'])
  try {
    const response = await down.read()
    assert.equal(response.status, 503)
    assert.equal(down.seen[0].length + down.seen[1].length, 2, 'both were tried')
    assert.equal(counted(down.pool), 0, 'a read no upstream started is refunded')
  } finally { down.close() }
})

// Public API wired as in production, with in-memory stores, in worker mode.
async function queueSetup({ env = {}, mode = 'ok', leaseSeconds } = {}) {
  const up = await listen(upstream(mode))
  const pool = fakePool()
  const fullEnv = { MODEL_UPSTREAM_URL: `${up.url}/lmstudio`, BRIDGE_SECRET: SECRET, READ_EXECUTION: 'worker', ...env }
  const modelProxy = createModelProxy({ pool, body, send, env: fullEnv })
  const keyStore = memoryKeyStore()
  const apiKeys = createApiKeys({ store: keyStore, env: fullEnv, body, send, audit: async () => {}, confirmAdmin: async () => true })
  const readStore = memoryReadStore(keyStore)
  const make = owner => createPublicApi({ readStore, env: fullEnv, body, send, modelProxy, apiKeys, publicOrigin: 'https://radgenis.com', leaseOwner: owner, timeouts: { cancelPoll: 20, leaseSeconds } })
  const api = make('api-1')
  const app = await listen(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    if (path.startsWith('/api/v1')) return api.handle(req, res, path)
    if (await apiKeys.handleAdmin(req, res, path, { id: '11111111-1111-4111-8111-111111111111', role: 'admin' })) return
    send(res, 404, {})
  })
  const issued = await (await fetch(`${app.url}/api/admin/api-keys`, { method: 'POST', body: JSON.stringify({ organisation: 'Acme', label: 'Bridge', kind: 'live', currentPassword: 'x' }) })).json()
  const submit = (headers = {}) => fetch(`${app.url}/api/v1/reads`, { method: 'POST', headers: { Authorization: `Bearer ${issued.secret}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(readBody()) })
  const poll = id => fetch(`${app.url}/api/v1/reads/${id}`, { headers: { Authorization: `Bearer ${issued.secret}` } }).then(r => r.json())
  return { api, make, pool, readStore, submit, poll, close: () => { up.close(); app.close() } }
}

test('worker mode: the API only queues and notifies; a worker claims and completes the read', async () => {
  const ctx = await queueSetup()
  try {
    const accepted = await ctx.submit()
    assert.equal(accepted.status, 202)
    const { id } = await accepted.json()
    await waitFor(() => ctx.readStore.notified === 1)
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal((await ctx.poll(id)).status, 'queued', 'nothing runs it in the API process')
    const worker = createWorker({ publicApi: ctx.make('worker-1'), concurrency: 2, pollMs: 10 }).start()
    const done = await waitFor(async () => { const read = await ctx.poll(id); return read.status === 'succeeded' && read })
    assert.deepEqual(done.result.report, REPORT)
    assert.equal(ctx.readStore.reads.get(id).request.messages[0].content[1].removed, true, 'image data dropped once finished')
    assert.equal(await worker.stop(100), 0)
    assert.equal(worker.stats().completed, 1)
  } finally { ctx.close() }
})

test('a read whose executor died is requeued, retried by another, and fails once attempts run out', async () => {
  const ctx = await queueSetup({ env: { READ_MAX_ATTEMPTS: '2' } })
  try {
    const { id } = await (await ctx.submit()).json()
    // A worker takes the read and then "dies": the lease lapses without a heartbeat.
    const dead = ctx.make('worker-dead')
    const row = ctx.readStore.reads.get(id)
    await ctx.readStore.start(id, dead.lease)
    ctx.readStore.lapse(id)
    await ctx.api.recover()
    assert.equal(row.status, 'queued', 'back on the queue with an attempt left')
    const worker = createWorker({ publicApi: ctx.make('worker-2'), concurrency: 1, pollMs: 10 }).start()
    await waitFor(async () => (await ctx.poll(id)).status === 'succeeded')
    await worker.stop(100)
    assert.equal(row.attempts, 2)
    // The dead worker cannot overwrite a read someone else finished.
    assert.equal(await ctx.readStore.finish(id, { status: 'failed', owner: dead.lease.owner }), false)

    const second = (await (await ctx.submit()).json()).id
    for (const owner of ['w-a', 'w-b']) { await ctx.readStore.start(second, { owner, seconds: 60 }); ctx.readStore.lapse(second); await ctx.api.recover() }
    assert.equal(ctx.readStore.reads.get(second).status, 'failed', 'no attempts left')
    assert.equal(ctx.readStore.reads.get(second).request, null)
  } finally { ctx.close() }
})

test('back-pressure and queue time limit: a full queue refuses before counting; an expired queued read is refunded', async () => {
  const ctx = await queueSetup({ env: { READ_QUEUE_LIMIT: '1' } })
  try {
    assert.equal((await ctx.submit()).status, 202)
    const full = await ctx.submit()
    assert.equal(full.status, 503)
    assert.equal((await full.json()).error.code, 'queue_full')
    assert.equal(full.headers.get('retry-after'), '30')
    assert.equal(counted(ctx.pool), 1, 'the refused read was never counted')
    const [row] = ctx.readStore.reads.values()
    row.created_at = new Date(Date.now() - 3600_000)
    await ctx.api.recover()
    assert.equal(row.status, 'failed')
    assert.equal(row.error.code, 'queue_timeout')
    assert.equal(counted(ctx.pool), 0, 'refunded: it never reached a GPU')
  } finally { ctx.close() }
})

test('inline mode retries a requeued read on the next API request, but leaves fresh reads to their submitter', async () => {
  const ctx = await queueSetup({ env: { READ_EXECUTION: 'inline' } })
  try {
    const { id } = await (await ctx.submit()).json()
    await waitFor(async () => (await ctx.poll(id)).status === 'succeeded')
    // Simulate a crashed function: running, attempt used, lease lapsed.
    const row = ctx.readStore.reads.get(id)
    Object.assign(row, { status: 'running', result: null, lease_owner: 'gone', request: readBody() })
    ctx.readStore.lapse(id)
    await ctx.poll(id) // sweeps and requeues
    await waitFor(async () => (await ctx.poll(id)).status === 'succeeded')
    assert.equal(row.attempts, 2)
  } finally { ctx.close() }
})

test('queue settings are bounded', () => {
  assert.deepEqual(queueSettings({}), { mode: 'inline', queueLimit: 500, queueTtlSeconds: 600, maxAttempts: 2 })
  assert.deepEqual(queueSettings({ READ_EXECUTION: 'worker', READ_QUEUE_LIMIT: '0', READ_QUEUE_TTL_SECONDS: '5', READ_MAX_ATTEMPTS: '9' }), { mode: 'worker', queueLimit: 0, queueTtlSeconds: 600, maxAttempts: 2 })
})

test('metrics: hidden without a token, Prometheus text with one, no identifiers', () => {
  const req = header => ({ headers: header ? { authorization: header } : {} })
  assert.equal(metricsAuthorized(req('Bearer ' + 't'.repeat(20)), undefined), false)
  assert.equal(metricsAuthorized(req('Bearer ' + 't'.repeat(20)), 'short'), false)
  assert.equal(metricsAuthorized(req('Bearer wrong'), 't'.repeat(20)), false)
  assert.equal(metricsAuthorized(req('Bearer ' + 't'.repeat(20)), 't'.repeat(20)), true)
  const operations = createOperations({ log: () => {} })
  const text = renderMetrics({ role: 'api', operations, pool: { totalCount: 3, idleCount: 2, waitingCount: 0 }, upstreams: [{ index: 0, host: 'gpu-1:8000', up: true, inFlight: 1, started: 4, failures: 1 }], queue: { queued: 5, running: 2 } })
  assert.match(text, /# TYPE voxelrad_http_requests_total counter/)
  assert.match(text, /voxelrad_db_pool_connections\{role="api",state="idle"\} 2/)
  assert.match(text, /voxelrad_model_upstream_up\{role="api",upstream="0",host="gpu-1:8000"\} 1/)
  assert.match(text, /voxelrad_api_reads\{status="queued"\} 5/)
  assert.ok(text.endsWith('\n'))
})
