-- Account profile (photo, centre, location, machines, centre logo) and a usage history for the profile's charts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS center_name text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS center_location text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS equipment jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Small images kept as data URLs (validated PNG/JPEG/WebP, size-capped by the API).
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS center_logo text;
-- One row per hosted model read that reached the GPU (refunded reads are not recorded) and per new saved study.
CREATE TABLE IF NOT EXISTS usage_events (
 id bigserial PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('model_read','study_created')),
 modality text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_user_time_idx ON usage_events(user_id, created_at DESC);
