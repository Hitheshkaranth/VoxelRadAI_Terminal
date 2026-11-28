-- Patient history: list one owner's saved studies for a patient ID without scanning every payload.
CREATE INDEX IF NOT EXISTS studies_owner_patient_idx ON studies (owner_id, (btrim(payload->'patient'->>'patientId')));
