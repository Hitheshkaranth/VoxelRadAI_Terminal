# Swarm follow-up verification

This record follows the v0.2.0-beta.1 release. It supersedes the earlier statement that the redesigned X-ray import/display workflow had not been visually verified. It does not claim clinical validation or live inference testing.

## Implemented

- Shared shadcn controls across shell, viewer and report actions. Radix modal isolation/focus handling and keyboard-operable inspector tabs. Mobile touch targets and a single-row scrolling X-ray toolbar that no longer overlaps the source image.
- Explicit NRRD acquisition context: modality, body region, MRI sequence, contrast and CT HU confirmation. Changing context pauses the old job, changes review identity and clears stale viewer results. Resume guards reject mismatched source/context. Confirming HU does not calibrate arbitrary voxel values.
- Conventional uncompressed multiframe DICOM intake imports all supported frames, retains actual frame identity and rejects malformed/truncated/unsupported enhanced objects. This is an image stack, not geometric DICOM-series reconstruction or PACS integration.
- Model transport rejects malformed, empty and prematurely ended streams; preserves cancellation type; supports compatible servers without LM Studio's inventory endpoint. Controlled-response tests cover recovery after cancellation and exact model matching.
- Current-password change and administrator-issued one-use recovery codes. Recovery codes are short-lived, submitted in request bodies and never placed in URLs. Password changes revoke sessions.
- Process-scoped operational metrics, privacy-safe request identifiers and a repeatable authenticated load-smoke harness. Capability flags explicitly distinguish implementation from unimplemented integrations.
- Share-history expiry display updates with time rather than waiting for an unrelated rerender.

## Browser evidence

Native Chrome inspection used the running development application on port 5173. One public ChestX-Det image (36199, official test split via the MedOtter mirror) was imported through the actual Windows file picker. Verified image-type selection, brightness adjustment, zoom, fit and reset. Default display was restored before capture. No model output was injected into the study.

At 400 x 792 CSS pixels, verified the source remains clear of the toolbox and navigation opens Findings and Report. The report screen correctly remains in the unanalyzed state. Chrome device emulation is not physical touchscreen verification.

Opened Settings, exercised Tab/Shift+Tab and Escape, and visually observed dismissal and focus returning to the Settings control. Opened CT Acquisition and verified explicit modality/body/contrast/HU fields, then dismissed without asserting calibration.

Screenshots: `docs/screenshots/v0.2.0/xray-workspace.png` and `xray-mobile.png`. The latter was captured directly by Chrome's responsive screenshot action at device pixel ratio 2. No anatomy or app state was synthesized or edited into either screenshot.

Source image SHA-256: `19e91d2913b615f8034914a02f51e65060688e65fabf3253c4ba76244ccaa001`.

## Automated verification

The complete frontend test runner passed, including account request contracts, model transport, multiframe DICOM, acquisition identities/resume guards, operations response validation and existing parsing/report/imaging tests. Production TypeScript/Vite build passed, with zero lint errors or warnings.

All 10 server unit tests passed. Docker integration passed against the isolated test database, including recovery replacement, concurrent single-use consumption, expired and disabled recovery rejection, password-change session revocation, RBAC, owner isolation, sharing expiry/revocation, deletion and logout. The final database-connected run also confirmed unknown recovery tokens do not allocate throttle records. Token-specific limits avoid blocking unrelated users behind the same reverse proxy.

A bounded authenticated load smoke across two API replicas completed 100 requests at concurrency 8 with zero failures (154 ms elapsed; p50 10 ms, p95 28 ms, p99 28 ms). This local smoke is not a production capacity benchmark. Browser verification used the current development frontend; the isolated Docker web image was not rebuilt for visual verification.

Controlled model responses verify software behavior only. The user confirmed no inference engine is currently set up; actual X-ray/CT/MRI inference, model quality, GPU throughput and end-to-end generation remain unverified.

## Remaining release gates

| Gap | Required work or input |
| --- | --- |
| Live inference | A reachable supported model engine and exact model ID; run representative inputs and record cancellation/retry/report outcomes |
| SSO/MFA | Identity-provider choice, issuer/client configuration, approved account/role mapping and end-to-end security tests; current password recovery is not MFA |
| Full-volume storage | Private object-storage backend, encryption/retention policy, upload limits, backup plan and access-control integration |
| PACS/DICOMweb | Actual endpoint/authentication and supported transfer syntaxes; geometric series assembly and conformance testing |
| Multi-tenant deployment | Tenant membership model, tenant-scoped data migration, enforced database isolation and cross-tenant negative tests |
| Durable inference jobs | Worker/runtime deployment, durable source storage, model capacity and cancellation/idempotency contracts |
| Accessibility/device coverage | Screen-reader, contrast audit and physical touchscreen testing across supported devices |
| Operations | Centralized monitoring/alerts, production TLS/secrets, representative capacity testing and restore drills |
| Clinical validation | Independent labeled cohorts, predefined acceptance criteria, expert review and documented intended use |

The current deployment remains a single-organization private installation. These gates must not be represented as completed by passing UI/unit tests or by publishing a beta package.
