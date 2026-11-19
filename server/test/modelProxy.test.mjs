import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { createModelProxy, dailyReadLimit, modelRoute, upstreamBase, upstreamError, userPseudonym } from '../src/modelProxy.mjs'

const SECRET = 's'.repeat(40)
function send(res, status, body, extra = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extra }); res.end(JSON.stringify(body)) }
async function body(req) { const chunks = []; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString() || '{}') }
// Stand-in for the login_attempts upsert: one counter per key, never expiring inside a test.
function fakePool() {
  const counts = new Map()
  return { counts, async query(sql, [key]) {
    if (sql.startsWith('INSERT')) { counts.set(key, (counts.get(key) || 0) + 1); return { rows: [{ attempts: counts.get(key), resets_at: new Date(Date.now() + 3600000) }] } }
    counts.set(key, Math.max(0, (counts.get(key) || 0) - 1)); return { rows: [] }
  } }
}
async function listen(handler) {
  const server = http.createServer(handler)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}
async function setup(upstreamHandler, env = {}, timeouts) {
  const upstream = await listen(upstreamHandler)
  const pool = fakePool()
  const proxy = createModelProxy({ pool, body, send, env: { MODEL_UPSTREAM_URL: `${upstream.url}/lmstudio`, BRIDGE_SECRET: SECRET, ...env }, timeouts })
  const app = await listen(async (req, res) => {
    if (!await proxy.handle(req, res, new URL(req.url, 'http://x').pathname, { id: 'user-1' })) send(res, 404, { error: 'Endpoint not found.' })
  })
  return { proxy, pool, url: app.url, close: () => { upstream.server.close(); app.server.close(); upstream.server.closeAllConnections(); app.server.closeAllConnections() } }
}
const read = (url, init = {}) => fetch(`${url}/lmstudio/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'skanda-v1', messages: [] }), ...init })

test('configuration and routing stay off unless both settings are valid', () => {
  assert.equal(upstreamBase('https://h.hf.space/lmstudio/'), 'https://h.hf.space/lmstudio')
  assert.equal(upstreamBase('http://example.com/lmstudio'), null, 'plain http only for loopback')
  assert.equal(upstreamBase('https://user:pw@h.hf.space'), null)
  assert.equal(modelRoute('lmstudio/v1/models', {}), 'unconfigured-model')
  assert.equal(modelRoute('lmstudio/v1/models', { MODEL_UPSTREAM_URL: 'https://h.hf.space/lmstudio', BRIDGE_SECRET: 'short' }), 'unconfigured-model')
  const env = { MODEL_UPSTREAM_URL: 'https://h.hf.space/lmstudio', BRIDGE_SECRET: SECRET }
  assert.equal(modelRoute('lmstudio/v1/chat/completions', env), 'lmstudio/v1/chat/completions')
  assert.equal(modelRoute('lmstudio/status', env), 'unconfigured-model', 'only the read and model-list paths are bridged')
  assert.equal(modelRoute('studies', env), 'studies')
  assert.equal(dailyReadLimit({}), 40)
  assert.equal(dailyReadLimit({ MODEL_DAILY_READS: '5' }), 5)
  assert.equal(dailyReadLimit({ MODEL_DAILY_READS: 'lots' }), 40)
  assert.match(userPseudonym('user-1', SECRET), /^u-[0-9a-f]{16}$/)
  assert.notEqual(userPseudonym('user-1', SECRET), userPseudonym('user-2', SECRET))
})

test('maps upstream refusals to errors the workspace understands', () => {
  const quota = upstreamError(500, JSON.stringify({ error: 'You have exceeded your GPU quota (90s requested vs. 12s left). Try again in 0:40:00.' }))
  assert.equal(quota.status, 429)
  assert.match(quota.error, /quota exceeded/i)
  assert.match(quota.error, /90s requested vs\. 12s left/)
  assert.equal(upstreamError(401, '{"error":"Sign in to use inference."}').status, 502)
  assert.equal(upstreamError(502, '<html>Space is building</html>').status, 503)
  assert.equal(upstreamError(404, '').status, 502)
})

test('disabled proxy leaves model paths alone', async () => {
  const proxy = createModelProxy({ pool: fakePool(), body, send, env: {} })
  assert.equal(proxy.enabled, false)
  assert.equal(await proxy.handle({ method: 'GET' }, {}, '/lmstudio/v1/models', { id: 'u' }), false)
})

test('streams a read with the bridge headers and counts it', async () => {
  let seen
  const ctx = await setup(async (req, res) => {
    seen = { url: req.url, headers: req.headers, body: await body(req) }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(': queued\n\n')
    setTimeout(() => { res.write('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n'); res.end('data: [DONE]\n\n') }, 30)
  })
  try {
    const res = await read(ctx.url)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /text\/event-stream/)
    assert.equal(res.headers.get('x-voxelrad-reads-left'), '39')
    const reader = res.body.getReader()
    const first = new TextDecoder().decode((await reader.read()).value)
    assert.equal(first, ': queued\n\n', 'heartbeat arrives before the result: no buffering')
    let rest = ''
    for (let r = await reader.read(); !r.done; r = await reader.read()) rest += new TextDecoder().decode(r.value)
    assert.match(rest, /"content":"ok"/)
    assert.match(rest, /\[DONE\]/)
    assert.equal(seen.url, '/lmstudio/v1/chat/completions')
    assert.equal(seen.headers['x-voxelrad-bridge'], SECRET)
    assert.equal(seen.headers['x-voxelrad-user'], userPseudonym('user-1', SECRET))
    assert.equal(seen.headers.cookie, undefined, 'the site session never reaches the Space')
    assert.equal(seen.body.model, 'skanda-v1')
    assert.equal([...ctx.pool.counts.values()][0], 1)
  } finally { ctx.close() }
})

test('enforces the per-user daily limit', async () => {
  let calls = 0
  const ctx = await setup((req, res) => { calls++; req.resume(); res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: [DONE]\n\n') }, { MODEL_DAILY_READS: '2' })
  try {
    assert.equal((await read(ctx.url)).status, 200)
    assert.equal((await read(ctx.url)).status, 200)
    const refused = await read(ctx.url)
    assert.equal(refused.status, 429)
    assert.match((await refused.json()).error, /Daily limit reached: 2 model reads/)
    assert.ok(Number(refused.headers.get('retry-after')) >= 60)
    assert.equal(calls, 2)
  } finally { ctx.close() }
})

test('returns clear JSON for quota and unavailable upstreams and refunds the read', async () => {
  let mode = 'quota'
  const ctx = await setup((req, res) => {
    req.resume()
    if (mode === 'quota') send(res, 429, { error: 'You have exceeded your free GPU quota. Try again in 1:00:00.' })
    else { res.writeHead(503, { 'Content-Type': 'text/html' }); res.end('<html>Sleeping</html>') }
  })
  try {
    const quota = await read(ctx.url)
    assert.equal(quota.status, 429)
    assert.match((await quota.json()).error, /ZeroGPU quota exceeded/)
    mode = 'down'
    const down = await read(ctx.url)
    assert.equal(down.status, 503)
    assert.match((await down.json()).error, /starting or unavailable/)
    assert.equal([...ctx.pool.counts.values()][0], 0, 'failed reads are not counted')
  } finally { ctx.close() }
})

test('times out when the upstream never answers', async () => {
  const ctx = await setup(() => {}, {}, { headers: 100 })
  try {
    const res = await read(ctx.url)
    assert.equal(res.status, 504)
    assert.match((await res.json()).error, /did not start the read/)
  } finally { ctx.close() }
})

test('aborts the upstream read when the client disconnects', async () => {
  let upstreamClosed
  const closed = new Promise(resolve => { upstreamClosed = resolve })
  const ctx = await setup((req, res) => {
    req.resume()
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(': queued\n\n')
    res.on('close', upstreamClosed)
  })
  try {
    const ac = new AbortController()
    const res = await read(ctx.url, { signal: ac.signal })
    await res.body.getReader().read()
    ac.abort()
    await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream still open')), 2000))])
  } finally { ctx.close() }
})

test('proxies the model list and rejects wrong methods', async () => {
  const ctx = await setup((req, res) => {
    assert.equal(req.headers['x-voxelrad-bridge'], SECRET)
    send(res, 200, { data: [{ id: 'skanda-v1', state: 'loaded' }], path: req.url })
  })
  try {
    const list = await fetch(`${ctx.url}/lmstudio/api/v0/models`)
    assert.equal(list.status, 200)
    assert.deepEqual(await list.json(), { data: [{ id: 'skanda-v1', state: 'loaded' }], path: '/lmstudio/api/v0/models' })
    assert.equal((await fetch(`${ctx.url}/lmstudio/v1/chat/completions`)).status, 405)
    assert.equal([...ctx.pool.counts.values()].length, 0, 'model checks do not use reads')
  } finally { ctx.close() }
})
