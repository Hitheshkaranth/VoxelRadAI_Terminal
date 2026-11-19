import test from 'node:test'
import assert from 'node:assert/strict'
import { validStudy, writeStudy } from '../src/studyValidation.mjs'

const patient = {name:'',patientId:'',age:'',sex:'',studyDate:'',referringPhysician:'',indication:'',clinicalHistory:''}
const study = {id:'31f37b3e-946a-452c-a666-a1de7c06a47b',title:'Test',createdAt:1,updatedAt:1,patient,images:[]}
const sections = {technique:'PA',comparison:'',findings:'Clear.',impression:'Normal.',recommendations:''}
const rich = {findings:'<p>Clear.</p>',impression:'<p><strong>Normal.</strong></p>'}
const v1 = {version:1,signedAt:10,signedBy:'Dr A',sections,rich,patientSnapshot:patient}
const signed = {...sections,rich,radiologist:'Dr A',signed:true,generated:true,updatedAt:10,versions:[v1]}

test('a signed report\'s rich HTML must match its latest signed version', () => {
  assert.equal(validStudy({...study,report:signed}),true)
  // jsonb reorders keys; order must not matter.
  assert.equal(validStudy({...study,report:{...signed,rich:{impression:rich.impression,findings:rich.findings}}}),true)
  assert.equal(validStudy({...study,report:{...signed,rich:{...rich,impression:'<p>Abnormal.</p>'}}}),false,'printed rich text cannot diverge from the signed version')
  assert.equal(validStudy({...study,report:{...signed,rich:{...rich,recommendations:'<p>Added after signing.</p>'}}}),false)
  assert.equal(validStudy({...study,report:{...signed,rich:undefined}}),false,'dropping rich that was signed is a divergence too')
  assert.equal(validStudy({...study,report:{...signed,versions:[{...v1,rich:undefined}]}}),false,'rich added after a plain-text signature is refused')
  assert.equal(validStudy({...study,report:{...signed,rich:{},versions:[{...v1,rich:undefined}]}}),true,'empty and missing rich are the same')
  assert.equal(validStudy({...study,report:{...signed,rich:{findings:7}}}),false)
  // Drafts (unsigned, e.g. a correction in progress) may change rich freely.
  assert.equal(validStudy({...study,report:{...signed,signed:false,rich:{findings:'<p>Draft.</p>'},correction:{of:1,startedAt:30,by:'Dr B'}}}),true)
})

/** Minimal pg client double: one studies table keyed by id, with an optional hook to simulate a concurrent writer. */
function fakeClient(rows, { beforeInsert } = {}) {
  const log = []
  return { log, async query(sql, params = []) {
    log.push(sql.split(' ')[0])
    if (/^SELECT/.test(sql)) return { rows: rows.has(params[0]) ? [rows.get(params[0])] : [] }
    if (/^INSERT/.test(sql)) {
      beforeInsert?.()
      assert.match(sql, /ON CONFLICT \(id\) DO NOTHING RETURNING revision/)
      if (rows.has(params[0])) return { rows: [] }
      rows.set(params[0], { owner_id: params[1], revision: 1, report: null }); return { rows: [{ revision: 1 }] }
    }
    if (/^UPDATE/.test(sql)) { const row = rows.get(params[0]); row.revision++; return { rows: [{ revision: row.revision }] } }
    return { rows: [] }
  } }
}

test('two concurrent first saves of a new study: the second is a stale 409, not a 500', async () => {
  const rows = new Map()
  // The other save commits between this save's (empty) row lock and its INSERT.
  const client = fakeClient(rows, { beforeInsert: () => rows.set(study.id, { owner_id: 'u1', revision: 1, report: null }) })
  const outcome = await writeStudy(client, 'u1', study, 'new')
  assert.equal(outcome.status, 409)
  assert.equal(outcome.body.code, 'stale')
  assert.deepEqual(client.log, ['BEGIN', 'SELECT', 'INSERT', 'ROLLBACK'])
})

test('a unique violation raised by the database is also reported as stale', async () => {
  const client = { log: [], async query(sql) { this.log.push(sql.split(' ')[0]); if (/^INSERT/.test(sql)) throw Object.assign(new Error('duplicate key'), { code: '23505' }); return { rows: [] } } }
  const outcome = await writeStudy(client, 'u1', study, 'new')
  assert.deepEqual([outcome.status, outcome.body.code], [409, 'stale'])
  assert.equal(client.log.at(-1), 'ROLLBACK')
})

test('normal first save and revision-checked update', async () => {
  const rows = new Map()
  assert.deepEqual(await writeStudy(fakeClient(rows), 'u1', study, 'new'), { status: 200, body: { id: study.id, revision: 1 } })
  assert.deepEqual(await writeStudy(fakeClient(rows), 'u1', study, 1), { status: 200, body: { id: study.id, revision: 2 } })
  const stale = await writeStudy(fakeClient(rows), 'u1', study, 1)
  assert.deepEqual([stale.status, stale.body.code, stale.body.revision], [409, 'stale', 2])
  assert.equal((await writeStudy(fakeClient(rows), 'u2', study, 2)).status, 404, 'another owner\'s study is not found')
  const other = Object.assign(new Error('connection lost'), { code: '08006' })
  await assert.rejects(writeStudy({ async query(sql) { if (/^SELECT/.test(sql)) throw other; return { rows: [] } } }, 'u1', study, 'new'), other)
})
