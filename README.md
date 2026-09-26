# Skanda Radiology

AI-assisted X-ray reading that runs entirely on your Mac: upload radiographs, have **MedGemma 27B** (served locally by LM Studio) perform a systematic read, see findings localized on the image, and produce a structured, signable radiology report.

> **Decision support only.** All AI output must be reviewed and verified by a qualified radiologist before any clinical use.

## Features
- **Intake** — drag & drop anywhere, paste (⌘V), or file picker. PNG, JPEG, WebP, and uncompressed DICOM (window/level + rescale applied).
- **Diagnostic viewer** — zoom/pan, window-level (right/⌥-drag) with Lung/Bone/Soft-tissue presets, invert, keyboard shortcuts, numbered severity-colored finding boxes linked to the findings list.
- **Analysis** — streamed progress, urgency (routine/priority/urgent), severity breakdown, impression, findings with confidence, pertinent negatives, differential, recommendations, raw model output for audit.
- **Report** — AI-drafted structured report (technique, comparison, findings, impression, recommendations), fully editable, sign-off, A4 print/PDF with annotated key images, plain-text and JSON export.
- **Private by design** — inference is local (LM Studio); studies persist in the browser's IndexedDB.
- Apple-style UI with light and dark mode.

## Requirements
- [LM Studio](https://lmstudio.ai) with `medgemma-27b-it` downloaded, and Node.js 20+.
- Load the model with a moderate context (a 131k context with 4 parallel slots caused "Compute error" on a 26 GB Mac):
  ```sh
  lms load medgemma-27b-it --context-length 16384 --gpu max -y
  lms server start          # serves http://localhost:1234
  ```

## Run
```sh
cd app
npm install
npm run dev               # http://localhost:5173 (Vite proxies /lmstudio → localhost:1234)
```
Base URL and model id can be changed in **Settings** (⌘,).

## Development
```sh
npm run build                                          # typecheck + production build
npm run lint                                           # oxlint incl. React rules-of-hooks
node --experimental-strip-types scripts/test-parse.ts  # model-output parser tests
```

| Path | Purpose |
|---|---|
| `app/src/lib/prompts.ts` | Radiologist system prompt + JSON schema |
| `app/src/lib/medgemma.ts` | LM Studio client (SSE streaming, request queue, retry) |
| `app/src/lib/parse.ts` | Robust JSON extraction/repair, `box_2d` → normalized boxes |
| `app/src/lib/analysis.ts` | Store-bound analysis and report jobs |
| `app/src/components/viewer` | Viewer, filmstrip, dropzone |
| `app/src/components/findings` | Findings inspector |
| `app/src/components/report` | Report editor and print view |
| `app/src/components/shell` | Layout, sidebar, toolbar, sheets |

`app/SWARM.md`, `app/tasks/` and `app/notes/` document how the first version was built by a 5-agent opencode swarm.

## Known limitations
- MedGemma's bounding boxes are approximate, and results vary between runs.
- Subtle interstitial patterns (prominent bronchovascular markings, perihilar opacities, peribronchial cuffing) are under-called by the main read. A second, neutral graded lung-pattern check (0–3 scale, ~10 s) adds a finding when the grade is ≥ 2; on a 12-film labelled set this raised detection from 6/7 to 7/7 with no false positives on 5 normals — a small sample, so treat it as directional.
- Leading yes/no questions ("is X present?") are unreliable: the model tends to agree with whatever is asked, including on normal films.

## Test images
Public chest radiographs from Wikimedia Commons (not redistributed here), e.g.
[normal PA](https://commons.wikimedia.org/wiki/File:Chest_Xray_PA_3-8-2010.png),
[pneumonia](https://commons.wikimedia.org/wiki/File:Pneumonia_x-ray.jpg),
[pneumothorax](https://commons.wikimedia.org/wiki/File:Pneumothorax_CXR.jpg),
[cardiomegaly](https://commons.wikimedia.org/wiki/File:Cardiomegally.PNG).
