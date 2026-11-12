-- Sessions end after a period without requests, as well as at their absolute expiry.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at timestamptz NOT NULL DEFAULT now();
