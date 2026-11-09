CREATE TABLE volume_objects (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  file_name text NOT NULL,
  title text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2147483648),
  content_type text NOT NULL DEFAULT 'application/octet-stream' CHECK (content_type = 'application/octet-stream'),
  acquisition jsonb,
  staging_key text UNIQUE NOT NULL,
  object_key text UNIQUE NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'ready', 'deleting')),
  upload_expires_at timestamptz NOT NULL,
  etag text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);
CREATE INDEX volume_objects_owner_created_idx ON volume_objects(owner_id, created_at DESC, id);
CREATE INDEX volume_objects_expiry_idx ON volume_objects(upload_expires_at) WHERE state = 'pending';
