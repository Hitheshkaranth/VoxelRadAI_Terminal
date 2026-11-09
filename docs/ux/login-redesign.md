# Skanda login redesign

The user requested UI UX Pro Max and an explicitly branded radiology background. The skill was absent locally, so its upstream repository was loaded into ignored `.tmp/ui-ux-pro-max` at commit `4f2dbb6`: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.

Applied its verified minimal-interface, accessible-authentication and React form guidance. The initial design-system query returned a marketing conversion layout, which did not fit login; a narrower style query returned Minimalism & Swiss Style. No marketing badges, customer statistics, certifications or unsupported authentication methods were added.

The new composition pairs a dark reading-room field, the existing Skanda mark, real public MRI imagery and an interactive three-plane preview with a light sign-in area. Figtree typography is bundled locally. The compact layout retains a branded MRI background above the form; desktop/tablet exposes the plane explorer. Glass is reserved for controls over the image. Credentials, backend/session logic and password-manager/paste support are preserved. Help reveals actual administrator-assisted recovery instructions.

Verification: TypeScript/production build passed; Impeccable detector returned no findings. Source review checked 44px preview/password targets, 54px fields, visible labels, reduced motion/transparency, responsive gutters, keyboard focus, retained loading/error states and self-hosted image/font resources. Browser screenshot verification remains unavailable because the browser access host is offline; no rendered visual pass is claimed.
