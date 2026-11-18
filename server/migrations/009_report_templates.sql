-- Per-user report templates (letterhead header, footer, section titles). One optional default per user.
CREATE TABLE IF NOT EXISTS report_templates (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL,
 content jsonb NOT NULL,
 is_default boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_templates_owner_idx ON report_templates(owner_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS report_templates_one_default ON report_templates(owner_id) WHERE is_default;
