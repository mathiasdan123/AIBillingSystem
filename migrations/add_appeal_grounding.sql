-- Appeal letter grounding + deadline basis (QA sweep 2026-11-18).
--
-- appeals: record the denial date and how the filing deadline was derived
-- (payer policy / practice default / estimated / manual), the facts the
-- biller supplied that the letter may assert (urgent service, retro-auth
-- request, additional grounds), and the list of reasons a letter is not yet
-- ready to send. practices: an optional default appeal window.
--
-- Additive and nullable throughout: old tasks ignore the columns, new tasks
-- treat NULL as "not recorded".

ALTER TABLE appeals
  ADD COLUMN IF NOT EXISTS denial_date DATE,
  ADD COLUMN IF NOT EXISTS deadline_source VARCHAR,
  ADD COLUMN IF NOT EXISTS deadline_policy_days INTEGER,
  ADD COLUMN IF NOT EXISTS grounding_inputs JSONB,
  ADD COLUMN IF NOT EXISTS readiness_issues JSONB;

ALTER TABLE practices
  ADD COLUMN IF NOT EXISTS appeal_window_days INTEGER;
