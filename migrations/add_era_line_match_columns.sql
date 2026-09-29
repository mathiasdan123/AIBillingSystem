-- ERA line-item auto-matching metadata. Purely additive (expand phase):
-- every column is nullable, old code never reads or writes them, and the
-- matching code treats NULL as "row predates the feature".
--
--   claim_reference      CLP01 patient control number — the claim id WE sent
--                        on the 837 (claims.claim_number), echoed back by the
--                        payer. Primary deterministic matching key.
--   payer_claim_id       CLP07 payer claim control number, for reference.
--   match_type           'claim_number', scored signal list, or 'manual'.
--   matched_at           when the link was made.
--   match_review_reason  why auto-match declined (ambiguity / amount
--                        mismatch) — surfaced on the remittance page.
--   auto_posted_at       when the automated path recorded the payment
--                        posting for this line (NULL = matched but the money
--                        is not yet posted by the auto path).

ALTER TABLE remittance_line_items
  ADD COLUMN IF NOT EXISTS claim_reference VARCHAR,
  ADD COLUMN IF NOT EXISTS payer_claim_id VARCHAR,
  ADD COLUMN IF NOT EXISTS match_type VARCHAR,
  ADD COLUMN IF NOT EXISTS matched_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS match_review_reason VARCHAR,
  ADD COLUMN IF NOT EXISTS auto_posted_at TIMESTAMP;
