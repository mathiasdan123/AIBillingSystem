-- Role-gating audit F1: insurance_rates had NO practice scoping — every
-- practice read and wrote one global rate table (cross-tenant exposure of
-- contracted rates).
--
-- Additive only: a NULLABLE practice_id column. Existing NULL rows are
-- legacy data created when practice 1 was the only real practice; the
-- storage layer treats NULL rows as practice 1's (and ONLY practice 1's —
-- other practices never see them). All new writes set practice_id.
-- NOT NULL is deliberately not added (rolling-deploy safety + legacy rows);
-- a backfill + NOT NULL can follow in a later expand→contract step.
ALTER TABLE insurance_rates
    ADD COLUMN IF NOT EXISTS practice_id INTEGER REFERENCES practices(id);

CREATE INDEX IF NOT EXISTS idx_insurance_rates_practice
    ON insurance_rates (practice_id);
