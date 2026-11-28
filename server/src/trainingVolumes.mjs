// De-identified copies of whole saved CT/MRI volumes for analytics and model training, written offline by
// scripts/export-training-volumes.mjs. A volume is copied only when the operator has training capture on
// (TRAINING_CAPTURE + TRAINING_PSEUDONYM_SECRET) and its owner has given both consents: the general one and the
// separate whole-volume one. Copies carry keyed pseudonyms, the acquisition context, the NRRD geometry fields and
// the month saved; owner, volume ID, title, file name, header comments and free-text NRRD fields are dropped.
// Voxel data is not altered: head scans are not defaced and text burned into pixels is not removed.
import { createHash } from 'node:crypto'
import { captureEnabled, ref } from './trainingCapture.mjs'

export const TRAINING_VOLUME_PREFIX = 'training/volumes/'
export const TRAINING_MANIFEST_KEY = 'training/manifest/volumes.jsonl'

// Structural NRRD fields needed to read the voxels in space; everything else (comments, key:=value pairs, content,
// labels, units, sample units, min/max, old min/max) can carry free text and is removed.
const KEPT_FIELDS = new Set(['type', 'dimension', 'space', 'space dimension', 'sizes', 'space directions', 'kinds', 'endian',
  'encoding', 'space origin', 'space units', 'measurement frame', 'spacings', 'thicknesses', 'axis mins', 'axis maxs',
  'centerings', 'line skip', 'byte skip'])
const MAX_HEADER_BYTES = 64 * 1024

/** Rewrite an attached NRRD's header keeping only geometry; the data bytes after the blank line are unchanged. */
export function deidentifyNrrd(bytes) {
  const buffer = Buffer.from(bytes)
  const head = buffer.subarray(0, Math.min(buffer.length, MAX_HEADER_BYTES)).toString('latin1')
  const magic = /^NRRD000[1-5]\r?\n/.exec(head)
  if (!magic) throw new Error('Not an NRRD volume')
  const end = /\r?\n\r?\n/.exec(head)
  if (!end) throw new Error('NRRD header is missing or too long')
  const header = {}
  for (const line of head.slice(magic[0].length, end.index).split(/\r?\n/)) {
    if (!line || line.startsWith('#') || /^[^:]*:=/.test(line)) continue
    const at = line.indexOf(': ')
    if (at < 1) throw new Error('Malformed NRRD header line')
    const key = line.slice(0, at).trim().toLowerCase(), value = line.slice(at + 2).trim()
    if (key === 'data file' || key === 'datafile') throw new Error('Detached NRRD data is not supported')
    if (KEPT_FIELDS.has(key)) header[key] = value
  }
  for (const key of ['type', 'dimension', 'sizes', 'encoding']) if (!header[key]) throw new Error(`NRRD header lacks "${key}"`)
  const text = `NRRD0004\n${Object.entries(header).map(([key, value]) => `${key}: ${value}`).join('\n')}\n\n`
  return { bytes: Buffer.concat([Buffer.from(text, 'latin1'), buffer.subarray(end.index + end[0].length)]), header }
}

/** Copy up to `limit` not-yet-exported consented volumes, then rewrite the JSONL manifest. Resumable and idempotent. */
export async function exportTrainingVolumes({ pool, source, target, sourceLocation, targetLocation, env = process.env, limit = 20, dryRun = false, log = () => {} }) {
  limit ??= 20
  if (!captureEnabled(env)) throw new Error('Set TRAINING_CAPTURE=on and TRAINING_PSEUDONYM_SECRET before exporting training volumes')
  const counts = { exported: 0, skipped: 0, failed: 0 }
  // Page by ID: timestamps round-trip through JavaScript at millisecond precision and would repeat rows.
  let after = '00000000-0000-0000-0000-000000000000'
  while (counts.exported < limit) {
    const batch = (await pool.query(`SELECT v.id,v.owner_id,v.object_key,v.acquisition,v.created_at FROM volume_objects v JOIN users u ON u.id=v.owner_id
      WHERE v.state='ready' AND v.storage_location=$1 AND u.training_consent AND u.training_volume_consent AND NOT u.disabled AND v.id>$2
      ORDER BY v.id LIMIT 200`, [sourceLocation, after])).rows
    if (!batch.length) break
    after = batch.at(-1).id
    const refs = batch.map(row => ref('volume', row.id, env))
    const done = new Set((await pool.query('SELECT ref FROM training_volumes WHERE ref=ANY($1)', [refs])).rows.map(row => row.ref))
    for (const [index, row] of batch.entries()) {
      if (counts.exported >= limit) break
      const volumeRef = refs[index]
      if (done.has(volumeRef)) { counts.skipped++; continue }
      if (dryRun) { counts.exported++; log(`would export ${volumeRef}`); continue }
      try {
        const { bytes: original } = await source.getBytes(row.object_key)
        const { bytes, header } = deidentifyNrrd(original)
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        const key = `${TRAINING_VOLUME_PREFIX}${volumeRef}.nrrd`
        await target.putBytes(key, bytes, { metadata: { sha256 } })
        const a = row.acquisition || {}
        await pool.query(`INSERT INTO training_volumes(ref,user_ref,object_key,storage_location,modality,body_part,sequence,contrast,intensity_is_hu,header,size_bytes,sha256,saved_month)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (ref) DO NOTHING`,
          [volumeRef, ref('user', row.owner_id, env), key, targetLocation, a.modality || '', a.bodyPart || '', a.sequence || '', a.contrast || 'unknown',
            typeof a.intensityIsHU === 'boolean' ? a.intensityIsHU : null, JSON.stringify(header), bytes.length, sha256, new Date(row.created_at).toISOString().slice(0, 7)])
        counts.exported++
        log(`exported ${volumeRef} (${bytes.length} bytes)`)
      } catch (error) {
        counts.failed++
        log(`failed ${volumeRef}: ${error.message}`)
      }
    }
  }
  if (!dryRun) await writeTrainingManifest({ pool, target })
  return counts
}

/** One JSON object per line: what the training team and analytics read instead of scanning the bucket. */
export async function writeTrainingManifest({ pool, target }) {
  const rows = (await pool.query(`SELECT ref,user_ref AS "userRef",object_key AS "objectKey",modality,body_part AS "bodyPart",sequence,contrast,
    intensity_is_hu AS "intensityIsHU",header,size_bytes::bigint AS "sizeBytes",sha256,saved_month AS "savedMonth",exported_at AS "exportedAt"
    FROM training_volumes ORDER BY exported_at,ref`)).rows
  const body = rows.map(row => JSON.stringify({ ...row, sizeBytes: Number(row.sizeBytes) })).join('\n') + (rows.length ? '\n' : '')
  await target.putBytes(TRAINING_MANIFEST_KEY, Buffer.from(body), { contentType: 'application/x-ndjson' })
  return rows.length
}
