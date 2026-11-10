# VoxelRad AI public landing page

The root introduces the product; `/workspace` retains backend sign-in and OIDC handling. The original Skanda logo and VoxelRad AI brand remain.

## Current direction

The user selected cinematic medical imaging: dark, immersive and scan-led. The hero is a continuous reading-room scene, with a dark header, large typography and distinct coronal MRI, sagittal MRI and axial CT teaching images. CSS perspective separates the anatomical views; no external 3D runtime or new dependency is required.

Four interactive chapters tell the actual product story: the scan, AI attention, the radiologist's decision, and the report. The first chapter briefly plays the CT cine. The next chapters reveal an illustrative heatmap and candidate box, then ask the visitor to approve the example. Approval carries it into the demonstration draft. Direct navigation to the report never approves the finding. Replay clears approval.

The scene uses existing self-hosted Figtree, near-black #060b0e, pale text #edf3f5 and cyan #87d3e7. State transitions use cubic-bezier(.22,1,.36,1) over 700-1000ms. The opening cine stops after 4.5 seconds and has a visible play/pause control. It pauses offscreen and when the document is hidden; reduced motion starts with a still image and removes CSS movement. All chapter controls are native buttons.

## Product and content boundaries

Heatmaps and boxes are illustrative, not model results. Hosted inference remains unconfigured. No speed, accuracy or clinical validation claim is made. Public teaching-image provenance is in `app/public/samples/provenance.json`. The MRI and CT images show separate teaching studies, not matched patient views.

The detailed workflow below the hero retains CT/MRI switching, overlay visibility and report approval. The viewer demo supports CT cine, MRI planes, zoom and carrying a locally typed observation into a sample draft. Demo inputs are not uploaded or persisted.

## References and validation

Design-taste, Awwwards web design, UI UX Pro Max and Emil Design Engineering informed composition, motion and interaction. The reference research used the Awwwards skill casebook and Lusion's public description of its 3D storytelling practice. Live Awwwards pages timed out and Lusion's automated screenshot remained in its loader; neither was claimed as a successfully inspected live hero.

Build and lint pass. Chrome checks cover all four chapters, unapproved direct report navigation, explicit approval, replay, reduced-motion playback, console errors, overflow and report/copy collisions at 375, 390, 768 and 1440 pixels. Screenshots are saved in `docs/screenshots/landing/`.

## Interface refinement

The cinematic direction now extends through the complete landing page. Shared dark surfaces, cyan actions, readable secondary text and consistent corner radii unify the workflow, viewer demonstration, audience section, FAQ and footer. The redundant four-step prose grid was removed; the interactive workflow remains. Hero chapter controls have a filled selected state, and review chapters support comparing the original image with the illustrative overlay. Mobile navigation provides an Explore menu with close-on-navigation and Escape handling.

Additional Chrome checks cover the mobile menu, source comparison, FAQ expansion and supporting-section appearance. Audience and viewer-demo screenshots are included alongside the three responsive hero captures.
