# Optional private volume storage

Works with any provider that speaks the S3 API: AWS S3 (`STORAGE_PROVIDER=aws`, the default), Google Cloud Storage (`gcs`) or another S3-compatible service (`s3-compatible`, with `S3_ENDPOINT`). The object key layout is the same everywhere, so a bucket can be moved to another provider later (see *Moving to another provider*).

Disabled by default. Use `compose.yaml` with `compose.integrations.yaml`. Set `S3_STORAGE_ENABLED=true`, `S3_BUCKET` and `AWS_REGION` after configuring your private bucket. Credentials use the AWS SDK default credential chain; prefer a deployment role. Never commit credentials. For environment credentials, the overlay forwards AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and optional AWS_SESSION_TOKEN.

Block public access, require TLS and configure encryption. The overlay defaults to AES256; for KMS set S3_SERVER_SIDE_ENCRYPTION=aws:kms and S3_KMS_KEY_ID and grant the deployment role the necessary key permissions. Grant object read/write/delete only for this application's `pending/` and `volumes/` prefixes. Configure bucket CORS for the exact application origin with POST and GET, signed request headers, and exposed ETag. Set a one-day expiration lifecycle for `pending/` objects, including noncurrent versions if versioning is enabled. Establish retention and deletion rules for finalized versions separately.

In Settings, Saved volumes uploads an imported NRRD and its acquisition context. Findings and jobs are not uploaded. Upload policies bind the exact byte count and generated staging key. Finalization checks size, metadata and NRRD magic, then conditionally copies to an immutable ready key. This is not full NRRD validation. Downloads require ownership and expire after 60 seconds; already issued links remain usable until expiry. Deletion removes the current object; bucket version retention may retain previous versions.

Defaults: 512 MiB per volume, 5 GiB per owner and 10 active pending reservations. Override S3_MAX_VOLUME_BYTES and S3_OWNER_QUOTA_BYTES as appropriate. Optional S3_ENDPOINT/S3_PUBLIC_ENDPOINT and S3_FORCE_PATH_STYLE support compatible services; HTTP requires explicit ALLOW_INSECURE_S3=true and is unsuitable for production traffic. Exact configured storage origins are checked by the browser.

Unit tests use controlled storage and genuine SDK policy generation. Actual AWS upload/download, CORS, IAM, encryption and restore acceptance remain pending deployment configuration. Configure the pending-object lifecycle even when application cleanup runs: a previously signed upload can recreate its staging object until its policy expires.

## Google Cloud Storage

1. Create a private bucket in `asia-south1` (Mumbai) with uniform bucket-level access and public access prevention on. Encryption at rest is always on; for your own key set a default Cloud KMS key on the bucket (leave `S3_SERVER_SIDE_ENCRYPTION` unset: GCS rejects the AWS headers).
2. Add lifecycle rules: delete objects under `pending/` after 1 day.
3. Set CORS on the bucket for the exact app origin, methods `POST` and `GET`, response headers `Content-Type`.
4. Create a service account with **Storage Object User** on this bucket only, then an HMAC key for it (Cloud Storage → Settings → Interoperability). The secret is shown once; put it straight into the deployment's secret store.
5. Configure: `S3_STORAGE_ENABLED=true`, `STORAGE_PROVIDER=gcs`, `S3_BUCKET=<bucket>`, `S3_ACCESS_KEY_ID=<HMAC access id>`, `S3_SECRET_ACCESS_KEY=<HMAC secret>`. The endpoint defaults to `https://storage.googleapis.com` and the signing region to `auto`. The SDK's default request checksums are turned off for non-AWS providers.

`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` work for every provider; without them the AWS SDK default credential chain applies.

## Moving to another provider

Each saved volume's row records where its bytes live (`storage_location`, e.g. `gcs:radgenis-volumes`). To move:

1. Create and configure the new bucket as above (lifecycle, CORS, access).
2. From an operator machine, with `DATABASE_URL`, the **new** bucket in the usual variables and the **old** one in the same variables prefixed `FROM_` (`FROM_STORAGE_PROVIDER`, `FROM_S3_BUCKET`, `FROM_S3_ACCESS_KEY_ID`, …), run `npm run storage -- migrate --dry-run`, then `npm run storage -- migrate` (in `server/`). Each object is copied with its SHA-256, its size is checked on the target, and only then does its row point at the new bucket. The app keeps serving from the old bucket meanwhile.
3. Switch the deployment's variables to the new bucket and redeploy.
4. Run `npm run storage -- migrate` once more for volumes saved in between. Until it finishes, those few volumes answer "being moved, try again in a few minutes" instead of failing.
5. When the command reports nothing left in the old bucket and downloads work, delete the old bucket's objects yourself. The script never deletes source objects.

The command is resumable: rerun it after any failure; moved objects are skipped.

## Analytics and training retrieval

Volume metadata (modality, body region, sequence, contrast, size, dates) lives in Postgres (`volume_objects`), so analytics query the database, not the bucket.

Whole volumes reach training only when training capture is on (`TRAINING_CAPTURE=on`, `TRAINING_PSEUDONYM_SECRET`) **and** the owner has turned on both choices in Settings → Model improvement: the general one and the separate *Also share my saved CT and MRI volumes*. Then run `npm run storage -- export-training` (add `--limit=N`, `--dry-run`). For each consented, not yet exported volume it writes `training/volumes/<pseudonym>.nrrd` with a header reduced to geometry (comments, `key:=value` pairs, `content`, labels and units are removed; voxels are unchanged, so head scans are not defaced), records it in `training_volumes`, and rewrites `training/manifest/volumes.jsonl`: one JSON line per volume with pseudonyms, acquisition context, geometry, size, SHA-256 and the month saved. Reruns skip exported volumes; `npm run storage -- manifest` rebuilds the manifest alone. Each run first deletes copies older than `TRAINING_RETENTION_DAYS` (default 365), object and row; a volume still saved and still consented is copied again with a new date.

Give the training team read access to the `training/` prefix only (on GCS an IAM condition on `resource.name.startsWith("projects/_/buckets/<bucket>/objects/training/")`; on AWS a prefix-scoped policy), never to `volumes/` or `pending/`. Training copies move with the bucket in a migration.
