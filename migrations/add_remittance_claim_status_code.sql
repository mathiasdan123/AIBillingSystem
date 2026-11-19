-- 835 claim status (CLP02) on each remittance line (demo billing test
-- 2026-11-19, denial import): the parser read CLP02 but dropped it before
-- storage, so a payer DENIAL (status 4) was indistinguishable from a
-- processed claim and a denied line matched to a claim left it in its old
-- status with no denial reason. Nullable: legacy rows and JSON uploads
-- without a status are never treated as denials.
-- Additive: nullable column, nothing existing is altered.

ALTER TABLE remittance_line_items ADD COLUMN IF NOT EXISTS claim_status_code VARCHAR;
