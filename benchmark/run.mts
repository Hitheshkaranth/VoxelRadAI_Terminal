// Runs the app's exact analysis pipeline (prompts, parser, lung-pattern pass) over the benchmark manifest.
// Resumable: appends one JSON line per image to results.jsonl and skips ids already present.
import fs from 'node:fs'
import { SYSTEM_PROMPT, buildAnalysisPrompt, LUNG_PATTERN_PROMPT, LUNG_PATTERN_SYSTEM } from '../app/src/lib/prompts.ts'
import { extractJson, normalizeAnalysis, parseLungPattern, mergeLungPattern } from '../app/src/lib/parse.ts'

const OUT = process.env.OUT ?? 'results.jsonl'
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'))
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : [])

async function chat(messages: unknown[], temperature: number, max_tokens: number) {
  const r = await fetch('http://localhost:1234/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'medgemma-27b-it', temperature, max_tokens, messages }),
  })
  const d: any = await r.json()
  if (!d.choices) throw new Error(JSON.stringify(d).slice(0, 200))
  return { text: d.choices[0].message.content as string, usage: d.usage, finish: d.choices[0].finish_reason }
}

const patient = (m: any) => ({ name: '', patientId: '', age: /\d/.test(m.age) ? String(m.age) : '', sex: m.sex === 'M' ? 'Male' : m.sex === 'F' ? 'Female' : '', studyDate: '', referringPhysician: '', indication: '', clinicalHistory: '' })

for (const m of manifest) {
  if (done.has(m.id)) continue
  const url = 'data:image/jpeg;base64,' + fs.readFileSync(m.path).toString('base64')
  const img = { type: 'image_url', image_url: { url } }
  const t0 = Date.now()
  const rec: any = { id: m.id, source: m.source, labels: m.labels }
  try {
    const main = await chat([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: [img, { type: 'text', text: buildAnalysisPrompt(patient(m) as any) }] }], 0.2, 3072)
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
