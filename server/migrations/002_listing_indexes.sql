CREATE INDEX IF NOT EXISTS studies_owner_updated_idx ON studies(owner_id,updated_at DESC,id);
CREATE INDEX IF NOT EXISTS shares_owner_study_created_idx ON share_grants(owner_id,study_id,created_at DESC);
CREATE INDEX IF NOT EXISTS users_created_idx ON users(created_at DESC,id);
