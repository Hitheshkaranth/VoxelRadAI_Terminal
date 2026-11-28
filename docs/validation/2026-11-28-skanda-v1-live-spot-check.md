# Skanda V1 live spot check, November 28, 2026: findings for the training team

**What this is.** A record of every scan we put through Skanda V1 on the live site (radgenis.com, Hugging Face ZeroGPU Space, model `hitheshkaranth/Skanda-V1` at the pinned `space-live` revision) on November 28, 2026: where each scan came from, its ground truth, what the model said, and what went wrong. It is meant to steer what the next checkpoint is trained and evaluated on. All data is public; nothing here is a patient study from our users.

**What this is not.** A benchmark. These are 25 hand-picked cases, read once at temperature as deployed. For scored, held-out numbers see the README (Skanda V1 model card: 39% right finding type on the 111 ChestX-Det test films; the repo's stored scored run in `benchmark/results-skanda-manifest-cxd.jsonl` is the older run 2: 37%).

---

## 1. How the reads were run

| Item | Setting |
| --- | --- |
| Model | Skanda V1 (run 4b checkpoint), served from the Space, `skanda-v1` |
| X-ray | One read per film, the app's normal pipeline (no classifier cross-check on the hosted site) |
| CT / MRI | "Analyze volume" in the app: **20 axial slices sampled evenly** through the series, each read independently as a 2D slice (no 3D context). Volumes with ≤ 20 slices are read in full |
| CT input | Hounsfield units, rendered by the app as lung / soft-tissue / bone windows in R / G / B (`app/src/lib/skandaSlice.ts`) |
| MRI input | Single sequence, 1st–99th positive-percentile grey window; sagittal/coronal acquisitions read on the axial reformat |
| Acquisition details set per scan | Modality, body region, HU confirmed for CT; MRI sequence only where known |
| Post-processing | The app's source-consistency checks withhold claims whose outline/box does not fit the image; "withheld" below means the text was produced but not drawn |

Laterality convention: patient left/right. On screen, patient left is on the viewer's right.

---

## 2. Results at a glance

| Area | Cases | Correct | Main failure |
| --- | --- | --- | --- |
| Chest X-ray | 15 films, 14 finding types | 2 fully, 4 partly | Misses most finding types; confuses pleural/airspace patterns; false cardiomegaly on a normal film |
| Chest CT, lung nodules | 2 cases, 5 marked nodules | 3 of 3 nodules > 20 mm | All nodules ≤ 12 mm missed; unlabelled "mediastinal lesion" calls |
| Brain MRI, tumour | 2 scans (same patient) | 1 outline | Laterality unstable; tumour withheld on follow-up; false "acute infarct" |
| Brain MRI / CT, healthy samples | 2 volumes | 0 | False "acute infarct" (MRI); 18 false lesions on a normal head CT |
| Abdominal CT (liver, kidney) | 2 cases | 0 | Liver metastases called normal; kidney read is noise |
| Prostate MRI | 1 case | n/a | Incomplete (daily read limit); 1 slice read, normal |

---

## 3. Case by case

### 3.1 Chest X-ray: ChestX-Det

**Source.** ChestX-Det (NIH ChestX-ray14 films re-annotated by three radiologists with 13 classes and boxes; Apache-2.0), Hugging Face dataset `MedOtter/ChestX-Det`, fetched by `benchmark/fetch.py chestxdet` into `benchmark/img/` with labels in `benchmark/manifest-cxd.json`. **Note the split column**: films marked `dev` are in our development split; do not count them as held out.

| Film | Split | Radiologist labels | Skanda V1 said | Issue |
| --- | --- | --- | --- | --- |
| cxd_41481 | test | Cardiomegaly | "Cardiomegaly", heart outlined, CTR ≈ 0.53 (24 s) | ✅ Correct |
| cxd_39473 | dev | No Finding | "No acute cardiopulmonary abnormality" (32 s) | ✅ Correct |
| cxd_69442 | dev | Pneumothorax | "Right upper zone consolidation" (significant) | ❌ Pneumothorax missed; wrong finding invented in the same zone |
| cxd_62109 | test | Mass | "No acute cardiopulmonary abnormality" | ❌ Mass missed |
| cxd_69046 | test | Effusion | Normal | ❌ Effusion missed |
| cxd_69521 | test | Nodule (4 boxes) | Normal | ❌ Nodules missed |
| cxd_56622 | test | Atelectasis | "Pleural effusion" | ❌ Wrong class (atelectasis → effusion) |
| cxd_45843 | dev | Emphysema | "Pleural effusion" | ❌ Wrong class; emphysema never reported |
| cxd_60241 | test | Pleural Thickening | Bilateral effusion + bilateral mid-zone consolidation | ❌ Pleural thickening → effusion; extra consolidation |
| cxd_69408 | dev | Calcification | Normal | ❌ Calcification missed |
| cxd_60947 | dev | Diffuse Nodule | "Bilateral diffuse nodular opacities" + left effusion + bilateral upper-zone consolidation | ⚠️ Found, with three extra findings |
| cxd_45495 | dev | Consolidation, Effusion, Fracture, Pleural Thickening | "Pleural effusion" | ⚠️ 1 of 4 (fracture, consolidation, thickening missed) |
| cxd_59475 | dev | Cardiomegaly, Consolidation, Effusion | "Cardiomegaly" | ⚠️ 1 of 3 |
| cxd_57506 | dev | Consolidation, Fibrosis, Pleural Thickening, Pneumothorax | Same four-part impression as cxd_60947 | ⚠️ Consolidation only; **pneumothorax missed**; **identical text to a different film** |
| cxd_60881 | dev | No Finding | "Cardiomegaly" | ❌ False positive on a normal film |

Consistent with the stored scored run (run 2) per-class sensitivity: consolidation 69%, cardiomegaly 83%, effusion 63%, nodule 16%, mass 11%, pneumothorax 20%, atelectasis 9%, fracture 8%, fibrosis / calcification / emphysema 0%.

### 3.2 Chest CT: LIDC-IDRI (lung nodules marked by four radiologists)

**Source.** The Cancer Imaging Archive, collection **LIDC-IDRI** (CC BY 3.0). Downloaded through the NBIA API:
`https://services.cancerimagingarchive.net/nbia-api/services/v1/getImage?SeriesInstanceUID=<UID>`; nodule masks from the collection's DICOM-SEG series (`getSeries?Collection=LIDC-IDRI&PatientID=<ID>`).
**Preparation.** DICOM → NRRD (int16 HU, clipped to −1024…3071, LPS), a **35-slice block of the original 2.5 mm slices** centred on the nodules (to fit the browser upload tool); in-plane resolution unchanged.

**LIDC-IDRI-0001**: CT series `1.3.6.1.4.1.14519.5.2.1.6279.6001.179049373636438705059720603192` (133 slices, 0.703 mm, 2.5 mm), slices 73–107 used; SEG `1.2.276.0.7230010.3.1.3.0.89314.1553284067.990548`.

| Ground truth | Sampled slices through it | Skanda V1 | Issue |
| --- | --- | --- | --- |
| One nodule, **left** lower lobe posterior, ~24 mm, block slices 15–22 (largest 18; row 365, col 314 of 512) | 15, 17, 19, 21, 22 | 17 "lung nodule, left" ✅; 19 "lung tumour, left" ✅ **outline on the nodule**; 21 "lung tumour, left" ✅; 15 normal ❌; 22 "lung nodule, **right**" ❌ | Found on 3 of 5 slices; laterality flips on one adjacent slice |
| (no lesion) | 3, 7, 8, 10, 12, 35 | "Mediastinal lesion, right" ×3; "lung nodule" right/left; "lung tumour, right" | 6 unlabelled candidates |

**LIDC-IDRI-0003**: CT series `1.3.6.1.4.1.14519.5.2.1.6279.6001.170706757615202213033480003264` (140 slices, 0.82 mm, 2.5 mm), slices 51–85 used; four SEG series (one per nodule, first reader each).

| Ground truth (block slices) | Sampled | Skanda V1 | Issue |
| --- | --- | --- | --- |
| Nodule 1, left, 23 mm (13–20) | 14, 15, 17, 19 | 17 "lung nodule, left" ✅; 14, 15, 19 normal | Found on 1 of 4 slices |
| Nodule 2, left, 22 mm (23–29; row 351, col 367) | 24, 26, 28, 29 | All four "lung nodule/tumour, left" ✅; **outline on the nodule at 28** | Correct |
| Nodule 3, left, **8.7 mm** (33–34) | 33 | Normal | ❌ Missed |
| Nodule 4, **right**, **11.9 mm** (33–35) | 33, 35 | Normal | ❌ Missed |
| (no lesion) | 31 | "Mediastinal lesion, right" | Unlabelled candidate |

### 3.3 Chest CT: 3D Slicer CT-chest (no labels)

**Source.** 3D Slicer sample data `CTChest` (`CT-chest.nrrd`, `https://github.com/Slicer/SlicerTestingData/releases/download/SHA256/4507b664690840abb6cb9af2d919377ffc4ef75b167cb6fd0f747befdb12e38e`). Prepared as every 4th slice (35 slices, 10 mm), int16 HU.
**Result.** "Lung tumour, right lung" (slice 21) and "lung nodule, right lung" (26, 29), **none localized** (all withheld). A small posterior right-lower-lobe density exists on slice 21, but with no labels we cannot score it. **Issue:** text claims without a drawable location.

### 3.4 Brain MRI: 3D Slicer brain tumour (two scans of one patient)

**Source.** 3D Slicer sample data, CC-BY-SA 4.0:
`MRBrainTumor1` (`RegLib_C01_1.nrrd`, SHA256 `998cb522173839c78657f4bc0ea907cea09fd04e44601f17c82ea27927937b95`, 256×256×112) and `MRBrainTumor2` (`RegLib_C01_2.nrrd`, SHA256 `1a64f3f422eb3d1c9b093d1a18da354b13bcf307907c66317e2463ee530b7a97`, 256×256×130), from `https://github.com/Slicer/SlicerTestingData/releases/download/SHA256/<hash>`. Contrast-enhanced T1-type images; an enhancing, extra-axial (meningioma-like) mass beside the falx. Sequence and contrast were left "unknown" in the app (not stated in the file). **No voxel labels**: judged visually.

| Scan | Skanda V1 | Issue |
| --- | --- | --- |
| Tumour 1, 20 of 112 slices (1 min 46 s) | Slice 76 "extra-axial lesion, both hemispheres": **outline traces the tumour** ✅ (box loose; a second small outline posteriorly, likely a vein). Slices 71, 82, 87: "extra-axial lesion, right", "peritumoral oedema, right", "brain tumour, right" | Laterality inconsistent for one lesion (right / both); "brain tumour" on 87 withheld |
| | Slices 37, 48, 59: "acute ischaemic infarct" (left, right, right) | ❌ False infarcts; acute infarct is not assessable on this sequence |
| Tumour 2 (follow-up), 20 of 130 (1 min 46 s) | Slice 88 "peritumoral oedema, right; **non-enhancing** tumour, left" (text only, withheld); 95 "peritumoral oedema, right" | ❌ Tumour not localized; called non-enhancing although it enhances |
| | Localized regions: "acute ischaemic infarct, right" (69), "postoperative change, left" (101) | ❌ Both false |

### 3.5 Healthy / unlabelled samples (the app's built-in teaching volumes)

**Source.** 3D Slicer `MRHead` (`MR-head.nrrd`, SHA256 `cc211f0dfd9a05ca3841ce1141b292898b2dd2d3f08286affadf823a7e58df93`; donated healthy volunteer, sagittal acquisition) and `CTBrain` (`ct-brain.nrrd`, SHA256 `6a5b6caccb76576a863beb095e3bfb910c50ca78f4c9bf043aa42f976cfa53d1`; oblique axial head CT), both under `app/public/samples/`.

| Volume | Skanda V1 | Issue |
| --- | --- | --- |
| MR head, 20 of 256 axial (reformatted from sagittal), 1 min 17 s | 19 normal; slice 148 "acute ischaemic infarct, left cerebral hemisphere" with a box near the cavernous sinus / temporal region | ❌ False infarct on a healthy volunteer |
| CT head, 20 of 76, 2 min 57 s | 18 findings across nearly every slice, alternating "focal lesion, left" / "soft-tissue lesion, right" (e.g. "7 mm, 59 HU, surrounding 63 HU"); 9 withheld | ❌ Hallucinated lesions on a normal CT; scalp/soft tissue called lesions |

### 3.6 Abdominal CT: liver metastases (TCIA Colorectal-Liver-Metastases)

**Source.** TCIA collection **Colorectal-Liver-Metastases** (CC BY 4.0), case **CRLM-CT-1027**: CT series `1.3.6.1.4.1.14519.5.2.1.9203.8273.187405215983989324227505234366` (26 slices, 0.66 mm, **7.5 mm** thick), SEG `1.3.6.1.4.1.14519.5.2.1.9203.8273.877816149738667601011486853039` (liver, remnant, hepatic and portal veins, Tumor_1–3). All 26 slices, int16 HU.

| Ground truth | Skanda V1 (20 of 26, 1 min 41 s) | Issue |
| --- | --- | --- |
| Tumor_3: ~15 mm, right lobe, slices 7–9; Tumor_1/2: ~8 mm, left lobe, slices 16–17 | Every sampled slice "no focal abnormality" (slices 8, 9, 17 included) | ❌ Both metastases missed (no false positives) |

### 3.7 Abdominal CT: kidney tumour (TCIA C4KC-KiTS)

**Source.** TCIA collection **C4KC-KiTS** (CC BY 3.0), case **KiTS-00019**, late-phase CT series `1.3.6.1.4.1.14519.5.2.1.6919.4624.104676305843633157149888038227` (19 slices, 0.94 mm, 7.5 mm), SEG `1.2.276.0.7230010.3.1.3.0.74671.1588583498.840380` (kidney, mass).

| Ground truth | Skanda V1 (all 19 slices, 2 min 56 s) | Issue |
| --- | --- | --- |
| Renal mass, **left kidney**, ~15 mm, slices 12–13 | 18 of 19 slices flagged: "colonic tumour, right colon" (1–4, 8, 11), "abdominal lesion, left abdomen" (most others), "liver lesion, right" (15); 3 localized regions, **none on the tumour** | ❌ Not found; output is generic and repeated across slices |

### 3.8 Prostate MRI (TCIA QIN-PROSTATE-Repeatability), incomplete

**Source.** TCIA collection **QIN-PROSTATE-Repeatability** (CC BY 3.0), case **PCAMPMRI-00001**, T2-weighted axial series `1.3.6.1.4.1.14519.5.2.1.3671.4754.609837242670719860929372097937` (30 slices, 0.27 mm, 3 mm, slightly oblique), SEG `1.2.276.0.7230010.3.1.3.1426846371.20024.1513205119.698` (prostate, peripheral zone, lesion, normal ROI). Cropped to the central 400×400.
**Ground truth.** Lesion ~6.4 mm, **right peripheral zone**, slices 14–17.
**Result.** Stopped after 1 of 20 slices (normal) when the account reached its daily read limit. **Not yet assessed**; rerun pending.

---

## 4. Failure patterns (what to train against)

1. **Small lesions are missed.** Lung nodules ≤ 12 mm (0 of 2), liver metastases 8–15 mm (0 of 2), kidney mass 15 mm, CXR nodules/mass. Detection only worked on lesions ≥ ~20 mm with high contrast.
2. **Chest X-ray class coverage is narrow.** Reliable: cardiomegaly, consolidation, large effusion. Rarely or never: pneumothorax, nodule, mass, atelectasis, emphysema, fibrosis, calcification, fracture, pleural thickening. Pleural thickening and atelectasis are relabelled as effusion.
3. **False "acute ischaemic infarct" on MRI.** Seen on 3 of 4 brain MRI reads, including a healthy volunteer and on non-diffusion sequences. The model should not call acute infarct without DWI/ADC, and should say so.
4. **Hallucinated lesions on normal CT.** Normal head CT: 18 candidates; kidney CT: 18 of 19 slices flagged with generic "abdominal lesion" / "colonic tumour". Needs more normal CT slices (head, abdomen) as negatives.
5. **Laterality instability.** The same lesion is called left on one slice and right or "both" on the next (LIDC-0001 slice 22; MRBrainTumor1). Train with orientation-consistent labels and penalize flips across adjacent slices.
6. **Text without location.** Claims the source-consistency checks cannot draw (CT-chest, MRBrainTumor2, slice 87 of MRBrainTumor1). Findings should come with a box or outline, or be phrased as uncertain.
7. **Templated output.** Two different CXRs (cxd_60947, cxd_57506) received the identical four-part impression. Suggests mode collapse on multi-finding films.
8. **Out-of-distribution body regions.** Liver and kidney CT and prostate MRI are outside the training mix; the model either says normal or produces generic lesions instead of declining. It should decline unsupported regions (Skanda-V2 already does for unknown MRI).
9. **2D-only CT/MRI reading.** Each slice is read alone, so the same lesion is found on some slices and missed on its neighbours (LIDC-0003 nodule 1: 1 of 4). A series-aware read (V2's series path) should help.

## 5. Data that would address these

| Gap | Public, labelled sources (check licences) |
| --- | --- |
| Small lung nodules | LIDC-IDRI (all 1,018 cases; nodules ≥ 3 mm marked), LUNA16 |
| Liver lesions | TCIA Colorectal-Liver-Metastases (197 cases with SEG), MSD Task03 Liver, LiTS |
| Kidney tumours | C4KC-KiTS (210 with SEG), KiTS19/21 |
| Prostate MRI | QIN-PROSTATE-Repeatability, PROSTATEx, Prostate158 |
| Brain tumours (multi-sequence) | BraTS, UPENN-GBM (TCIA) |
| Stroke vs non-stroke MRI | SOOP / ISLES (DWI with masks) plus normal non-DWI scans as negatives |
| Normal CT negatives | Normal head and abdomen CT slices (e.g. CQ500 non-bleed, normal TCIA cases) |
| CXR classes | ChestX-Det (keep `test` held out), VinDr-CXR, NIH ChestX-ray14 boxes, SIIM pneumothorax |

## 6. Reproducing these cases

- X-rays: `cd benchmark && python3 fetch.py chestxdet` (films land in `benchmark/img/`).
- TCIA: `curl "https://services.cancerimagingarchive.net/nbia-api/services/v1/getImage?SeriesInstanceUID=<UID>" -o series.zip` for each CT/MR and SEG UID above; convert DICOM → NRRD (int16, LPS, spacing and origin from the DICOM headers), and crop or select slices as described per case.
- Slicer volumes: download from the SHA256 URLs above and verify the hash.
- In RadGenis: Open NRRD volume → Acquisition (modality, body region, HU for CT) → Review → Analyze volume.

---

## 7. Prompt for the training team

> We tested Skanda V1 (run 4b) live on 25 public cases on November 28, 2026 (full record above). Please use these findings to plan the next checkpoint's data and evaluation:
>
> 1. **Small lesions:** add LIDC-IDRI nodules ≤ 12 mm, liver metastases (CRLM, LiTS) and kidney tumours (KiTS) with masks. V1 found only lesions ≥ ~20 mm.
> 2. **Chest X-ray classes:** raise pneumothorax, nodule, mass, atelectasis, emphysema, fibrosis, calcification, fracture and pleural thickening (all ≤ 20% in V1). Stop mapping thickening and atelectasis to effusion. Keep ChestX-Det `test` held out.
> 3. **No acute infarct without DWI:** train negatives on non-DWI brain MRI and healthy volunteers. When diffusion is absent, the model should state that acute infarct cannot be assessed.
> 4. **Normal CT negatives:** add normal head and abdominal CT slices to cut hallucinated "focal lesion", "abdominal lesion" and "colonic tumour" calls.
> 5. **Laterality:** enforce patient-left/right consistency across adjacent slices; penalize flips.
> 6. **Every finding localized** (box or outline) or explicitly uncertain; no unlocatable claims.
> 7. **Decline unsupported regions** (e.g. kidney, liver, prostate until trained) instead of inventing generic lesions.
> 8. **Avoid templated impressions** on multi-finding films.
>
> Evaluation: rerun exactly these cases (IDs, UIDs and preparation listed in sections 3 and 6) and report per-lesion found/missed, laterality, and false positives per volume, side by side with V1.
