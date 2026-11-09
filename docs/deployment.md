# Container deployment and database operations

Skanda now has two modes: the existing local-only Vite application, and a server build with mandatory sign-in. The Compose web build enables `VITE_SERVER_MODE=true`. Accounts, sessions, explicitly uploaded image studies, share snapshots and aggregate activity live in PostgreSQL. Browser-local studies are not automatically uploaded. Full NRRD volumes and inference jobs remain browser/model-service workflows.

## Run a private installation

1. Copy `config.example` to `.env` at the repository root.
2. Set a unique, URL-safe `POSTGRES_PASSWORD` (hex or base64url), `BOOTSTRAP_ADMIN_EMAIL`, and a random `BOOTSTRAP_ADMIN_PASSWORD` of at least 12 characters. No credentials are shipped. Keep `.env` private; it is ignored by Git.
3. Run `docker compose up -d --build`.
4. Open `http://localhost:8088`. Sign in with the bootstrap account. Open Settings → Admin & analytics → Organization to create clinician accounts and inspect actual server activity.
5. After the first administrator exists, remove bootstrap values from `.env` and recreate the API: `docker compose up -d api`. Bootstrap never overwrites an existing account.

The default published port is loopback-only. For remote use, place an HTTPS reverse proxy in front of the web service, set `PUBLIC_ORIGIN` to its exact HTTPS origin, set `ALLOW_INSECURE_LOCALHOST=false`, and recreate the API. Forward the original `Origin` header. Do not publish PostgreSQL, the API, or model service ports to the Internet. Use a secrets manager instead of an environment file for managed production infrastructure.

The web service proxies model requests to the host's ports 1234, 8765 and 8766 after checking the server session. The GPU/model service is not bundled in the web image. On Linux, configure the model listener/firewall to accept the Docker bridge; host loopback listeners are not reachable through `host.docker.internal`. Model weights, GPU capacity and inference deployment remain separate concerns.

## Services and scale boundaries

| Service | State | Scaling behavior |
| --- | --- | --- |
| Web / Nginx | Immutable frontend assets | Can run behind a load balancer/CDN; API, shares and HTML must not be cached |
| API / Node | PostgreSQL sessions, rate-limit buckets and records | Replicas share login/session state; no sticky session requirement |
| PostgreSQL 17 | Named durable volume | Single-instance Compose database; use managed HA PostgreSQL and PITR for production |
| Model services | Model/GPU memory | Independently provision; a durable distributed inference queue is not implemented |

For a local replica smoke test: `docker compose up -d --scale api=2`. Budget database connections as `API replicas × DB_POOL_SIZE`, leaving capacity for maintenance and other clients. Docker DNS lets Nginx discover API replicas. This proves deployability, not throughput capacity; measure concurrent logins, study reads/uploads and slow-model behavior before selecting a user-capacity target.

This is a bounded single-organization foundation. Study snapshots currently use JSONB with a 25 MB upload limit; duplicating image bytes in JSON and share snapshots is unsuitable for a large PACS. Move DICOM/NRRD and display assets to private object storage with scoped, short-lived downloads; retain metadata and permissions in PostgreSQL. Before multi-organization SaaS, add tenant membership and database-enforced tenant isolation. Do not interpret global administrator totals as tenant-filtered data.

## Database backup and restore

Keep the `postgres-data` volume. `docker compose down` preserves it; **`down -v` destroys it**. Container recreation is not a backup.

Create a consistent custom-format database backup without PowerShell binary-redirection corruption:

```sh
docker compose exec -T db pg_dump -U skanda -d skanda -Fc -f /tmp/skanda.backup
docker compose cp db:/tmp/skanda.backup ./skanda.backup
```

Encrypt and access-restrict backups: they contain patient records and credential hashes. Move them to a separate storage system, apply a retention policy and test restoration regularly. For managed deployments, enable continuous WAL archiving/PITR in addition to snapshots. PostgreSQL documents logical backups in [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).

Restore into a **new, empty database**, inspect it, and only then plan a controlled cutover:

```sh
docker compose cp ./skanda.backup db:/tmp/skanda-restore.backup
docker compose exec -T db createdb -U skanda skanda_restore
docker compose exec -T db pg_restore -U skanda -d skanda_restore --no-owner --exit-on-error /tmp/skanda-restore.backup
```

Do not overwrite a live database to test a backup. Use a separate migration owner and a restricted runtime database role in production; the bundled private Compose setup uses a single application database owner for bootstrap/migrations. Test new migrations against a restored copy before rollout. Health-gated startup follows [Docker Compose readiness semantics](https://docs.docker.com/compose/how-tos/startup-order/).

## Verification and known deployment gaps

Run `npm test` and `npm run build` in `app`, and `npm test` in `server`. `server/test/integration.mjs` targets a disposable deployment using `BASE_URL`, `TEST_ADMIN_EMAIL`, and `TEST_ADMIN_PASSWORD`; it creates synthetic accounts/studies. Do not run it against patient production data.

Required before broad clinical deployment: browser/device visual and touch QA, accessibility audit, representative load testing, external security review, SSO/MFA and an organizational recovery policy, TLS termination, encrypted database/object storage, backup restore drills, least-privilege runtime credentials, centralized operational metrics, retention/deletion policy, and independent clinical validation. The existing clinical model limitations remain unchanged. Shared links are bearer credentials: anyone who receives one can read its snapshot until expiry/revocation; recipients may retain downloaded copies.

## Account recovery and operational visibility

The API now supports current-password changes and administrator-issued recovery codes. Recovery requires an active administrator to verify the user's identity outside the application, re-enter their own password, and securely deliver a 15-minute, one-time code. No outbound mail service or identity provider is configured. Password changes, completed recovery, administrative password resets and disabling accounts invalidate sessions and outstanding recovery codes. See the [API contracts](../server/README.md).

`GET /api/admin/operations` exposes authenticated, administrator-only process metrics: request counts, status classes, latency totals, database pool pressure and memory. Each request receives a random `X-Request-ID`. Structured application completion logs omit request URLs, bodies, cookies and patient/user identifiers. Aggregate these per-replica logs in the deployment's monitoring system; the process endpoint resets on restart and is not a distributed metrics store.

Use `server/test/load.mjs` for a bounded authenticated-session load smoke; use the integration harness for recovery/revocation races and owner isolation. Neither replaces representative image-upload or inference load testing. [server/capabilities.json](../server/capabilities.json) explicitly identifies absent MFA, SSO, multi-tenant isolation, full-volume object storage and durable inference jobs. Do not advertise or enable those capabilities based only on container health.
