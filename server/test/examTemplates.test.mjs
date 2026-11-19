import test from 'node:test'
import assert from 'node:assert/strict'
import { createExamLibrary, validExamTemplate, validMacro } from '../src/examTemplates.mjs'

const template = () => ({ name: 'CT brain', modality: 'CT', bodyPart: 'Head', keywords: ['brain'], sections: { findings: 'No [acute/subacute] haemorrhage.', impression: 'Normal.' } })
const macro = () => ({ name: 'normalchest', trigger: 'normal chest', text: 'Lungs are clear.' })

// In-memory stand-in for the two tables, keyed by owner, enough for the SQL the routes issue.
function fakeDb() {
  const rows = { exam_templates: [], report_macros: [] }
  const query = async (sql, params) => {
    const table = sql.match(/(exam_templates|report_macros)/)[1], list = rows[table]
    if (sql.startsWith('SELECT count')) return { rows: [{ n: list.filter(r => r.owner_id === params[0]).length }] }
    if (sql.startsWith('SELECT')) return { rows: list.filter(r => r.owner_id === params[0]).map(r => ({ id: r.id, content: JSON.parse(r.content), updatedAt: 'now' })) }
    if (sql.startsWith('INSERT')) {
      if (list.some(r => r.owner_id === params[1] && r.name.toLowerCase() === params[2].toLowerCase())) throw Object.assign(new Error('duplicate'), { code: '23505' })
      list.push({ id: params[0], owner_id: params[1], name: params[2], content: params[3] }); return { rowCount: 1, rows: [] }
    }
    const row = list.find(r => r.id === params[0] && r.owner_id === params[1])
    if (sql.startsWith('UPDATE')) { if (row) Object.assign(row, { name: params[2], content: params[3] }); return { rowCount: row ? 1 : 0, rows: row ? [{ id: row.id }] : [] } }
    if (sql.startsWith('DELETE')) { if (row) list.splice(list.indexOf(row), 1); return { rowCount: row ? 1 : 0 } }
    throw new Error(`unexpected SQL ${sql}`)
  }
  return { rows, query }
}
function setup() {
  const db = fakeDb()
  const library = createExamLibrary({ pool: db, body: async req => req.payload, send: (res, status, data) => Object.assign(res, { status, data }) })
  const call = async (method, path, payload, user = { id: 'u1' }) => {
    const res = {}
    const handled = await library.route({ method, payload }, res, user, path)
    return { handled, ...res }
  }
  return { db, call }
}

test('validates plain-text exam templates and macros', () => {
  assert.ok(validExamTemplate(template()))
  assert.ok(validExamTemplate({ ...template(), views: ['PA'] }))
  assert.ok(!validExamTemplate({ ...template(), modality: 'PET' }))
  assert.ok(!validExamTemplate({ ...template(), sections: {} }))
  assert.ok(!validExamTemplate({ ...template(), sections: { other: 'x' } }))
  assert.ok(!validExamTemplate({ ...template(), html: '<b>' }))
  assert.ok(!validExamTemplate({ ...template(), name: ' ' }))
  assert.ok(validMacro(macro()))
  assert.ok(!validMacro({ ...macro(), name: '...' }))
  assert.ok(!validMacro({ ...macro(), text: '  ' }))
  assert.ok(!validMacro({ ...macro(), scope: 'builtin' }))
})

test('exam template CRUD is scoped to the owner', async () => {
  const { call } = setup()
  assert.equal((await call('GET', '/api/report-templates')).handled, false)
  const created = await call('POST', '/api/exam-templates', template())
  assert.equal(created.status, 201)
  const id = created.data.id
  const listed = await call('GET', '/api/exam-templates')
  assert.equal(listed.data.templates.length, 1)
  assert.equal(listed.data.templates[0].id, id)
  assert.equal(listed.data.templates[0].sections.findings, 'No [acute/subacute] haemorrhage.')
  assert.equal((await call('GET', '/api/exam-templates', undefined, { id: 'u2' })).data.templates.length, 0)
  assert.equal((await call('PUT', `/api/exam-templates/${id}`, { ...template(), name: 'CT head' })).status, 200)
  assert.equal((await call('PUT', `/api/exam-templates/${id}`, template(), { id: 'u2' })).status, 404)
  assert.equal((await call('DELETE', `/api/exam-templates/${id}`, undefined, { id: 'u2' })).status, 404)
  assert.equal((await call('DELETE', `/api/exam-templates/${id}`)).status, 200)
  assert.equal((await call('GET', '/api/exam-templates')).data.templates.length, 0)
  assert.equal((await call('DELETE', '/api/exam-templates/not-a-uuid')).status, 404)
  assert.equal((await call('POST', '/api/exam-templates', { ...template(), modality: 'PET' })).status, 400)
})

test('macros reject duplicates by name and unknown fields', async () => {
  const { call } = setup()
  assert.equal((await call('POST', '/api/report-macros', macro())).status, 201)
  assert.equal((await call('POST', '/api/report-macros', { ...macro(), name: 'NormalChest' })).status, 409)
  assert.equal((await call('POST', '/api/report-macros', { ...macro(), extra: 1 })).status, 400)
  const listed = await call('GET', '/api/report-macros')
  assert.deepEqual(Object.keys(listed.data.macros[0]).sort(), ['id', 'name', 'text', 'trigger', 'updatedAt'])
  assert.equal((await call('PATCH', '/api/report-macros')).status, 404)
})
