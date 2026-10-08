-- Initial Evaluation refinements (Wonder Kids pilot — Megan's follow-up answers).
-- Additive only: nullable columns, no drops/renames/NOT NULL.
--
-- 1. treatment_plans.session_length_minutes — all Wonder Kids sessions are
--    45 minutes; accepted eval plans record it. Legacy plans keep NULL.
-- 2. initial_evaluations.interview_outline — AI-drafted parent interview
--    outline (three sections of caregiver questions drawn from the patient's
--    intake data) plus the therapist's captured notes, which ground the
--    subjective portions of the composed write-up.
-- 3. initial_evaluations.eval_code_suggestion / eval_code_final — suggested
--    OT evaluation CPT complexity code (97165/97166/97167) with rationale,
--    and the treating therapist's final choice. Not wired into claim
--    creation yet (follow-up).

ALTER TABLE treatment_plans ADD COLUMN IF NOT EXISTS session_length_minutes INTEGER;

ALTER TABLE initial_evaluations ADD COLUMN IF NOT EXISTS interview_outline JSONB;
ALTER TABLE initial_evaluations ADD COLUMN IF NOT EXISTS eval_code_suggestion JSONB;
ALTER TABLE initial_evaluations ADD COLUMN IF NOT EXISTS eval_code_final VARCHAR;
