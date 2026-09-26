# Skanda Radiology — Swarm Contract (read fully before writing code)

A radiologist-grade web app: upload X-ray images → local **MedGemma 27B** (vision, served by LM Studio)
diagnoses them → findings are drawn on the image → a structured, editable, signable radiology report is produced and exported.

Stack: Vite 8 + React 19 + TypeScript (strict, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` → use `import type`),
zustand 5, idb-keyval, lucide-react (icons), dicom-parser. **Plain CSS files** (no Tailwind, no CSS-in-JS, no new npm packages).

## Five agents work IN PARALLEL in this same folder. Rules:
1. **Only create/edit files you own** (listed in your task). Never touch another agent's files, `src/types.ts`,
   `src/store.ts`, `src/styles/*`, `vite.config.ts`, `package.json`. If you need something from the store that is missing,
   derive it locally in your own module.
2. **Do not** run `npm install`, `npm run dev`, `vite`, or anything that binds a port. Do not delete files.
3. Keep the **exported names and props of the stubs** you own exactly as they are (other agents import them).
4. Typecheck with `npx tsc -p tsconfig.app.json --noEmit`. Errors in other agents' files are not yours — ignore them; your files must be clean.
5. Your CSS lives in one `.css` file next to your components, imported by your component. **Prefix every class** with your
   module prefix (below) to avoid collisions. Use only CSS variables from `src/styles/tokens.css` for colors, radii, fonts,
   spacing, and reuse primitives from `src/styles/ui.css` (`.btn`, `.btn-primary`, `.btn-plain`, `.icon-btn`, `.input`,
   `.textarea`, `.select`, `.field`, `.segmented`, `.card`, `.glass`, `.group`, `.section-title`, `.badge[data-severity]`,
   `.spinner`, `.kbd`, `.scroll`). Read both files first.
6. Finish by writing a short `notes/<agent>.md` describing what you built and anything the integrator must know.

## Shared contract (already written — read these files)
- `src/types.ts` — domain types: `Study`, `StudyImage`, `Finding` (bbox normalized 0..1), `AnalysisResult`, `ReportDraft`, `Settings`, `ViewerState`, `Severity`.
- `src/store.ts` — zustand `useApp` store + `useActiveStudy()`, `useActiveImage()` selectors, `uid()`, `hydrate()`.
  Selection state: `activeStudyId`, `activeImageId`, `selectedFindingId`, `hoveredFindingId`, `inspectorTab`, `viewer`, `sheet`, `connection`.
- `src/lib/medgemma.ts` (Agent 1) — `checkConnection(settings)`, `analyzeImage({image, patient, settings, signal, onProgress})`, `generateReport({study, settings, signal, onProgress})`.
- `src/lib/analysis.ts` (Agent 1) — store-bound actions for the UI: `runAnalysis(studyId, imageId)`, `runAnalysisForStudy(studyId)`, `cancelAnalysis(imageId)`, `isAnalyzing(imageId)`.
- `src/lib/imageIntake.ts` (Agent 2) — `filesToStudyImages(files)`, `ACCEPTED_TYPES`.
- `src/lib/annotate.ts` (Agent 2) — `renderAnnotatedImage(image, {maxSize})` → data URL with numbered finding boxes burned in.

## Layout (macOS three-pane app, Agent 5 composes it)
```
┌──────────── Toolbar (glass, 52px): study title · patient chip · Analyze All · connection pill · settings ───┐
│ Sidebar (256px,   │  Viewer (dark, flexible)                        │ Inspector (380px)                    │
│ vibrancy):        │  ┌──────────────────────────────────────┐       │ [ Findings | Report ] segmented      │
│ search            │  │  image + finding overlays, HUD       │       │  FindingsPanel  (Agent 3)            │
│ studies list      │  │  zoom/pan/window-level/invert         │       │  ReportPanel    (Agent 4)            │
│ + New Study       │  └──────────────────────────────────────┘       │                                      │
│                   │  Filmstrip (thumbnails, status dots, +add)      │                                      │
└───────────────────┴─────────────────────────────────────────────────┴──────────────────────────────────────┘
```
Empty study (no images) → the viewer area shows `<Dropzone studyId>` as a large beautiful drop target.

## Visual language — "Apple, clinical"
- SF system font stack, macOS HIG sizes (13px body). Generous whitespace, 0.5px hairline separators, soft shadows, 10–14px radii.
- Vibrancy/glass for toolbar & sidebar (`.glass`), crisp white/elevated cards in the inspector. Full light + dark mode via tokens.
- Viewer is **always dark** (`--viewer-bg`) — radiology reading convention.
- Severity colors: critical=red, significant=orange, moderate=yellow, minor=blue, normal=green (`[data-severity]`).
- Motion: short (140–220ms), `--ease-out`; springy only for small confirmations. Respect reduced motion.
- lucide-react icons at 15–17px, stroke 1.75. No emoji. No gradients-for-decoration, no purple AI glow clichés.
- Medical safety: always visible, tasteful disclaimer that AI output is decision support and must be verified by a qualified radiologist.

## MedGemma facts (verified by the integrator)
- Endpoint: OpenAI-compatible `POST {settings.baseUrl}/chat/completions` (default baseUrl `/lmstudio/v1`, Vite proxies to `http://localhost:1234`). Model id `medgemma-27b-it`. `GET {baseUrl}/models` lists models.
- Vision works with `content: [{type:'image_url', image_url:{url:dataUrl}}, {type:'text', text}]`. Image first, then text.
- Supports `stream: true` (SSE `data: {...choices[0].delta.content}` lines, ends with `data: [DONE]`).
- ~45–60 s per image for ~600 output tokens → streaming progress is mandatory UX.
- Wraps JSON in ```json fences even when told not to. Returns boxes as `box_2d: [ymin, xmin, ymax, xmax]` on a 0–1000 scale (convert to normalized `{x,y,w,h}`).
- Laterality: radiographs are displayed with patient's RIGHT on image LEFT — prompts must state this.
- Run ONE inference at a time (queue) — the local GPU is shared.
