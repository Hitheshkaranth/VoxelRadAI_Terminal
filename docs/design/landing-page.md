# VoxelRad AI public landing page

The root URL introduces the product. `/workspace` retains the authenticated workspace, and OIDC return queries retain the existing authenticated flow. The landing preview only uses bundled public teaching samples; it does not request patient or account data.

## Direction and references

The product performs: the existing CT cine and MRI teaching slices become the interactive first view. The page argues from seeing the scan, through keeping evidence in context, to reviewing a report. It retains Figtree, the original Skanda mark and VoxelRad AI identity.

References: [Ashby](https://www.ashbyhq.com/) for a clear product tour, [Resend](https://resend.com/) for interactive product proof, and [Arc Library](https://github.com/kuratlielia/arc-library) for moving tab selection, calm accordion transitions, keyboard semantics and reduced-motion alternatives. Arc is inspiration; no Arc source was copied or new animation dependency added. Existing Radix primitives provide keyboard and accessibility behavior.

## Verification

Production build and lint pass. Browser checks cover scan switching, zoom limits/reset, keyboard tab navigation, FAQ expansion, anchor destinations, reduced-motion playback, and mobile overflow. Visual inspection at 1440, 768 and 390 pixels returned zero failures. Remaining inspector warnings: compact product-preview labels add sizes to the marketing scale; the footage detector misses the nested CT video even though screenshots and playback checks confirm it.

The screenshot review found a clear scan-led first viewport and consistent margins at all three widths. Refinements removed unnecessary introductory labels, strengthened paragraph contrast, and replaced abrupt selection and FAQ changes with restrained transitions. The copy distinguishes configured viewing features from currently unavailable hosted inference; it makes no customer, accuracy or clinical-validation claims.

Screenshots are in `docs/screenshots/landing/`. Public teaching image provenance remains in `app/public/samples/provenance.json` and `app/public/login/README.md`.
