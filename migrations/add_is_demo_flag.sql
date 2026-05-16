-- Phase 5: demo / practice mode.
-- Tag rows created by Blanche's enable_demo_mode tool so they can be
-- excluded from analytics, refused by submission paths (so a fake claim
-- never goes to a real clearinghouse), and bulk-cleaned via clear_demo_data.
--
-- Default false: existing rows and any new real rows are NOT demo. The
-- demo tool is the only path that flips it on.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

-- Partial indexes — most queries filter `is_demo = false` (the common case)
-- and a handful filter `is_demo = true` (analytics exclusions, demo cleanup).
-- Partial indexes are cheap and avoid bloating the regular query path.
CREATE INDEX IF NOT EXISTS idx_patients_demo
  ON patients(practice_id) WHERE is_demo = true;
CREATE INDEX IF NOT EXISTS idx_claims_demo
  ON claims(practice_id) WHERE is_demo = true;
CREATE INDEX IF NOT EXISTS idx_appointments_demo
  ON appointments(practice_id) WHERE is_demo = true;
