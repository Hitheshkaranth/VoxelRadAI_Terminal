CREATE TABLE oidc_identities (
 issuer text NOT NULL,
 subject text NOT NULL,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (issuer, subject),
 UNIQUE (user_id, issuer)
);
CREATE TABLE oidc_login_states (
 state_hash text PRIMARY KEY,
 browser_hash text NOT NULL,
 code_verifier text NOT NULL,
 nonce text NOT NULL,
 issuer text NOT NULL,
 link_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
 link_session_hash text,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((link_user_id IS NULL) = (link_session_hash IS NULL))
);
CREATE INDEX oidc_login_states_expiry_idx ON oidc_login_states(expires_at);
CREATE INDEX oidc_login_states_browser_idx ON oidc_login_states(browser_hash);
