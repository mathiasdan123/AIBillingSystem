-- Migration: Add secondary insurance support
-- Date: 2026-03-12

-- Add secondary insurance fields to patients table
ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_provider VARCHAR;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_policy_number VARCHAR;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_member_id VARCHAR;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_group_number VARCHAR;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_relationship VARCHAR;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_subscriber_name VARCHAR;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS secondary_insurance_subscriber_dob DATE;

-- Add secondary billing fields to claims table
ALTER TABLE claims ADD COLUMN IF NOT EXISTS billing_order VARCHAR DEFAULT 'primary';
ALTER TABLE claims ADD COLUMN IF NOT EXISTS primary_claim_id INTEGER;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS primary_paid_amount DECIMAL(10, 2);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS primary_adjustment_amount DECIMAL(10, 2);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS cob_data JSONB;

-- Add index for secondary claim lookup
CREATE INDEX IF NOT EXISTS idx_claims_primary_claim_id ON claims(primary_claim_id);
CREATE INDEX IF NOT EXISTS idx_claims_billing_order ON claims(billing_order);
