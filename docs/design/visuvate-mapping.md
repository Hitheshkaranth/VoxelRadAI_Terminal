# Visuvate -> VoxelRad: element-by-element adaptation

Reference: https://visuvate.com/ (inspected in Chrome at 1440px and 390px on 2026-11-10).

## Observed elements and project equivalents

| Reference element | VoxelRad equivalent | Implementation decision |
| --- | --- | --- |
| Compact navigation; persistent desktop bar | Brand, workflow, demo, audience, sign-in | Native anchors; modal mobile navigation with Escape/focus restoration; original Skanda logo. |
| Contrasting sans/serif headline | Imaging intelligence and clinician judgment | Instrument Sans plus Instrument Serif; self-hosted OFL fonts. |
| Centered introduction and paired actions | Open workspace / Try the walkthrough | Sign-in is the primary destination; the second action anchors to the reading room. |
| Dark ground with blue atmosphere | Dark medical reading room | Blue perimeter around the preview; neutral readable text. |
| Interactive editor hero | Interactive radiology preview | Study rail, scan canvas, review panel, then draft report. |
| Gallery preview and direct manipulation | CT/MRI study selection | Native buttons select teaching imagery; source switching clears approval. |
| Large project showcases | Working viewer demonstration | Existing cine, plane selection, zoom and observation-to-report demo. |
| Logo/tool strip | Supported imaging workflow | CT, MRI, X-ray and reporting capabilities; no partner endorsements. |
| Service grid | Ten imaging capability tiles | Same five-column desktop/two-column mobile arrangement, quiet outlines, centered icons and two-line labels. |
| Approach panels | Four workflow stages | Asymmetric desktop panels, large scan imagery, source comparison, explicit approval and a report draft. |
| Platform compatibility content | Real format support | Supported DICOM frames, X-ray images and NRRD volumes; no unverified integrations. |
| Pricing | Access and configuration facts | Administrator-provisioned sign-in; model server required for live inference. |
| Testimonials and metrics | Interactive product evidence | Omit invented clients, clinical results, speed claims and approval counts. |
| Bordered accordion FAQ | Product readiness and access FAQ | Native keyboard-operable Radix accordion. |
| Closing invitation and footer | Open workspace; return to demo | Real routes, brand, sample provenance and evaluation status. |
| Mobile stacked composition | Scan first, controls then findings | Full-width scan, compact study selector, readable report; no horizontal viewport overflow. |
| Motion and hover treatments | State-driven imaging transitions | Short reveal, source/overlay comparison and report entrance; reduced-motion state. |

## Scope and evidence

The reference uses Walsheim and Fraunces in the inspected headline. Its desktop header was observed as a floating bar after scrolling. The editor, service grid, approach panels and FAQ were visually inspected. Gallery instructions advertise drag and hold interactions; their full gesture behavior was not independently verified, so VoxelRad uses explicit buttons instead. The reference's copy, artwork, logos and commercial typefaces are not reused.

The user approved Instrument Sans as the open-source alternative to Perplexity's FK Grotesk. Instrument Serif provides the reference-inspired contrast. These are alternatives, not the reference sites' proprietary fonts.

## Screen-by-screen transformation

[Open the comparison gallery](../screenshots/landing/comparison/index.html). Seven paired captures use the same 1440 × 900 viewport, plus the working viewer demo and responsive captures at 768, 390 and 375 pixels. Reference screenshots are design-review evidence, not application assets.

| Before | After | Why |
| --- | --- | --- |
| Blue-grey page and panels | Black canvas, neutral borders and white primary actions | Match the reference's dominant visual treatment. |
| Both hero lines ended in italic words | Sans/serif positions alternate between lines | Match the reference's typographic composition using licensed alternatives. |
| Two-line descriptive lead | One concise desktop lead | Restore the reference's compact hero rhythm. |
| Muted preview outline | Vivid blue edge and blue side atmosphere | Match the framing and silhouette of the editor preview. |
| Narrow scan viewport | Wide editor-like three-column frame | Adapt the editor canvas to an actual reading room. |
| Generic blue study selection | Neutral selected row, quiet list and compact counts | Match reference control surfaces. |
| No image-collage section | Tilted collection of actual CT/MRI teaching scans | Translate the reference's portfolio collage into imaging content. |
| No service-grid equivalent | Ten imaging tool tiles | Preserve the reference's component geometry with relevant product content. |
| Small equal workflow cards | Larger asymmetric panels and enlarged imagery | Match the approach panels while retaining chronological reading order. |
| Abstract report bars | Legible illustrative report with findings/impression | Show the product's output with meaningful content. |
| Small tinted closing card | Large type on the black page | Match the closing section's visual scale. |
| Blue FAQ panels and plus icons | 55px bordered rows, inline numbering and chevrons | Match the FAQ component's density and open/closed affordance. |
| Whole-label rollover | Staggered individual-letter rollover | Reproduce the observed hover treatment without moving the button. |
| Inline mobile Explore disclosure | Full-screen navigation dialog | Provide clear mobile navigation with focus restoration and Escape dismissal. |
| Fixed desktop header width | Floating 960px header on scroll | Match the observed persistent navigation pattern. |
| No fullscreen view | Expand/exit reading-room control | Keep the larger imaging preview usable. |

### Verification

- Production build and lint pass.
- No horizontal overflow at 1440, 768, 390 or 375 pixels; tablet service-tile intrinsic sizing was corrected after inspection.
- Hero: direct report navigation cannot approve a finding; explicit approval, original/overlay comparison and study-change reset pass.
- Demo: MRI coronal selection, zoom, typed note and note-to-draft transition pass.
- Navigation: mobile dialog opens, Escape dismisses it and focus returns to the trigger.
- Fullscreen enters and exits using the visible control; button hover has no layout shift.
- Reduced motion pauses the opening cine and suppresses letter transitions.
- No browser console errors in the exercised flows.

The generic style inspector also flags the intentional blue gradient, framed preview, large headings and spacious service tiles. These are explicit reference-matching decisions. Its actual skip-link contrast and tablet overflow findings were corrected. This is a component-level adaptation, not a pixel-identical copy: the content, logo, fonts, medical controls and image assets differ intentionally.

## “Our Works” becomes “Your workspace”

The reference's sticky, full-viewport 3D portfolio was inspected separately at three scroll positions. VoxelRad now has a corresponding section at `#workspace-showcase`: five real screenshots of CT, MRI, AI attention, clinician review and report-draft states surround the large title over blue light bands. Scroll position changes their depth-oriented transforms; there is no continuously running animation loop.

Each preview links to its corresponding interactive reading-room state. Selecting the report preview does not grant approval. Keyboard focus brings the chosen preview into the center of the screen. At mobile widths and under reduced-motion preferences the same links become a static, ordered image gallery. Screenshots use public teaching studies and explicitly illustrative AI overlays.

| Before | After | Why |
| --- | --- | --- |
| Portfolio section absent | Full-viewport “Your workspace” showcase | Adapt the reference's signature section to the actual application. |
| Agency websites as reference imagery | Five screenshots captured from VoxelRad | Show what the user can actually explore. |
| Reference uses WebGL canvases | CSS perspective with scroll-driven transforms | Keep images, links and keyboard access native and avoid an extra rendering dependency. |
| No stage-specific showcase links | Each preview opens the correct CT/MRI/demo stage | Turn the presentation into a useful product entry point. |

Verified: all five image assets load; scroll changes the transforms; all five destinations open the expected stage; report access leaves approval unset; no horizontal overflow at 1440/768/390/375; reduced motion uses a static layout; build and lint pass.

## Build boundaries

Keep the original app and backend sign-in. The hero is an illustrative workflow, never a live inference result. Keep public teaching scans and the local-only observation demo. No fabricated billing, patient information, integrations or clinical outcomes. No autoplaying decorative marquee, cookie banner or customer logos without a corresponding product need.
