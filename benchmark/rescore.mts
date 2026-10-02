import fs from 'node:fs'
import { extractJson, normalizeAnalysis, mergeLungPattern } from '../app/src/lib/parse.ts'
const out: string[] = []
for (const l of fs.readFileSync(process.argv[2] ?? 'results.jsonl', 'utf8').trim().split('\n')) {
  const r = JSON.parse(l)
  if (r.raw) {
    // normalizeAnalysis throws on unreadable output; record it as a parse failure like run.mts does.
    try { const a = normalizeAnalysis(extractJson(r.raw), { rawText: r.raw, model: '', durationMs: 0 }); r.main = a; r.final = mergeLungPattern(a, r.pattern); r.parse = 'ok' }
    catch (e) { r.parse = 'fail: ' + (e as Error).message; delete r.main; delete r.final }
  }
  out.push(JSON.stringify(r))
}
fs.writeFileSync(process.argv[3] ?? 'results-rescored.jsonl', out.join('\n') + '\n')
