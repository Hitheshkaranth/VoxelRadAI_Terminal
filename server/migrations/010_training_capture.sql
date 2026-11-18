-- De-identified cases and dictation clips kept for improving future models.
-- Patient fields are never stored; study, image and user IDs are replaced by one-way pseudonyms.
CREATE TABLE IF NOT EXISTS training_images (
 sha256 text PRIMARY KEY,
 mime text NOT NULL,
 bytes bytea NOT NULL,
 width int, height int,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS training_cases (
 id bigserial PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('analysis','signed')),
 study_ref text NOT NULL,
 image_ref text,
 image_sha256 text REFERENCES training_images(sha256) ON DELETE SET NULL,
 modality text NOT NULL DEFAULT '',
 model text NOT NULL DEFAULT '',
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS training_cases_created_idx ON training_cases(created_at, id);
CREATE INDEX IF NOT EXISTS training_cases_study_idx ON training_cases(study_ref);
CREATE TABLE IF NOT EXISTS dictation_events (
 id bigserial PRIMARY KEY,
 kind text NOT NULL CHECK (kind IN ('error','empty','undone','corrected')),
 user_ref text NOT NULL,
 language text NOT NULL DEFAULT '',
 transcript text NOT NULL DEFAULT '',
 corrected text NOT NULL DEFAULT '',
 error text NOT NULL DEFAULT '',
 audio bytea,
 audio_mime text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dictation_events_created_idx ON dictation_events(created_at, id);
