import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import https from 'node:https'
import { once } from 'node:events'
import { checkWebhookUrl, deliverWebhook, guardedLookup, isPublicAddress, postJson, signWebhook } from '../src/webhook.mjs'

test('only public addresses pass', () => {
  for (const address of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) assert.equal(isPublicAddress(address), true, address)
  for (const address of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::', '::1', 'fe80::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:a00:1::1', 'not-an-ip']) assert.equal(isPublicAddress(address), false, address)
})

test('webhook URLs must be https, credential-free and resolve only to public addresses', async () => {
  const resolve = async host => ({ 'good.example': ['93.184.216.34'], 'mixed.example': ['93.184.216.34', '10.0.0.1'], 'empty.example': [] })[host] ?? Promise.reject(new Error('NXDOMAIN'))
  assert.deepEqual(await checkWebhookUrl('https://good.example/hook?x=1', { resolve }), { url: 'https://good.example/hook?x=1' })
  assert.match((await checkWebhookUrl('http://good.example/hook', { resolve })).error, /https/)
  assert.match((await checkWebhookUrl('https://a:b@good.example/', { resolve })).error, /credentials/)
  assert.match((await checkWebhookUrl('https://mixed.example/', { resolve })).error, /private/, 'every resolved address must be public')
  assert.match((await checkWebhookUrl('https://empty.example/', { resolve })).error, /resolved/)
  assert.match((await checkWebhookUrl('https://missing.example/', { resolve })).error, /resolved/)
  assert.match((await checkWebhookUrl('https://10.0.0.1/', { resolve })).error, /private/)
  assert.match((await checkWebhookUrl('https://[fd00::1]/', { resolve })).error, /private/)
  assert.match((await checkWebhookUrl('https://localhost/', { resolve })).error, /public host/)
  assert.match((await checkWebhookUrl('ftp://good.example/', { resolve })).error, /https/)
  assert.match((await checkWebhookUrl(42, { resolve })).error, /HTTPS URL/)
  assert.match((await checkWebhookUrl('https://slow.example/', { resolve: () => new Promise(() => {}), timeoutMs: 20 })).error, /resolved/)
})

test('connection-time lookup refuses hosts that rebind to private addresses', async () => {
  const lookup = answers => guardedLookup((_host, _options, callback) => callback(null, answers))
  const run = (fn, options) => new Promise(resolve => fn('h.example', options, (...args) => resolve(args)))
  const [error] = await run(lookup([{ address: '10.0.0.1', family: 4 }]), {})
  assert.equal(error.code, 'EPRIVATEADDR')
  const [, address, family] = await run(lookup([{ address: '93.184.216.34', family: 4 }]), {})
  assert.deepEqual([address, family], ['93.184.216.34', 4])
  const [, all] = await run(lookup([{ address: '93.184.216.34', family: 4 }]), { all: true })
  assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }])
  await assert.rejects(postJson('https://127.0.0.1:9/x', '{}', {}, 1000), { code: 'EPRIVATEADDR' }, 'literal private addresses are refused before connecting')
  await assert.rejects(postJson('http://93.184.216.34/x', '{}', {}, 1000), /https/)
})

test('delivery signs the exact body and retries three times with backoff', async () => {
  const secret = 'whsec_test'
  const payload = { id: 'r1', status: 'succeeded', result: { content: '{}' } }
  const calls = [], waits = []
  let clock = 0
  const result = await deliverWebhook({ url: 'https://good.example/hook', payload, secret, deadline: 60_000, now: () => clock, sleep: async ms => { waits.push(ms); clock += ms },
    post: async (url, raw, headers, timeout) => { calls.push({ url, raw, headers, timeout }); clock += 100; return calls.length < 4 ? 500 : 204 } })
  assert.deepEqual(result, { delivered: true, attempts: 4, status: 204 })
  assert.deepEqual(waits, [1000, 2000, 4000])
  assert.equal(calls[0].raw, JSON.stringify(payload))
  assert.equal(calls[0].headers['X-VoxelRad-Timestamp'], '0')
  assert.equal(calls[0].headers['X-VoxelRad-Signature'], 'sha256=' + createHmac('sha256', secret).update(`0.${calls[0].raw}`).digest('hex'), 'signed over timestamp.body')
  assert.equal(calls[0].headers['X-VoxelRad-Signature'], signWebhook(secret, '0', calls[0].raw))
  assert.equal(calls[3].headers['X-VoxelRad-Timestamp'], '7', 'each retry is signed with its own time')
  assert.equal(calls[3].headers['X-VoxelRad-Signature'], signWebhook(secret, '7', calls[3].raw))
  assert.notEqual(signWebhook(secret, '1', calls[0].raw), signWebhook(secret, '2', calls[0].raw), 'a replay cannot move the timestamp without the secret')
  assert.equal(calls[0].timeout, 10_000)

  const redirects = []
  const redirected = await deliverWebhook({ url: 'https://good.example/hook', payload, secret, deadline: 60_000, now: () => 0, sleep: async () => {}, post: async () => { redirects.push(1); return 302 } })
  assert.equal(redirected.delivered, false, 'a redirect is not followed or treated as delivered')
  assert.equal(redirects.length, 4)

  let tight = 0
  const late = await deliverWebhook({ url: 'https://good.example/hook', payload, secret, deadline: 2500, now: () => tight, sleep: async ms => { tight += ms }, post: async (_u, _r, _h, timeout) => { tight += timeout; return 500 } })
  assert.equal(late.attempts, 1, 'no attempt is started past the function lifetime')

  const blocked = []
  await deliverWebhook({ url: 'https://good.example/hook', payload, secret, deadline: 60_000, now: () => 0, sleep: async () => {}, post: async () => { blocked.push(1); throw Object.assign(new Error('private'), { code: 'EPRIVATEADDR' }) } })
  assert.equal(blocked.length, 1, 'a host that rebinds to a private address is not retried')
})

test('IPv4-compatible IPv6 addresses (::a.b.c.d) are not public', async () => {
  for (const address of ['::7f00:1', '::127.0.0.1', '::a00:1', '::a9fe:a9fe']) assert.equal(isPublicAddress(address), false, address)
  assert.match((await checkWebhookUrl('https://[::7f00:1]/hook', { resolve: async () => [] })).error, /private/)
  assert.match((await checkWebhookUrl('https://compat.example/hook', { resolve: async () => ['::127.0.0.1'] })).error, /private/)
  assert.equal(isPublicAddress('2606:4700::1111'), true)
})

// Throwaway self-signed certificate for drip.example, used only by the timeout test below.
const DRIP_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgprnZr6lrGEQzTYnM
MI1f52zsWcauSOtWxnAameG/YQ+hRANCAASiRdMDwxDMcokWbowaIJFzsNKRobR1
PMh1uVxpE6muXG7Hy/8ZsLsmcDdk5dp4Hd54txeyZtGi0Jxfk2DTXqpZ
-----END PRIVATE KEY-----`
const DRIP_CERT = `-----BEGIN CERTIFICATE-----
MIIBfjCCASOgAwIBAgIUZETubvTnt8eMffE3mT6WpaRN9vMwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMZHJpcC5leGFtcGxlMCAXDTI2MTExOTEyMTkwNVoYDzIxMjYx
MDI2MTIxOTA1WjAXMRUwEwYDVQQDDAxkcmlwLmV4YW1wbGUwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAASiRdMDwxDMcokWbowaIJFzsNKRobR1PMh1uVxpE6muXG7H
y/8ZsLsmcDdk5dp4Hd54txeyZtGi0Jxfk2DTXqpZo0swSTAdBgNVHQ4EFgQU2GtX
A3p9GFgYfXC7D6lUoNp1qZswDwYDVR0TAQH/BAUwAwEB/zAXBgNVHREEEDAOggxk
cmlwLmV4YW1wbGUwCgYIKoZIzj0EAwIDSQAwRgIhANBZ1OQuSlyYcTck8xnWYSNX
Kro+s0UXNYCf1SPGvalIAiEAmWxDcOudhwGQ1PWc4tzCY1tjlzvzSjDg0yzzOFO/
td4=
-----END CERTIFICATE-----`

test('a webhook attempt has a wall-clock limit even when the receiver keeps dripping bytes', async () => {
  // Answers 200 but sends the body one byte every 20 ms and never ends it: a socket idle timeout alone never fires.
  const drips = new Set()
  const server = https.createServer({ key: DRIP_KEY, cert: DRIP_CERT }, (req, res) => {
    req.resume()
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    const drip = setInterval(() => res.write('.'), 20)
    drips.add(drip)
    res.on('close', () => { clearInterval(drip); drips.delete(drip) })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const lookup = (_host, options, callback) => options?.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4)
  const started = Date.now()
  try {
    await assert.rejects(postJson(`https://drip.example:${server.address().port}/hook`, '{}', {}, 300, { lookup, ca: DRIP_CERT }), /timed out|closed before/)
    assert.ok(Date.now() - started < 2000, `gave up after ${Date.now() - started} ms`)
  } finally { for (const drip of drips) clearInterval(drip); server.closeAllConnections(); server.close() }
})
