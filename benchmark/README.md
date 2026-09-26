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

## What changed in the app because of this
- Devices in a satisfactory position are classified as normal (malpositioned devices keep their severity).
- Each finding card shows the benchmark confirmation rate for its finding type, with a warning for weak types (pneumothorax, effusion, cardiomegaly, edema), and the model's confidence is labelled "Model-stated". Table: `app/src/lib/reliability.ts` — update it after re-running.

## Tried and rejected (measured on subsets)
- **Temperature 0**: same false-positive rate, more findings per false alarm.
- **Two-step "plain report → JSON"**: caught nodules/masses (2/2) and had fewer false alarms, but missed both pneumothoraces and was ~2× slower.
- **Zone re-check of each opacity** (neutral 0–3 grade): graded every region 0, removing true findings along with false ones.
- **Leading yes/no questions**: answer "present" regardless of the image.
- **Checklist of subtle patterns in the main prompt**: induced false findings on normal films.
