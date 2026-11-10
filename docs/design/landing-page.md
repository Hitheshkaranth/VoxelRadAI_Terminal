# VoxelRad AI public landing page

The root introduces VoxelRad AI. `/workspace` retains backend sign-in and OIDC handling. The original Skanda logo, domain and existing viewer remain.

## Reference and typography

The user requested an element-by-element adaptation of https://visuvate.com/ after approving an open-source alternative to Perplexity's font. See [visuvate-mapping.md](visuvate-mapping.md) for the observed reference elements, evidence and project equivalents.

The landing page self-hosts Instrument Sans (400-700) and Instrument Serif (regular and italic), with their SIL OFL licenses in `app/public/fonts/`. These are not FK Grotesk, Walsheim or Fraunces. No proprietary reference assets are bundled. Fonts do not require a third-party request at runtime.

## Page architecture

1. Compact sticky navigation with a mobile Explore menu.
2. Centered mixed-type headline and workspace/walkthrough actions.
3. Interactive reading room: teaching-study rail, scan canvas, review panel, report and four chapters.
4. Capability strip with actual imaging and reporting features.
5. Four illustrated workflow panels; no duplicated interactive workflow.
6. Hands-on viewer demo, including image controls and a local observation-to-draft exercise.
7. Audience cards for radiologists, educators and researchers.
8. Product-readiness/access FAQ, workspace action and provenance footer.

## Interaction and truthfulness

CT/MRI study selection clears previous approval and returns to the source. Overlays are explicitly illustrative. Visitors can compare the original image, review and approve the example, then see it included in a draft. Direct navigation to the report does not approve a finding. Replay clears approval. Hosted inference is not configured; no real model result, clinical validation or measured performance is claimed.

The CT hero plays a short opening cine and provides replay/pause. It stops after 4.5 seconds, offscreen or when the document is hidden. Reduced motion starts with a still scan and disables the transitions. The report uses a short entrance; the source-to-attention transition uses restrained CSS perspective. Text and controls remain DOM elements; no WebGL is required.

The existing viewer demo provides CT cine, MRI planes, zoom and a local-only note. No demo input is uploaded or persisted. Teaching-image provenance remains in `app/public/samples/provenance.json`.

## Verification

Build and lint pass. Chrome checks cover font loading, overlay/source comparison, study changes and approval reset, direct report navigation, explicit approval, replay, reduced motion, mobile menu, FAQ, overflow and report/copy collisions at 375/390/768/1440px. Updated screenshots live in `docs/screenshots/landing/`.
