-- Persist the suggested billing alongside the drafted S-O-A-P text so a
-- draft restore brings back CPT codes, units, time blocks, rationale and the
-- estimated total instead of resetting them to $0 / 0 units (QA sweep
-- 2026-11-18). Additive and nullable: old tasks ignore the column, new tasks
-- treat NULL as "no billing saved yet". Contents are PHI (activity
-- descriptions, rationale) and are written only as an AES-256-GCM
-- {ciphertext, iv, tag} object by phiEncryptionService.encryptSoapDraftRecord,
-- never as plaintext JSON.

ALTER TABLE soap_note_drafts
  ADD COLUMN IF NOT EXISTS billing JSONB;
