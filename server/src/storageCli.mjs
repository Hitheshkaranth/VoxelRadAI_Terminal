// Operator commands for portable storage and training retrieval. Configure the target exactly as the app is
// configured (S3_*, STORAGE_PROVIDER, AWS_REGION); for `migrate`, configure the source with the same names prefixed
// FROM_. Add --dry-run to list what would happen, --limit=N to stop after N objects.
//   npm run storage -- migrate          copy volumes + training copies from FROM_* to the current bucket
//   npm run storage -- export-training  write de-identified copies of consented volumes + the JSONL manifest
//   npm run storage -- manifest         rewrite training/manifest/volumes.jsonl from the database
import pg from 'pg'
import { createS3Storage, readObjectStorageConfig, storageLocation } from './objectStorage.mjs'
import { migrateObjects, readSourceConfig } from './storageMigration.mjs'
import { exportTrainingVolumes, writeTrainingManifest } from './trainingVolumes.mjs'

const [command, ...flags] = process.argv.slice(2)
const dryRun = flags.includes('--dry-run')
const limitFlag = flags.find(flag => flag.startsWith('--limit='))
const limit = limitFlag ? Number(limitFlag.slice(8)) : undefined
if (!['migrate', 'export-training', 'manifest'].includes(command) || (limit !== undefined && !(Number.isInteger(limit) && limit > 0))) {
  console.error('Usage: npm run storage -- migrate|export-training|manifest [--dry-run] [--limit=N]')
  process.exit(2)
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
const target = readObjectStorageConfig(process.env)
if (!target.enabled) throw new Error('Configure the target bucket (S3_STORAGE_ENABLED=true, S3_BUCKET, ...)')
const { Pool } = process.env.DATABASE_DRIVER === 'neon' ? await import('@neondatabase/serverless') : pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
const log = line => console.log(line)
try {
  const targetStorage = await createS3Storage(target), targetLocation = storageLocation(target)
  if (command === 'migrate') {
    const source = readSourceConfig(process.env)
    const counts = await migrateObjects({ pool, source: await createS3Storage(source), target: targetStorage, sourceLocation: storageLocation(source), targetLocation, limit, dryRun, log })
    console.log(`${dryRun ? 'Would move' : 'Moved'} ${counts.moved}, failed ${counts.failed}, still in ${storageLocation(source)}: ${counts.remaining}`)
    if (counts.failed) process.exitCode = 1
  } else if (command === 'export-training') {
    const counts = await exportTrainingVolumes({ pool, source: targetStorage, target: targetStorage, sourceLocation: targetLocation, targetLocation, limit, dryRun, log })
    console.log(`${dryRun ? 'Would export' : 'Exported'} ${counts.exported}, already exported ${counts.skipped}, failed ${counts.failed}`)
    if (counts.failed) process.exitCode = 1
  } else {
    console.log(`Manifest lists ${await writeTrainingManifest({ pool, target: targetStorage })} training volumes.`)
  }
} finally { await pool.end() }
