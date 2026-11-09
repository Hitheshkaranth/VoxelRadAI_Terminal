# Platform and UX implementation QC — 10 November 2026

## Scope and research

The work used three delegated implementation/review tracks plus integration review. The [product research](../ux/2026-11-09-radiology-product-review.md) compares official OHIF, RadiAnt, Horos, Sectra, PocketHealth and related imaging workflows. These are representative comparators, not a measured market-share ranking.

Implemented: responsive glass navigation with opaque clinical content; tablet panel budgeting; mobile tool disclosure; X-ray image stepping/brightness/contrast; CT/MRI zoom/window controls; shared three-plane zoom and linked 3D slice stepping; account login; administrator analytics and account lifecycle; explicit server study save/restore; portable file exports and hosted snapshot links; PostgreSQL and container deployment.

## Review/fix iterations

| Pass | Findings | Changes and evidence |
| --- | --- | --- |
| Existing UX/source audit | Light glass differed from dark; tablet side panels crowded the scan; mobile volume toolbar used excessive height; rename Escape/Enter behavior and model-readiness controls were inconsistent | Reworked material tokens/fallbacks, mutually exclusive tablet panels, More tools disclosure, rename commit/cancel handling, and online-only analysis action |
| Workflow/security audit | No existing server identity or hosted links; account switching could share browser storage; external study restore needed runtime validation | Added server-mode gate, per-account IndexedDB namespaces, HttpOnly sessions, RBAC, owner queries, explicit upload/restore, strict payload checks, opaque expiring share tokens and revocation |
| Navigation/interaction audit | Three-plane zoom controls did not affect its canvases; mobile controls could sit below the plane stack; input could pass blank/NaN values; modal shortcuts could change the viewer underneath | Shared zoom geometry, controls before the plane stack, bounded slice/zoom helpers, linked 3D stepping, dialog-safe shortcuts and enabled-control focus trapping |
| Container/integration audit | Initial running image predated null-body validation; bulk study payload listing would grow excessively; session reset raced concurrent login; read-only container rejected `docker cp` | Rebuilt current source; paginated metadata plus individual payload retrieval; transaction-locked account/session changes; streamed synthetic tests through stdin without relaxing read-only containers |
| Final integration review | Lazy component CSS could override material rules; logout reload could be delayed by a running-job prompt; closing restore could apply results after dismissal | Eager ordered CSS with lazy JavaScript, immediate session-gate concealment, and mounted-state guard before restore mutation |

## Executed checks

| Check | Result |
| --- | --- |
| `app`: `npm test` | All 24 TypeScript suites passed, including existing imaging/report/geometry tests and new display, session, sharing, analytics and restore tests |
| `server`: `npm test` | 9 tests passed: password/session security, origin rejection, snapshot escaping/identity, validation, pagination, migration checksum/rollback |
| Production build in Docker | Passed. Three JS chunks approximately 233 KB, 300 KB and 86 KB; former single-chunk >500 KB warning eliminated |
| Compose image builds and health checks | PostgreSQL, non-root/read-only web, and two non-root/read-only API replicas healthy |
| Full synthetic integration through Nginx and PostgreSQL | Passed: login/logout, bad origin, null/oversized JSON, invalid pagination, admin RBAC, provisioning/reset/disable, owner isolation, paginated save/restore, inert HTML, revoke, actual database expiry, DB-backed throttle, concurrent password-reset/login regression |
| Unauthenticated model access | `/lmstudio/v1/models` rejected with 401 at Nginx |
| HTML security headers | `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff` verified |
| Replica-stack smoke | 64 authenticated session reads at concurrency 16 passed; observed local p95 50 ms. This is not a capacity benchmark or SLA |
| Database backup/restore | `pg_dump -Fc` restored successfully into a separate empty test database; two accounts and two migration records verified from that snapshot |
| Design detector | No findings for inspected changed UI targets. This does not replace visual/accessibility testing |

All integration data was synthetic. No patient study was transmitted during testing. The isolated stack uses project name `skanda-qc` and ignored `.env.qc`; its test database is separate from any production setup. Credentials are not included in this record.

## Unverified and deferred

**Live browser screenshots, visual contrast measurements, keyboard traversal and real touch interaction were not verified.** The browser host was unavailable; native Chrome control then stopped because the tool could not determine its URL confidently. No substitute browser automation bypass was used. Responsive changes were reviewed in source and covered where possible by geometry/control tests.

Before release, manually exercise light/dark and glass/solid at 360×800, 390×844, 768×1024, 1024×768 and 1440×900. Check X-ray image stepping, zoom/brightness/reset, CT/MRI single/three-plane views, cine/slice endpoints, 3D stepping, modal focus, long titles, offline errors, login, admin lifecycle, save/restore and link creation/revocation. Check native-share cancel and clipboard-denied recovery on actual mobile browsers.

No new clinical-model validation or GPU/inference throughput test was performed. Full-volume cloud storage/sharing, object storage, distributed inference jobs, multi-tenant SaaS isolation, SSO/MFA and self-service recovery remain outside this foundation. The admin panel explicitly marks unavailable job telemetry. See [deployment boundaries and operations](../deployment.md).
