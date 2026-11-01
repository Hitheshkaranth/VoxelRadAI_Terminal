<div align="center">

<img src="docs/brand/skanda-banner.jpg" alt="Skanda" width="100%">

# Skanda Radiology

**An image-first workspace for X-ray, CT and MRI review.**

View the source image, navigate the volume, inspect model candidates, and keep review decisions tied to their evidence.

[Current interface](#current-interface) · [Radiologist workflow](#radiologist-workflow) · [Reading with Skanda](#reading-with-skanda-x-ray-ct-mri) · [Quick start](#quick-start) · [Evaluation](#evaluation) · [Development](#development)

</div>

![Current MRI workspace with a large axial image, synchronized coronal and sagittal views, a right-side 3D volume and slice-analysis results](benchmark/volume-validation/mri-multiplanar.png)

*Current application, captured during the November 2026 labeled-case evaluation. The MRI result shown is for axial slice 97 only. The three-plane viewer and 3D locator show navigation, not validated lesion segmentation.*

> **Research and review support.** Model findings require qualified review. In the latest targeted CT/MRI tests, five of six positive-slice boxes had zero overlap with their reference regions. [Read the detailed fault report](docs/validation/2026-11-02-labeled-case-failure-report.md). That test used a 3-bit GGUF build in LM Studio, which cannot draw outlines; with the Skanda server (bf16, outlines) the same MRI slices reach outline Dice 0.67–0.91, while CT tumour outlines remain poor. See [Reading with Skanda](#reading-with-skanda-x-ray-ct-mri).

## Current interface

The workspace now supports CT and MRI volume review alongside the X-ray workflow. Dark and light themes, a translucent material option, reading mode, and collapsible panels let the image take priority. The screenshots below show actual application states, including incomplete or flagged model output.

### X-ray: image and findings together

![Current X-ray viewer with findings, review actions and an auxiliary classifier heatmap](docs/screenshots/xray-current.png)

Select findings from the image or inspector, zoom to their locations, and accept or dismiss them. Box, outline and fill controls apply when the reader returns suitable coordinates or masks. Missing localization is disclosed. The colored heatmap is coarse **classifier evidence**, not a confirmed lesion boundary.

*Shown: ChestX-Det `cxd_69598`. This run reported atelectasis, matching one of four reference categories by name. It omitted consolidation, effusion and fibrosis and returned no usable reader box or outline.*

### CT: full slice with spatial context

![Labeled liver CT in the current application, with a large axial slice, 3D locator, slice navigation and a flagged single-slice result](benchmark/volume-validation/ct-59-app.png)

Keep the axial image large while using the right-side 3D volume to locate the plane. Browse slices with the slider, number field, previous/next buttons or cine playback. Show the review panel when needed, or collapse it for reading. The visible warning in this example identifies an unsupported model measurement; the candidate overlay is withheld.

### MRI: the same volume controls

CT and MRI share the same volume viewer: axial/coronal/sagittal selection, synchronized three-plane layout, crosshair navigation, windowing, fit/pan/zoom, review tools and the right-side 3D locator. A finding retains its source plane and slice; its candidate region can be projected into other views where it intersects the displayed plane.

The locator is reconstructed from the loaded volume's voxels. It is not a generic anatomical model. Click or touch the volume to navigate, drag to rotate, and use **Expand 3D** to enlarge it. This display uses reduced resolution; it does not establish the correctness of a finding or its extent across slices.

### Mobile: direct access to the reading task

<img src="docs/screenshots/mobile-volume-current.png" alt="Current mobile MRI viewer with slice controls and navigation to studies, viewer, findings and report" width="320">

The mobile layout provides **Studies**, **Viewer**, **Findings** and **Report** navigation, with a direct **Analyze & findings** action for volumes. This gives findings and analysis a dedicated screen instead of squeezing every desktop panel beside the image. The screenshot shows the built-in public MRI sample before analysis.

## Radiologist workflow

### What was added for easier access

| Reading task | Current UI access | Practical benefit |
| --- | --- | --- |
| Find the right study | Search by patient, ID or study; All / Review / Signed filters; recent or AI-priority sorting | Locate studies without scanning the entire list. AI priority remains a model-derived cue. |
| Keep the open volume in context | Open-volume entry in the worklist, patient-link state and volume identity details | Distinguish a sample or unlinked volume from a patient study. |
| Give the scan more space | Reading mode, collapsible studies/review panels, fit controls and maximizable plane views | Reduce surrounding controls while inspecting anatomy. |
| Keep CT and MRI behavior consistent | Shared volume toolbar and review components | Use the same navigation and review actions across both modalities. |
| Move between anatomical planes | Axial / Coronal / Sagittal controls, Three planes layout and synchronized crosshairs | Inspect the same position without manually searching each plane. |
| Understand the slice position | Right-side voxel-derived 3D locator, touch navigation and Expand 3D | Relate the displayed plane to the loaded volume. |
| Inspect a candidate at its source | Finding selection with source plane/slice navigation and linked locations | Return to the image supporting the model claim. Spatial linking does not validate that claim. |
| Work through pending findings | Review actions, pending-finding navigation and keyboard shortcuts | Keep the review sequence explicit. |
| See analysis coverage | Volume jobs, completed/total slice counts, progress, pause/resume and failed-read status | Distinguish partial work from completed coverage. |
| Inspect anatomy beneath overlays | Overlay visibility/opacity controls; hold Alt in the volume viewer | Compare a candidate with the unobscured source image. |
| Prepare a volume draft | Draft from accepted findings, source-evidence navigation, stale-draft warnings and text export | Keep the draft tied to reviewed evidence and current coverage. |
| Continue on a small screen | Dedicated mobile navigation and Analyze & findings action | Reach the reading task without a crowded desktop sidebar. |

### X-ray review

1. Create a study and enter its patient/context information.
2. Drop, paste or select an image. Supported intake includes PNG, JPEG, WebP and supported uncompressed DICOM.
3. Confirm the model connection and image type, then run **Analyze Image**.
4. Review each finding against the source. Inspect any available classifier evidence separately from the reader's location.
5. Accept or dismiss findings, then draft and edit the report. The image-study workflow includes print/PDF and structured exports, signing checks and an amendment trail.

### CT and MRI review

1. Open a built-in CT/MRI sample or choose **Open NRRD volume…**. Imported NRRD files initially receive generic `Volume` metadata; the ordinary upload control does not yet collect structured modality, sequence and contrast information. This is a [documented gap](docs/validation/2026-11-02-labeled-case-failure-report.md#f06-acquisition-metadata-is-not-represented-sufficiently-in-the-validation-path).
2. Set the viewing window and use a single plane or **Three planes**. Keep the source plane/index visible while browsing.
3. Use **Analyze volume** for the acquired-slice review job, or expand **Analyze current slice only** for a single-image request. These have different scopes.
4. Check coverage and errors, then inspect each candidate at its source. Rule-flagged claims remain available for audit, with overlays/report acceptance restricted.
5. Create a draft from accepted findings. Marking a volume draft reviewed requires completed coverage, resolved finding review and an up-to-date draft. A reviewed volume draft remains **unsigned**; it is distinct from the image-study signing workflow.

Volume analysis sends acquired slices as individual requests at the selected display window. It is not a native whole-volume inference or validated 3D segmentation model.

### Volume reading shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play / pause slices |
| `F` | Fit the full image |
| `P` / `W` | Pan / window tool |
| `M` | Single / three-plane layout |
| `H` | Toggle overlays |
| Hold `Alt` | Temporarily hide overlays |
| `J` / `K` | Next / previous pending finding |
| `A` / `R` | Accept / reject the selected finding |
| `?` | Show shortcuts |

Shortcuts are context-specific: for example, `M` in the X-ray viewer cycles overlay styles. Text inputs retain their normal editing behavior. See the on-screen shortcut help for the active viewer.

## Reading with Skanda (X-ray, CT, MRI)

[Skanda](https://github.com/Hitheshkaranth/skanda-grounding) is our own reader. It writes the report and draws an
**outline for each finding**, and its server measures sizes and HU from those outlines. The app treats any model whose
name starts with `skanda-` as Skanda. For X-ray it then sends Skanda's own prompt. For CT and MRI it sends the slice the
way Skanda was trained to see it: axial, native pixel grid, CT as lung / soft-tissue / bone windows plus raw HU and the
pixel spacing.

<a href="docs/skanda-demo.mp4"><img src="docs/skanda-demo.gif" alt="71-second recording of the app with the Skanda server (run 3): an X-ray read, then two liver CT slices and two brain MRI slices from the labeled-case report, analysed one slice at a time" width="100%"></a>

<sub>Recorded from this app on 2 Nov 2026 with the Skanda server, run 3 checkpoint, bf16 (GIF at 1.5× speed;
<a href="docs/skanda-demo.mp4">MP4</a>). It shows the X-ray film from the failure report, then CT and MRI slices from
the same report (MSD liver_0 and BraTS-GLI-00000-000).</sub>

### Which build to run

| Build | Precision | Memory | Outlines | X-ray | CT / MRI |
|---|---|---|---|---|---|
| **Skanda server** (`skanda/serve.py`, weights in the private Hugging Face repo [`hitheshkaranth/skanda-grounding`](https://huggingface.co/hitheshkaranth/skanda-grounding)) | **bf16, not quantised** | ~68 GB while reading, ~93 GB peak (measured on a DGX Spark, 128 GB unified) | ✅ one per finding | ✅ | ✅ with Skanda's native input, measured sizes and HU |
| GGUF in LM Studio (e.g. `skanda-grounding-q3-mixed`, 3-bit mixed) | Q3 | – | ❌ LM Studio cannot run Skanda's outline model (SAM 2) | names only, no locations | **boxes removed**: it writes coordinates Skanda was never trained to produce |
| FP8 / INT4 Skanda server | planned | ~38 / ~24 GB (estimated) | ✅ | not built or benchmarked yet | not built or benchmarked yet |

```sh
# on the GPU machine, in skanda-grounding (stop other large models first)
hf download hitheshkaranth/skanda-grounding --local-dir models/skanda-r3          # main = run 3 (59 GB)
run/serve_skanda.sh models/skanda-r3 skanda-grounding-run3                       # http://localhost:1234
```

Then set **Settings → model** to `skanda-grounding-run3`. The default base URL `/lmstudio/v1` reaches port 1234 through
the dev server's proxy. On another machine, use `http://<gpu host>:1234/v1`.

### What it does on the failure report's cases

The [labeled-case failure report](docs/validation/2026-11-02-labeled-case-failure-report.md) tested the 3-bit GGUF in
LM Studio with the generic box prompt. We repeated the same films and slices with the Skanda server (run 3), using the
same pixels and reference masks, and scored them the same way. Outline Dice compares Skanda's outline with the
radiologist mask; the GGUF draws no outline, so it has no Dice.

| Case | Reference | GGUF in LM Studio (report) | Skanda server, run 3 |
|---|---|---|---|
| X-ray `cxd_69598` | atelectasis, consolidation, effusion, fibrosis | atelectasis; no box or outline | consolidation; **not localised** (no outline). In the app benchmark's first pass on the same film: effusion and consolidation on both sides, with boxes |
| CT 59 / 60 / 70 (liver tumour) | tumour | lesion named; box IoU 0 / 0 / 0 | lesion named in the right liver; outline Dice 0.14 / 0.20 / 0.01, because the outline follows enhanced vessels. On 59 and 60 the server **withholds** the outline (brighter than the tissue around it although the text says hypoattenuating) |
| CT 56 | no tumour | false liver lesion | **normal** ✓ |
| MRI 61 / 75 / 85 (glioma) | tumour | box IoU 0.07 / 0 / 0; sides contradictory | outline Dice **0.91 / 0.84 / 0.67**; left hemisphere every time ✓; oedema, non-enhancing and enhancing tumour named separately |
| MRI 97 | no tumour | normal | normal ✓ |

<table>
<tr>
<td width="33%"><img src="docs/screenshots/skanda-mri.png" alt="Brain MRI T1 post-contrast, axial 75: three Skanda regions (enhancing tumour, non-enhancing tumour, peritumoral oedema) boxed over the left frontal tumour"></td>
<td width="33%"><img src="docs/screenshots/skanda-ct-withheld.png" alt="Liver CT axial 59: no candidate regions shown, because the server withheld an outline that followed enhanced vessels"></td>
<td width="33%"><img src="docs/screenshots/skanda-xray.png" alt="Chest X-ray cxd_69598: Skanda reports consolidation without a location"></td>
</tr>
<tr>
<td><sub>MRI 75: three regions from Skanda's outlines, on the tumour and on the correct side.</sub></td>
<td><sub>CT 59: the outline followed vessels, so the server withheld it and the panel says why.</sub></td>
<td><sub>X-ray: consolidation found, but no outline (run 3 omits the outline token on about 1 in 5 X-ray findings). The amber note is the optional TorchXRayVision cross-check, which was not running.</sub></td>
</tr>
</table>

<details>
<summary><b>Reference vs Skanda outlines (re-run images)</b></summary>

Each panel shows the slice, then the radiologist reference (green), then Skanda's outline (orange) and box (blue).
Scores: [`docs/validation/skanda-rerun/results.json`](docs/validation/skanda-rerun/results.json).

<img src="docs/validation/skanda-rerun/mri-75.png" alt="MRI 75: reference tumour and Skanda outline overlap closely" width="49%"> <img src="docs/validation/skanda-rerun/mri-61.png" alt="MRI 61: Skanda outline matches the reference (Dice 0.91)" width="49%">
<img src="docs/validation/skanda-rerun/ct-59.png" alt="CT 59: reference tumour is a small dark region; Skanda's outline is scattered over bright vessels" width="100%">
</details>

**Still open:**
- **X-ray outlines:** run 3 leaves out the outline token on about 21% of X-ray findings. Run 4, training now, keeps it on every finding.
- **CT tumour outlines:** run 4 adds real liver-tumour outlines from CRLM and HCC-TACE-Seg.
- **Single MRI sequences:** Skanda was trained on FLAIR, T1 post-contrast and T2 together. The server rewrites claims about sequences that weren't sent, and the result says the read is outside its training data.
- **Uploaded NRRD volumes:** they open as modality "Volume", and Skanda needs CT or MRI (report fault F06).

## Quick start

The app connects to a separately hosted vision-language model. Model weights are not bundled with this repository. The current default model identifier is **`skanda-grounding-q3-mixed`**, a 3-bit GGUF build used for the labeled CT/MRI tests. It cannot draw outlines, so for outlines, measured sizes and CT/MRI reads use the bf16 Skanda server ([Reading with Skanda](#reading-with-skanda-x-ray-ct-mri)). A model alias does not identify an exact weight revision or guarantee modality performance.

### 1. Start the model server

**Skanda server (recommended; outlines, bf16, ~68 GB):** see [which build to run](#which-build-to-run). It also serves port **1234**, as model `skanda-grounding-run3`.

**LM Studio:** load your installed compatible vision model and start its API server on port **1234**. Check the available identifiers:

```sh
curl http://localhost:1234/v1/models
```

In the app's **Settings**, use the exact served model ID. With the default Vite proxy, the base URL is `/lmstudio/v1`. Selecting an identifier in Settings does not download or load its weights.

### 2. Start the app

Use Node.js 24+ for the development and TypeScript test commands documented here.

```sh
git clone https://github.com/Hitheshkaranth/skanda-radiology.git
cd skanda-radiology/app
npm ci
npm run dev
```

Open **http://localhost:5173** and confirm that the connection status reads **Connected**. Memory requirements and latency depend on the model, quantization, context length and inference host; the interface alone does not determine them.

### 3. Optional X-ray services

The local TorchXRayVision service supplies chest-X-ray classifier evidence. It is not a CT/MRI validator. From a second terminal:

```sh
cd app
uv run --with torchxrayvision --with scikit-image server/txrv_server.py
```

MAIRA-2 is an optional chest-X-ray second reader, disabled by default. Its weights and service are separate from LM Studio. See [the service implementation](app/server/maira_server.py) and [historical benchmark documentation](benchmark/README.md) for its evaluated setup. Do not transfer its CXR results to CT or MRI.

### Common setup and reading issues

| Symptom | Check |
| --- | --- |
| Disconnected / model not loaded | Start the model server and match the Settings model ID to `/v1/models`. |
| Remote inference host | Configure the backend/proxy for that host; connecting Tailscale alone does not change the repository's localhost proxy target. |
| No overlay on a reported finding | The model may have returned no usable coordinates, or the app may have withheld a rule-flagged candidate. Inspect the finding explanation. |
| Result is for a different slice/window | Return to the result's source slice or analyze the current image. Do not interpret it against the new view. |
| Incomplete volume review | Inspect completed/total coverage and the failed-read reason before resuming. Incomplete coverage is not a normal result. |
| Unsupported compressed DICOM | Export a supported uncompressed image. The intake is not a general DICOM-series/PACS importer. |
| Whole-volume import needed | Use a supported scalar NRRD volume; NIfTI conversion was performed separately for the labeled evaluation. |

## Evaluation

### Latest labeled CT/MRI check

One labeled case per modality, with three target-positive and one target-negative axial slice selected before inference. Reference masks were not sent to the model.

| Case | Observed result |
| --- | --- |
| CT liver (`liver_0`) | Lesion descriptions on all three positive slices, but all three boxes missed the reference tumors. A lesion was also reported on the reference-negative slice. |
| MRI brain (`BraTS-GLI-00000-000`) | Lesion descriptions on all three positive slices. One box partially overlapped the reference region (box-mask IoU 0.074); two had zero overlap. No abnormality was reported on the reference-negative slice. |

**Re-run on the Skanda server (run 3, bf16):** CT tumour outlines still followed vessels (Dice 0.14 / 0.20 / 0.01; two of the three are now withheld by a consistency check), the CT negative slice became normal, and the MRI outlines reached Dice 0.91 / 0.84 / 0.67 with the correct side. Details: [Reading with Skanda](#reading-with-skanda-x-ray-ct-mri).

**Four selected slices per case are not full-volume validation.** These public training cases have unknown overlap with the reader's training data. Rule checks caught some unsupported claims, but incorrect locations also passed. Self-reported confidence was not a reliable localization score.

- [Detailed report: 13 observed fault categories and remediation criteria](docs/validation/2026-11-02-labeled-case-failure-report.md)
- [Saved outputs, reference comparisons and reproduction instructions](benchmark/volume-validation/README.md)
- [Machine-readable scores](benchmark/volume-validation/scores.json)
- [Historical CXR benchmarks and model comparisons](benchmark/README.md)

The historical CXR results involve different reader versions and protocols. They are not performance claims for the current CT/MRI workflow. The revised narrated demo uses the latest labeled comparisons; its script and captions are in [the evidence package](benchmark/volume-validation/README.md). Rendered videos remain local under `output/`.

## Architecture and data handling

```mermaid
flowchart LR
    I[Images / scalar NRRD] --> V[Browser viewer]
    V --> M[Configured model server]
    M --> R[Parsed findings and consistency checks]
    R --> H[Human source review]
    H --> D[Draft and export]
    V --> C[Optional CXR classifier]
    C --> H
    V --> S[Browser IndexedDB]
```

| Component | Responsibility |
| --- | --- |
| [Viewer components](app/src/components/viewer) | X-ray viewer, volume navigation, three-plane views, 3D display and review panels |
| [Shell components](app/src/components/shell) | Worklist, study context, model connection, responsive navigation and settings |
| [Volume geometry](app/src/lib/volume.ts) | Scalar NRRD decoding, LPS coordinates and slice rendering |
| [Volume jobs](app/src/lib/volumeJobs.ts) | Acquired-slice review, persisted progress, bounded transient-error retries and review state |
| [Consistency checks](app/src/lib/volumeValidation.ts) | Limited context, background boxes and selected unsupported/contradictory claims |
| [Model client](app/src/lib/medgemma.ts) | Streaming requests, parsing, retries and modality-aware prompt selection |
| [Vite proxy](app/vite.config.ts) | `/lmstudio` → localhost:1234; `/txrv` → localhost:8765; `/maira` → localhost:8766 |

Studies and review state are stored in browser IndexedDB. Inference images are sent to the configured model/services. The default proxy targets local services; using another host changes where data travels. This is browser-local storage, not a hospital PACS, shared worklist service or managed clinical archive.

## Development

From `app/`:

```sh
npm test
npm run lint
npm run build
python3 server/test_servers.py
```

Verify the saved labeled-case evidence without running a model:

```sh
python3 -m venv benchmark/volume-validation/.venv
benchmark/volume-validation/.venv/bin/pip install -r benchmark/volume-validation/requirements.txt
benchmark/volume-validation/.venv/bin/python benchmark/volume-validation/verify.py
```

Run that block from the repository root. [Live evaluation instructions](benchmark/volume-validation/README.md#optional-live-reproduction) document the development-harness dependencies and limitations.

## Sample data and attribution

Built-in Slicer CT/MRI volumes are teaching/demo data, not expert-labeled validation cases. Their source URLs, geometry and hashes are recorded in [sample provenance](app/public/samples/provenance.json). The small pydicom fixtures exercise decoding; see [their attribution](app/public/samples/README.md).

The labeled evaluation uses MSD/LiTS liver CT and BraTS 2023 glioma MRI. Source links, mask definitions, hashes and mirror-declared licenses are recorded in [evaluation provenance](benchmark/volume-validation/provenance.json). Derived display slices and comparisons are committed for audit; full downloaded evaluation volumes are not. The X-ray screenshot uses ChestX-Det; see [the benchmark documentation](benchmark/README.md).
