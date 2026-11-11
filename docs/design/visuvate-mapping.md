# Visuvate → VoxelRad: element-by-element adaptation

Reference: https://visuvate.com/ inspected in Chrome on 2026-11-11 at a 1902 px viewport. Geometry was matched by measuring
the same elements on both pages (`getBoundingClientRect`) and iterating until offsets agreed, then checked at 820 px and
390 px. Code: `app/src/landing/`. The reference's copy, artwork, logos and commercial fonts are not reused.

| # | Reference element (measured) | VoxelRad element |
|---|---|---|
| 1 | Nav, 69 px; floats into a 920 px blurred pill on scroll | Same behaviour; "Skanda V1" serving chip; full-screen menu dialog under 960 px |
| 2 | Hero: eyebrow at 131, 92 px Walsheim/Fraunces headline (−0.06em), 18 px #9a9a9a lead, paired pills, blue edge glow | "Skanda V1 · Base model"; *Grounded Radiology / Visible Evidence*; Figtree + Instrument Serif stand in for Walsheim + Fraunces |
| 2b | Design-tool editor (Pages/Layers/Assets, canvas, inspector, floating toolbar), clipped at the hero edge | Reading room: Studies/Layers/Findings, X-ray/CT/MRI switch, scan canvas with overlay toggle and press-and-hold source, finding inspector |
| 3 | Tool logo strip, 2 × 4, 217 px band | Formats, datasets and services the repo actually uses (DICOM, NRRD, ChestX-Det, BraTS, SAM 2, TorchXRayVision, PostgreSQL, Orthanc); no endorsement implied |
| 4 | Intro copy + wall of 357 × 268 tiles, 8 px gap, three staggered rows, scroll drift | Same grid filled with scan renders and recorded detections |
| 5 | "Our Works": sticky 3D helix over blue light streaks | "Our *Reads*": twelve detections on the helix |
| 6 | Services: 64 px heading, 5 × 2 grid of 254 px tiles | Ten Skanda capabilities |
| 7 | Platform card (starfield) + 4 × 2 logo grid | Modality / format grid |
| 8 | Keyword ticker, 70 px band | Modality ticker |
| 9 | Pricing: 132 px title, three 425 × 522 glass cards overlapping it | **Benchmarks**: Skanda V1, MedGemma 27B, MAIRA-2 cards, then a "Head to head" chart (headline / by finding / precision) with 95 % intervals |
| 10 | Approach bento, 764/532 alternating, rows 593/650/560 | Source First, Grounded Findings, Evidence Heatmaps, Reference-Checked (Dice 0.84), Report-Ready, Seconds per Read |
| 11 | Testimonials: title behind glass stats + quote slider | "Evidence": held-out-split facts and three measured takeaways, including a limitation; no invented testimonials |
| 12 | FAQ: 72 px title, 880 × 57 rows, 12 px radius | Model, comparison, imagery, limitations, regulatory status, access |
| 13 | Footer with CTA, giant fading mark, frosted 4-column grid | Same; Skanda mark rendered white |

## Evidence rules

- **Benchmarks** come from `app/src/landing/benchmarks.generated.ts`, written by `python benchmark/emit_landing.py` from
  `benchmark/score.py` output on the ChestX-Det held-out test split (111 films). Skanda (run-2 best checkpoint) was read
  twice; the page shows the mean of both reads with Wilson intervals at single-read n. No figure is typed by hand.
- **Imagery** comes from `app/scripts/build-landing-imagery.py`, recorded in `app/public/landing/provenance.json`:
  - CT/MR planes and skull radiographs (DRRs) rendered from the public Slicer volumes. Their heatmaps are labelled
    *illustrative* because the volumes carry no labelled finding.
  - Chest-film and BraTS overlays cropped from recorded app output. The `cxd_45707` heatmap is MedGemma plus the
    TorchXRayVision classifier, and is labelled that way.
- Reduced motion turns the helix into a static grid and stops marquees and drifts.
