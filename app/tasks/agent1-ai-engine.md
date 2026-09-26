# Agent 1 — AI Engine (MedGemma client, prompts, analysis orchestration)

You own: `src/lib/medgemma.ts`, `src/lib/prompts.ts` (new), `src/lib/parse.ts` (new), `src/lib/analysis.ts`,
`scripts/test-medgemma.mjs` (new), `notes/agent1.md`. Read `SWARM.md`, `src/types.ts`, `src/store.ts` first.

## 1. `src/lib/prompts.ts`
- `SYSTEM_PROMPT`: expert, board-certified radiologist persona; systematic ABCDE-style review for chest (Airway, Bones, Cardiac,
  Diaphragm, Effusions/Everything else: lungs, pleura, mediastinum, hila, devices/lines/tubes, soft tissues) and a generic
  systematic review for other body parts (bones, joints, alignment, soft tissue, foreign bodies). Instruct: be specific and
  conservative, never invent findings, report a normal study as normal, state laterality from the PATIENT's perspective
  (image left = patient right), respond ONLY with JSON.
- `buildAnalysisPrompt(patient: PatientInfo)`: includes age/sex/indication/history when present and the exact JSON schema:
  `{modality, bodyPart, view, imageQuality, findings:[{title, description, severity: critical|significant|moderate|minor|normal,
  confidence 0-1, location, category, recommendation, box_2d:[ymin,xmin,ymax,xmax] 0-1000 tight box around the abnormality}],
  pertinentNegatives:[...], impression, recommendations:[...], differential:[...]}`. Tell it: box must tightly enclose the
  abnormality; omit box_2d for diffuse/global findings; if study is normal, findings may be [] or contain one "normal" item without a box.
  Severity definitions (critical = needs immediate action e.g. tension pneumothorax, free air; significant = needs prompt
  clinical attention; moderate; minor/incidental; normal).
- `buildReportPrompt(study)`: text-only prompt that takes patient info + every image's AnalysisResult (as compact JSON) and asks
  for a formal radiology report JSON `{technique, comparison, findings, impression, recommendations}` in professional
  radiology prose (findings organized by anatomical system; impression as numbered list, most important first;
  recommendations with timeframe). comparison = "None available." unless history mentions prior imaging.

## 2. `src/lib/parse.ts`
Robust, pure, well-tested-by-script functions:
- `extractJson(text)`: strip ```json fences / leading prose, find the outermost balanced `{...}`, repair common issues
  (trailing commas, smart quotes, unterminated output — close open strings/arrays/objects when the stream was cut), then JSON.parse.
- `normalizeAnalysis(obj, meta:{rawText, model, durationMs})` → `AnalysisResult`: coerce every field with safe defaults,
  clamp confidence (accept 0-100 → /100), map unknown severities to nearest (e.g. "severe"/"high"→significant, "mild"/"low"→minor,
  "none"→normal), convert `box_2d` [ymin,xmin,ymax,xmax] 0-1000 → `bbox {x,y,w,h}` 0..1 (also accept `bbox` objects / 0..1
  arrays; drop degenerate/out-of-range boxes; swap inverted coords), assign `id` via `uid()` from store, sort findings by
  severity then confidence, derive `urgency` (any critical → 'urgent', any significant → 'priority', else 'routine').
- `normalizeReport(obj)` → the 5 report strings (arrays joined with newlines, numbered for impression).

## 3. `src/lib/medgemma.ts` (keep exported signatures from the stub)
- `checkConnection(settings)`: GET `/models` with 4s timeout → 'online' if model id present, 'model-missing' if server up but
  model absent, 'offline' otherwise.
- Internal `chatStream({settings, messages, signal, onDelta, maxTokens})` using fetch + ReadableStream SSE parsing
  (handle partial lines across chunks, `[DONE]`, `error` payloads, non-200 with the server's error message).
- `analyzeImage`: before sending, re-encode the image to JPEG at max 1024px long edge via OffscreenCanvas/canvas (MedGemma
  uses 896px internally; keeps requests small). Stream; call `onProgress` with human-friendly stage text like
  "Reviewing image…" → "Writing findings · 312 tokens" (count deltas). Parse with `extractJson` + `normalizeAnalysis`.
  If parsing fails, retry ONCE with a follow-up message asking to return only valid JSON for the same schema.
  Throw `Error` with a clear, user-presentable message on failure (e.g. "LM Studio is not reachable at …").
- `generateReport`: stream text-only, parse with `normalizeReport`, same retry.
- A module-level promise queue so only one request runs against LM Studio at a time.

## 4. `src/lib/analysis.ts` (keep exported signatures)
Store-bound orchestration used by the UI:
- `runAnalysis(studyId, imageId)`: abort controller per image in a Map; `setImageStatus(..,'analyzing',{progressText:'Queued'})`,
  call `analyzeImage` with the study's patient + current settings, stream progress into `progressText` (throttle store updates
  to ~5/s), on success `setImageAnalysis`, and if it is the active image and nothing is selected, keep selection null.
  On abort → status 'idle'. On error → status 'error' with message.
- `runAnalysisForStudy(studyId)`: queue all images that are not 'done' / not 'analyzing'.
- `cancelAnalysis(imageId)`, `isAnalyzing(imageId)`.
- Also export `generateStudyReport(studyId): Promise<void>` + `cancelReport()` + a tiny zustand store
  `useReportJob` (`{running:boolean, progressText?:string, error?:string}`) that calls `generateReport` and writes the result
  with `useApp.getState().setReport(studyId, {...result, generated:true, signed:false})`. Agent 4 (Report UI) will import
  `generateStudyReport`, `cancelReport`, `useReportJob` from `src/lib/analysis.ts` — use exactly these names.

## 5. `scripts/test-medgemma.mjs`
Node script (no deps) that: (a) unit-tests `extractJson`-equivalent logic on tricky strings (fenced, trailing commas,
truncated) — you may duplicate the parser logic by importing the TS? No: write parse.ts in plain TS without DOM so Node can
run it via `node --experimental-strip-types scripts/test-parse.ts` — do that instead (name it `scripts/test-parse.ts`,
import from `../src/lib/parse.ts`; avoid importing store.ts there → make `uid` injectable or use `crypto.randomUUID()` directly
in parse.ts). (b) `scripts/test-medgemma.mjs` hits `http://localhost:1234/v1` with `../sample-xrays/Pneumothorax_CXR.jpg`
using your prompts (copy the text) and prints the parsed findings. Run both and make them pass. LM Studio IS running.

Quality bar: this is medical software. Handle every failure mode gracefully. Clear code, typed, no `any` leaks in exports.
Typecheck: `npx tsc -p tsconfig.app.json --noEmit`. Write `notes/agent1.md` when done.
