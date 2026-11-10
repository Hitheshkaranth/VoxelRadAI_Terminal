# VoxelRad AI landing page

The public root explains the product; `/workspace` keeps the authenticated app. Existing OIDC return queries preserve the original sign-in flow. The original Skanda mark remains the app logo.

## Design

Rebuilt using the user-requested UI UX Pro Max skill from https://github.com/nextlevelbuilder/ui-ux-pro-max-skill. Its medical-imaging SaaS query recommended a light interface, clear hero-to-feature progression, restrained depth, accessible controls and reduced-motion fallbacks. The implementation keeps the established self-hosted Figtree rather than adding a remote font. Blue actions and a cool neutral ground distinguish public content from the dark scan viewer.

The introduction uses three real public MRI slice images on intersecting CSS 3D planes. This is explicitly an illustrative arrangement, not calibrated volume reconstruction. Visitors can rotate, highlight a plane, reset or pause motion; reduced-motion and focus stop automatic motion.

## Content and demo

- How it works: open a supported study, explore views, review a report.
- Who it is for: clinicians evaluating workflows, residents/educators, and imaging researchers.
- Three-step interactive demo: explore public CT/MRI scans, enter an observation, then see that note in an example report. Notes only exist in React state and are not uploaded or persisted.
- FAQs explain formats, access, model configuration and research-only status.

Arc Library remains inspiration for the moving tab indicator and accordion transitions; the implementation uses existing Radix primitives. No Arc source or new animation dependency was added. CSS classes use the isolated `lp2-` prefix to avoid collisions with the clinical viewer.

## Verification

Production build and lint pass. Browser interaction checks cover reduced-motion cine and 3D, plane highlight/reset, note-to-report flow, scan switching, zoom/reset, FAQ, anchor destinations, and arrow-key tabs. Layout checks at 1440/768/375 pixels and phone/landscape overflow checks at 375x812, 844x390 and 320x750 pass. Screenshots reviewed at each size and stored in `docs/screenshots/landing/`.

The generic design inspector reported zero failures. Its app-screen title/below-fold warnings are not applicable to this public landing page; high-contrast lines on the 3D illustration identify the image planes rather than panel decoration.

The page does not claim clinical validation or working hosted inference. Teaching-image provenance is in `app/public/samples/provenance.json` and `app/public/login/README.md`.
