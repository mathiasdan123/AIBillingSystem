-- Initial Evaluation module (Wonder Kids pilot — Megan).
-- Additive only: one new table + three nullable columns on treatment_goals.
-- Accepted proposals land in the EXISTING treatment_plans / treatment_goals
-- model (no parallel goal model), so the Progress tab charts them unchanged.

CREATE TABLE IF NOT EXISTS initial_evaluations (
  id SERIAL PRIMARY KEY,
  practice_id INTEGER NOT NULL REFERENCES practices(id),
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  therapist_id VARCHAR REFERENCES users(id),
  evaluation_date DATE,
  status VARCHAR NOT NULL DEFAULT 'draft',
  personal_info JSONB,
  health_history JSONB,
  caregiver_concerns JSONB,
  subjective_comments TEXT,
  objective_activities TEXT,
  assessment_results TEXT,
  skill_areas TEXT,
  ai_write_up JSONB,
  composed_at TIMESTAMP,
  proposed_plan JSONB,
  proposed_goals JSONB,
  proposed_at TIMESTAMP,
  treatment_plan_id INTEGER REFERENCES treatment_plans(id),
  finalized_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_initial_evaluations_patient ON initial_evaluations(patient_id);
CREATE INDEX IF NOT EXISTS idx_initial_evaluations_practice ON initial_evaluations(practice_id);

-- Expand-only goal metadata: accepted eval goals carry term/duration/start
-- date inside the existing goal model; legacy rows keep NULL.
ALTER TABLE treatment_goals ADD COLUMN IF NOT EXISTS goal_term VARCHAR;
ALTER TABLE treatment_goals ADD COLUMN IF NOT EXISTS duration_weeks INTEGER;
ALTER TABLE treatment_goals ADD COLUMN IF NOT EXISTS start_date DATE;
