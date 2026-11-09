# Skanda API

Node 24 + PostgreSQL service. Start with `npm ci` then `npm start`. Startup applies ordered SQL migrations with recorded checksums under an advisory transaction lock. Editing an applied migration stops startup; add a new numbered migration instead. See the root compose setup for containers.

Environment:

- `DATABASE_URL` required; use a dedicated database/role.
- `PUBLIC_ORIGIN` exact browser origin, default `http://localhost:5173`. Mutating requests must send this Origin.
- `PORT` defaults to 8080; `DB_POOL_SIZE` defaults to 10 per replica.
- `NODE_ENV=production` requires an HTTPS origin. `ALLOW_INSECURE_LOCALHOST=true` is accepted only for loopback origins during local evaluation.
- `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` create an administrator only if the user table is empty; password must have 12–256 characters. No default credentials. Remove these variables after provisioning.

Sessions use random 256-bit tokens, SHA-256 hashes stored in Postgres, eight-hour absolute expiry, HttpOnly SameSite=Strict cookies (Secure on HTTPS), and server checks on every protected request. Passwords use salted scrypt. Login verification and session creation hold a user-row transaction lock, so password resets cannot leave a new session created with the old password. Login throttling is an atomic Postgres per-email hash counter (15 attempts/15 minutes) shared across replicas. A production edge should additionally rate-limit abusive clients; forwarded IP headers are not implicitly trusted.

## API

- GET `/api/session`; POST `/api/login`, `/api/logout`
- GET `/api/auth/check` returns 200/401 for reverse-proxy inference authorization.
- GET/POST `/api/admin/users`, GET `/api/admin/metrics` require admin role.
- PATCH `/api/admin/users/:id` accepts `disabled` or a new `password`. Disabling or resetting a password revokes all of that user's sessions; self-disable is rejected. Share grants remain independently revocable.
- GET/POST `/api/studies`, GET/DELETE `/api/studies/:id` are owner scoped. Lists use `limit` (1–100) and `offset` (0–1,000,000), return metadata only, and include a total. Invalid pagination returns 400. Fetch one study to restore its payload. POST is an explicit full-study upload/upsert with nested payload validation and a 25 MB limit. Local browser state is not automatically counted as server data.
- GET/POST `/api/studies/:id/shares`; POST selects `expiresInHours` (1–168), `includeIdentity`, and `includeImages`. Returns a bearer link once; its raw token is not stored.
- DELETE `/api/shares/:id` revokes an owned grant. GET `/api/shared/:token` serves an inert report snapshot while the grant remains valid. Any holder of that link can view it. No recipient verification is implemented. Requests do not log raw tokens or patient text.

Shared content defaults to omitting identity and images. Snapshot HTML escapes text and accepts only embedded raster images. Responses prohibit external resources, scripting, framing, storage in caches and referrers. Revocation stops future requests; it cannot erase copies recipients already captured. Sharing is not a validated clinical signature or a recipient identity assertion.

## Database and scaling boundaries

The service can run multiple replicas sharing PostgreSQL; no session or rate-limit state is in process memory. Bound total connections by replica count × `DB_POOL_SIZE`. Migrations are serialized and checksummed. Back up and rehearse forward/rollback procedures before applying schema changes to production.

Studies and image data URLs currently live in JSONB with a 25 MB request cap. This is a transitional persistence implementation for app display copies, not a large-volume PACS. Large DICOM/volume objects require encrypted object storage, signed owner-scoped object access, validated metadata and background import jobs. No persistent inference queue exists; admin jobs are explicitly unavailable. Automatic study sync/conflict resolution, verified-recipient shares, MFA, password recovery, durable audit export and retention enforcement are not implemented here.

Use TLS termination and managed database backup/encryption/restore procedures appropriate to the deployment. Keep inference services behind the authenticated proxy, not publicly exposed ports. Operational security and clinical/regulatory validation are deployment work beyond these tests.

## Tests

`npm test` runs password/session/origin and inert export tests. `TEST_ORIGIN`, `TEST_ADMIN_EMAIL`, `TEST_ADMIN_PASSWORD` plus `node test/integration.mjs` exercise a disposable running deployment: login, clinician/admin separation, owner isolation, sharing, revoke, delete and logout. The integration test creates a test clinician and removes its study; it leaves the test user for audit.
