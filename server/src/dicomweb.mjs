import { allowedOrigin } from './security.mjs'

const UID = /^\d+(?:\.\d+)*$/
const META_BYTES = 2 * 1024 * 1024
const INSTANCE_BYTES = 60 * 1024 * 1024
const fail = (status, message) => Object.assign(new Error(message), { status })
const uid = value => typeof value === 'string' && value.length <= 64 && UID.test(value)
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const reply = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
  res.end(JSON.stringify(value))
}

export function dicomwebConfiguration(env) {
  if (!env.DICOMWEB_BASE_URL) return null
  let base
  try { base = new URL(env.DICOMWEB_BASE_URL) } catch { throw new Error('DICOMWEB_BASE_URL must be an absolute URL.') }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('DICOMWEB_BASE_URL must be an HTTP(S) service root without embedded credentials, query or fragment.')
  if (base.protocol !== 'https:' && env.DICOMWEB_ALLOW_HTTP !== 'true') throw new Error('DICOMweb requires HTTPS; explicitly opt in to HTTP only for an isolated private network.')
  if (!env.DICOMWEB_USERNAME || !env.DICOMWEB_PASSWORD || env.DICOMWEB_USERNAME.includes(':')) throw new Error('DICOMweb requires a configured service username and password.')
  base.pathname = base.pathname.replace(/\/+$/, '') + '/'
  return { base, authorization: `Basic ${Buffer.from(`${env.DICOMWEB_USERNAME}:${env.DICOMWEB_PASSWORD}`).toString('base64')}` }
}

async function boundedBody(response, limit) {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) { await response.body?.cancel(); throw fail(502, 'Archive response exceeds the configured size limit.') }
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader(), chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw fail(502, 'Archive response exceeds the configured size limit.') }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks, size)
}

/** WADO-RS retrieves one instance as a one-part multipart response. Never forward upstream headers/URLs. */
export function singleDicomPart(bytes, contentType) {
  if (/^application\/dicom(?:\s*;|$)/i.test(contentType)) { if (!bytes.length) throw fail(502, 'Archive returned an empty instance.'); return bytes }
  if (!/^multipart\/related(?:\s*;|$)/i.test(contentType)) throw fail(502, 'Archive did not return a DICOM instance.')
  const boundary = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)?.slice(1).find(Boolean)
  if (!boundary || !/^[A-Za-z0-9'()+_,./:=?-]{1,70}$/.test(boundary)) throw fail(502, 'Archive returned an invalid multipart boundary.')
  const opening = Buffer.from(`--${boundary}\r\n`)
  if (!bytes.subarray(0, opening.length).equals(opening)) throw fail(502, 'Archive returned an invalid multipart response.')
  const headersEnd = bytes.indexOf('\r\n\r\n', opening.length)
  if (headersEnd < 0 || headersEnd - opening.length > 8192) throw fail(502, 'Archive returned invalid instance headers.')
  const headers = bytes.subarray(opening.length, headersEnd).toString('latin1')
  if (!/^content-type:\s*application\/dicom(?:\s*;[^\r\n]*)?\s*$/im.test(headers)) throw fail(502, 'Archive part is not a DICOM instance.')
  const marker = Buffer.from(`\r\n--${boundary}`)
  const end = bytes.indexOf(marker, headersEnd + 4)
  if (end < 0 || !/^--(?:\r\n)?$/.test(bytes.subarray(end + marker.length).toString('latin1'))) throw fail(502, 'Expected exactly one DICOM instance from the archive.')
  const result = bytes.subarray(headersEnd + 4, end)
  if (!result.length) throw fail(502, 'Archive returned an empty instance.')
  return result
}

function textTag(row, tag, max = 256) {
  const value = row?.[tag]?.Value?.[0]
  return typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' ? String(value).slice(0, max) : ''
}
function countTag(row, tag) { const value = textTag(row, tag); const n = Number(value); return value !== '' && Number.isSafeInteger(n) && n >= 0 ? n : null }
function metadataRow(row, level) {
  if (!object(row)) throw fail(502, 'Archive returned invalid metadata.')
  const studyUid = textTag(row, '0020000D', 65)
  if (!uid(studyUid)) throw fail(502, 'Archive metadata lacks a valid study identity.')
  if (level === 'studies') {
    const name = row['00100010']?.Value?.[0]?.Alphabetic
    return { studyUid, patientName: typeof name === 'string' ? name.slice(0, 256) : '', patientId: textTag(row, '00100020'), date: textTag(row, '00080020', 16), description: textTag(row, '00081030'), modalities: (row['00080061']?.Value ?? []).filter(v => typeof v === 'string').slice(0, 10).map(v => v.slice(0, 16)), seriesCount: countTag(row, '00201206') }
  }
  const seriesUid = textTag(row, '0020000E', 65)
  if (!uid(seriesUid)) throw fail(502, 'Archive metadata lacks a valid series identity.')
  if (level === 'series') return { studyUid, seriesUid, modality: textTag(row, '00080060', 16), description: textTag(row, '0008103E'), number: textTag(row, '00200011', 16), instanceCount: countTag(row, '00201209') }
  const instanceUid = textTag(row, '00080018', 65)
  if (!uid(instanceUid)) throw fail(502, 'Archive metadata lacks a valid instance identity.')
  return { studyUid, seriesUid, instanceUid, number: textTag(row, '00200013', 16), rows: countTag(row, '00280010'), columns: countTag(row, '00280011'), frames: countTag(row, '00280008') ?? 1 }
}

export function qidoRequest(input) {
  if (!object(input) || !['studies', 'series', 'instances'].includes(input.level)) throw fail(400, 'Choose studies, series or instances.')
  if (Object.keys(input).some(k => !['level','studyUid','seriesUid','patientId','studyDate','offset','limit'].includes(k))) throw fail(400, 'Unsupported archive query field.')
  const limit = input.limit ?? 25, offset = input.offset ?? 0
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) throw fail(400, 'Archive pagination must use 1–50 results and an offset between 0 and 10000.')
  let path = 'studies'
  if (input.level !== 'studies') {
    if (!uid(input.studyUid)) throw fail(400, 'A valid study identity is required.')
    path += `/${input.studyUid}/series`
    if (input.level === 'instances') {
      if (!uid(input.seriesUid)) throw fail(400, 'A valid series identity is required.')
      path += `/${input.seriesUid}/instances`
    }
  }
  const query = new URLSearchParams({ limit: String(limit + 1), offset: String(offset) })
  if (input.level === 'studies') {
    for (const [key, tag] of [['patientId','PatientID'], ['studyDate','StudyDate']]) {
      if (input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 64 || /[\x00-\x1f\x7f]/.test(input[key]))) throw fail(400, 'Archive search fields must be short text values.')
      if (input[key]) query.set(tag, input[key])
    }
  }
  return { path: `${path}?${query}`, limit, offset, level: input.level, studyUid: input.studyUid, seriesUid: input.seriesUid }
}

async function requestBody(req) {
  const chunks = []; let count = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) { count += chunk.length; if (count > 4096) { req.resume(); throw fail(413, 'Archive request is too large.') } chunks.push(chunk) }
  try { const value = JSON.parse(Buffer.concat(chunks).toString()); if (!object(value)) throw new Error(); return value } catch { throw fail(400, 'Archive request must be a JSON object.') }
}

/** Read-only, administrator-only proxy. Credentials and destination never come from the caller. */
export function createDicomweb({ env = process.env, fetchImpl = fetch } = {}) {
  const config = dicomwebConfiguration(env)
  const origin = new URL(env.PUBLIC_ORIGIN || 'http://localhost:5173').origin
  let active = 0
  async function upstream(path, accept, signal, maxBytes) {
    let response
    try { response = await fetchImpl(new URL(path, config.base), { headers: { Accept: accept, Authorization: config.authorization }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) }) }
    catch { throw fail(signal.aborted ? 499 : 502, 'The configured imaging archive is unavailable.') }
    if (!response.ok) { await response.body?.cancel(); throw fail(response.status === 404 ? 404 : 502, response.status === 404 ? 'This archive item is no longer available.' : 'The imaging archive rejected the request. Contact your administrator.') }
    return { bytes: await boundedBody(response, maxBytes), type: response.headers.get('content-type') ?? '' }
  }
  return {
    configured: !!config,
    async handle(req, res, user, { audit = async () => {} } = {}) {
      const path = new URL(req.url, 'http://internal').pathname
      if (!path.startsWith('/api/admin/pacs/')) return false
      if (!user) { reply(res, 401, { error: 'Sign in to continue.' }); return true }
      if (user.role !== 'admin') { reply(res, 403, { error: 'Imaging archive access is restricted to administrators.' }); return true }
      if (path === '/api/admin/pacs/status' && req.method === 'GET') { reply(res, 200, { configured: !!config, access: 'administrator-only', retrieval: 'single-instance', readOnly: true }); return true }
      if (!['/api/admin/pacs/query','/api/admin/pacs/instance'].includes(path) || req.method !== 'POST') { reply(res, 404, { error: 'Archive route not found.' }); return true }
      if (!allowedOrigin(req.headers.origin, origin)) { reply(res, 403, { error: 'Request origin is not allowed.' }); return true }
      if (!config) { reply(res, 503, { error: 'The imaging archive is not configured.' }); return true }
      if (active >= 2) { reply(res, 429, { error: 'The archive is busy. Retry after the current retrieval finishes.' }); return true }
      active++
      const controller = new AbortController()
      const abort = () => controller.abort()
      req.once('aborted', abort); res.once('close', abort)
      try {
        const input = await requestBody(req)
        if (path.endsWith('/query')) {
          const query = qidoRequest(input)
          const response = await upstream(query.path, 'application/dicom+json', controller.signal, META_BYTES)
          if (!/^application\/(dicom\+json|json)(?:\s*;|$)/i.test(response.type)) throw fail(502, 'Archive did not return DICOM metadata.')
          let rows
          try { rows = JSON.parse(response.bytes.toString()) } catch { throw fail(502, 'Archive returned invalid metadata JSON.') }
          if (!Array.isArray(rows) || rows.length > query.limit + 1) throw fail(502, 'Archive returned too many metadata records; bounded pagination is required.')
          // Nested QIDO responses can omit their parent UID. Only the requested parent supplies it.
          const items = rows.slice(0, query.limit).map(row => {
            if (!object(row)) throw fail(502, 'Archive returned invalid metadata.')
            for (const [tag, expected] of [['0020000D', query.studyUid], ['0020000E', query.seriesUid]]) {
              if (expected && row[tag] !== undefined && textTag(row, tag, 65) !== expected) throw fail(502, 'Archive metadata does not match the requested parent.')
            }
            return metadataRow({ ...row, ...(query.studyUid ? { '0020000D': { Value: [query.studyUid] } } : {}), ...(query.seriesUid ? { '0020000E': { Value: [query.seriesUid] } } : {}) }, query.level)
          })
          await audit(user.id, 'pacs.query')
          reply(res, 200, { items, hasMore: rows.length > query.limit, offset: query.offset, limit: query.limit })
        } else {
          if (Object.keys(input).some(k => !['studyUid','seriesUid','instanceUid'].includes(k)) || !['studyUid','seriesUid','instanceUid'].every(k => uid(input[k]))) throw fail(400, 'Valid study, series and instance identities are required.')
          const response = await upstream(`studies/${input.studyUid}/series/${input.seriesUid}/instances/${input.instanceUid}`, 'multipart/related; type="application/dicom"; transfer-syntax=1.2.840.10008.1.2.1', controller.signal, INSTANCE_BYTES + 16384)
          const bytes = singleDicomPart(response.bytes, response.type)
          if (bytes.length > INSTANCE_BYTES) throw fail(502, 'This instance exceeds the 60 MB image-import limit.')
          await audit(user.id, 'pacs.instance_retrieved')
          res.writeHead(200, { 'Content-Type': 'application/dicom', 'Content-Length': bytes.length, 'Content-Disposition': 'attachment; filename="archive-instance.dcm"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
          res.end(bytes)
        }
      } catch (error) {
        if (!res.destroyed && !res.headersSent) reply(res, error.status && error.status !== 499 ? error.status : 502, { error: error.status ? error.message : 'Archive request failed. Nothing was imported.' })
      } finally { active--; req.removeListener('aborted', abort); res.removeListener('close', abort) }
      return true
    },
  }
}
