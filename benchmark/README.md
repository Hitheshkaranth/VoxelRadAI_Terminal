# MedGemma benchmark

Runs the app's exact analysis pipeline (same prompts, parser, and lung-pattern pass) over public, labelled chest radiographs and scores it.

```sh
cd benchmark
python3 fetch.py                                   # downloads a stratified sample → img/, manifest.json
node --experimental-strip-types run.mts            # ~1 min/image; resumable → results.jsonl
python3 score.py final results.jsonl               # per-class sensitivity, normal specificity, FP types, latency
node --experimental-strip-types rescore.mts        # re-parse stored raw outputs after parser changes
```
Requires LM Studio serving `medgemma-27b-it` on `localhost:1234`.

Committed alongside the scripts: `manifest.json` (the exact 56 images and their labels) and `results.jsonl` (every raw model output, parsed findings and lung-pattern grade from the Sep 2026 run), so the numbers below can be audited or re-scored without re-running the model: `python3 score.py final results.jsonl`. Images are not committed — `fetch.py` re-downloads them.

## Data
- **NIH ChestX-ray14** (test split, via Hugging Face `BahaaEldin0/NIH-Chest-Xray-14`): 44 adult films, 12 *No Finding* + effusion, cardiomegaly, pneumothorax, edema, consolidation, pneumonia, infiltration, atelectasis, mass, nodule. Labels are NLP-mined from reports (~90% accurate), so per-class numbers on 4–6 images are directional.
- **Kermany pediatric pneumonia** (`hf-vision/chest-xray-pneumonia` test split): 6 normal, 6 pneumonia.

## Results — Sep 2026, 56 images, medgemma-27b-it (LM Studio, 16k ctx)

| | |
|---|---|
| Pediatric pneumonia (Kermany) | 6/6 pneumonia flagged, 6/6 normals clear |
| Adult abnormal flagged (NIH) | 22/32 |
| Adult normals called normal (NIH) | 8/12 |
| JSON parse success | 56/56 |
| Abnormal findings localized with a box | 62/79 |
| Latency | median ~50 s alone (77 s measured while other jobs shared the GPU) |

Sensitivity by label: infiltration 5/6, pneumothorax 3/4, edema 3/4, consolidation 3/4, pneumonia 7/10, cardiomegaly 2/4, atelectasis 1/5, **effusion 1/6, nodule/mass 0/6**.

How often each *reported* finding type was supported by the labels (precision):

| Reported | Confirmed |
|---|---|
| interstitial / markings | 4/4 |
| consolidation / opacity | 24/31 |
| pneumothorax | 3/7 — false calls were "apical pneumothorax", 2 on effusion films |
| effusion | 1/9 |
| cardiomegaly | 1/7 |

Other observations:
- Self-reported confidence is uncalibrated: false findings are typically stated at 0.90–0.95.
- A stereotyped false positive, "Right lower lobe consolidation", accounts for 3 of 4 false alarms on normal films.
- Well-positioned devices (pacemaker, central line) were reported as abnormal findings.

## MAIRA-2 comparison — Sep 2026, same 56 images
```sh
# needs transformers 4.46–4.51 (MAIRA-2's remote code), torch, pillow, protobuf, sentencepiece, accelerate
# and the weights (license accepted at huggingface.co/microsoft/maira-2); MAIRA_PATH defaults to ~/.cache/maira-2
python run_maira2.py                               # grounded reporting, bf16 on MPS, ~8 s/image → results-maira2.jsonl
python3 run_maira2.py --rescore results-maira2.jsonl   # re-classify stored sentences after rule changes (no model)
python3 score.py final results-maira2.jsonl
```
MAIRA-2 generates a MIMIC-style *Findings* section (technique = view, no indication or prior), one box per sentence. Each sentence becomes a finding; a rule-based classifier marks negated sentences ("normal without effusion", "No pneumothorax") and well-positioned devices as normal. All findings are severity `minor` because the model gives no severity or confidence. In 5/56 outputs the model dropped its `<obj>` tags mid-report, which breaks its own parser; those are recovered as plain sentences without boxes (`parse: "fallback"`).

Synonyms added to `score.py` for MAIRA-2's wording (*opacification*, *alveolar*, *round opacity*) leave MedGemma's scores unchanged.

| | MedGemma 27B | MAIRA-2 |
|---|---|---|
| Adult abnormal flagged (NIH) | 22/32 | 27/32 |
| Adult normals called normal (NIH) | 8/12 | 8/12 |
| Pediatric (Kermany): pneumonia with a pneumonia-type finding / normals clear | 5/6 / 6/6 | 0/6 / 6/6 |
| Right finding type (all labels) | 25/49 | 19/49 |
| Median latency | ~50 s (77 s shared GPU) | 8 s |

Sensitivity by label, MAIRA-2: infiltration 5/6, atelectasis 3/5, effusion 3/6, pneumothorax 2/4, nodule 2/4, mass 1/2, cardiomegaly 1/4, edema 1/4, consolidation 1/4, **pneumonia 0/10**.

Images where a reported finding type was supported by the labels (one count per image, same rule for both):

| Reported | MedGemma | MAIRA-2 |
|---|---|---|
| consolidation / opacity | 15/20 | 16/22 |
| pneumothorax | 3/7 | 2/3 |
| effusion | 1/8 | 3/13 |
| cardiomegaly | 0/4 | 1/11 |
| atelectasis | 0/1 | 3/15 |
| edema / congestion | 1/3 | 1/11 |
| nodule / mass | 0/0 | 2/3 |

Observations:
- Pediatric films are outside MAIRA-2's training data (adult MIMIC-CXR): all 6 pneumonias were "abnormal" but described as cardiomegaly/vascular congestion, and one as large bilateral pneumothoraces with effusions.
- It never uses the word pneumonia for an opacity, and lists incidental findings (tortuous aorta, low lung volumes, "costophrenic angle not included") that the classifier counts as abnormal.
- False alarms on normal films: subsegmental atelectasis ×2, a 1 cm nodule, tortuous aorta, and one film read as edema + effusions + cardiomegaly.

## TorchXRayVision cross-check — Sep 2026
```sh
python run_txrv.py                                          # probabilities per image → txrv.jsonl (uses app/server/txrv_server.py)
python3 run_txrv.py --filter results.jsonl results-txrv.jsonl   # drop findings the classifier does not support
python3 score.py final results-txrv.jsonl
```
Models: `densenet121-res224-chex`, `-mimic_ch`, `-pc` averaged — deliberately not the default `all` model, which includes NIH ChestX-ray14 in training. A finding's type is taken from its title (description only if the title matches no type) and is unsupported when the probability for that type is < 0.5 (each model's operating point; not tuned on this set).

| | MedGemma | + cross-check |
|---|---|---|
| Adult normals called normal | 8/12 | 9/12 |
| Adult abnormal flagged | 22/32 | 21/32 (the dropped film's only finding was a false pneumothorax) |
| Right finding type | 25/49 | 25/49 |
| Findings removed | — | 4, all false |

Classifier alone, AUC vs normals (n = 2–10 per label, directional): pneumothorax 1.00, consolidation 0.96, edema 0.94, cardiomegaly 0.93, mass 0.92, nodule 0.90, any abnormality 0.87, pneumonia 0.82, atelectasis 0.82, effusion 0.76 (two labelled effusions scored 0.08 and 0.10).

Tried and rejected: adding effusions the classifier sees but MedGemma missed (at a threshold catching 4/6 effusions it also fired on 20/32 other abnormal films), and a cardiothoracic ratio from the ChestX-Det heart/lung masks (labelled cardiomegaly 0.46–0.60 vs 3/18 normals above 0.5). An early version of the type mapping let description words override the title (e.g. "…or atelectasis" in a consolidation's description) and appeared to remove 5 false findings; fixed before the numbers above.

## What changed in the app because of this
- Devices in a satisfactory position are classified as normal (malpositioned devices keep their severity).
- Each finding card shows the benchmark confirmation rate for its finding type, with a warning for weak types (pneumothorax, effusion, cardiomegaly, edema), and the model's confidence is labelled "Model-stated". Table: `app/src/lib/reliability.ts` — update it after re-running.

## Tried and rejected (measured on subsets)
- **Temperature 0**: same false-positive rate, more findings per false alarm.
- **Two-step "plain report → JSON"**: caught nodules/masses (2/2) and had fewer false alarms, but missed both pneumothoraces and was ~2× slower.
- **Zone re-check of each opacity** (neutral 0–3 grade): graded every region 0, removing true findings along with false ones.
- **Leading yes/no questions**: answer "present" regardless of the image.
- **Checklist of subtle patterns in the main prompt**: induced false findings on normal films.
