import { ensureRoom, studySizes } from './storage.mjs'
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const textFields = (value,fields) => object(value) && fields.every(field => typeof value[field] === 'string')
const stringArray = value => Array.isArray(value) && value.every(item => typeof item === 'string')
const finite = value => typeof value === 'number' && Number.isFinite(value)
const dicomSource = value => ['sourceSeriesUid','sourceSopInstanceUid'].every(key => value[key] === undefined || typeof value[key] === 'string' && value[key].length <= 64 && /^[0-9]+(?:\.[0-9]+)*$/.test(value[key])) && (value.sourceFrameCount === undefined || Number.isInteger(value.sourceFrameCount) && value.sourceFrameCount > 0 && value.sourceFrameCount <= 500) && (value.sourceFrameIndex === undefined || Number.isInteger(value.sourceFrameIndex) && value.sourceFrameIndex >= 0 && Number.isInteger(value.sourceFrameCount) && value.sourceFrameIndex < value.sourceFrameCount)
const unit = value => finite(value) && value >= 0 && value <= 1
const measurement = value => object(value) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 64 && ['length','angle'].includes(value.kind) && finite(value.createdAt) && Array.isArray(value.points) && value.points.length === (value.kind === 'length' ? 2 : 3) && value.points.every(point => object(point) && unit(point.x) && unit(point.y))
const gridSize = value => value === undefined || Number.isInteger(value) && value > 0 && value <= 65535
const measuring = value => gridSize(value.sourceRows) && gridSize(value.sourceColumns) && (value.pixelSpacing === undefined || object(value.pixelSpacing) && ['row','col'].every(key => finite(value.pixelSpacing[key]) && value.pixelSpacing[key] > 0 && value.pixelSpacing[key] <= 10) && ['pixel','imager'].includes(value.pixelSpacing.source)) && (value.measurements === undefined || Array.isArray(value.measurements) && value.measurements.length <= 50 && value.measurements.every(measurement))
const patient = value => textFields(value,['name','patientId','age','sex','studyDate','referringPhysician','indication','clinicalHistory']) && ['','Male','Female','Other'].includes(value.sex)
const sectionKeys = ['technique','comparison','findings','impression','recommendations']
const int = value => Number.isInteger(value)
const version = (value,index) => object(value) && value.version === index + 1 && finite(value.signedAt) && typeof value.signedBy === 'string' && textFields(value.sections,sectionKeys) && (value.rich === undefined || object(value.rich) && Object.values(value.rich).every(html => typeof html === 'string')) && (value.patientSnapshot === undefined || patient(value.patientSnapshot)) && (value.signOverrides === undefined || stringArray(value.signOverrides)) && (value.corrects === undefined || int(value.corrects) && value.corrects >= 1 && value.corrects <= index)
const addendum = value => object(value) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 64 && typeof value.text === 'string' && value.text.length <= 20000 && finite(value.createdAt) && typeof value.by === 'string' && (value.signedAt === undefined || finite(value.signedAt)) && (value.version === undefined || int(value.version))
// A signed report's current text must be its latest signed version: signed text changes only through a new version.
// That covers the rich HTML too (it is what print and share render): the report's rich must equal the latest
// version's rich, with a missing rich treated as empty on either side.
const richOf = value => object(value) ? value : {}
const signedMatchesLatest = value => {
  const latest = value.versions[value.versions.length - 1]
  return sectionKeys.every(key => value[key] === latest.sections[key]) && same(richOf(value.rich),richOf(latest.rich))
}
const reportHistory = value => (value.versions === undefined || Array.isArray(value.versions) && value.versions.length <= 100 && value.versions.every(version)) && (value.addenda === undefined || Array.isArray(value.addenda) && value.addenda.length <= 200 && value.addenda.every(addendum) && new Set(value.addenda.map(a => a.id)).size === value.addenda.length) && (value.correction === undefined || object(value.correction) && int(value.correction.of) && finite(value.correction.startedAt) && typeof value.correction.by === 'string') && (!value.signed || !value.versions?.length || signedMatchesLatest(value)) && (value.rich === undefined || object(value.rich) && Object.values(value.rich).every(html => html === undefined || typeof html === 'string'))
const report = value => textFields(value,['technique','comparison','findings','impression','recommendations','radiologist']) && typeof value.signed === 'boolean' && typeof value.generated === 'boolean' && finite(value.updatedAt) && (!value.patientSnapshot || patient(value.patientSnapshot)) && (!value.signOverrides || stringArray(value.signOverrides)) && (!value.amendments || Array.isArray(value.amendments) && value.amendments.every(a => object(a) && finite(a.signedAt) && finite(a.unlockedAt) && typeof a.by === 'string')) && reportHistory(value)
const finding = value => textFields(value,['id','title','description','severity','location']) && ['critical','significant','moderate','minor','normal'].includes(value.severity) && finite(value.confidence) && (!value.bbox || object(value.bbox) && ['x','y','w','h'].every(key => finite(value.bbox[key]))) && (!value.validationIssues || stringArray(value.validationIssues))
const analysis = value => textFields(value,['modality','bodyPart','view','imageQuality','impression','urgency','rawText','model']) && Array.isArray(value.findings) && value.findings.every(finding) && ['pertinentNegatives','recommendations','differential'].every(key => stringArray(value[key])) && finite(value.durationMs) && finite(value.createdAt)
const image = value => textFields(value,['id','name','mime','dataUrl','status']) && /^data:image\/(?:png|jpeg|webp|gif|bmp);base64,[A-Za-z0-9+/\r\n]*={0,2}$/.test(value.dataUrl) && finite(value.width) && value.width > 0 && finite(value.height) && value.height > 0 && finite(value.addedAt) && ['idle','analyzing','done','error'].includes(value.status) && dicomSource(value) && measuring(value) && (!value.analysis || analysis(value.analysis))
export function validStudy(value) {
  return textFields(value,['id','title']) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) && patient(value.patient) && finite(value.createdAt) && finite(value.updatedAt) && Array.isArray(value.images) && value.images.length <= 500 && value.images.every(image) && (!value.report || report(value.report))
}

// Order-insensitive deep equality: jsonb does not keep the key order the client sent.
const same = (a,b) => {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item,i) => same(item,b[i]))
  if (!object(a) || !object(b)) return false
  const keys = Object.keys(a).filter(key => a[key] !== undefined)
  return keys.length === Object.keys(b).filter(key => b[key] !== undefined).length && keys.every(key => same(a[key],b[key]))
}
/** Saved signed versions and signed addenda are append-only: a write may add to them, never drop or alter one. */
export function preservesSignedHistory(previous,next) {
  const before = Array.isArray(previous?.versions) ? previous.versions : [], after = Array.isArray(next?.versions) ? next.versions : []
  if (after.length < before.length || !before.every((item,i) => same(item,after[i]))) return false
  const kept = new Map((Array.isArray(next?.addenda) ? next.addenda : []).map(a => [a.id,a]))
  return (Array.isArray(previous?.addenda) ? previous.addenda : []).filter(a => a?.signedAt !== undefined).every(a => same(a,kept.get(a.id)))
}
/** X-Study-Revision: absent = unconditional write (older clients), "new" = expect no server copy, n = expect revision n. null = malformed. */
export function expectedRevision(header) {
  if (header === undefined) return undefined
  if (header === 'new') return 'new'
  return /^[1-9][0-9]{0,8}$/.test(header) ? Number(header) : null
}
const STALE = { code: 'stale', error: 'The server copy of this study changed since this browser last saved or opened it. Open the server copy to see the newer version, or choose to overwrite it.' }
/** Revision-checked study write inside one transaction on `client` (a pg client). Returns { status, body }.
 *  Two first-time saves of the same new study can race past the empty row lock; the loser's INSERT hits the
 *  primary key, so it inserts with ON CONFLICT DO NOTHING and reports the conflict as a stale 409, never a 500. */
export async function writeStudy(client,userId,data,expected,env = process.env) {
  await client.query('BEGIN')
  try {
    // The user row lock serialises this user's saves, so the allowance check below cannot be raced.
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId])
    const current = (await client.query("SELECT owner_id,revision,payload->'report' AS report,payload_bytes FROM studies WHERE id=$1 FOR UPDATE", [data.id])).rows[0]
    if (current && current.owner_id !== userId) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'Study not found.' } } }
    const conflict = studyWriteConflict(current ? { revision: current.revision, report: current.report } : null, data, expected)
    if (conflict) { await client.query('ROLLBACK'); return { status: 409, body: { ...conflict, revision: current.revision } } }
    const sizes = studySizes(data)
    try { await ensureRoom(client, userId, sizes.payloadBytes, Number(current?.payload_bytes || 0), env) }
    catch (error) { if (error.code !== 'storage_quota_exceeded') throw error; await client.query('ROLLBACK'); return { status: 413, body: { code: error.code, error: error.message } } }
    const values = [data.id,userId,JSON.stringify(data),data.images.length,!!data.report,!!data.report?.signed,sizes.payloadBytes,sizes.imageBytes,sizes.analysisBytes]
    const result = current
      ? await client.query('UPDATE studies SET payload=$3,image_count=$4,has_report=$5,report_signed=$6,payload_bytes=$7,image_bytes=$8,analysis_bytes=$9,revision=revision+1,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING revision', values)
      : await client.query('INSERT INTO studies(id,owner_id,payload,image_count,has_report,report_signed,payload_bytes,image_bytes,analysis_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING RETURNING revision', values)
    if (!result.rows[0]) { await client.query('ROLLBACK'); return { status: 409, body: STALE } }
    await client.query('COMMIT')
    return { status: 200, body: { id: data.id, revision: result.rows[0].revision } }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    if (error?.code === '23505') return { status: 409, body: STALE }
    throw error
  }
}
/** Why a study write must be refused (409), or null. `existing` is the saved row ({revision, report}) or null. */
export function studyWriteConflict(existing,incoming,expected) {
  if (existing && (expected === 'new' || typeof expected === 'number' && expected !== existing.revision)) return STALE
  if (existing && !preservesSignedHistory(existing.report,incoming.report)) return { code: 'signed-history', error: 'Signed report versions and signed addenda on the server cannot be removed or changed. Add an addendum or correct the report instead.' }
  return null
}
