import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { createDicomweb, dicomwebConfiguration, qidoRequest, singleDicomPart } from '../src/dicomweb.mjs'

const env = { DICOMWEB_BASE_URL: 'https://archive.example/dicom-web/', DICOMWEB_USERNAME: 'service', DICOMWEB_PASSWORD: 'secret', PUBLIC_ORIGIN: 'https://app.example' }
const admin = { id: 'admin-1', role: 'admin' }
async function request(adapter, path, body = {}, user = admin, origin = env.PUBLIC_ORIGIN, method = 'POST') {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]); Object.assign(req, { url: path, method, headers: { origin } })
  const res = new EventEmitter(); res.writeHead = (status, headers) => { res.status = status; res.headers = headers; res.headersSent = true }; res.end = value => { res.body = value }
  const audit = []
  await adapter.handle(req, res, user, { audit: async (...args) => audit.push(args) })
  return { ...res, json: String(res.headers?.['Content-Type']).includes('json') ? JSON.parse(res.body) : null, audit }
}
const tag = value => ({ Value: [value] })
const metadata = rows => new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/dicom+json' } })

test('configuration is fixed and private HTTP requires explicit opt in', () => {
  assert.equal(dicomwebConfiguration({}), null)
  for (const value of ['http://archive.example/', 'https://user:pass@archive.example/', 'https://archive.example/?url=x', 'file:///etc/passwd']) assert.throws(() => dicomwebConfiguration({ ...env, DICOMWEB_BASE_URL: value }))
  assert.equal(dicomwebConfiguration(env).base.href, env.DICOMWEB_BASE_URL)
  assert.throws(() => qidoRequest({ level: 'studies', url: 'https://evil.example' }))
  assert.throws(() => qidoRequest({ level: 'series', studyUid: '../secret' }))
  assert.throws(() => qidoRequest({ level: 'studies', limit: 51 }))
})
test('authentication, admin and exact-origin checks run before upstream access', async () => {
  let calls = 0; const adapter = createDicomweb({ env, fetchImpl: async () => { calls++; throw Error() } })
  assert.equal((await request(adapter, '/api/admin/pacs/query', {}, null)).status, 401)
  assert.equal((await request(adapter, '/api/admin/pacs/query', {}, { role: 'reviewer' })).status, 403)
  assert.equal((await request(adapter, '/api/admin/pacs/query', {}, admin, 'https://evil.example')).status, 403)
  assert.equal((await request(adapter, '/api/admin/pacs/status', {}, admin, undefined, 'GET')).json.configured, true)
  assert.equal(calls, 0)
})
test('QIDO bounds results, strips unneeded metadata, encodes filters, denies redirects', async () => {
  const adapter = createDicomweb({ env, fetchImpl: async (url, options) => {
    assert.equal(url.origin, 'https://archive.example'); assert.equal(url.searchParams.get('PatientID'), 'A&B'); assert.equal(url.searchParams.get('limit'), '2')
    assert.equal(options.redirect, 'error'); assert.match(options.headers.Authorization, /^Basic /)
    return metadata([{ '0020000D': tag('1.2.3'), '00100010': tag({ Alphabetic: 'Example' }), '7FE00010': { BulkDataURI: 'https://evil.example' } }, { '0020000D': tag('1.2.4') }])
  } })
  const result = await request(adapter, '/api/admin/pacs/query', { level: 'studies', patientId: 'A&B', limit: 1 })
  assert.equal(result.status, 200); assert.equal(result.json.items.length, 1); assert.equal(result.json.hasMore, true)
  assert.equal(result.json.items[0].seriesCount, null); assert.equal(JSON.stringify(result.json).includes('BulkDataURI'), false)
  assert.deepEqual(result.audit, [['admin-1', 'pacs.query']])
})
test('nested metadata cannot change requested parent identity', async () => {
  const adapter = createDicomweb({ env, fetchImpl: async () => metadata([{ '0020000D': tag('9.9'), '0020000E': tag('1.2') }]) })
  assert.equal((await request(adapter, '/api/admin/pacs/query', { level: 'series', studyUid: '1.1' })).status, 502)
})
test('multipart extraction preserves pixels and rejects multiple or empty instances', () => {
  const body = Buffer.from('--abc\r\nContent-Type: application/dicom\r\n\r\nDICM\0pixels\r\n--abc--\r\n')
  assert.equal(singleDicomPart(body, 'multipart/related; boundary="abc"').toString(), 'DICM\0pixels')
  assert.throws(() => singleDicomPart(Buffer.from('--abc\r\nContent-Type: application/dicom\r\n\r\nDICM\r\n--abc\r\nsecond'), 'multipart/related; boundary=abc'))
  assert.throws(() => singleDicomPart(Buffer.alloc(0), 'application/dicom'))
})
test('retrieval uses explicit little endian and does not forward sensitive headers', async () => {
  const adapter = createDicomweb({ env, fetchImpl: async (url, options) => {
    assert.equal(url.pathname, '/dicom-web/studies/1.1/series/1.2/instances/1.3')
    assert.match(options.headers.Accept, /transfer-syntax=1\.2\.840\.10008\.1\.2\.1/)
    return new Response('DICM', { headers: { 'Content-Type': 'application/dicom', 'Set-Cookie': 'unsafe=1' } })
  } })
  const result = await request(adapter, '/api/admin/pacs/instance', { studyUid: '1.1', seriesUid: '1.2', instanceUid: '1.3' })
  assert.equal(result.status, 200); assert.equal(result.headers['Set-Cookie'], undefined); assert.equal(result.headers['Cache-Control'], 'no-store')
  assert.deepEqual(result.audit, [['admin-1', 'pacs.instance_retrieved']])
})
test('oversized upstream metadata is rejected before buffering', async () => {
  const adapter = createDicomweb({ env, fetchImpl: async () => new Response('[]', { headers: { 'Content-Type': 'application/dicom+json', 'Content-Length': '999999999' } }) })
  assert.equal((await request(adapter, '/api/admin/pacs/query', { level: 'studies' })).status, 502)
})
