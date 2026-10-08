-- Progress Notes feature (Wonder Kids pilot — Megan).
-- Additive only: one new table. A progress note reviews EVERY treatment goal
-- (goal table + per-goal commentary), carries the Present Level of
-- Functioning / annual goals / recommendations narratives, and documents the
-- optional plan-extension decision with the therapist's rationale.
-- Progress % per goal is therapist-entered, never auto-computed.

CREATE TABLE IF NOT EXISTS progress_notes (
  id SERIAL PRIMARY KEY,
  practice_id INTEGER NOT NULL REFERENCES practices(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  treatment_plan_id INTEGER REFERENCES treatment_plans(id),
  therapist_id VARCHAR REFERENCES users(id),
  status VARCHAR NOT NULL DEFAULT 'draft',
  window_start DATE,
  window_end DATE,
  sessions_reviewed INTEGER,
  goal_entries JSONB,
  present_level TEXT,
  annual_goals TEXT,
  recommendations TEXT,
  extension_requested BOOLEAN DEFAULT FALSE,
  extension_new_end_date DATE,
  extension_rationale TEXT,
  extension_applied_at TIMESTAMP,
  goal_progress_synced_at TIMESTAMP,
  generated_at TIMESTAMP,
  finalized_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_progress_notes_patient ON progress_notes(patient_id);
CREATE INDEX IF NOT EXISTS idx_progress_notes_practice ON progress_notes(practice_id);
