-- Tracks which captured records have been copied to durable storage (the Hugging Face dataset).
ALTER TABLE training_cases ADD COLUMN IF NOT EXISTS synced_at timestamptz;
ALTER TABLE dictation_events ADD COLUMN IF NOT EXISTS synced_at timestamptz;
CREATE INDEX IF NOT EXISTS training_cases_unsynced_idx ON training_cases(id) WHERE synced_at IS NULL;
CREATE INDEX IF NOT EXISTS dictation_events_unsynced_idx ON dictation_events(id) WHERE synced_at IS NULL;
