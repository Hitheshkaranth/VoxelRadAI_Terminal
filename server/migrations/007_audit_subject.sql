-- Audit events name what they acted on (study, share or account ID) so administrators can trace and export them.
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS subject_id text;
CREATE INDEX IF NOT EXISTS audit_events_type_created_idx ON audit_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_share_opened_idx ON audit_events(subject_id) WHERE event_type = 'share.opened';
