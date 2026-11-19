-- Per-user opt-in for model-improvement capture. Off until the user turns it on in Settings.
ALTER TABLE users ADD COLUMN IF NOT EXISTS training_consent boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS training_consent_at timestamptz;
