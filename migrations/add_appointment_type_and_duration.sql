-- Wire appointments to the configured appointment_types catalog and persist
-- the chosen session duration. Until now the calendar dialog used a hardcoded
-- 4-string dropdown ("Individual Therapy"…) and forced every appointment to
-- 60 minutes, ignoring the appointment_types table the practice already
-- configures for online booking.
--
-- Both columns are nullable: existing rows have neither, and the calendar
-- create path falls back to its prior 60-minute / title-string behavior
-- when the user picks no type. Pure expand — safe for rolling deploy.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS appointment_type_id INTEGER REFERENCES appointment_types(id),
  ADD COLUMN IF NOT EXISTS duration_minutes    INTEGER;
