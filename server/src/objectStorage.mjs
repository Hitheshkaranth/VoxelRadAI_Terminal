import { randomUUID } from 'node:crypto'
import { pagination } from './pagination.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CONTENT_TYPE = 'application/octet-stream'
const MAX_OBJECT_BYTES = 2 * 1024 ** 3
const fail = (status, message) => Object.assign(new Error(message), { status })
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function integerSetting(env, name, fallback, max) {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > max) throw new Error(`Invalid ${name}`)
  return Number(raw)
}
function endpoint(value, allowHttp) {
  if (!value) return undefined
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || (url.protocol !== 'https:' && !allowHttp)) throw new Error('S3 endpoints require HTTPS unless ALLOW_INSECURE_S3=true is explicitly configured')
  if (url.pathname !== '/') throw new Error('S3 endpoints must not contain a path')
  return url.origin
}
export function readObjectStorageConfig(env = process.env) {
  if (env.S3_STORAGE_ENABLED !== 'true') return { enabled: false }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.S3_BUCKET || '') || env.S3_BUCKET.includes('..')) throw new Error('S3_BUCKET must name a private bucket')
  const allowHttp = env.ALLOW_INSECURE_S3 === 'true'
  const internalEndpoint = endpoint(env.S3_ENDPOINT, allowHttp)
  const publicEndpoint = endpoint(env.S3_PUBLIC_ENDPOINT, allowHttp) || internalEndpoint
  const maxBytes = integerSetting(env, 'S3_MAX_VOLUME_BYTES', 512 * 1024 ** 2, MAX_OBJECT_BYTES)
  const ownerQuotaBytes = integerSetting(env, 'S3_OWNER_QUOTA_BYTES', 5 * 1024 ** 3, 1024 ** 4)
  if (ownerQuotaBytes < maxBytes) throw new Error('S3_OWNER_QUOTA_BYTES must cover at least one maximum-size volume')
  const encryption = env.S3_SERVER_SIDE_ENCRYPTION || undefined
  if (encryption && !['AES256', 'aws:kms'].includes(encryption)) throw new Error('Unsupported S3_SERVER_SIDE_ENCRYPTION')
  if (env.S3_KMS_KEY_ID && encryption !== 'aws:kms') throw new Error('S3_KMS_KEY_ID requires aws:kms encryption')
  const region = env.AWS_REGION || 'us-east-1'
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/.test(region)) throw new Error('AWS_REGION is invalid')
  const suffix = region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com'
  const origins = publicEndpoint ? [publicEndpoint] : [`https://${env.S3_BUCKET}.s3.${region}.${suffix}`, `https://s3.${region}.${suffix}`]
  return { enabled: true, bucket: env.S3_BUCKET, region, endpoint: internalEndpoint, publicEndpoint, origins, allowHttp, forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true' || !!internalEndpoint, maxBytes, ownerQuotaBytes, uploadSeconds: 300, downloadSeconds: 60, pendingSeconds: 900, encryption, kmsKeyId: env.S3_KMS_KEY_ID || undefined }
}

export function validateVolumeUpload(value, maxBytes) {
  if (!isObject(value) || typeof value.fileName !== 'string' || value.fileName.length > 180 || !/^[^/\\\u0000-\u001f]+\.nrrd$/i.test(value.fileName)) throw fail(400, 'Choose a single NRRD volume with a valid filename.')
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 9 || value.sizeBytes > maxBytes) throw fail(400, `Volume size must be between 9 and ${maxBytes} bytes.`)
  const title = value.title === undefined ? value.fileName : value.title
  if (typeof title !== 'string' || !title.trim() || title.length > 200 || /[\u0000-\u001f]/.test(title)) throw fail(400, 'Volume title must contain 1–200 printable characters.')
  let acquisition = null
  if (value.acquisition !== undefined && value.acquisition !== null) {
    const a = value.acquisition
    if (!isObject(a) || !['CT', 'MRI', 'Volume'].includes(a.modality) || !['unknown', 'without', 'with'].includes(a.contrast) || typeof a.intensityIsHU !== 'boolean' || !['bodyPart', 'sequence'].every(key => typeof a[key] === 'string' && a[key].length <= 120 && !/[\u0000-\u001f]/.test(a[key]))) throw fail(400, 'Acquisition metadata is invalid.')
    if (a.modality !== 'CT' && a.intensityIsHU || a.modality !== 'MRI' && a.sequence) throw fail(400, 'Acquisition metadata conflicts with the selected modality.')
    acquisition = { modality: a.modality, bodyPart: a.bodyPart.trim(), sequence: a.sequence.trim(), contrast: a.contrast, intensityIsHU: a.intensityIsHU }
  }
  return { fileName: value.fileName, title: title.trim(), sizeBytes: value.sizeBytes, acquisition }
}

export function volumeObjectSummary(row) {
  return { id: row.id, fileName: row.file_name, title: row.title, sizeBytes: Number(row.size_bytes), state: row.state, acquisition: row.acquisition, createdAt: row.created_at, finalizedAt: row.finalized_at, uploadExpiresAt: row.upload_expires_at }
}

async function createS3Storage(config) {
  const [{ S3Client, HeadObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand }, { createPresignedPost }, { getSignedUrl }] = await Promise.all([import('@aws-sdk/client-s3'), import('@aws-sdk/s3-presigned-post'), import('@aws-sdk/s3-request-presigner')])
  const options = { region: config.region, forcePathStyle: config.forcePathStyle, maxAttempts: 2 }
  const client = new S3Client({ ...options, endpoint: config.endpoint })
  const signingClient = config.publicEndpoint !== config.endpoint ? new S3Client({ ...options, endpoint: config.publicEndpoint }) : client
  const encryption = config.encryption ? { ServerSideEncryption: config.encryption, ...(config.kmsKeyId ? { SSEKMSKeyId: config.kmsKeyId } : {}) } : {}
  return {
    async presignUpload(row) {
      const fields = { 'Content-Type': CONTENT_TYPE, 'x-amz-meta-upload-id': row.id, success_action_status: '204' }
      if (config.encryption) fields['x-amz-server-side-encryption'] = config.encryption
      if (config.kmsKeyId) fields['x-amz-server-side-encryption-aws-kms-key-id'] = config.kmsKeyId
      return createPresignedPost(signingClient, { Bucket: config.bucket, Key: row.staging_key, Expires: config.uploadSeconds, Fields: fields, Conditions: [['content-length-range', Number(row.size_bytes), Number(row.size_bytes)], ...Object.entries(fields).map(([key, value]) => ['eq', `$${key}`, value])] })
    },
    async head(key) { return client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key })) },
    async prefix(key, etag) {
      const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key, Range: 'bytes=0-8', IfMatch: etag }))
      return Buffer.from(await result.Body.transformToByteArray())
    },
    async copy(row, etag) {
      const source = `${encodeURIComponent(config.bucket)}/${row.staging_key.split('/').map(encodeURIComponent).join('/')}`
      const result = await client.send(new CopyObjectCommand({ Bucket: config.bucket, Key: row.object_key, CopySource: source, CopySourceIfMatch: etag, MetadataDirective: 'REPLACE', Metadata: { 'volume-id': row.id }, ContentType: CONTENT_TYPE, ...encryption }))
      if (!result.CopyObjectResult?.ETag) throw new Error('Object storage did not confirm the copy')
      return result.CopyObjectResult.ETag
    },
    async delete(key) { await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })) },
    async presignDownload(row) {
      return getSignedUrl(signingClient, new GetObjectCommand({ Bucket: config.bucket, Key: row.object_key, ResponseContentType: CONTENT_TYPE, ResponseContentDisposition: `attachment; filename="volume-${row.id}.nrrd"`, ResponseCacheControl: 'private, no-store' }), { expiresIn: config.downloadSeconds })
    },
  }
}

/** Call only after the host router's origin and session checks. Also denies missing users defensively. */
export async function createObjectStorageRouter({ pool, body, send, env = process.env, storage: suppliedStorage, now = () => Date.now() }) {
  const config = readObjectStorageConfig(env)
  const storage = config.enabled ? suppliedStorage || await createS3Storage(config) : null
  const transact = async action => {
    const client = await pool.connect()
    try { await client.query('BEGIN'); const value = await action(client); await client.query('COMMIT'); return value }
    catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  }
  const lockOwner = async (client, ownerId) => {
    const result = await client.query('SELECT id FROM users WHERE id=$1 AND NOT disabled FOR UPDATE', [ownerId])
    if (!result.rowCount) throw fail(401, 'Sign in to continue.')
  }
  async function cleanupExpiredUploads(limit = 50) {
    if (!config.enabled) return { deleted: 0, failed: 0 }
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Cleanup batch size must be 1–200')
    const attempted = [], counts = { deleted: 0, failed: 0 }
    for (let index = 0; index < limit; index++) {
      const found = await transact(async client => {
        const result = await client.query("SELECT * FROM volume_objects WHERE state='pending' AND upload_expires_at<now()-interval '24 hours' AND NOT(id=ANY($1::uuid[])) ORDER BY upload_expires_at LIMIT 1 FOR UPDATE SKIP LOCKED", [attempted])
        const row = result.rows[0]
        if (!row) return false
        attempted.push(row.id)
        try {
          await storage.delete(row.staging_key)
          // A copy can precede a failed database commit; remove that inaccessible orphan too.
          await storage.delete(row.object_key)
        } catch { counts.failed++; return true }
        await client.query("DELETE FROM volume_objects WHERE id=$1 AND owner_id=$2 AND state='pending'", [row.id, row.owner_id])
        counts.deleted++
        return true
      })
      if (!found) break
    }
    return counts
  }
  async function handle({ req, res, path, user }) {
    if (path !== '/api/volumes' && !path.startsWith('/api/volumes/')) return false
    const reply = (status, value) => { send(res, status, value); return true }
    if (!user || !UUID.test(user.id)) return reply(401, { error: 'Sign in to continue.' })
    if (path === '/api/volumes/status' && req.method === 'GET') return reply(200, { enabled: config.enabled, maxVolumeBytes: config.enabled ? config.maxBytes : 0, ownerQuotaBytes: config.enabled ? config.ownerQuotaBytes : 0, uploadOrigins: config.origins || [], downloadOrigins: config.origins || [], allowInsecureTransport: config.allowHttp || false, formats: ['nrrd'] })
    if (!config.enabled) return reply(503, { error: 'Private volume storage is not configured.' })
    try {
      if (path === '/api/volumes' && req.method === 'GET') {
        let page
        try { page = pagination(new URL(req.url, 'http://internal').searchParams) } catch (error) { throw fail(400, error.message) }
        const [rows, total] = await Promise.all([pool.query('SELECT * FROM volume_objects WHERE owner_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3', [user.id, page.limit, page.offset]), pool.query('SELECT count(*)::int AS total FROM volume_objects WHERE owner_id=$1', [user.id])])
        return reply(200, { volumes: rows.rows.map(volumeObjectSummary), total: total.rows[0].total, maxVolumeBytes: config.maxBytes, ownerQuotaBytes: config.ownerQuotaBytes })
      }
      if (path === '/api/volumes/uploads' && req.method === 'POST') {
        const data = validateVolumeUpload(await body(req), config.maxBytes)
        const id = randomUUID(), expiresAt = new Date(now() + config.pendingSeconds * 1000)
        const row = await transact(async client => {
          await lockOwner(client, user.id)
          const used = await client.query("SELECT COALESCE(sum(size_bytes),0)::bigint AS bytes,count(*) FILTER(WHERE state='pending' AND upload_expires_at>now())::int AS pending FROM volume_objects WHERE owner_id=$1 AND (state<>'pending' OR upload_expires_at>now())", [user.id])
          if (Number(used.rows[0].pending) >= 10) throw fail(429, 'Finish or delete an existing pending upload before starting another.')
          if (Number(used.rows[0].bytes) + data.sizeBytes > config.ownerQuotaBytes) throw fail(413, 'This upload exceeds your configured volume storage quota.')
          const result = await client.query('INSERT INTO volume_objects(id,owner_id,file_name,title,size_bytes,acquisition,staging_key,object_key,upload_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [id, user.id, data.fileName, data.title, data.sizeBytes, data.acquisition ? JSON.stringify(data.acquisition) : null, `pending/${user.id}/${id}`, `volumes/${user.id}/${id}`, expiresAt])
          return result.rows[0]
        })
        let upload
        try { upload = await storage.presignUpload(row) }
        catch (error) { await pool.query("DELETE FROM volume_objects WHERE id=$1 AND owner_id=$2 AND state='pending'", [id, user.id]); throw error }
        return reply(201, { volume: volumeObjectSummary(row), upload: { method: 'POST', url: upload.url, fields: upload.fields, expiresInSeconds: config.uploadSeconds } })
      }
      const match = path.match(/^\/api\/volumes\/([a-f0-9-]+)(?:\/(finalize|download))?$/i)
      if (!match || !UUID.test(match[1])) return reply(404, { error: 'Volume not found.' })
      const id = match[1], action = match[2]
      if (action === 'finalize' && req.method === 'POST') {
        const row = await transact(async client => {
          await lockOwner(client, user.id)
          const lookup = await client.query('SELECT * FROM volume_objects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, user.id])
          const current = lookup.rows[0]
          if (!current) throw fail(404, 'Volume not found.')
          if (current.state === 'ready') return current
          if (current.state !== 'pending' || new Date(current.upload_expires_at).getTime() <= now()) throw fail(409, 'This upload is no longer pending. Start a new upload.')
          let head
          try { head = await storage.head(current.staging_key) } catch (error) { if (error?.$metadata?.httpStatusCode === 404 || ['NotFound', 'NoSuchKey'].includes(error?.name)) throw fail(409, 'Upload has not completed. Upload the file before finalizing.'); throw error }
          if (head.ContentLength !== Number(current.size_bytes) || head.ContentType !== CONTENT_TYPE || head.Metadata?.['upload-id'] !== id || typeof head.ETag !== 'string' || !head.ETag) throw fail(409, 'Uploaded object does not match the reserved size or metadata. Delete it and retry.')
          const prefix = await storage.prefix(current.staging_key, head.ETag)
          if (!/^NRRD000[1-5][\r\n]$/.test(Buffer.from(prefix).toString('ascii'))) throw fail(400, 'Uploaded file is not a supported NRRD volume.')
          const etag = await storage.copy(current, head.ETag)
          const updated = await client.query("UPDATE volume_objects SET state='ready',etag=$3,finalized_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *", [id, user.id, etag])
          await client.query('INSERT INTO audit_events(actor_id,event_type) VALUES($1,$2)', [user.id, 'volume.saved'])
          return updated.rows[0]
        })
        // Staging URLs remain valid until expiry, so configure a pending/ lifecycle even after this cleanup.
        try { await storage.delete(row.staging_key) } catch { /* The bucket lifecycle is the fallback; no keys or URLs are logged. */ }
        return reply(200, { volume: volumeObjectSummary(row) })
      }
      if (action === 'download' && req.method === 'POST') {
        const result = await pool.query("SELECT * FROM volume_objects WHERE id=$1 AND owner_id=$2 AND state='ready'", [id, user.id])
        const row = result.rows[0]
        if (!row) throw fail(404, 'Volume not found.')
        const url = await storage.presignDownload(row)
        return reply(200, { url, expiresInSeconds: config.downloadSeconds, volume: volumeObjectSummary(row) })
      }
      if (!action && req.method === 'DELETE') {
        const row = await transact(async client => {
          await lockOwner(client, user.id)
          const result = await client.query("UPDATE volume_objects SET state='deleting' WHERE id=$1 AND owner_id=$2 RETURNING *", [id, user.id])
          if (!result.rowCount) throw fail(404, 'Volume not found.')
          return result.rows[0]
        })
        await storage.delete(row.object_key)
        await storage.delete(row.staging_key)
        await transact(async client => {
          await client.query("DELETE FROM volume_objects WHERE id=$1 AND owner_id=$2 AND state='deleting'", [id, user.id])
          await client.query('INSERT INTO audit_events(actor_id,event_type) VALUES($1,$2)', [user.id, 'volume.deleted'])
        })
        return reply(200, { ok: true })
      }
      return reply(405, { error: 'Method not allowed.' })
    } catch (error) {
      if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) return reply(error.status, { error: error.message })
      // Never send storage exception messages: they can contain credentials, bucket names or signed URLs.
      return reply(503, { error: 'Private volume storage is temporarily unavailable. Try again.' })
    }
  }
  return { enabled: config.enabled, handle, cleanupExpiredUploads }
}
