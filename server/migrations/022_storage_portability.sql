-- Portable object storage and consented training retrieval.
-- storage_location ("gcs:bucket", "aws:bucket") records where each saved volume's bytes live, so
-- scripts/migrate-object-storage.mjs can move a bucket to another provider and resume safely. NULL rows were saved
-- before this column and are backfilled with the configured location when the server starts.
ALTER TABLE volume_objects ADD COLUMN IF NOT EXISTS storage_location text;
CREATE INDEX IF NOT EXISTS volume_objects_location_idx ON volume_objects(storage_location) WHERE state = 'ready';

-- Whole saved CT/MRI volumes go to training only with this second, separate opt-in (the first covers sampled slices).
ALTER TABLE users ADD COLUMN IF NOT EXISTS training_volume_consent boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS training_volume_consent_at timestamptz;

-- De-identified copies written by scripts/export-training-volumes.mjs: no owner, volume ID, title or file name, only
-- keyed pseudonyms, the acquisition context, the geometry fields kept from the NRRD header and the month saved.
-- This table is the analytics and training index; training/manifest/volumes.jsonl in the bucket mirrors it.
CREATE TABLE IF NOT EXISTS training_volumes (
  ref text PRIMARY KEY,
  user_ref text NOT NULL,
  object_key text NOT NULL UNIQUE,
  storage_location text NOT NULL,
  modality text NOT NULL DEFAULT '',
  body_part text NOT NULL DEFAULT '',
  sequence text NOT NULL DEFAULT '',
  contrast text NOT NULL DEFAULT 'unknown',
  intensity_is_hu boolean,
  header jsonb NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL,
  saved_month text NOT NULL CHECK (saved_month ~ '^\d{4}-\d{2}$'),
  exported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_volumes_location_idx ON training_volumes(storage_location);
CREATE INDEX IF NOT EXISTS training_volumes_modality_idx ON training_volumes(modality, body_part);
