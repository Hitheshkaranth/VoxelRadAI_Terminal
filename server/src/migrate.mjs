import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export async function migrate(pool) {
  const directory = new URL('../migrations/', import.meta.url)
  const files = (await readdir(directory)).filter(file => /^\d+_[a-z0-9_]+\.sql$/.test(file)).sort()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(193822)')
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
    for (const version of files) {
      const sql = await readFile(new URL(version,directory),'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const existing = await client.query('SELECT checksum FROM schema_migrations WHERE version=$1',[version])
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Migration checksum mismatch: ${version}. Add a new migration instead of editing an applied file.`)
        continue
      }
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations(version,checksum) VALUES ($1,$2)',[version,checksum])
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
