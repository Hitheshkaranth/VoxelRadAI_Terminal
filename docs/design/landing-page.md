# VoxelRad AI public landing page

The root is a public product introduction. `/workspace` retains backend sign-in and existing OIDC callback handling. The Skanda logo and VoxelRad AI name are preserved.

## Product story

The central narrative is scan intake ? AI first-pass heatmap and candidate boxes ? radiologist review and approval ? report draft. Intended benefits are earlier attention to candidate regions and less time assembling reports; no measured speed or accuracy claim is made.

`ReviewFlow` illustrates this as a four-step 3D transition. The walkthrough stops before approval. The visitor approves the example finding to include it in the demonstration report. Jumping directly to the report shows that no finding has been approved. Restart clears approval. CT/MRI switching and overlay visibility controls allow comparison with the original public teaching image.

Heatmaps and boxes in this explanatory animation are illustrative, not actual model results, and are labeled accordingly. Hosted inference remains unconfigured. The page does not claim clinical validation. The separate viewer demo supports CT cine, MRI views, zoom, and carrying a typed observation into a sample draft. No demo inputs are uploaded or persisted.

## Art direction

UI UX Pro Max guided the work. Apple's iPad Pro product presentation (https://www.apple.com/ipad-pro/) informed the large imaging hero, concise chapter headings, image-led explanations and neutral section contrast. No Apple assets or branding are used. Arc Library remains a reference for the existing tab/accordion interactions. Fonts remain self-hosted Figtree.

The cinematic hero is followed by capabilities, the animated decision workflow, a hands-on viewer demo, audience information, FAQ and final workspace action. Isolated `lp2-`/`lp3-` classes avoid clinical-viewer collisions. Motion has reduced-motion fallbacks; the walkthrough is user-started and pauses when the tab is hidden.

## Validation

Build and lint pass. Browser checks cover source-only intake, overlay reveal, approval, inclusion in report, restart, responsive overflow at 375/768/1440 pixels and console errors. Updated screenshots are stored in `docs/screenshots/landing/`. Public teaching-image provenance remains in `app/public/samples/provenance.json`.
