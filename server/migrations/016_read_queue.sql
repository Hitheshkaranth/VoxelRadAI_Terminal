-- Durable queue for asynchronous API reads. One executor (the submitting API process or a read worker) holds a
-- read at a time under a renewable lease. A read whose lease runs out (its executor died) goes back to the queue
-- with a short back-off until it has used its attempts, then fails. Constant and now() defaults do not rewrite
-- the table.
ALTER TABLE api_reads ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE api_reads ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE api_reads ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE api_reads ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS api_reads_claim_idx ON api_reads(available_at, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS api_reads_lease_idx ON api_reads(lease_expires_at) WHERE status = 'running';
