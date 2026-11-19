-- Server-to-server API access: administrator-issued keys and asynchronous model reads.
-- Keys are stored only as SHA-256 hashes; the plaintext is shown once at creation.
-- An organisation is its own record: names are labels only and may repeat, so two customers an
-- administrator happens to name alike never share reads. Every access check uses organisation_id.
CREATE TABLE IF NOT EXISTS api_organisations (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS api_keys (
 id uuid PRIMARY KEY,
 organisation_id uuid NOT NULL REFERENCES api_organisations(id),
 owner_id uuid REFERENCES users(id) ON DELETE SET NULL,
 label text NOT NULL,
 prefix text NOT NULL,
 key_hash text UNIQUE NOT NULL,
 kind text NOT NULL CHECK (kind IN ('live','test')),
 daily_read_limit integer CHECK (daily_read_limit BETWEEN 0 AND 10000),
 -- Reference to a signed data agreement, kept for a future opt-in. API reads are never captured for training.
 data_agreement_id text,
 -- True when a webhook signing secret was derived and shown at creation. Keys issued while
 -- API_WEBHOOK_SECRET was unset never received one, so they cannot register webhooks.
 webhook_secret_issued boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz,
 revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_keys_created_idx ON api_keys(created_at DESC);
CREATE INDEX IF NOT EXISTS api_keys_organisation_idx ON api_keys(organisation_id);
CREATE TABLE IF NOT EXISTS api_reads (
 id uuid PRIMARY KEY,
 key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
 status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
 -- Full request (with image data) only until the read finishes; then image parts are removed.
 request jsonb,
 request_hash text NOT NULL,
 idempotency_key text,
 result jsonb,
 error jsonb,
 webhook_url text,
 -- End of the UTC day the read was counted against (the limiter row's resets_at). A refund applies to that day only.
 quota_resets_at timestamptz,
 -- Set by the first refund, so a read is refunded at most once.
 refunded_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz,
 finished_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE UNIQUE INDEX IF NOT EXISTS api_reads_idempotency ON api_reads(key_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS api_reads_expires_idx ON api_reads(expires_at);
CREATE INDEX IF NOT EXISTS api_reads_active_idx ON api_reads(created_at) WHERE status IN ('queued','running');
