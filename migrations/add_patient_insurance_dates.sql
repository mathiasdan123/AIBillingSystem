-- Add primary-insurance effective / termination dates to the patients table.
--
-- These fields previously lived only on patient_plan_benefits (OCR-populated,
-- admin-only), which left no way for normal users to record the dates they
-- read off an insurance card. The new columns are nullable and ignored by
-- existing code paths, so this is a pure expand — safe for a rolling deploy.
-- A future contract migration could clean up the duplicate fields on
-- patient_plan_benefits if that table is ever fully phased out.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS effective_date DATE,
  ADD COLUMN IF NOT EXISTS termination_date DATE;
