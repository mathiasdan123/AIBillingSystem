-- Add white-label branding columns to practices table
ALTER TABLE practices ADD COLUMN IF NOT EXISTS brand_logo_url VARCHAR;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS brand_primary_color VARCHAR DEFAULT '#2563eb';
ALTER TABLE practices ADD COLUMN IF NOT EXISTS brand_secondary_color VARCHAR DEFAULT '#1e40af';
ALTER TABLE practices ADD COLUMN IF NOT EXISTS brand_email_from_name VARCHAR;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS brand_email_reply_to VARCHAR;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS brand_website_url VARCHAR;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS brand_privacy_policy_url VARCHAR;

-- Add contact preference columns to patients table
ALTER TABLE patients ADD COLUMN IF NOT EXISTS phone_type VARCHAR DEFAULT 'mobile';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS preferred_contact_method VARCHAR DEFAULT 'email';
ALTER TABLE patients ADD COLUMN IF NOT EXISTS sms_consent_given BOOLEAN DEFAULT false;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS sms_consent_date TIMESTAMP;

-- Create patient_insurance_authorizations table
CREATE TABLE IF NOT EXISTS patient_insurance_authorizations (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    practice_id INTEGER NOT NULL REFERENCES practices(id),
    token VARCHAR NOT NULL UNIQUE,
    status VARCHAR DEFAULT 'pending',
    scopes JSONB DEFAULT '["eligibility", "benefits"]',
    delivery_method VARCHAR DEFAULT 'email',
    delivery_address VARCHAR,
    expires_at TIMESTAMP NOT NULL,
    sent_at TIMESTAMP,
    opened_at TIMESTAMP,
    authorized_at TIMESTAMP,
    revoked_at TIMESTAMP,
    consent_ip_address VARCHAR,
    consent_user_agent TEXT,
    consent_signature TEXT,
    reminder_count INTEGER DEFAULT 0,
    last_reminder_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create payer_integrations table
CREATE TABLE IF NOT EXISTS payer_integrations (
    id SERIAL PRIMARY KEY,
    payer_name VARCHAR NOT NULL,
    payer_code VARCHAR UNIQUE,
    api_type VARCHAR DEFAULT 'edi270',
    api_base_url VARCHAR,
    api_version VARCHAR,
    auth_method VARCHAR DEFAULT 'oauth2',
    capabilities JSONB DEFAULT '["eligibility"]',
    is_active BOOLEAN DEFAULT true,
    rate_limit_per_minute INTEGER DEFAULT 60,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create payer_credentials table
CREATE TABLE IF NOT EXISTS payer_credentials (
    id SERIAL PRIMARY KEY,
    practice_id INTEGER NOT NULL REFERENCES practices(id),
    payer_integration_id INTEGER NOT NULL REFERENCES payer_integrations(id),
    encrypted_credentials TEXT NOT NULL,
    credentials_iv VARCHAR NOT NULL,
    credentials_auth_tag VARCHAR NOT NULL,
    is_active BOOLEAN DEFAULT true,
    last_verified_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create insurance_data_cache table
CREATE TABLE IF NOT EXISTS insurance_data_cache (
    id SERIAL PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    authorization_id INTEGER REFERENCES patient_insurance_authorizations(id),
    payer_integration_id INTEGER REFERENCES payer_integrations(id),
    data_type VARCHAR NOT NULL,
    raw_response JSONB,
    normalized_data JSONB,
    fetched_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP,
    is_stale BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create authorization_audit_log table
CREATE TABLE IF NOT EXISTS authorization_audit_log (
    id SERIAL PRIMARY KEY,
    authorization_id INTEGER REFERENCES patient_insurance_authorizations(id),
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    practice_id INTEGER NOT NULL REFERENCES practices(id),
    user_id VARCHAR REFERENCES users(id),
    action VARCHAR NOT NULL,
    details JSONB,
    ip_address VARCHAR,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_insurance_auth_patient ON patient_insurance_authorizations(patient_id);
CREATE INDEX IF NOT EXISTS idx_insurance_auth_practice ON patient_insurance_authorizations(practice_id);
CREATE INDEX IF NOT EXISTS idx_insurance_auth_token ON patient_insurance_authorizations(token);
CREATE INDEX IF NOT EXISTS idx_insurance_auth_status ON patient_insurance_authorizations(status);
CREATE INDEX IF NOT EXISTS idx_insurance_data_patient ON insurance_data_cache(patient_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_patient ON authorization_audit_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_practice ON authorization_audit_log(practice_id);
