// Move saved volumes (and de-identified training copies) from one S3-API bucket to another, e.g. Google Cloud
// Storage to AWS S3, keeping every object key. Each object is read, written to the target with its SHA-256,
// checked by size on the target, and only then is its row's storage_location switched. Source objects are never
// deleted here: remove them yourself once the app runs on the target. Safe to stop and rerun at any point.
import { createHash } from 'node:crypto'
import { readObjectStorageConfig } from './objectStorage.mjs'
import { TRAINING_MANIFEST_KEY } from './trainingVolumes.mjs'

/** The source bucket is configured with the same variables as the app, prefixed FROM_ (FROM_S3_BUCKET, ...). */
export function readSourceConfig(env = process.env) {
  const prefixed = Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('FROM_')).map(([key, value]) => [key.slice(5), value]))
  return readObjectStorageConfig({ ...prefixed, S3_STORAGE_ENABLED: 'true' })
}

const TABLES = [
  { name: 'volume_objects', key: 'object_key', id: 'id', where: "state='ready'" },
  { name: 'training_volumes', key: 'object_key', id: 'ref', where: 'true' },
]

export async function migrateObjects({ pool, source, target, sourceLocation, targetLocation, limit = Infinity, dryRun = false, log = () => {} }) {
  if (sourceLocation === targetLocation) throw new Error('Source and target are the same bucket')
  const counts = { moved: 0, failed: 0, remaining: 0 }
  for (const table of TABLES) {
    const failed = []
    while (counts.moved + counts.failed < limit) {
      const rows = (await pool.query(`SELECT ${table.id} AS id,${table.key} AS key FROM ${table.name} WHERE ${table.where} AND storage_location=$1 AND NOT(${table.id}::text=ANY($2::text[])) ORDER BY ${table.id} LIMIT 50`, [sourceLocation, failed])).rows
      if (!rows.length) break
      for (const row of rows) {
        if (counts.moved + counts.failed >= limit) break
        if (dryRun) { counts.moved++; failed.push(String(row.id)); log(`would move ${table.name} ${row.key}`); continue }
        try {
          const { bytes, metadata, contentType } = await source.getBytes(row.key)
          const sha256 = createHash('sha256').update(bytes).digest('hex')
          if (metadata.sha256 && metadata.sha256 !== sha256) throw new Error('source checksum does not match its recorded SHA-256')
          await target.putBytes(row.key, bytes, { metadata: { ...metadata, sha256 }, contentType })
          const head = await target.head(row.key)
          if (Number(head.ContentLength) !== bytes.length) throw new Error('target size does not match')
          await pool.query(`UPDATE ${table.name} SET storage_location=$2 WHERE ${table.id}=$1 AND storage_location=$3`, [row.id, targetLocation, sourceLocation])
          counts.moved++
          log(`moved ${table.name} ${row.key} (${bytes.length} bytes)`)
        } catch (error) {
          counts.failed++
          failed.push(String(row.id))
          log(`failed ${table.name} ${row.key}: ${error.message}`)
        }
      }
    }
    counts.remaining += Number((await pool.query(`SELECT count(*)::int AS n FROM ${table.name} WHERE ${table.where} AND storage_location=$1`, [sourceLocation])).rows[0].n)
  }
  // The manifest is derived from the training_volumes table; copy it when present so readers find it at once.
  if (!dryRun) {
    try { const { bytes, contentType } = await source.getBytes(TRAINING_MANIFEST_KEY); await target.putBytes(TRAINING_MANIFEST_KEY, bytes, { contentType }) }
    catch { /* no manifest yet */ }
  }
  return counts
}
