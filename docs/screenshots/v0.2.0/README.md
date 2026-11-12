# Workspace captures

All six captures were retaken November 12, 2026 from the running development application at `127.0.0.1:5173` (local browser-storage mode). System Chrome was driven headlessly through `playwright-core` at a 1920 x 1080 viewport, and the images were saved without editing. Focus was cleared before each capture so no tooltips or focus rings show.

- `ct-workspace.png`: CT brain teaching sample, axial slice 39/76 (default), optional panels collapsed.
- `ct-review.png`: same CT sample with the 3D locator and Review panel open.
- `mri-three-planes.png`: MRI head teaching sample in synchronized three-plane view.
- `study-workspace.png`: MRI three-plane workspace with the Studies sidebar open. The worklist is empty and the sample is not linked to a patient.

The model service was disconnected. No findings were generated for these captures. Sample provenance is recorded in `app/public/samples/provenance.json` at the repository root. These images show the application layout, not clinical validation or segmentation performance.

## X-ray captures

`xray-workspace.png` (1920 x 1080) and `xray-mobile.png` (400 x 792 CSS pixels at device pixel ratio 2, touch emulation, Viewer tab) show public ChestX-Det test image 36199. It was extracted from the official test split parquet in the MedOtter mirror (`data/test-0000*-of-00002.parquet`) and imported through the app's file chooser. Brightness and contrast are at their defaults. No inference was run. The empty patient context belongs to a local test study.

Image source SHA-256 (PNG bytes from the parquet): `05d2ace92b8569a78356fca61533fdea46402f94b2250e994d74f8c719b33351`. The November 10 captures used a copy fetched through the dataset API (`19e91d29…`), which re-encodes the image. Dataset: https://huggingface.co/datasets/MedOtter/ChestX-Det. See `docs/validation/2026-11-10-swarm-followup.md` for the earlier checks and limits.
