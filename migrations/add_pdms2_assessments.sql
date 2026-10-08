-- PDMS-2 structured scoring workflow (outcome-measures feature).
-- Additive only: new table + indexes, no changes to existing objects.
-- Stores therapist-entered item scores and manual normative-table lookups;
-- no PDMS-2 Examiner's Manual content (tables, item text, criteria) is stored.
CREATE TABLE IF NOT EXISTS pdms2_assessments (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    practice_id INTEGER NOT NULL REFERENCES practices(id),
    administered_by VARCHAR REFERENCES users(id),
    assessment_date TIMESTAMP DEFAULT NOW(),
    age_in_months INTEGER NOT NULL,
    subtests JSONB NOT NULL DEFAULT '{}'::jsonb,
    computed JSONB,
    gross_motor_quotient INTEGER,
    fine_motor_quotient INTEGER,
    total_motor_quotient INTEGER,
    tasks_went_well TEXT,
    tasks_challenging TEXT,
    narrative TEXT,
    narrative_generated_at TIMESTAMP,
    status VARCHAR DEFAULT 'in_progress',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdms2_assessments_patient ON pdms2_assessments(patient_id);
CREATE INDEX IF NOT EXISTS idx_pdms2_assessments_practice ON pdms2_assessments(practice_id);
