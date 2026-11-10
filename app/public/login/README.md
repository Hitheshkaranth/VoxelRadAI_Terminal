# Login imagery

The current login uses `ct-cine.mp4` and `ct-poster.webp`, derived from the existing public `samples/ct-brain.nrrd` volume. The video traverses all 76 native axial slices and reverses without duplicated endpoint frames: 150 frames, 12 fps, 12.5 seconds, muted H.264, 640 × 640. Display window is center 40 / width 100. The 512 × 507 source has equal physical pixel spacing; frames are resized to 640 × 634 and padded black. The poster is slice 40. Source checksum and unrestricted-use acknowledgement are in `samples/provenance.json`. This is a teaching illustration, not a patient's current study or an inference result.

Generate raw frames with `node --experimental-strip-types scripts/render-login-cine.ts` from the repository root. Encode the `.tmp/ct-cine/%03d.ppm` sequence with FFmpeg at 12 fps, `scale=640:634,pad=640:640:0:3:black`, `libx264`, CRF 23, `yuv420p`, `+faststart`, and no audio. The original MRI stills below remain available as archived assets.

Playback pauses when the page is hidden, respects reduced-motion preferences, and has a visible play/pause control. A failed video displays the CT poster.

The three WebP files are display slices derived from the repository's public Slicer MRHead sample, `public/samples/mr-head.nrrd`. They contain no private uploaded study data. Original source, checksum and unrestricted-use acknowledgement are recorded in `public/samples/provenance.json`.

Rendering: `decodeNrrd` / `renderSlice` from `src/lib/volume.ts`; midpoint acquired slice for each plane, level 120 / width 240; resized preserving physical pixel spacing to a maximum dimension of 720 pixels, WebP quality 88. These are teaching illustrations, not a clinical interpretation or lesion localization.

The login shows the existing VoxelRad AI mark. Figtree is self-hosted in `public/fonts` with its SIL Open Font License; no third-party font request is made during sign-in.
