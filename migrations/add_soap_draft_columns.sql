-- Reshape soap_note_drafts to hold real S-O-A-P content alongside the
-- legacy OT-form scaffold columns. Purely additive — legacy columns
-- (form_data, ot_interventions, caregiver_dropdown_state, ai_optimization)
-- stay in place, nullable, ignored by the new write path. A future cleanup
-- migration will drop them once we're confident no one is using them.

ALTER TABLE soap_note_drafts
  ADD COLUMN IF NOT EXISTS practice_id INTEGER REFERENCES practices(id),
  ADD COLUMN IF NOT EXISTS session_id INTEGER REFERENCES treatment_sessions(id),
  ADD COLUMN IF NOT EXISTS subjective TEXT,
  ADD COLUMN IF NOT EXISTS objective TEXT,
  ADD COLUMN IF NOT EXISTS assessment TEXT,
  ADD COLUMN IF NOT EXISTS plan TEXT,
  ADD COLUMN IF NOT EXISTS interventions JSONB,
  ADD COLUMN IF NOT EXISTS progress_notes TEXT,
  ADD COLUMN IF NOT EXISTS home_program TEXT,
  ADD COLUMN IF NOT EXISTS location VARCHAR,
  ADD COLUMN IF NOT EXISTS session_type VARCHAR,
  ADD COLUMN IF NOT EXISTS last_saved_at TIMESTAMP DEFAULT NOW();

-- One in-progress draft per (therapist, patient). Upserts target this key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_soap_draft_therapist_patient
  ON soap_note_drafts(therapist_id, patient_id)
  WHERE therapist_id IS NOT NULL AND patient_id IS NOT NULL;

-- Multi-tenant scan lookup.
CREATE INDEX IF NOT EXISTS idx_soap_draft_practice
  ON soap_note_drafts(practice_id);
