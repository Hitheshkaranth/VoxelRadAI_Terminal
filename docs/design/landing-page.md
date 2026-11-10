# VoxelRad AI public landing page

The root is a public product introduction. `/workspace` retains backend sign-in and existing OIDC callback handling. The Skanda logo and VoxelRad AI name are preserved.

## Product story

The central narrative is scan intake -> AI first-pass heatmap and candidate boxes -> radiologist review and approval -> report draft. Intended benefits are earlier attention to candidate regions and less time assembling reports; no measured speed or accuracy claim is made.

`ReviewFlow` illustrates this as a four-step 3D transition. The walkthrough stops before approval. The visitor approves the example finding to include it in the demonstration report. Jumping directly to the report shows that no finding has been approved. Restart clears approval. CT/MRI switching and overlay visibility controls allow comparison with the original public teaching image.

Heatmaps and boxes in this explanatory animation are illustrative, not actual model results, and are labeled accordingly. Hosted inference remains unconfigured. The page does not claim clinical validation. The separate viewer demo supports CT cine, MRI views, zoom, and carrying a typed observation into a sample draft. No demo inputs are uploaded or persisted.

## Art direction

UI UX Pro Max guided the work. Apple's iPad Pro product presentation (https://www.apple.com/ipad-pro/) informed the large imaging hero, concise chapter headings, image-led explanations and neutral section contrast. No Apple assets or branding are used. Arc Library remains a reference for the existing tab/accordion interactions. Fonts remain self-hosted Figtree.

The split hero pairs “AI assists. You decide.” with the interactive scan-to-report workflow. The first pass advances automatically, then stops for radiologist approval. Scan sweeps, overlay reveals and a finding-to-report transition explain each action. Motion pauses offscreen or when the tab is hidden, respects reduced motion and stays immediate for keyboard input. UI UX Pro Max and Emil Design Engineering informed the timing. Capabilities, four workflow chapters, a hands-on viewer demo, audience information, FAQ and workspace action follow. Isolated lp2/lp3/lp4 classes avoid clinical-viewer collisions.

## Validation

Build and lint pass. Browser checks cover source-only intake, overlay reveal, approval, inclusion in report, restart, responsive overflow at 375/768/1440 pixels and console errors. Updated screenshots are stored in `docs/screenshots/landing/`. Public teaching-image provenance remains in `app/public/samples/provenance.json`.

## Hero reset after visual review

The crowded split hero was replaced with an editorial heading and a wide imaging stage. A layered CT teaching image is the principal object; Reveal AI attention changes its pose, separates the layers and reveals a clearly illustrative attention map. The detailed approval/report interaction sits below the hero. The scan remains visible without motion; reduced-motion disables the entrance and transitions. No new animation dependency or external runtime was added.

References: Awwwards web design skill casebook (Opal Tadpole object presentation), Awwwards Hot Right Now 2023 discussion of True Staging, and Lusion's approach to 3D storytelling (https://lusion.co/). Live Awwwards listing requests timed out; Lusion's automated screenshot remained in its loader, so it was not treated as a verified hero composition. Existing public teaching imagery supplies the actual visual, with no borrowed artwork.

Design decision: the scan becomes a lightbox object visitors can inspect. Fog #f5f6f8, ink #172d3c, stage #101c24, existing Figtree typography; a single 1100ms entrance and state-driven 600-1000ms transitions. The hero contains no diagnostic claim or invented performance metric.
