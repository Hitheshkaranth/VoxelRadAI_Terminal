CREATE TABLE password_recovery_tokens (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_recovery_expiry_idx ON password_recovery_tokens(expires_at);
CREATE INDEX password_recovery_user_idx ON password_recovery_tokens(user_id);
