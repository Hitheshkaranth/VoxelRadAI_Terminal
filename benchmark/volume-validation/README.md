# Labeled CT/MRI evaluation evidence

Start with the [detailed fault report](../../docs/validation/2026-11-02-labeled-case-failure-report.md). The saved result is a targeted eight-slice comparison of one CT and one MRI volume, not a clinical benchmark or full-volume analysis.

## Included evidence

- `app-results.json`: final application analyses, raw model text, request/result labels and timestamps. Some network-body captures contain errors; the application analysis is captured for all eight cases.
- `scores.json`: box-to-reference-mask overlap, target presence and app warning status.
- `manifest.json`, `provenance.json`: fixed selection, geometry, original hashes, source URLs and target definitions.
- `data/*.png`: unannotated display slices and binary reference masks in the same orientation. Reference masks were not sent to the model.
- `*-app.png`, `*-comparison.png`: actual UI captures and derived reference/model comparisons.
- `review.html`: expandable visual report; open locally or serve this directory.
- `first-pass-results.json`: excluded exploratory outputs, including the documented slice-identity mismatch. First-pass screenshots were superseded by final screenshots; do not pair these outputs with the final captures.
- `demo-narration.json`, `demo-captions.srt`: revised three-minute narration and approximate phrase captions. The rendered video and raw recordings remain local under `output/`, outside Git.

Source images retain their source attribution/license obligations. The CT mirror declares CC-BY-SA-4.0 and MRI mirror CC-BY-4.0; see `provenance.json` and the report. Comparisons are derived works from those public data, not generated anatomy.

## Offline verification and scoring

Use Python 3.11+ and a local virtual environment. From the repository root:

```sh
python3 -m venv benchmark/volume-validation/.venv
benchmark/volume-validation/.venv/bin/pip install -r benchmark/volume-validation/requirements.txt
benchmark/volume-validation/.venv/bin/python benchmark/volume-validation/verify.py
benchmark/volume-validation/.venv/bin/python benchmark/volume-validation/score.py
python3 benchmark/volume-validation/build_report.py
```

`verify.py` independently recomputes integer mask/box intersections from the committed slices and app-normalized coordinates, checks score consistency, and asserts all request/result slice identities. It does not run a clinical model. `score.py` regenerates comparison images and scores; it uses Arial on macOS or DejaVu Sans on Linux. Neither operation corrects model coordinates using the labels.

`normalized-results.json` uses the captured application analysis whenever available. To regenerate the normalization fallback with Node 24+:

```sh
node --experimental-strip-types benchmark/volume-validation/normalize.mts
```

The fallback uses the existing app parser; it is only needed if an analysis is absent but raw network text is available. Do not interpret a fallback as recovery of a missing clinical finding.

## Optional live reproduction

Live generation is nondeterministic and overwrites final artifacts in this directory. Use a separate checkout or copy to retain the published run. The exact model artifact revision and training overlap were not captured; the alias alone cannot guarantee identical weights.

1. Download the four source NIfTI files with `fetch_data.py`. It checks their SHA-256 hashes against the manifest. Downloaded NIfTI/NRRD data are ignored by Git.
2. Run `prepare.py` using the virtual environment. It asserts matching image/mask geometry, preserves native integer values, writes NRRD data, and recreates the fixed selection and rendered PNGs. MRI scaling is the 99th percentile of positive intensities; CT uses W400/L50.
3. Start the existing app with `npm run dev` in `app/`, with LM Studio serving `skanda-grounding-q3-mixed` via the existing proxy.
4. Open a `labeled-validation` browser session with the Playwright CLI wrapper. Then run `python3 benchmark/volume-validation/launch.py`.
5. Normalize, score and verify as above. Preserve any failed run instead of treating partial output as a complete evaluation.

```sh
benchmark/volume-validation/.venv/bin/python benchmark/volume-validation/fetch_data.py
benchmark/volume-validation/.venv/bin/python benchmark/volume-validation/prepare.py
bash "$HOME/.codex/skills/playwright/scripts/playwright_cli.sh" -s=labeled-validation open http://localhost:5173 --headed
python3 benchmark/volume-validation/launch.py
```

Set `PLAYWRIGHT_CLI` to a different wrapper path or `SKANDA_APP_URL` to a different app URL if needed. The harness loads NRRD files through the app upload control, then sets the correct modality/window through the live shell state because the upload control initially assigns generic `Volume`. It invokes the real single-slice analysis button, uses no mocked model response, and asserts the source labels. It depends on development-mode Vite module URLs and React state introspection; this is a known fragile evaluation harness, not a public automation API.

The final source request was checked by label, not by a captured request-image hash. Adding a supported image-hash/result export is an open item in the fault report.
