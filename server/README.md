# Skanda API

Node 24 + PostgreSQL service. Start with `npm ci` then `npm start`. Startup applies ordered SQL migrations with recorded checksums under an advisory transaction lock. Editing an applied migration stops startup; add a new numbered migration instead. See the root compose setup for containers.

Environment:

- `DATABASE_URL` required; use a dedicated database/role.
- `PUBLIC_ORIGIN` exact browser origin, default `http://localhost:5173`. Mutating requests must send this Origin.
- `PORT` defaults to 8080; `DB_POOL_SIZE` defaults to 10 per replica.
- `NODE_ENV=production` requires an HTTPS origin. `ALLOW_INSECURE_LOCALHOST=true` is accepted only for loopback origins during local evaluation.
- `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` create an administrator only if the user table is empty; password must have 12–256 characters. No default credentials. Remove these variables after provisioning.

Sessions use random 256-bit tokens, SHA-256 hashes stored in Postgres, eight-hour absolute expiry plus an idle timeout (`SESSION_IDLE_MINUTES`, default 60, 5–480), HttpOnly SameSite=Strict cookies (Secure on HTTPS), and server checks on every protected request. Passwords use salted scrypt (N=2^17, r=8, p=1); older N=2^14 hashes still verify and are re-hashed at the next sign-in. Login verification and session creation hold a user-row transaction lock, so password resets cannot leave a new session created with the old password. Login throttling uses atomic Postgres hash counters shared across replicas: 15 attempts per email and 60 per client address per 15 minutes; a successful sign-in resets the email counter. The client address is the socket peer unless `VERCEL` is set or `TRUST_PROXY_HEADERS=true` (the bundled nginx sets `X-Real-IP`; Compose enables this). Unauthenticated SSO starts are limited to 30 per client address. A production edge should still rate-limit abusive clients.

## API

- GET `/api/session`; POST `/api/login`, `/api/logout`
- GET `/api/auth/check` returns 200/401 for reverse-proxy inference authorization.
- GET/POST `/api/admin/users`, GET `/api/admin/metrics` require admin role.
- GET `/api/admin/operations` returns process-scoped HTTP counts/latencies, database readiness/pool pressure, memory and explicit feature availability. Counts reset on restart and are not replica-wide totals. Every response has a random `X-Request-ID`; request completion logs contain only that ID, status and duration, never URLs, bodies, cookies or identifiers.
- POST `/api/account/password` accepts `currentPassword` and `password`; success revokes all sessions/recovery codes and clears the cookie. The user must sign in again.
- POST `/api/admin/users` and PATCH `/api/admin/users/:id` with a `password` require the administrator's `currentPassword`; an administrator cannot reset their own password there (use `/api/account/password`). Disabling a user ends their sessions, voids recovery codes and revokes their share links.
- POST `/api/admin/users/:id/recovery` requires the administrator's `currentPassword` and returns a one-time `token` plus `expiresAt`. Deliver this code through an approved secure channel after verifying the user's identity. Codes expire in 15 minutes, are stored only as hashes, and a replacement invalidates earlier codes. The administrator never chooses the user's new password in this flow.
- POST `/api/password-recovery` accepts `token` and a new `password`, without an existing session. It requires the configured Origin. Token consumption, password update and revocation of all sessions occur atomically. Consumed/expired/disabled-account tokens are rejected. Recovery codes must not be put in query strings or persistent browser storage. No email delivery or self-service identity verification is provided.
- PATCH `/api/admin/users/:id` accepts `disabled` or a new `password`. Disabling or resetting a password revokes all of that user's sessions; self-disable is rejected. Share grants remain independently revocable.
- GET/POST `/api/studies`, GET/DELETE `/api/studies/:id` are owner scoped. Lists use `limit` (1–100) and `offset` (0–1,000,000), return metadata only, and include a total. Invalid pagination returns 400. Fetch one study to restore its payload. POST is an explicit full-study upload/upsert with nested payload validation and a 25 MB limit. Local browser state is not automatically counted as server data.
- GET/POST `/api/studies/:id/shares`; POST selects `expiresInHours` (1–168), `includeIdentity`, and `includeImages`. Returns a bearer link once; its raw token is not stored.
- DELETE `/api/shares/:id` revokes an owned grant. New links have the form `/shared#<token>`: the token sits in the URL fragment, which browsers never send, and the static viewer POSTs it to `/api/shared` and renders the inert snapshot in a fully sandboxed frame, so tokens do not reach request logs. GET `/api/shared/:token` still serves links issued before this change until they expire. Any holder of that link can view it. No recipient verification is implemented. Requests do not log raw tokens or patient text.

Shared content defaults to omitting identity and images. Snapshot HTML escapes text and accepts only embedded raster images. Responses prohibit external resources, scripting, framing, storage in caches and referrers. Revocation stops future requests; it cannot erase copies recipients already captured. Sharing is not a validated clinical signature or a recipient identity assertion.

## Database and scaling boundaries

The service can run multiple replicas sharing PostgreSQL; no session or rate-limit state is in process memory. Bound total connections by replica count × `DB_POOL_SIZE`. Migrations are serialized and checksummed. Back up and rehearse forward/rollback procedures before applying schema changes to production.

Studies and image data URLs currently live in JSONB with a 25 MB request cap. This is a transitional persistence implementation for app display copies, not a large-volume PACS. Large DICOM/volume objects require encrypted object storage, signed owner-scoped object access, validated metadata and background import jobs. No persistent inference queue exists; admin jobs are explicitly unavailable. Automatic study sync/conflict resolution, verified-recipient shares, MFA, SSO, self-service email recovery, durable audit export and retention enforcement are not implemented here. The machine-readable [capability manifest](capabilities.json) records these boundaries.

Password changes and recovery issuance are throttled per account; recovery redemption is throttled per hashed recovery code (15 attempts/15 minutes). One exhausted code does not block other users behind the same proxy. Forwarded-IP headers are not trusted. The database stores only hashed limiter keys. Deploy a trusted edge-wide abuse limiter before broad exposure; this per-code limiter is not volumetric denial-of-service protection. Recovery needs another authorized administrator; a sole administrator who loses access must use the deployment's controlled database recovery procedure. Audit events retain actor/type/time; recovery target association is only retained in the expiring token table, so this is not a full forensic account-lifecycle ledger.

Use TLS termination and managed database backup/encryption/restore procedures appropriate to the deployment. Keep inference services behind the authenticated proxy, not publicly exposed ports. Operational security and clinical/regulatory validation are deployment work beyond these tests.

## Tests

`npm test` runs password/session/origin and inert export tests. `TEST_ORIGIN`, `TEST_ADMIN_EMAIL`, `TEST_ADMIN_PASSWORD` plus `node test/integration.mjs` exercise a disposable running deployment: login, clinician/admin separation, owner isolation, sharing, revoke, delete and logout. The integration test creates a test clinician and removes its study; it leaves the test user for audit.

The integration harness also checks recovery reauthentication, replacement invalidation, concurrent single-use redemption, disabled accounts, password-change session revocation and admin-only operations access. Use a fresh disposable deployment or respect throttle windows between repeated runs.

`BASE_URL`, `TEST_ADMIN_EMAIL`, `TEST_ADMIN_PASSWORD` plus `node test/load.mjs` run a bounded authenticated-session smoke (defaults: 100 requests, concurrency 8). Optional `LOAD_REQUESTS` (1–10000) and `LOAD_CONCURRENCY` (1–100) control it. The harness logs percentiles/error counts, not credentials or response bodies, and signs out its test session. It is not an inference-capacity or clinical-throughput benchmark.
