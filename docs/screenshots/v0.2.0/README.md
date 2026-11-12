# Workspace captures

The four CT/MRI captures were retaken November 12, 2026 from the running development application at `127.0.0.1:5173` (local browser-storage mode). System Chrome was driven headlessly through `playwright-core` at a 1920 x 1080 viewport, and the images were saved without editing. Focus was cleared before each capture so no tooltips or focus rings show.

- `ct-workspace.png`: CT brain teaching sample, axial slice 39/76 (default), optional panels collapsed.
- `ct-review.png`: same CT sample with the 3D locator and Review panel open.
- `mri-three-planes.png`: MRI head teaching sample in synchronized three-plane view.
- `study-workspace.png`: MRI three-plane workspace with the Studies sidebar open. The worklist is empty and the sample is not linked to a patient.

The model service was disconnected. No findings were generated for these captures. Sample provenance is recorded in `app/public/samples/provenance.json` at the repository root. These images show the application layout, not clinical validation or segmentation performance.

## Swarm follow-up X-ray captures

`xray-workspace.png` and `xray-mobile.png` show public ChestX-Det test image 36199, downloaded through the MedOtter mirror's dataset API and imported with the native file picker. Desktop is 1920 x 1080; mobile is 400 x 792 CSS pixels at device pixel ratio 2, captured with Chrome's responsive screenshot action. Brightness and contrast were reset to 100 before capture. No inference was run. The empty patient context belongs to a local UI test study.

Image source SHA-256: `19e91d2913b615f8034914a02f51e65060688e65fabf3253c4ba76244ccaa001`. Dataset: https://huggingface.co/datasets/MedOtter/ChestX-Det. See `docs/validation/2026-11-10-swarm-followup.md` for checks and limits.
