-- Patient archive (QA sweep 2026-11-18): there was no way to retire a patient
-- record short of the right-to-erasure soft delete, which nulls PHI and purges
-- the row after the retention window. archived_at hides the patient from the
-- default list, search and pickers and blocks new appointments/claims, while
-- keeping every record intact and reversible. Additive and nullable.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
