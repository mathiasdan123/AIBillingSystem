-- 835 claim status (CLP02) on each remittance line (demo billing test
-- 2026-11-19, denial import): the parser read CLP02 but dropped it before
-- storage, so a payer DENIAL (status 4) was indistinguishable from a
-- processed claim and a denied line matched to a claim left it in its old
-- status with no denial reason. Nullable: legacy rows and JSON uploads
-- without a status are never treated as denials.
--
-- posted_at / denial_applied_at / denial_error (#497 review): the payment
-- posting and the denial application are two steps; these let the second
-- be retried without repeating the first, and let the manual match route
-- be idempotent.
--
-- Additive: nullable columns, nothing existing is altered. Applied by the
-- deploy workflow's "Run pending DB migrations" step (drizzle-kit push of
-- shared/schema.ts) before the app rolls forward; old tasks never read
-- these columns.

ALTER TABLE remittance_line_items ADD COLUMN IF NOT EXISTS claim_status_code VARCHAR;
ALTER TABLE remittance_line_items ADD COLUMN IF NOT EXISTS posted_at TIMESTAMP;
ALTER TABLE remittance_line_items ADD COLUMN IF NOT EXISTS denial_applied_at TIMESTAMP;
ALTER TABLE remittance_line_items ADD COLUMN IF NOT EXISTS denial_error TEXT;
