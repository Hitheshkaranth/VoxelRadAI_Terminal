CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
 role text NOT NULL CHECK (role IN ('admin','clinician')), disabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS studies (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id),
 payload jsonb NOT NULL, image_count integer NOT NULL DEFAULT 0,
 has_report boolean NOT NULL DEFAULT false, report_signed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studies_owner_idx ON studies(owner_id);
CREATE TABLE IF NOT EXISTS audit_events (
 id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 event_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at);
CREATE TABLE IF NOT EXISTS share_grants (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), study_id uuid NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
 token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE share_grants ADD COLUMN IF NOT EXISTS snapshot_html text;
CREATE TABLE IF NOT EXISTS login_attempts (
 key_hash text PRIMARY KEY, attempts integer NOT NULL, resets_at timestamptz NOT NULL
);
