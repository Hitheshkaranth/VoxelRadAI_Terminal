-- Optimistic concurrency for study saves: each write bumps the revision; a client sends the one it last saw.
ALTER TABLE studies ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
