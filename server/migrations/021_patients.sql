-- Patient register: a permanent RadGenis ID per patient, findable by ABHA or Aadhaar. Aadhaar is kept only as a keyed
-- hash plus its last four digits.
CREATE SEQUENCE IF NOT EXISTS patient_mrn_seq;
CREATE TABLE IF NOT EXISTS server_secrets (name text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mrn text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  sex text NOT NULL DEFAULT '' CHECK (sex IN ('', 'M', 'F', 'O')),
  birth_date date,
  phone text NOT NULL DEFAULT '',
  abha_number text,
  abha_address text,
  aadhaar_hash text,
  aadhaar_last4 text CHECK (aadhaar_last4 IS NULL OR aadhaar_last4 ~ '^\d{4}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS patients_owner_aadhaar ON patients(owner_id, aadhaar_hash) WHERE aadhaar_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS patients_owner_abha_number ON patients(owner_id, abha_number) WHERE abha_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS patients_owner_abha_address ON patients(owner_id, abha_address) WHERE abha_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS patients_owner_recent ON patients(owner_id, updated_at DESC);
