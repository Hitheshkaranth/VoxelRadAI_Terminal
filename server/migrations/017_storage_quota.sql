-- Per-user storage allowance (default STORAGE_QUOTA_BYTES, 10 GiB) covering saved studies (scans, patient data,
-- reports, AI analysis and the user's review decisions), uploaded volumes and the user's dictation feedback.
-- NULL quota = the server default. Study sizes are recorded at write time so usage is a cheap indexed sum.
ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_quota_bytes bigint CHECK (storage_quota_bytes IS NULL OR storage_quota_bytes BETWEEN 0 AND 1099511627776);
ALTER TABLE studies ADD COLUMN IF NOT EXISTS payload_bytes bigint NOT NULL DEFAULT 0;
ALTER TABLE studies ADD COLUMN IF NOT EXISTS image_bytes bigint NOT NULL DEFAULT 0;
ALTER TABLE studies ADD COLUMN IF NOT EXISTS analysis_bytes bigint NOT NULL DEFAULT 0;
UPDATE studies s SET
  payload_bytes = octet_length(s.payload::text),
  image_bytes = COALESCE((SELECT sum(octet_length((i.img - 'analysis')::text)) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload->'images')='array' THEN s.payload->'images' ELSE '[]'::jsonb END) AS i(img)), 0),
  analysis_bytes = COALESCE((SELECT sum(octet_length((i.img->'analysis')::text)) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload->'images')='array' THEN s.payload->'images' ELSE '[]'::jsonb END) AS i(img) WHERE i.img ? 'analysis'), 0)
WHERE s.payload_bytes = 0;
CREATE INDEX IF NOT EXISTS dictation_events_user_idx ON dictation_events(user_ref);
