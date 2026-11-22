-- Append-only claim history behind the claim detail's Status timeline
-- (QA 2026-11-18, denial follow-up sweep): the claims row keeps only the
-- latest state, so denials, appeals, internal notes and reopen-to-draft
-- never appeared on the timeline and reopen erased the denial reason.
-- Additive: a new table, nothing existing is altered.

CREATE TABLE IF NOT EXISTS claim_events (
  id SERIAL PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  practice_id INTEGER NOT NULL REFERENCES practices(id),
  event_type VARCHAR NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB,
  created_by VARCHAR,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claim_events_claim ON claim_events (claim_id, created_at);
CREATE INDEX IF NOT EXISTS idx_claim_events_practice ON claim_events (practice_id, created_at);
