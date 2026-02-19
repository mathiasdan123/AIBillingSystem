-- Add payment method and intake tracking to patient_portal_access
ALTER TABLE patient_portal_access
ADD COLUMN IF NOT EXISTS has_payment_method BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR,
ADD COLUMN IF NOT EXISTS stripe_payment_method_id VARCHAR,
ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMP;
