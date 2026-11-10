# Visuvate -> VoxelRad: element-by-element adaptation

Reference: https://visuvate.com/ (inspected in Chrome at 1440px and 390px on 2026-11-10).

## Observed elements and project equivalents

| Reference element | VoxelRad equivalent | Implementation decision |
| --- | --- | --- |
| Compact navigation; persistent desktop bar | Brand, workflow, demo, audience, sign-in | Native anchors; mobile Explore menu; original Skanda logo. |
| Contrasting sans/serif headline | Imaging intelligence and clinician judgment | Instrument Sans plus Instrument Serif; self-hosted OFL fonts. |
| Centered introduction and paired actions | Open workspace / Try the walkthrough | Sign-in is the primary destination; the second action anchors to the reading room. |
| Dark ground with blue atmosphere | Dark medical reading room | Blue perimeter around the preview; neutral readable text. |
| Interactive editor hero | Interactive radiology preview | Study rail, scan canvas, review panel, then draft report. |
| Gallery preview and direct manipulation | CT/MRI study selection | Native buttons select teaching imagery; source switching clears approval. |
| Large project showcases | Working viewer demonstration | Existing cine, plane selection, zoom and observation-to-report demo. |
| Logo/tool strip | Supported imaging workflow | CT, MRI, X-ray and reporting capabilities; no partner endorsements. |
| Service grid | Four workflow stages | Intake, AI attention, clinician decision and report, each with a specific visual. |
| Approach panels | Human review safeguards | Visible source comparison and explicit approval; report remains a draft. |
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

## Build boundaries

Keep the original app and backend sign-in. The hero is an illustrative workflow, never a live inference result. Keep public teaching scans and the local-only observation demo. No fabricated billing, patient information, integrations or clinical outcomes. No autoplaying decorative marquee, cookie banner or customer logos without a corresponding product need.
