# Skanda Radiology: observed faults in labeled CT and MRI testing

Evaluation date: 2 November 2026 (Asia/Kolkata). Application baseline: `ae049e4`.
Model exposed by the running LM Studio server: `skanda-grounding-q3-mixed`.

## Executive finding

The application can display the selected volumes and obtain slice-level model responses, but this test does **not** demonstrate reliable lesion localization or segmentation. The model described lesions on all six selected reference-positive slices. Five of their six returned boxes had **zero overlap** with the reference masks. The remaining MRI box had box-to-mask IoU **0.073908**, covering only **53.61%** of the reference region while including extensive unrelated tissue. A liver-lesion claim was also returned on the reference-negative CT slice.

The consistency checks withheld several suspect overlays, but two MRI candidates passed those checks despite poor or absent reference overlap. Passing the checks must not be presented as confirmation of disease or a validated location.

This report records observed failures and proposed remediation. **It does not claim that the faults have been fixed.** The commit containing this report adds evidence and evaluation tooling; it does not change the reader model, prompts, viewer, or validation behavior.

## Evidence and test scope

- [Per-slice scores](../../benchmark/volume-validation/scores.json)
- [Actual application outputs, labels and timestamps](../../benchmark/volume-validation/app-results.json)
- [Interactive visual review](../../benchmark/volume-validation/review.html) (open locally; GitHub shows HTML source)
- [Selection manifest, geometry and hashes](../../benchmark/volume-validation/manifest.json)
- [Data provenance and annotation definitions](../../benchmark/volume-validation/provenance.json)
- [Excluded exploratory pass](../../benchmark/volume-validation/first-pass-results.json)
- [Reproduction instructions](../../benchmark/volume-validation/README.md)

| Item | CT | MRI |
| --- | --- | --- |
| Source | Medical Segmentation Decathlon Task03 Liver / LiTS | BraTS 2023 Adult Glioma |
| Case | `liver_0` | `BraTS-GLI-00000-000` |
| Dimensions | 512 × 512 × 75 | 240 × 240 × 155 |
| Input | Axial grayscale CT slices | Axial T1 post-contrast slices (`t1c`) |
| Display window | W400 / L50 | W5574 / L2787 |
| Positive slices, one-based | 59, 60, 70 | 61, 75, 85 |
| Reference-negative slice | 56 | 97 |
| Target | Label 2: liver tumor | Union of labels 1, 2, 3: tumor-associated regions, including edema |

The image and mask dimensions and affines matched. Native integer voxel values were preserved when converting NIfTI to scalar NRRD, with RAS-to-LPS coordinate conversion and no resampling. Reference masks were kept out of model inputs. Slice selection was fixed before inference using reference extent and peak area; it was not random sampling. The same app analysis button and connection were used for each slice. Final request and result labels were asserted to match the intended slice on all eight tests.

Only **4/75 CT slices** and **4/155 MRI slices** were tested in this final evaluation. No full-volume assessment, multi-sequence MRI assessment, or whole-lesion 3D segmentation was completed. Both are public training cases; overlap with the model's training data is unknown. A reference-negative slice has no annotated target, not necessarily no disease of any kind. No sensitivity, specificity, clinical accuracy, or generalization claim is justified by these cases.

## Final per-slice results

Boxes were scored exactly as normalized by the application. Coordinates were not swapped, moved, enlarged, or otherwise corrected after seeing the reference. Pixel boxes use floor for the start and ceil for the end, clipped to image extent. IoU is intersection divided by union of the raw candidate-box pixels and the reference-mask pixels. This is **not segmentation Dice**, and boxes inherently include tissue outside a lesion.

| Modality / slice | Reference target | Model response | Reference pixels | Intersection pixels | Box-mask IoU | App flagged |
| --- | --- | --- | ---: | ---: | ---: | --- |
| CT 59 | Present | Focal liver lesion | 538 | 0 | 0 | Yes |
| CT 60 | Present | Liver tumor | 377 | 0 | 0 | Yes |
| CT 70 | Present | Liver lesion | 136 | 0 | 0 | Yes |
| CT 56 | Absent | Liver lesion | 0 | 0 | 0 | Yes |
| MRI 61 | Present | Focal cerebral lesion | 1,414 | 758 | 0.073908 | No |
| MRI 75 | Present | Focal cerebral lesion | 1,978 | 0 | 0 | Yes |
| MRI 85 | Present | Focal cerebral lesion | 1,298 | 0 | 0 | No |
| MRI 97 | Absent | No focal abnormality | 0 | 0 | Not applicable: no box | No |

All eight final responses produced readable application results; none was marked truncated. This shows successful response handling on these requests, not medical correctness.

## Fault register

Severity describes the potential effect on interpretation, not a quantified clinical risk estimate. **Critical** means the output could materially misdirect interpretation if accepted; **high** means an important reliability or workflow gap; **medium** means an evaluation, presentation, or traceability limitation.

### F01. Incorrect lesion localization despite plausible finding names

**Severity: Critical. Confirmed.**

CT 59, 60 and 70 each received a liver-lesion description, but none of the three candidate boxes overlapped a reference tumor pixel. MRI 75 and 85 also had zero overlap. Describing the correct organ or a plausible abnormality is therefore insufficient evidence that the system detected the annotated lesion.

- [CT 59 comparison](../../benchmark/volume-validation/ct-59-comparison.png)
- [CT 60 comparison](../../benchmark/volume-validation/ct-60-comparison.png)
- [CT 70 comparison](../../benchmark/volume-validation/ct-70-comparison.png)
- [MRI 75 comparison](../../benchmark/volume-validation/mri-75-comparison.png)
- [MRI 85 comparison](../../benchmark/volume-validation/mri-85-comparison.png)

**Impact:** a radiologist could inspect the wrong tissue, accept an incorrectly placed marker, or mistake a generic description for a localized detection. Projecting the same coordinates into other views or 3D would preserve the error.

**Cause status:** poor grounding is observed; its internal cause is not established. A coordinate-convention mismatch, model behavior, prompt adherence, or preprocessing mismatch requires separate investigation. The application requests `[ymin,xmin,ymax,xmax]` on a 0–1000 scale. There is no basis here for silently swapping axes to improve scores.

**Proposed fix and acceptance criteria:** trace source pixels, request image, raw coordinates, parser normalization and final screen coordinates end to end. Add an asymmetric geometry fixture with known coordinates and verify matching 2D, multiplanar and 3D positions. Evaluate subsequent model/prompt changes on a separately selected labeled set. Preserve the current failures as regression cases and publish misses, not just successful examples.

### F02. Overbroad MRI candidate with weak overlap

**Severity: High. Confirmed.**

MRI 61 returned a 9,600-pixel box. It intersected 758 of 1,414 reference pixels: 53.61% reference coverage, but box-mask IoU only 0.073908. The box contains 8,842 pixels outside the target and misses 656 target pixels. Its confidence was 0.85, and the app attached no validation issues.

[View MRI 61 comparison](../../benchmark/volume-validation/mri-61-comparison.png).

**Impact:** a visually large box can imply useful localization while including mostly unrelated tissue and omitting part of the annotated region. It is unsuitable as a lesion boundary, volume estimate or segmentation.

**Proposed fix and acceptance criteria:** keep boxes labeled as candidate locations. Require an actual mask-producing method before offering segmentation, lesion volume or boundary measurements. Evaluate box coverage and false-positive area separately; do not turn partial overlap into a pass without a predeclared task-specific rule.

### F03. CT lesion claim on a slice without an annotated tumor

**Severity: Critical. Confirmed relative to the reference annotation.**

CT 56 has zero liver-tumor pixels in its reference mask. The model nevertheless reported a liver lesion with confidence 0.8. Its box was almost entirely in display background and was flagged by the app. This is a false-positive target claim under the supplied annotation, not independent proof that every structure on the slice is healthy.

[View CT 56 comparison](../../benchmark/volume-validation/ct-56-comparison.png).

**Impact:** unnecessary findings and review work; a risk of reporting a target unsupported by the reference.

**Proposed fix and acceptance criteria:** include reference-negative slices and independently labeled negative cases in evaluation, not just positive lesion examples. Track false-positive findings per slice and per study. Retain background rejection, but do not rely on it to catch incorrect boxes that fall inside anatomy.

### F04. Unsupported quantitative claims

**Severity: Critical. Confirmed.**

The model was supplied a rendered image, not a calibrated measurement tool, HU sampling tool, ADC map, or reference segmentation. Final responses nevertheless contained:

| Slice | Unsupported output |
| --- | --- |
| CT 59 | Approximately 23 mm lesion size |
| CT 60 | Approximately 19 mm size and mean attenuation 54 HU |
| CT 70 | Approximately 12 mm size and an inferred non-contrast characterization |
| CT 56 | Approximately 27 mm size and approximately four separate areas |
| MRI 61 | Approximately 13% involvement plus “58 of 100” non-background brain-mask pixels, although no brain mask was supplied |
| MRI 75 | Mean ADC 1370 mm²/s and approximately 84 mm size from a T1 post-contrast image; no ADC image was supplied |
| MRI 85 | Approximately 10% brain-parenchyma involvement without a supplied segmentation |

MRI 61's 13% statement and 58-of-100 statement are not arithmetically consistent if interpreted as the same quantity. Their precise denominator is also unclear. The report should not convert either claim into a computed fact.

**Impact:** invented measurements may appear more authoritative than qualitative descriptions and could contaminate downstream reports or follow-up comparisons.

**Current protection:** the size regex flagged the CT findings and MRI 75. It does not explicitly validate HU, ADC, percentages or fabricated mask counts; MRI 61 and 85 passed.

**Proposed fix and acceptance criteria:** derive quantitative outputs through calibrated image/geometry tools and attach their provenance. Reject or clearly mark unsupported quantitative claims in every output field. Test HU, ADC, percentage, pixel-count and physical-size examples independently, including descriptions without an accompanying mm/cm value.

### F05. Passing consistency checks can leave an incorrect finding visible

**Severity: Critical. Confirmed.**

MRI 85 had zero reference overlap and no validation issues. MRI 61 had weak overlap, unsupported percentage/mask-count language, and no validation issues. The checks in `app/src/lib/volumeValidation.ts` inspect selected language patterns, coordinate bounds, visible context and border-connected background; they do not test whether a box encloses the disease.

**Impact:** “not flagged” may be mistaken for “verified.” A wrong location inside anatomy can pass the current rules.

**Proposed fix and acceptance criteria:** show validation status separately from clinical review status. Never auto-accept a candidate because the rule list is empty. Require an explicit human decision for reporting. Add regression examples demonstrating that a valid in-bounds box may still be a wrong finding, and verify that the UI does not label it clinically validated.

### F06. Acquisition metadata is not represented sufficiently in the validation path

**Severity: High. Confirmed implementation limitation.**

The test source explicitly identified a T1 post-contrast MRI sequence in the volume title. MRI 75 was nevertheless flagged for inferring sequence or contrast without acquisition metadata. `findingIssues` receives text and pixels, not structured acquisition context, so it cannot distinguish known metadata from an unsupported inference. Conversely, its regex does not cover all enhancement-related wording: MRI 61's enhancement language passed.

The NRRD upload control also initially assigns modality `Volume`. The test harness explicitly set CT/MRI source metadata and a display window after upload; an ordinary upload does not supply the same structured modality selection through that control.

**Impact:** correct contextual statements can be flagged while unsupported variants pass. Generic uploaded volumes may enter the wrong prompt context unless modality is supplied elsewhere.

**Proposed fix and acceptance criteria:** collect and persist modality, sequence, contrast status and their source separately from the display title. Pass that context to the prompt and validator. Verify that known T1 post-contrast context is allowed, unknown context is marked uncertain, and an ADC claim cannot be justified by T1 metadata. Provide an explicit modality choice for imported NRRD volumes.

### F07. Laterality and location descriptions can conflict

**Severity: High. Confirmed in text; comprehensive laterality scoring not performed.**

MRI 61 and 75 describe the left cerebral hemisphere with wording such as “midline to right” or “midline right.” MRI 85 describes a right-hemisphere lesion while its reference region is on the opposite displayed side under the checked axial orientation. Its box also has zero target overlap. These contradictions must not be corrected by relabeling the source image to fit the model.

**Impact:** inconsistent laterality can misdirect review and carry into a report even when the viewer's orientation labels are correct.

**Proposed fix and acceptance criteria:** retain patient-coordinate provenance for every region and validate text laterality against its position when the anatomy/task supports that check. Add asymmetric left/right test fixtures and clinical reference cases. Report ambiguity instead of automatically rewriting unsupported text.

### F08. High self-reported confidence did not predict localization quality

**Severity: High. Confirmed.**

The zero-overlap CT boxes carried confidence 0.8–0.85. MRI 75 had confidence 0.95 despite zero reference overlap and unsupported ADC/size claims. MRI 85 had confidence 0.85 despite a missed reference region. These are model-generated estimates, not empirically calibrated probabilities of a correct lesion location.

**Impact:** a prominent percentage could encourage acceptance of a poor candidate.

**Proposed fix and acceptance criteria:** identify the confidence source and calibration status in the UI. Do not use these values as diagnostic probabilities or automatic report thresholds. Assess calibration on independent labeled data separately for finding classification and localization before using it operationally.

### F09. Source-slice drift invalidated part of the exploratory run

**Severity: High. Confirmed observation; root cause unresolved.**

In the exploratory pass, the intended MRI 85 record actually contained a result for axial 15. Its displayed slice had moved to 1 by capture. The intended MRI 75 result was for 75, but the displayed slice had moved to 141. The app did display a stale-result warning, which was useful. The cause of the unexpected navigation was not established; automation, focus, scrolling, asynchronous UI state and viewer interaction remain possibilities.

All eight cases were repeated. The final run checked the request label before analysis and the result label after analysis, matched both to the intended index, removed input focus, and returned the viewer to that slice before capture. Only this identity-checked final run is scored.

**Impact:** without source identity, a correct interpretation of one image can be incorrectly scored or shown against another image.

**Proposed fix and acceptance criteria:** bind the result to immutable volume fingerprint, plane, voxel index, window and request-image hash. Keep an always-visible source-slice return control and stale-result state. Reproduce the navigation issue under scroll, input focus, cine, 3D navigation and delayed response conditions; do not declare it fixed solely because the guarded test completed.

### F10. Test-harness failures initially weakened evidence capture

**Severity: Medium. Confirmed and mitigated for this final run.**

- A Playwright wait used the options object in the wrong argument position, leaving a 30-second default timeout. The first CT response took about 64 seconds in the exploratory run.
- `.volume-analysis` selected both whole-volume and single-slice sections. It was replaced with the specific “Slice abnormality detection” region.
- React state capture initially missed some results. The final capture inspected current/alternate hook state and matched the stored result label to the displayed label.
- Some response-body captures failed. The final evidence includes the normalized application analysis and its raw model text for all eight cases; a network-capture error is not automatically a failed model response.
- The CLI can print `### Error` despite an otherwise successful process exit. The committed launcher treats that output as a failure.

**Remaining fragility:** React internals and Vite module URLs are implementation-dependent. Replace them with a supported, read-only result export or diagnostic interface. This report does not equate captured response labels with a cryptographic proof of request pixels; request-image hashing is a proposed next step.

### F11. Responses varied between runs and were not consistently strict JSON

**Severity: High for reproducibility; medium for formatting. Confirmed.**

The same MRI 61 case changed from a completely misplaced box in the exploratory pass to a large partially overlapping box in the final pass. CT box locations and quantitative text also changed. Several raw responses repeat JSON in fenced blocks; one exploratory MRI response contained multiple objects. The application's permissive parser produced a result, but parseability does not establish completeness, stability or correctness.

**Impact:** a single favorable rerun can conceal unreliable behavior; downstream tools may disagree about which object to use.

**Proposed fix and acceptance criteria:** preserve model artifact identity, generation settings, prompt version, source-image hash and raw response for each request. Evaluate repeated reads, including deterministic settings, and report dispersion rather than selecting the best answer. Use a strict output contract with explicit handling of duplicate or conflicting objects. Model alias alone does not identify the exact weights/quantization revision.

### F12. Boxes and linked views do not constitute 3D segmentation

**Severity: High. Confirmed scope limitation.**

The final CT/MRI outputs contain boxes, not validated per-pixel lesion masks. No full-volume analysis or adjacent-slice lesion reconstruction was evaluated. A 3D box projected from a single-slice candidate cannot establish lesion depth, extent or volume. Multiplanar screenshots confirm display capability, not clinical localization accuracy.

**Proposed fix and acceptance criteria:** distinguish a raw candidate box, a manually reviewed finding and a true segmentation in text, color legend and exports. Require per-voxel evidence across relevant slices before calculating lesion volume or displaying a surface as lesion segmentation. Evaluate spatial linking separately from detection correctness.

### F13. Earlier samples did not support a labeled correctness assessment

**Severity: Medium. Corrected in the revised presentation.**

The original CT sample had a single-slice response without expert reference annotation. The MRI sample had inconsistent findings and an incomplete review. Those samples supported a workflow demonstration, not a labeled correctness comparison. The revised video uses the labeled cases above, explicitly states the four-slice scope, and shows raw model boxes separately from reference contours.

The first video's dense evidence sidebar competed with the application's own sidebar, and its MRI contact sheet made individual errors difficult to inspect. The revised edit uses larger comparisons and reduced text. This is a **video-presentation change**, not an application UI overhaul. The remaining app UX and correctness faults listed here are still open.

## Context from the earlier X-ray check

The preceding X-ray case `cxd_69598` has reference categories atelectasis, consolidation, effusion and fibrosis in `benchmark/manifest-cxd.json`. The app reported atelectasis but omitted the other three categories and returned no usable reader box/mask. The visible auxiliary classifier heatmap was not a lesion segmentation. This was a match by category name, not verified laterality or localization. The X-ray check was not rerun during this CT/MRI evaluation and is not included in the eight-slice scores.

## Prioritized remediation plan

| Priority | Work item | Completion evidence |
| --- | --- | --- |
| P0 | Bind results to immutable source image and acquisition context | Request hash, volume identity, plane/index/window persisted; delayed-response and navigation regression checks |
| P0 | Diagnose coordinate/grounding errors | Known-coordinate fixture passes end to end; independent labeled localization results published without post-hoc box correction |
| P0 | Block unsupported quantitative outputs | HU, ADC, physical size, percentages and mask-count claims either tool-derived with provenance or marked unsupported across all output fields |
| P0 | Separate candidate, rule-check and human-review states | No “validated” implication from empty issue lists; explicit review required for final report |
| P1 | Persist modality/sequence/contrast metadata for imports | CT/MRI upload workflow carries structured context to prompt, validator and report |
| P1 | Introduce supported evaluation export | Raw text, normalized output, validation decisions and source identity export without React internals |
| P1 | Evaluate negative cases and repeated reads | Independent case-level split, false-positive results, localization metrics and repeatability analysis |
| P1 | Validate full-volume and multi-view behavior | Coverage accounting, acquisition-aware linking, mask-based evaluation and explicit incomplete-state handling |
| P2 | Improve display hierarchy and evidence navigation | Large source image, persistent source identity, accessible return-to-result control, readable warning details at desktop/mobile sizes |

## What this change validates

The evidence package checks all eight final request/result identities, preserves app output and raw model text, and provides deterministic offline box-to-mask scoring from the committed source slices and masks. Visual report checks confirmed that all comparison images loaded and the desktop layout had no horizontal overflow. The revised H.264/AAC video decoded without errors at 1920 × 1080, approximately 180 seconds.

These checks validate the **artifact and evaluation bookkeeping**. They do not resolve the model faults, prove full-volume correctness, or replace radiologist adjudication.

## Sources and attribution

CT source project: [Medical Segmentation Decathlon](https://medicaldecathlon.com/); downloaded from the [MedOtter MSD Liver mirror](https://huggingface.co/datasets/MedOtter/msd-liver), which declares CC-BY-SA-4.0. MRI source project: [BraTS 2023](https://www.synapse.org/Synapse:syn51156910/wiki/622351); downloaded from the [MedOtter BraTS 2023 GLI mirror](https://huggingface.co/datasets/MedOtter/brats2023-gli-dataset), which declares CC-BY-4.0. Source paths, case identifiers, hashes and annotation definitions are recorded in the provenance and manifest files. The committed images are derived display slices and reference comparisons; they are not generated anatomy.
