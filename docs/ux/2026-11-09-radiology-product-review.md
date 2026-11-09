# Skanda radiology experience review

Research date: 9 November 2026. This is a product and interaction review, not a clinical evaluation. The comparators are established products with relevant workflows; this is not a market-share ranking. Findings below distinguish documented competitor behavior from recommendations inferred for Skanda. No patient records were uploaded to a third-party service during this research.

## Evidence from comparable products

| Product | Documented pattern | Implication for Skanda |
| --- | --- | --- |
| OHIF | Series on the left, image viewport in the center, measurement details on the right; tool groups expose related actions through a caret. | Preserve the image-first desktop layout, but make tool selection and secondary actions understandable without a dense permanent toolbar. [Viewer](https://docs.ohif.org/user-guide/viewer/), [toolbar](https://docs.ohif.org/user-guide/viewer/toolbar/). |
| OHIF measurement tracking | Tracked versus temporary annotations have different visual states, and tracked measurements can become structured reports. | Keep model candidates, accepted findings and report content distinct. A visually polished overlay must never imply a validated lesion. [Measurement tracking](https://docs.ohif.org/user-guide/viewer/measurement-tracking/). |
| RadiAnt | Its documented touch controls include pinch zoom, two-finger pan and double-tap maximize; it offers full-screen/distraction-free viewing. | Retain explicit tool buttons alongside gestures, provide reset/fit, and give the image most of a phone's usable height. Do not rely on undocumented gestures. [Touch manual](https://www.radiantviewer.com/dicom-viewer-manual/multi-touch_operations.html), [products](https://www.radiantviewer.com/products/). |
| Sectra UniView | Browser viewer with worklist/search, patient context, report access, touch input, mobile/tablet support and EMR integration. | Responsive adaptation should preserve the reading task and patient context. Tablet needs its own balance of workspace and navigation rather than a squeezed desktop. [UniView](https://medical.sectra.com/product/sectra-uniview/). |
| PocketHealth | Users select records, share to recipients who need no account, and manage status, resend and revoke in share history. Its current help distinguishes sharing options and expiry by method. | A future hosted share needs clear scope, recipient access, expiry and revocation. An ordinary local app URL is not a patient-record share. [Current sharing help](https://www.pockethealth.com/section/sharing-records/). |
| PocketHealth account access | Account setup uses a password and users confirm their identity before viewing records. | Separate account identity from the radiologist name entered into a report. Do not represent a locally entered display name as verified authentication. [How it works](https://www.pockethealth.com/faqs/how-does-pockethealth-work/). |
| Horos | The official project describes a desktop imaging product and optional cloud reporting/sharing. Its training offers separate modules for viewing and MPR. | Keep local viewing and cloud distribution explicitly different capabilities. Progressive disclosure and contextual help are preferable to exposing every advanced control at once. [Project](https://horosproject.org/), [official training](https://academy.horosproject.org/courses/entry-edition). |

Horos homepage content was available in the search index, but direct retrieval timed out. No visual or usability claim about its current release was inferred from that result. Competitor documentation describes capabilities, not independently measured usability. Older PocketHealth articles contain different expiry behavior; the current help page is preferred here.

## Skanda baseline and priorities

Repository evidence: `app/src/store.ts`, `app/src/components/shell/shellState.ts`, `app/src/components/shell/Toolbar.tsx`, `app/src/components/shell/MobileNavigation.tsx`, `app/src/components/shell/VolumeIdentity.tsx`, `app/src/styles/mobile.css` and `app/src/components/report/ReportPanel.tsx`.

### P0: make identity and sharing truthful

- Studies and reports are browser-local. There is no existing account/session service, remote patient store or share authorization endpoint in the inspected application. A front-end login screen alone would not protect that storage.
- Current hash links identify known sample volumes. They do not distribute imported scans, patient information, model findings or reports. Label sample links precisely.
- Existing report copy/text/JSON/print actions are export mechanisms. Shared files cannot be remotely revoked once downloaded. Keep that limitation visible at the sharing decision.
- The report radiologist field is attribution entered by a user, not verified identity or a cryptographic signature.
- A future hosted service should enforce permissions server-side for metadata, image pixels and reports. OHIF documents an OIDC integration and authorization on both metadata and pixel-data requests; this is a useful integration pattern, not an implementation already present in Skanda. [OHIF authorization](https://docs.ohif.org/deployment/authorization/).

### P1: keep the reading surface usable at every width

- Baseline 1024–1279px layout assigns 210px to the worklist and 330px to the inspector; at 1024px only about 484px remains before other layout costs. At 1023px it switches to one-screen mobile navigation. Test both sides of that boundary and introduce deliberate tablet behavior.
- Keep Studies, Viewer, Findings and Report as stable destinations on phones. Keep the current study identifiable when panels change.
- Apply the requested glass material to surrounding chrome and floating surfaces. Keep image pixels and report body surfaces opaque and stable. Use solid fallbacks when transparency is reduced or backdrop filtering is unavailable.
- Test light and dark themes independently: translucency changes effective contrast depending on what lies behind it.
- Expose offline/model-not-loaded status in plain language. The absence of a model must not prevent scan viewing or report export.

### P1: interaction defects to verify and fix

These were identified by source review and require browser reproduction before being marked fixed:

| Candidate | Evidence | Acceptance condition |
| --- | --- | --- |
| Rename cancellation/duplicate commit | `Toolbar.tsx` binds commit to blur and Enter, while Escape only exits editing. | Escape never changes the saved title; Enter commits exactly once; ordinary blur commits once. |
| Analyze readiness | `AnalyzeAll` excludes only offline and model-missing, leaving unknown/checking actionable. | The UI communicates checking state and starts analysis only when its required service is ready; other local functions remain usable. |
| Tablet viewport compression | Width budget above and abrupt 1023/1024 breakpoint. | A useful image viewport survives at 768, 1024 and 1280px without horizontal document overflow or inaccessible controls. |
| Keyboard dialog traversal | Shared `Sheet` uses a selector that includes disabled inputs/selects and tabindex values. | Tab and Shift+Tab cycle through only enabled, visible controls; Escape closes; focus returns to the trigger. |

The volume header's “Patient not linked” is correct for the inspected source model and must not be replaced with the active radiograph patient's identity. The separate volume context deliberately prevents that identity mix-up.

## Target experience

The central task is: open the right study, inspect its source images, review the findings, and export the intended report with an explicit understanding of what is being shared.

- Desktop: stable worklist, large image, contextual findings/report panel; collapsible panels and clear active tools.
- Tablet: two useful regions at a time, comfortable touch controls, quick access to the third region.
- Phone: one primary region, persistent bottom navigation, compact patient/study context and scrollable sheets that respect the safe area.
- Visual language: neutral surfaces, restrained teal accent, generous control spacing, quiet separators and selective glass material. Critical status uses text and shape as well as color.

## Repeatable quality-control loop

1. Capture the current empty worklist, loaded public sample, findings, report and settings at phone (390×844), tablet (768×1024 and 1024×768), desktop (1440×900), and a narrow phone (360px). Record the theme and exact scenario.
2. Attempt each core task with pointer, keyboard and touch-sized targets. Check focus visibility, meaningful names, loading/error recovery, long study titles, no-results search and small-height landscape.
3. Fix the observed faults as a batch. Capture the same states again and compare, rather than changing the test scenario to avoid the fault.
4. Exercise sharing with missing reports, empty studies, rejected clipboard permissions, canceled native sharing, unavailable native sharing, public sample links and imported volumes. Confirm that no ordinary URL is described as a hosted patient share.
5. Run the existing regression suite and production build. Preserve report provenance, stale-report warnings, accepted/dismissed findings, volume coverage and source-slice navigation.
6. Record what was actually tested, pass/fail evidence and remaining infrastructure limitations separately. UI inspection is not clinical validation, penetration testing, or production authentication approval.

For hosted sharing, additional release gates are mandatory implementation work: server-side scope checks, expiry enforcement, revoke behavior, request rate limits, event history, cross-account isolation and recovery from expired sessions. These cannot be certified from local export tests.

## Large-userbase architecture assessment

Updated 10 November 2026 after the scope expanded to containerization, database persistence, account management and admin analytics. The preceding baseline describes the repository at the start of the review. A server implementation is being added separately; its tests and deployment documentation, rather than this design proposal, determine its delivered guarantees.

The baseline architecture cannot support a shared large-userbase service by replicating the Vite application alone. Browser IndexedDB is device-local; browser memory owns processing queues; image payloads are embedded in study objects; model requests go to separately operated inference hosts. Containers improve reproducibility but do not create database isolation, distributed work scheduling or measured capacity.

### Recommended service boundaries

| Layer | Initial deliverable | Scale-out direction and release evidence |
| --- | --- | --- |
| Web | Built static assets and same-origin reverse proxy | Cache versioned assets at the edge; never cache authenticated API responses or patient payloads publicly. Test phone payload and rendering costs separately from API throughput. |
| API | Authenticated Node API with persisted sessions and explicit ownership checks | Stateless replicas behind a load balancer; bounded request sizes, connection pool and timeouts. Load-test representative metadata and payload distributions. |
| Identity | Server-created account, password verification, HttpOnly session cookie, server-side role check | Institutional OIDC/SSO, MFA, invitation/reset lifecycle, session revocation and independent audit. Never infer admin authorization from a visible UI tab. OWASP recommends server-enforced expiry and logout invalidation. [Session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet). |
| Database | PostgreSQL for accounts, sessions, study records, shares and audit events | Migrations, backup/restore drill, point-in-time recovery, index/query-plan review, pool budgets across replicas. Add a tenant key to every owned resource before multi-organization hosting. PostgreSQL row-security policies can enforce per-row access as an additional boundary; ordinary application ownership checks are still necessary. [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). |
| Image storage | Explicit, bounded study saves | Move original DICOM/NRRD and large raster objects to protected object storage; database stores metadata and object references. Use checksum verification, short-lived authorized downloads and lifecycle rules. Embedded base64 JSON is unsuitable as the long-term bulk-image transport. |
| Inference | Existing model service connection | Separate durable queue and GPU workers, idempotent job IDs, retry/dead-letter policy, per-organization quotas and cancellation. Scale workers on queue age/depth and available GPU capacity. Browser progress is not a global scheduler. |
| Analytics | Actual local aggregates and authenticated server aggregates, separately labeled | Durable, allowlisted product events plus scheduled aggregate tables. Partition and expire events; avoid expensive full-table scans per dashboard refresh. Do not log clinical text, scans, patient identifiers, tokens or passwords. |
| Operations | Container health/readiness and persistent database volume | TLS, secrets manager, migration rollout, restore verification, metrics/alerts and capacity targets. Kubernetes HPA changes replica counts from observed metrics; deploying it alone is not proof of scalability. [HPA documentation](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/). |

### Admin metrics contract

`GET /api/admin/metrics` must authenticate the session, check the administrator role on the server and return only counts scoped to the authorized organization. Response keys: `scope: "organization"`, ISO `generatedAt`, `users: {total, active30d}`, `studies: {total}`, `images: {total}`, `reports: {total, signed}`, `shares: {active, revoked}`, `jobs: {queued, running, failed, available}`, `events: {total30d}`. Counts are nonnegative safe integers; active users cannot exceed registered users, and signed reports cannot exceed reports. If server job tracking does not exist, `jobs.available` is false and the UI says unavailable rather than displaying invented zero activity.

The browser view derives counts from existing image studies only. It neither counts registered users nor uploads its aggregates. Organization totals include only server-persisted records, excluding unsaved browser studies. Dates, definition of active usage and retention windows must accompany any future trend chart.

For a future multi-tenant service, authenticate organization membership independently of a request-supplied tenant ID. Events need server-assigned actor/tenant context, allowlisted event names, UTC timestamps, idempotency keys and retention. Keep operational analytics separate from detailed clinical audit trails. A defensible retention period depends on deployment policy and jurisdiction; this document does not invent one.

### Scale readiness gates

Before claiming a supported concurrency or user count, benchmark a realistic mix of sign-in, worklist pagination, save/load, sharing and inference. Record p50/p95/p99 latency, error rates, database connections, queue delay, CPU/memory, object throughput and cost. Repeat with a failed API replica, database restart, expired session, revoked share and worker retry. Verify cross-user and cross-tenant isolation with adversarial IDs. A successful local build or one-container smoke test does not meet these gates.
