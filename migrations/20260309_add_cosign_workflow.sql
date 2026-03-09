-- Migration: Add co-signing workflow for supervised therapists
-- This enables supervisors to review and co-sign SOAP notes created by their supervisees

-- Add supervision fields to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS supervisor_id VARCHAR REFERENCES users(id),
ADD COLUMN IF NOT EXISTS requires_cosign BOOLEAN DEFAULT FALSE;

-- Add co-signing fields to soap_notes table
ALTER TABLE soap_notes
ADD COLUMN IF NOT EXISTS cosigned_by VARCHAR REFERENCES users(id),
ADD COLUMN IF NOT EXISTS cosigned_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS cosign_status VARCHAR DEFAULT 'not_required',
ADD COLUMN IF NOT EXISTS cosign_rejection_reason TEXT;

-- Create index for efficient pending cosign queries
CREATE INDEX IF NOT EXISTS idx_soap_notes_cosign_status ON soap_notes(cosign_status);
CREATE INDEX IF NOT EXISTS idx_soap_notes_therapist_id ON soap_notes(therapist_id);
CREATE INDEX IF NOT EXISTS idx_users_supervisor_id ON users(supervisor_id);

-- Add constraint to ensure valid cosign_status values
-- Note: This uses a CHECK constraint instead of an enum for flexibility
ALTER TABLE soap_notes
DROP CONSTRAINT IF EXISTS chk_cosign_status;

ALTER TABLE soap_notes
ADD CONSTRAINT chk_cosign_status
CHECK (cosign_status IN ('not_required', 'pending', 'approved', 'rejected'));

-- Comment on columns for documentation
COMMENT ON COLUMN users.supervisor_id IS 'ID of the supervising therapist who co-signs this user''s notes';
COMMENT ON COLUMN users.requires_cosign IS 'Whether this therapist requires supervisor co-signature on SOAP notes';
COMMENT ON COLUMN soap_notes.cosigned_by IS 'ID of the supervisor who co-signed this note';
COMMENT ON COLUMN soap_notes.cosigned_at IS 'Timestamp when the note was co-signed';
COMMENT ON COLUMN soap_notes.cosign_status IS 'Co-sign workflow status: not_required, pending, approved, rejected';
COMMENT ON COLUMN soap_notes.cosign_rejection_reason IS 'Reason provided by supervisor when rejecting a note';
