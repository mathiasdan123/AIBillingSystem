-- Work-queue actions on claim follow-ups (QA sweep 2026-11-18): who marked
-- an item complete, and a snooze-until instant that hides it from the open
-- queue. Additive and nullable: old tasks ignore both columns.

ALTER TABLE claim_follow_ups
  ADD COLUMN IF NOT EXISTS completed_by VARCHAR REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMP;
