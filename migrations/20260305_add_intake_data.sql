-- Add intake_data column to patients table for comprehensive intake form storage
-- This stores HIPAA acknowledgment, medical history, developmental history,
-- sensory processing questionnaire, waivers, and financial responsibility data

ALTER TABLE patients ADD COLUMN IF NOT EXISTS intake_data JSONB;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMP;

-- Create index for efficient querying of intake completion status
CREATE INDEX IF NOT EXISTS idx_patients_intake_completed ON patients(intake_completed_at) WHERE intake_completed_at IS NOT NULL;

COMMENT ON COLUMN patients.intake_data IS 'Comprehensive intake form data including HIPAA consent, medical history, developmental milestones, sensory processing questionnaire, waivers, and financial responsibility acknowledgments';
COMMENT ON COLUMN patients.intake_completed_at IS 'Timestamp when the patient/guardian completed the full intake form';
