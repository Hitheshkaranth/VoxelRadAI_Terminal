import test from 'node:test'
import assert from 'node:assert/strict'
import { createObjectStorageRouter, readObjectStorageConfig, validateVolumeUpload, volumeObjectSummary } from '../src/objectStorage.mjs'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const enabledEnv = { S3_STORAGE_ENABLED: 'true', S3_BUCKET: 'private-volumes', S3_ENDPOINT: 'https://objects.example.test', S3_MAX_VOLUME_BYTES: '1024', S3_OWNER_QUOTA_BYTES: '4096' }
const acquisition = { modality: 'MRI', bodyPart: 'Head', sequence: 'T1', contrast: 'unknown', intensityIsHU: false }

function fakePool() {
  const rows = new Map(), audit = [], calls = []
  let disabled = false
  const query = async (sql, values = []) => {
    calls.push({ sql, values })
    const result = values => ({ rows: values, rowCount: values.length })
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return result([])
    if (sql.startsWith('SELECT id FROM users')) return result(disabled ? [] : [{ id: values[0] }])
    if (sql.startsWith('SELECT COALESCE(sum(size_bytes)')) {
      const list = [...rows.values()].filter(row => row.owner_id === values[0] && (row.state !== 'pending' || +new Date(row.upload_expires_at) > Date.now()))
      return result([{ bytes: list.reduce((sum, row) => sum + row.size_bytes, 0), pending: list.filter(row => row.state === 'pending').length }])
    }
    if (sql.startsWith('INSERT INTO volume_objects')) {
      const [id, owner_id, file_name, title, size_bytes, raw, staging_key, object_key, upload_expires_at] = values
      const row = { id, owner_id, file_name, title, size_bytes, acquisition: raw ? JSON.parse(raw) : null, staging_key, object_key, upload_expires_at, state: 'pending', created_at: new Date(), finalized_at: null }
      rows.set(id, row); return result([row])
    }
    if (sql.startsWith('SELECT count(*)::int AS total FROM volume_objects')) return result([{ total: [...rows.values()].filter(row => row.owner_id === values[0]).length }])
    if (sql.startsWith("SELECT * FROM volume_objects WHERE state='pending'")) return result([...rows.values()].filter(row => row.state === 'pending' && +new Date(row.upload_expires_at) < Date.now() - 86400000 && !values[0].includes(row.id)).slice(0, 1))
    if (sql.startsWith('SELECT * FROM volume_objects WHERE owner_id')) return result([...rows.values()].filter(row => row.owner_id === values[0]).slice(values[2], values[2] + values[1]))
    if (sql.startsWith('SELECT * FROM volume_objects WHERE id=')) {
      const row = rows.get(values[0])
      return result(row?.owner_id === values[1] && (!sql.includes("state='ready'") || row.state === 'ready') ? [row] : [])
    }
    if (sql.startsWith('UPDATE volume_objects')) {
      const row = rows.get(values[0])
      if (row?.owner_id !== values[1]) return result([])
      if (sql.includes("state='ready'")) { row.state = 'ready'; row.etag = values[2]; row.finalized_at = new Date() }
      else row.state = 'deleting'
      return result([row])
    }
    if (sql.startsWith('DELETE FROM volume_objects')) {
      const row = rows.get(values[0])
      if (row?.owner_id === values[1] && (!sql.includes("state='pending'") || row.state === 'pending')) rows.delete(values[0])
      return result([])
    }
    if (sql.startsWith('INSERT INTO audit_events')) { audit.push(values); return result([]) }
    throw new Error(`Unexpected test query: ${sql}`)
  }
  return { rows, audit, calls, query, disable: () => { disabled = true }, connect: async () => ({ query, release() {} }) }
}
function fakeStorage() {
  const objects = new Map(), calls = []
  const api = {
    objects, calls, failCopy: false, failDelete: false,
    async presignUpload(row) { calls.push(['upload', row.staging_key]); return { url: 'https://objects.example.test/private-volumes', fields: { key: row.staging_key, Policy: 'policy' } } },
    async head(key) { calls.push(['head', key]); if (!objects.has(key)) throw Object.assign(new Error('missing'), { name: 'NotFound' }); return objects.get(key) },
    async prefix(key, etag) { assert.equal(objects.get(key).ETag, etag); return objects.get(key).prefix || Buffer.from('NRRD0005\n') },
    async copy(row, etag) { calls.push(['copy', row.object_key, etag]); if (api.failCopy) throw new Error('provider secret must not escape'); assert.equal(objects.get(row.staging_key).ETag, etag); objects.set(row.object_key, { ...objects.get(row.staging_key) }); return etag },
    async delete(key) { calls.push(['delete', key]); if (api.failDelete) throw new Error('provider secret must not escape'); objects.delete(key) },
    async presignDownload(row) { calls.push(['download', row.object_key]); return `https://objects.example.test/${row.object_key}?signed=1` },
  }
  return api
}
async function setup(env = enabledEnv, storage = fakeStorage()) {
  const pool = fakePool()
  let response
  const router = await createObjectStorageRouter({ pool, storage, env, body: async req => req.data, send: (_res, status, data) => { response = { status, data } } })
  const request = async (path, method = 'GET', data = {}, owner = OWNER) => {
    response = undefined
    const matched = await router.handle({ req: { url: path, method, data }, res: {}, path: path.split('?')[0], user: owner ? { id: owner } : null })
    return { ...response, matched }
  }
  const upload = async () => {
    const result = await request('/api/volumes/uploads', 'POST', { fileName: 'head.nrrd', title: 'Teaching MRI', sizeBytes: 100, acquisition, objectKey: 'someone-else/file' })
    assert.equal(result.status, 201)
    const row = pool.rows.get(result.data.volume.id)
    return { row, result }
  }
  const put = row => storage.objects.set(row.staging_key, { ContentLength: row.size_bytes, ContentType: 'application/octet-stream', Metadata: { 'upload-id': row.id }, ETag: '"original"' })
  return { router, pool, storage, request, upload, put }
}

test('S3 configuration is opt-in and refuses unsafe/invalid settings', () => {
  assert.deepEqual(readObjectStorageConfig({}), { enabled: false })
  assert.throws(() => readObjectStorageConfig({ S3_STORAGE_ENABLED: 'true' }), /S3_BUCKET/)
  assert.throws(() => readObjectStorageConfig({ ...enabledEnv, S3_ENDPOINT: 'http://objects.example.test' }), /HTTPS/)
  assert.throws(() => readObjectStorageConfig({ ...enabledEnv, S3_PUBLIC_ENDPOINT: 'https://user:password@objects.example.test' }), /HTTPS/)
  assert.throws(() => readObjectStorageConfig({ ...enabledEnv, S3_MAX_VOLUME_BYTES: '9999999999' }), /S3_MAX/)
  assert.throws(() => readObjectStorageConfig({ ...enabledEnv, S3_OWNER_QUOTA_BYTES: '1' }), /quota|QUOTA/)
  assert.deepEqual(readObjectStorageConfig(enabledEnv).origins, ['https://objects.example.test'])
})

test('volume intake rejects traversal, invalid sizes and inconsistent acquisition', () => {
  const good = { fileName: 'head.nrrd', sizeBytes: 100, acquisition }
  assert.equal(validateVolumeUpload(good, 1024).title, 'head.nrrd')
  for (const fileName of ['../head.nrrd', 'folder\\head.nrrd', 'head.exe', 'x\n.nrrd']) assert.throws(() => validateVolumeUpload({ ...good, fileName }, 1024))
  for (const sizeBytes of [0, 8, -1, 1025, Infinity, 9.5]) assert.throws(() => validateVolumeUpload({ ...good, sizeBytes }, 1024))
  assert.throws(() => validateVolumeUpload({ ...good, acquisition: { ...acquisition, intensityIsHU: true } }, 1024))
  assert.throws(() => validateVolumeUpload({ ...good, title: ' ' }, 1024))
})

test('status is authenticated, disabled storage is explicit, and routes fall through', async () => {
  const h = await setup({})
  assert.equal((await h.request('/api/volumes/status', 'GET', {}, null)).status, 401)
  const status = await h.request('/api/volumes/status')
  assert.equal(status.data.enabled, false); assert.deepEqual(status.data.uploadOrigins, [])
  assert.equal((await h.request('/api/volumes')).status, 503)
  assert.equal((await h.request('/api/unrelated')).matched, false)
  assert.equal(h.pool.calls.length, 0)
})

test('owner-bound upload/finalize/download persists stable id and immutable ready object', async () => {
  const h = await setup(), { row, result } = await h.upload()
  assert.equal(result.data.upload.method, 'POST')
  assert.match(row.staging_key, new RegExp(`^pending/${OWNER}/`))
  assert.match(row.object_key, new RegExp(`^volumes/${OWNER}/`))
  assert.equal(result.data.volume.object_key, undefined)
  assert.deepEqual(result.data.volume.acquisition, acquisition)
  assert.equal((await h.request(`/api/volumes/${row.id}/download`, 'POST')).status, 404)
  assert.equal((await h.request(`/api/volumes/${row.id}/finalize`, 'POST')).status, 409)
  h.put(row)
  assert.equal((await h.request(`/api/volumes/${row.id}/finalize`, 'POST', {}, OTHER)).status, 404)
  const finalized = await h.request(`/api/volumes/${row.id}/finalize`, 'POST')
  assert.equal(finalized.status, 200); assert.equal(finalized.data.volume.id, row.id); assert.equal(finalized.data.volume.state, 'ready')
  assert.equal(h.storage.objects.has(row.staging_key), false)
  assert.equal(h.storage.objects.has(row.object_key), true)
  const copies = h.storage.calls.filter(([name]) => name === 'copy').length
  // Replaying an unexpired upload grant can only recreate staging, never the ready key.
  h.put(row); h.storage.objects.get(row.staging_key).ETag = '"changed"'
  await h.request(`/api/volumes/${row.id}/finalize`, 'POST')
  assert.equal(h.storage.calls.filter(([name]) => name === 'copy').length, copies)
  assert.equal(h.storage.objects.get(row.object_key).ETag, '"original"')
  assert.equal((await h.request(`/api/volumes/${row.id}/download`, 'POST', {}, OTHER)).status, 404)
  const download = await h.request(`/api/volumes/${row.id}/download`, 'POST')
  assert.equal(download.status, 200); assert.equal(download.data.expiresInSeconds, 60)
  assert.match(download.data.url, new RegExp(row.object_key))
  assert.equal((await h.request('/api/volumes', 'GET', {}, OTHER)).data.total, 0)
  assert.equal((await h.request('/api/volumes')).data.volumes.length, 1)
  assert.equal(volumeObjectSummary(row).owner_id, undefined)
})

test('finalization rejects size mismatch, metadata mismatch, invalid magic and expiration', async () => {
  const h = await setup(), { row } = await h.upload()
  h.put(row); h.storage.objects.get(row.staging_key).ContentLength = 101
  assert.equal((await h.request(`/api/volumes/${row.id}/finalize`, 'POST')).status, 409)
  h.put(row); h.storage.objects.get(row.staging_key).Metadata['upload-id'] = 'other'
  assert.equal((await h.request(`/api/volumes/${row.id}/finalize`, 'POST')).status, 409)
  h.put(row); h.storage.objects.get(row.staging_key).prefix = Buffer.from('NOT-NRRD\n')
  assert.equal((await h.request(`/api/volumes/${row.id}/finalize`, 'POST')).status, 400)
  row.upload_expires_at = new Date(0)
  assert.equal((await h.request(`/api/volumes/${row.id}/finalize`, 'POST')).status, 409)
  assert.equal(h.storage.calls.some(([name]) => name === 'copy'), false)
})

test('quota and pending limits are checked under user lock before reservation', async () => {
  const h = await setup()
  for (let i = 0; i < 10; i++) await h.upload()
  assert.equal((await h.request('/api/volumes/uploads', 'POST', { fileName: 'x.nrrd', sizeBytes: 100 })).status, 429)
  assert.ok(h.pool.calls.some(call => call.sql.includes('users WHERE id=$1 AND NOT disabled FOR UPDATE')))
  const q = await setup({ ...enabledEnv, S3_OWNER_QUOTA_BYTES: '1024' })
  assert.equal((await q.request('/api/volumes/uploads', 'POST', { fileName: 'x.nrrd', sizeBytes: 1024 })).status, 201)
  assert.equal((await q.request('/api/volumes/uploads', 'POST', { fileName: 'x.nrrd', sizeBytes: 9 })).status, 413)
})

test('delete is owner-only, denies downloads while failed deletion is retryable, and redacts provider errors', async () => {
  const h = await setup(), { row } = await h.upload(); h.put(row)
  await h.request(`/api/volumes/${row.id}/finalize`, 'POST')
  assert.equal((await h.request(`/api/volumes/${row.id}`, 'DELETE', {}, OTHER)).status, 404)
  h.storage.failDelete = true
  const failed = await h.request(`/api/volumes/${row.id}`, 'DELETE')
  assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed), /provider secret/)
  assert.equal((await h.request(`/api/volumes/${row.id}/download`, 'POST')).status, 404)
  h.storage.failDelete = false
  assert.equal((await h.request(`/api/volumes/${row.id}`, 'DELETE')).status, 200)
  assert.equal(h.pool.rows.has(row.id), false)
  assert.equal(h.storage.objects.has(row.object_key), false)
})

test('SDK-generated POST policy binds key, upload identity and exact byte count', async () => {
  const previous = { access: process.env.AWS_ACCESS_KEY_ID, secret: process.env.AWS_SECRET_ACCESS_KEY }
  process.env.AWS_ACCESS_KEY_ID = 'TESTACCESSKEYONLY'
  process.env.AWS_SECRET_ACCESS_KEY = 'test-only-fake-secret-not-a-live-credential'
  try {
    const pool = fakePool(); let response
    const router = await createObjectStorageRouter({ pool, env: enabledEnv, body: async req => req.data, send: (_res, status, data) => { response = { status, data } } })
    await router.handle({ req: { method: 'POST', url: '/api/volumes/uploads', data: { fileName: 'test.nrrd', sizeBytes: 100 } }, res: {}, path: '/api/volumes/uploads', user: { id: OWNER } })
    assert.equal(response.status, 201)
    const fields = response.data.upload.fields
    const policy = JSON.parse(Buffer.from(fields.Policy, 'base64').toString())
    assert.ok(policy.conditions.some(condition => Array.isArray(condition) && condition[0] === 'content-length-range' && condition[1] === 100 && condition[2] === 100))
    assert.ok(policy.conditions.some(condition => Array.isArray(condition) && condition[0] === 'eq' && condition[1] === '$x-amz-meta-upload-id' && condition[2] === response.data.volume.id))
    assert.ok(policy.conditions.some(condition => condition.key === fields.key || Array.isArray(condition) && condition[1] === '$key' && condition[2] === fields.key))
    assert.equal(new URL(response.data.upload.url).origin, 'https://objects.example.test')
  } finally {
    if (previous.access === undefined) delete process.env.AWS_ACCESS_KEY_ID; else process.env.AWS_ACCESS_KEY_ID = previous.access
    if (previous.secret === undefined) delete process.env.AWS_SECRET_ACCESS_KEY; else process.env.AWS_SECRET_ACCESS_KEY = previous.secret
  }
})

test('bounded cleanup removes only old pending uploads and inaccessible orphan copies', async () => {
  const h = await setup(), { row: expired } = await h.upload(), { row: recent } = await h.upload(), { row: ready } = await h.upload()
  h.put(expired); h.put(recent); h.put(ready)
  await h.request(`/api/volumes/${ready.id}/finalize`, 'POST')
  expired.upload_expires_at = new Date(Date.now() - 2 * 86400000)
  h.storage.objects.set(expired.object_key, { orphan: true })
  const result = await h.router.cleanupExpiredUploads(10)
  assert.deepEqual(result, { deleted: 1, failed: 0 })
  assert.equal(h.pool.rows.has(expired.id), false)
  assert.equal(h.storage.objects.has(expired.staging_key), false)
  assert.equal(h.storage.objects.has(expired.object_key), false)
  assert.equal(h.pool.rows.has(recent.id), true)
  assert.equal(h.pool.rows.has(ready.id), true)
  assert.equal(h.storage.objects.has(ready.object_key), true)
  recent.upload_expires_at = new Date(0); h.storage.failDelete = true
  assert.deepEqual(await h.router.cleanupExpiredUploads(), { deleted: 0, failed: 1 })
  assert.equal(h.pool.rows.has(recent.id), true, 'Cleanup failures remain retryable')
  assert.ok(h.pool.calls.some(call => call.sql.includes('FOR UPDATE SKIP LOCKED')))
})
