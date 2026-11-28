-- Self-service sign-up (email + password, or Google). New accounts wait for an administrator's approval; password
-- sign-ups must also confirm their email first. Existing and administrator-created accounts stay approved and usable.
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval text NOT NULL DEFAULT 'approved' CHECK (approval IN ('pending','approved'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_source text NOT NULL DEFAULT 'admin' CHECK (signup_source IN ('admin','password','google'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS organization text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_role text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS users_pending_idx ON users(created_at DESC) WHERE approval = 'pending';
-- One-time email confirmation links; only the SHA-256 of the token is stored.
CREATE TABLE IF NOT EXISTS email_verifications (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verifications_user_idx ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS email_verifications_expiry_idx ON email_verifications(expires_at);
