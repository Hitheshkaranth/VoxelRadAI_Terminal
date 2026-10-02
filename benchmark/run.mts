// Runs the app's exact analysis pipeline (prompts, parser, lung-pattern pass) over the benchmark manifest.
// Resumable: appends one JSON line per image to results.jsonl and skips ids already present.
//   MANIFEST=manifest-cxd.json OUT=results-cxd-r1.jsonl MODEL=medgemma-27b-it TEMP=0.2 node --experimental-strip-types run.mts
// Every row records model, temperature, finish reason and a hash of the prompts, so runs can be told apart later.
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { SYSTEM_PROMPT, buildAnalysisPrompt, LUNG_PATTERN_PROMPT, LUNG_PATTERN_SYSTEM } from '../app/src/lib/prompts.ts'
import { extractJson, normalizeAnalysis, parseLungPattern, mergeLungPattern } from '../app/src/lib/parse.ts'

const OUT = process.env.OUT ?? 'results.jsonl'
const MODEL = process.env.MODEL ?? 'medgemma-27b-it'
const TEMP = Number(process.env.TEMP ?? 0.2) // the app's default (DEFAULT_SETTINGS.temperature)
const API = 'http://localhost:1234/v1'
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST ?? 'manifest.json', 'utf8'))
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : [])

async function chat(messages: unknown[], temperature: number, max_tokens: number) {
  const r = await fetch(`${API}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature, max_tokens, messages }),
  })
  const d: any = await r.json()
  if (!d.choices) throw new Error(JSON.stringify(d).slice(0, 200))
  return { text: d.choices[0].message.content as string, usage: d.usage, finish: d.choices[0].finish_reason }
}

const patient = (m: any) => ({ name: '', patientId: '', age: /\d/.test(m.age) ? String(m.age) : '', sex: m.sex === 'M' ? 'Male' : m.sex === 'F' ? 'Female' : '', studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' })

// Fail before the loop, not with one error row per image, when the server is down or serves another model.
const listed: string[] = await fetch(`${API}/models`)
  .then((r) => r.json())
  .then((d: any) => (d.data ?? []).map((x: any) => x.id))
  .catch(() => { console.error(`LM Studio is not reachable at ${API}. Start it and load ${MODEL} (see run_all.sh).`); process.exit(1) })
if (!listed.includes(MODEL)) {
  console.error(`Model "${MODEL}" is not served by LM Studio (it lists: ${listed.join(', ') || 'nothing'}). Load it first: lms load ${MODEL}`)
  process.exit(1)
}

const emptyPatient = patient({ age: '', sex: '' })
const promptHash = createHash('sha1').update(SYSTEM_PROMPT + buildAnalysisPrompt(emptyPatient as any) + LUNG_PATTERN_PROMPT).digest('hex').slice(0, 12)
console.log(`${MODEL} · temperature ${TEMP} · prompt ${promptHash} → ${OUT}`)

for (const m of manifest) {
  if (done.has(m.id)) continue
  const url = 'data:image/jpeg;base64,' + fs.readFileSync(m.path).toString('base64')
  const img = { type: 'image_url', image_url: { url } }
  const t0 = Date.now()
  const rec: any = { id: m.id, source: m.source, labels: m.labels, model: MODEL, temp: TEMP, promptHash, finish: null }
  try {
    const main = await chat([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: [img, { type: 'text', text: buildAnalysisPrompt(patient(m) as any) }] }], TEMP, 3072)
    rec.mainMs = Date.now() - t0; rec.tokens = main.usage?.completion_tokens; rec.finish = main.finish; rec.raw = main.text
    let analysis
    try { analysis = normalizeAnalysis(extractJson(main.text), { rawText: main.text, model: 'm', durationMs: 0 }); rec.parse = 'ok' }
    catch (e) { rec.parse = 'fail: ' + (e as Error).message; analysis = null }
    const t1 = Date.now()
    const pat = await chat([{ role: 'system', content: LUNG_PATTERN_SYSTEM }, { role: 'user', content: [img, { type: 'text', text: LUNG_PATTERN_PROMPT }] }], 0, 200)
    rec.patternMs = Date.now() - t1
    let lp = null
    try { lp = parseLungPattern(extractJson(pat.text)) } catch { /* ignore */ }
    rec.pattern = lp
    if (analysis) {
      rec.main = analysis
      rec.final = mergeLungPattern(analysis, lp)
    }
  } catch (e) {
    rec.error = (e as Error).message
  }
  rec.totalMs = Date.now() - t0
  fs.appendFileSync(OUT, JSON.stringify(rec) + '\n')
  const f = rec.final?.findings?.filter((x: any) => x.severity !== 'normal').map((x: any) => x.title).join('; ') ?? rec.error ?? rec.parse
  console.log(`${m.id.padEnd(14)} ${String(m.labels).padEnd(28)} ${(rec.totalMs / 1000).toFixed(0)}s  → ${f || '(normal)'}`)
}
