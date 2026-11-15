-- Requests for a workspace account submitted from the public landing page. Reviewed by administrators.
CREATE TABLE IF NOT EXISTS access_requests (
 id uuid PRIMARY KEY,
 name text NOT NULL,
 email text NOT NULL,
 organization text NOT NULL,
 role text NOT NULL DEFAULT '',
 use_case text NOT NULL,
 status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','approved','declined')),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS access_requests_created_idx ON access_requests(created_at DESC);
