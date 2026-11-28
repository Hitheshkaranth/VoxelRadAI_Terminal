import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deidentifyNrrd, exportTrainingVolumes, TRAINING_MANIFEST_KEY } from '../src/trainingVolumes.mjs'
import { migrateObjects, readSourceConfig } from '../src/storageMigration.mjs'

const ON = { TRAINING_CAPTURE: 'on', TRAINING_PSEUDONYM_SECRET: 'test-only-secret' }
const voxels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
const nrrd = (extra = '') => Buffer.concat([Buffer.from(`NRRD0005\n# Patient: Ravi Kumar 1961-02-03\ntype: short\ndimension: 3\nspace: left-posterior-superior\nsizes: 2 2 1\nspace directions: (1,0,0) (0,1,0) (0,0,2.5)\nkinds: domain domain domain\nendian: little\nencoding: raw\nspace origin: (-10,-20,30)\ncontent: RAVI KUMAR CT CHEST\nlabels: "Ravi" "Kumar" "x"\nPatientName:=Ravi Kumar\n${extra}\n`), voxels])

function memoryStorage(location) {
  const objects = new Map()
  return {
    location, objects,
    async getBytes(key) { if (!objects.has(key)) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' }); const o = objects.get(key); return { bytes: o.bytes, metadata: o.metadata, contentType: o.contentType } },
    async putBytes(key, bytes, { metadata = {}, contentType = 'application/octet-stream' } = {}) { objects.set(key, { bytes: Buffer.from(bytes), metadata, contentType }) },
    async head(key) { return { ContentLength: objects.get(key).bytes.length } },
  }
}

test('NRRD de-identification keeps geometry and voxels, drops comments and free text', () => {
  const { bytes, header } = deidentifyNrrd(nrrd())
  const text = bytes.toString('latin1')
  assert.ok(!/Ravi|Kumar|1961/i.test(text))
  assert.deepEqual(Object.keys(header), ['type', 'dimension', 'space', 'sizes', 'space directions', 'kinds', 'endian', 'encoding', 'space origin'])
  assert.ok(text.startsWith('NRRD0004\ntype: short\n'))
  assert.deepEqual(bytes.subarray(bytes.length - voxels.length), voxels)
  assert.throws(() => deidentifyNrrd(nrrd('data file: other.raw\n')), /Detached/)
  assert.throws(() => deidentifyNrrd(Buffer.from('P5\n')), /NRRD/)
  assert.throws(() => deidentifyNrrd(Buffer.from('NRRD0004\ntype: short\n\n')), /lacks/)
})

function exportPool(volumes, consents) {
  const training = new Map()
  return {
    training,
    async query(sql, values) {
      if (sql.includes('FROM volume_objects v JOIN users u')) {
        const [location, id] = values
        return { rows: volumes.filter(v => v.storage_location === location && v.state === 'ready' && consents[v.owner_id] === 'both' && v.id > id).sort((a, b) => a.id < b.id ? -1 : 1) }
      }
      if (sql.startsWith('SELECT ref FROM training_volumes')) return { rows: values[0].filter(r => training.has(r)).map(ref => ({ ref })) }
      if (sql.startsWith('INSERT INTO training_volumes')) { training.set(values[0], values); return { rows: [] } }
      if (sql.includes('FROM training_volumes ORDER BY')) return { rows: [...training.values()].map(v => ({ ref: v[0], userRef: v[1], objectKey: v[2], modality: v[4], sizeBytes: String(v[10]), sha256: v[11], savedMonth: v[12] })) }
      throw new Error(`unexpected ${sql}`)
    },
  }
}

test('training export copies only fully consented volumes, de-identified, under pseudonyms; reruns skip', async () => {
  const store = memoryStorage('gcs:b')
  const volumes = [
    { id: 'a0000000-0000-4000-8000-000000000001', owner_id: 'u-yes', object_key: 'volumes/u-yes/1', acquisition: { modality: 'CT', bodyPart: 'Chest', sequence: '', contrast: 'without', intensityIsHU: true }, created_at: new Date('2026-11-02T10:00:00Z'), state: 'ready', storage_location: 'gcs:b' },
    { id: 'a0000000-0000-4000-8000-000000000002', owner_id: 'u-no', object_key: 'volumes/u-no/2', acquisition: null, created_at: new Date('2026-11-03T10:00:00Z'), state: 'ready', storage_location: 'gcs:b' },
  ]
  for (const v of volumes) await store.putBytes(v.object_key, nrrd())
  const pool = exportPool(volumes, { 'u-yes': 'both', 'u-no': 'general-only' })
  await assert.rejects(exportTrainingVolumes({ pool, source: store, target: store, sourceLocation: 'gcs:b', targetLocation: 'gcs:b', env: {} }), /TRAINING_CAPTURE/)
  const counts = await exportTrainingVolumes({ pool, source: store, target: store, sourceLocation: 'gcs:b', targetLocation: 'gcs:b', env: ON })
  assert.deepEqual(counts, { exported: 1, skipped: 0, failed: 0 })
  const [row] = pool.training.values()
  assert.match(row[2], /^training\/volumes\/[0-9a-f]{20}\.nrrd$/)
  assert.ok(!row[2].includes(volumes[0].id) && row[1] !== 'u-yes')
  assert.equal(row[12], '2026-11')
  const copy = store.objects.get(row[2])
  assert.ok(!/Ravi/.test(copy.bytes.toString('latin1')))
  assert.equal(copy.metadata.sha256, createHash('sha256').update(copy.bytes).digest('hex'))
  const manifest = store.objects.get(TRAINING_MANIFEST_KEY).bytes.toString().trim().split('\n').map(line => JSON.parse(line))
  assert.equal(manifest.length, 1); assert.equal(manifest[0].modality, 'CT'); assert.equal(typeof manifest[0].sizeBytes, 'number')
  assert.deepEqual(await exportTrainingVolumes({ pool, source: store, target: store, sourceLocation: 'gcs:b', targetLocation: 'gcs:b', env: ON }), { exported: 0, skipped: 1, failed: 0 })
})

test('migration copies with checksums, switches location only after a verified copy, and resumes', async () => {
  const source = memoryStorage('gcs:old'), target = memoryStorage('aws:new')
  const rows = { volume_objects: [{ id: 'v1', key: 'volumes/u/v1', storage_location: 'gcs:old' }, { id: 'v2', key: 'volumes/u/v2', storage_location: 'gcs:old' }], training_volumes: [{ id: 't1', key: 'training/volumes/t1.nrrd', storage_location: 'gcs:old' }] }
  await source.putBytes('volumes/u/v1', nrrd())
  await source.putBytes('training/volumes/t1.nrrd', voxels, { metadata: { sha256: createHash('sha256').update(voxels).digest('hex') } })
  // v2 is missing from the source: it must fail and stay where it is.
  const pool = { async query(sql, values) {
    const table = sql.includes('training_volumes') ? 'training_volumes' : 'volume_objects'
    if (sql.startsWith('SELECT count')) return { rows: [{ n: rows[table].filter(r => r.storage_location === values[0]).length }] }
    if (sql.startsWith('SELECT')) return { rows: rows[table].filter(r => r.storage_location === values[0] && !values[1].includes(r.id)) }
    if (sql.startsWith('UPDATE')) { const r = rows[table].find(r => r.id === values[0] && r.storage_location === values[2]); if (r) r.storage_location = values[1]; return { rows: [] } }
    throw new Error(sql)
  } }
  await assert.rejects(migrateObjects({ pool, source, target, sourceLocation: 'gcs:old', targetLocation: 'gcs:old' }), /same/)
  const first = await migrateObjects({ pool, source, target, sourceLocation: 'gcs:old', targetLocation: 'aws:new' })
  assert.deepEqual(first, { moved: 2, failed: 1, remaining: 1 })
  assert.deepEqual(rows.volume_objects.map(r => r.storage_location), ['aws:new', 'gcs:old'])
  assert.deepEqual(target.objects.get('volumes/u/v1').bytes, nrrd())
  assert.ok(source.objects.has('volumes/u/v1'), 'source objects are never deleted')
  await source.putBytes('volumes/u/v2', nrrd())
  assert.deepEqual(await migrateObjects({ pool, source, target, sourceLocation: 'gcs:old', targetLocation: 'aws:new' }), { moved: 1, failed: 0, remaining: 0 })
})

test('the migration source is configured with FROM_ variables', () => {
  const source = readSourceConfig({ FROM_STORAGE_PROVIDER: 'gcs', FROM_S3_BUCKET: 'old-bucket', S3_BUCKET: 'new-bucket' })
  assert.equal(source.bucket, 'old-bucket'); assert.equal(source.provider, 'gcs')
})
