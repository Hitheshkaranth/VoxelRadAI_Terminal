// Per-user exam (content) templates and report macros. Both hold plain text only; fields such as
// [left/right] are plain characters, so nothing here can inject markup into a report.
import { randomUUID } from 'node:crypto'
import { SECTION_KEYS } from './reportTemplates.mjs'

export const MAX_EXAM_TEMPLATES = 200
export const MAX_MACROS = 500
export const EXAM_BODY_LIMIT = 64 * 1024
const MODALITIES = ['XR', 'CT', 'MR', 'US', 'OT']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value, max) => typeof value === 'string' && value.length <= max
const only = (value, keys) => Object.keys(value).every(key => keys.includes(key))
const words = (value, count, max) => Array.isArray(value) && value.length <= count && value.every(word => text(word, max))

export function validExamTemplate(value) {
  if (!object(value) || !only(value, ['name', 'modality', 'bodyPart', 'keywords', 'views', 'sections'])) return false
  if (!text(value.name, 80) || !value.name.trim() || !MODALITIES.includes(value.modality) || !text(value.bodyPart, 60)) return false
  if (!words(value.keywords, 30, 40) || (value.views !== undefined && !words(value.views, 10, 30))) return false
  if (!object(value.sections) || !only(value.sections, SECTION_KEYS)) return false
  const sections = SECTION_KEYS.filter(key => value.sections[key] !== undefined)
  return sections.length > 0 && sections.every(key => text(value.sections[key], 8000))
}

export function validMacro(value) {
  if (!object(value) || !only(value, ['name', 'trigger', 'text'])) return false
  // Names are typed as ".name", so they must contain a letter or digit to match.
  if (!text(value.name, 40) || !/[a-z0-9]/i.test(value.name) || !text(value.trigger, 80)) return false
  return text(value.text, 4000) && value.text.trim().length > 0
}

const pick = (data, keys) => Object.fromEntries(keys.filter(key => data[key] !== undefined).map(key => [key, data[key]]))
const COLLECTIONS = {
  '/api/exam-templates': { table: 'exam_templates', field: 'templates', max: MAX_EXAM_TEMPLATES, valid: validExamTemplate, keys: ['name', 'modality', 'bodyPart', 'keywords', 'views', 'sections'], label: 'Exam template',
    invalid: 'Exam template needs a name, a modality (XR, CT, MR, US or OT) and at least one section of plain text.' },
  '/api/report-macros': { table: 'report_macros', field: 'macros', max: MAX_MACROS, valid: validMacro, keys: ['name', 'trigger', 'text'], label: 'Macro',
    invalid: 'Macro needs a name of up to 40 characters and text of up to 4000 characters.' },
}

/** Routes for /api/exam-templates and /api/report-macros. route() returns false for other paths. */
export function createExamLibrary({ pool, body, send }) {
  async function route(req, res, user, path) {
    const match = path.match(/^(\/api\/exam-templates|\/api\/report-macros)(?:\/([^/]+))?$/)
    if (!match) return false
    const c = COLLECTIONS[match[1]], id = match[2]
    if (id && !UUID.test(id)) { send(res, 404, { error: `${c.label} not found.` }); return true }
    if (req.method === 'GET' && !id) {
      const result = await pool.query(`SELECT id,content,updated_at AS "updatedAt" FROM ${c.table} WHERE owner_id=$1 ORDER BY lower(name)`, [user.id])
      send(res, 200, { [c.field]: result.rows.map(({ content, ...row }) => ({ ...content, ...row })) })
      return true
    }
    if (req.method === 'DELETE' && id) {
      const result = await pool.query(`DELETE FROM ${c.table} WHERE id=$1 AND owner_id=$2`, [id, user.id])
      result.rowCount ? send(res, 200, { ok: true }) : send(res, 404, { error: `${c.label} not found.` })
      return true
    }
    if (!((req.method === 'POST' && !id) || (req.method === 'PUT' && id))) { send(res, 404, { error: 'Endpoint not found.' }); return true }
    const data = await body(req, EXAM_BODY_LIMIT)
    if (!c.valid(data)) { send(res, 400, { error: c.invalid }); return true }
    const content = JSON.stringify(pick(data, c.keys)), name = data.name.trim()
    try {
      if (req.method === 'POST') {
        const count = await pool.query(`SELECT count(*)::int AS n FROM ${c.table} WHERE owner_id=$1`, [user.id])
        if (count.rows[0].n >= c.max) { send(res, 400, { error: `You can keep up to ${c.max} ${c.field}.` }); return true }
        const newId = randomUUID()
        await pool.query(`INSERT INTO ${c.table}(id,owner_id,name,content) VALUES ($1,$2,$3,$4)`, [newId, user.id, name, content])
        send(res, 201, { id: newId })
        return true
      }
      const result = await pool.query(`UPDATE ${c.table} SET name=$3,content=$4,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING id`, [id, user.id, name, content])
      result.rowCount ? send(res, 200, { id }) : send(res, 404, { error: `${c.label} not found.` })
    } catch (error) {
      // Unique (owner, lower(name)) index: a second macro or template with the same name would be ambiguous.
      if (error?.code === '23505') send(res, 409, { error: `${c.label} “${name}” already exists.` })
      else throw error
    }
    return true
  }
  return { route }
}
