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

Optional second opinion — a local [TorchXRayVision](https://github.com/mlmed/torchxrayvision) classifier that cross-checks every MedGemma finding (~0.1 s; first start downloads ~100 MB of weights):
```sh
cd app
uv run --with torchxrayvision --with scikit-image server/txrv_server.py   # http://localhost:8765, proxied at /txrv
```
Each finding card then shows *Classifier agrees · opacity 69%* or *Classifier does not support this*. Unsupported findings are drawn as a dashed outline, left out of the finding count and the draft report, but stay visible for the radiologist. Without the service the app behaves exactly as before.

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

## Benchmark
`benchmark/` runs the app's exact pipeline (same prompts, parser and lung-pattern pass) over 56 public, labelled chest X-rays and scores it: 44 adult films from NIH ChestX-ray14 (12 *No Finding* + 10 abnormal labels) and 12 from the Kermany pediatric pneumonia set (6 normal, 6 pneumonia). NIH labels are NLP-mined (~90% accurate) and per-class counts are small, so treat per-class numbers as directional.

**Results — Sep 2026, medgemma-27b-it (LM Studio, 16k ctx)**

| Metric | Result |
|---|---|
| Pediatric pneumonia (Kermany) | 6/6 pneumonia flagged, 6/6 normals clear |
| Adult abnormal flagged (NIH) | 22/32 |
| Adult normals called normal (NIH) | 8/12 |
| JSON parse success | 56/56 |
| Abnormal findings localized with a box | 62/79 |
| Latency | median ~50 s per image |

Sensitivity by label: infiltration 5/6, pneumothorax 3/4, edema 3/4, consolidation 3/4, pneumonia 7/10, cardiomegaly 2/4, atelectasis 1/5, **effusion 1/6, nodule/mass 0/6**.

Precision — how often each *reported* finding type was supported by the labels:

| Reported | Confirmed |
|---|---|
| interstitial / markings | 4/4 |
| consolidation / opacity | 24/31 |
| pneumothorax | 3/7 |
| effusion | 1/9 |
| cardiomegaly | 1/7 |

Self-reported confidence is uncalibrated (false findings typically stated at 0.90–0.95), and "Right lower lobe consolidation" accounts for 3 of 4 false alarms on normal films.

**Comparison — Microsoft MAIRA-2 (7B, grounded reporting) on the same 56 images**

[MAIRA-2](https://huggingface.co/microsoft/maira-2) is a chest-X-ray report generator, not a chat model: it cannot follow the app's prompt, return JSON, or run in LM Studio (no GGUF/MLX build; custom Rad-DINO + Vicuna architecture). `benchmark/run_maira2.py` runs it through transformers on the Mac GPU and turns each generated sentence into a finding (negated sentences and well-positioned devices count as normal), so the same `score.py` applies. Same scorer for both; MedGemma's scores are unchanged by the synonyms added for MAIRA-2's wording (*opacification*, *alveolar*, *round opacity*).

| | MedGemma 27B | MAIRA-2 |
|---|---|---|
| Adult abnormal flagged (NIH) | 22/32 | **27/32** |
| Adult normals called normal (NIH) | 8/12 | 8/12 |
| Right finding type, all labels | **25/49** | 19/49 |
| Pneumonia — pediatric (Kermany) | **5/6** | 0/6 |
| Pneumonia — adult (NIH) | **2/4** | 0/4 |
| Effusion / nodule+mass | 1/6 / 0/6 | **3/6 / 3/6** |
| Pneumothorax / edema / cardiomegaly | **3/4 / 3/4 / 2/4** | 2/4 / 1/4 / 1/4 |
| Abnormal findings with a box | 62/79 | 67/92 |
| Output well-formed | 56/56 JSON | 51/56 (5 malformed grounding tags, recovered as plain text) |
| Latency | ~50 s | **~8 s** |

- MAIRA-2 never names pneumonia; it describes opacities. On the pediatric films it is out of its training distribution (adult MIMIC-CXR only): it calls all 6 pediatric pneumonias abnormal, but as cardiomegaly/congestion, and once as bilateral pneumothorax with large effusions.
- It writes more findings per film (92 vs 79) with more incidental ones (tortuous aorta, low volumes), and has no confidence or severity, so its "flagged" rate is less meaningful than MedGemma's.
- Conclusion: MAIRA-2 is ~6× faster and better at effusions and nodules/masses, but weaker on pneumonia, pneumothorax, edema and cardiomegaly, and it does not fit the app's structured-output pipeline. MedGemma stays the app's model. Raw outputs: `benchmark/results-maira2.jsonl`.

**TorchXRayVision cross-check** (CheXpert + MIMIC + PadChest DenseNets, none trained on NIH; a finding is unsupported when its type's probability is < 0.5, the models' operating point, not tuned here): on the same MedGemma outputs it removed 4 findings, all false (right lower lobe consolidation and bilateral apical fibrosis on a normal film; an apical pneumothorax on an effusion film), and no true ones. Adult normals called normal 8/12 → **9/12**, right finding type unchanged at 25/49. Caveat: the classifier gave 0.08–0.10 effusion probability on 2 of 6 labelled effusions, so a correct effusion call can be flagged — the finding stays visible for that reason. `benchmark/run_txrv.py`.

Reproduce or re-score (requires LM Studio serving `medgemma-27b-it`):
```sh
cd benchmark
python3 fetch.py                             # download images + manifest
node --experimental-strip-types run.mts      # ~1 min/image, resumable → results.jsonl
python3 score.py final results.jsonl         # score (works on the committed results without re-running)
```
Raw model outputs for every image are committed in `benchmark/results.jsonl`. Methodology, what changed in the app, and approaches that were tried and rejected are in [benchmark/README.md](benchmark/README.md).

## Known limitations
- MedGemma's bounding boxes are approximate, and results vary between runs.
- Self-reported confidence is uncalibrated; finding cards show the benchmark confirmation rate for each finding type instead (weak: pneumothorax 3/7, effusion 1/9, cardiomegaly 1/7).
- Subtle interstitial patterns (prominent bronchovascular markings, perihilar opacities, peribronchial cuffing) are under-called by the main read. A second, neutral graded lung-pattern check (0–3 scale, ~10 s) adds a finding when the grade is ≥ 2; on a 12-film labelled set this raised detection from 6/7 to 7/7 with no false positives on 5 normals — a small sample, so treat it as directional.
- Leading yes/no questions ("is X present?") are unreliable: the model tends to agree with whatever is asked, including on normal films.

## Test images
Public chest radiographs from Wikimedia Commons (not redistributed here), e.g.
[normal PA](https://commons.wikimedia.org/wiki/File:Chest_Xray_PA_3-8-2010.png),
[pneumonia](https://commons.wikimedia.org/wiki/File:Pneumonia_x-ray.jpg),
[pneumothorax](https://commons.wikimedia.org/wiki/File:Pneumothorax_CXR.jpg),
[cardiomegaly](https://commons.wikimedia.org/wiki/File:Cardiomegally.PNG).
