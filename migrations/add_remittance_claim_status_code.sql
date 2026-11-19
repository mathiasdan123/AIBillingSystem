-- 835 claim status (CLP02) on each remittance line (demo billing test
-- 2026-11-19, denial import): the parser read CLP02 but dropped it before
-- storage, so a payer DENIAL (status 4) was indistinguishable from a
-- processed claim and a denied line matched to a claim left it in its old
-- status with no denial reason. Nullable: legacy rows and JSON uploads
-- without a status are never treated as denials.
--
-- #497 review: the payment posting and the denial application are two
-- steps. payment_postings.remittance_line_item_id + a partial unique index
-- is the ONE posting identity for the auto and manual paths (atomic at the
-- database: simultaneous requests or a retry after a crash cannot post a
-- line twice). posted_at is a convenience marker written after the posting
-- commits; denial_applied_at / denial_error / denial_attempts track the
-- denial step so it can be retried (bounded automatically, unbounded by the
-- line's Retry button) without touching the posting.
--
-- Additive: nullable columns and a partial unique index over rows that
-- do not exist yet (every existing posting has a NULL line id). Applied by
-- the deploy workflow's "Run pending DB migrations" step (drizzle-kit push
-- of shared/schema.ts) before the app rolls forward; old tasks never read
-- these columns.

ALTER TABLE remittance_line_items ADD COLUMN IF NOT EXISTS claim_status_code VARCHAR;
ALTER TABLE remittance_line_items ADD COLUMN IF NOT EXISTS posted_at TIMESTAMP;
ALTER TABLE remittance_line_items ADD COLUMN IF NOT EXISTS denial_applied_at TIMESTAMP;
ALTER TABLE remittance_line_items ADD COLUMN IF NOT EXISTS denial_error TEXT;
ALTER TABLE remittance_line_items ADD COLUMN IF NOT EXISTS denial_attempts INTEGER DEFAULT 0;

ALTER TABLE payment_postings ADD COLUMN IF NOT EXISTS remittance_line_item_id INTEGER REFERENCES remittance_line_items(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_postings_line_active
  ON payment_postings (remittance_line_item_id)
  WHERE remittance_line_item_id IS NOT NULL AND reversed = false;
