-- Migration: Add patient plan documents and benefits tables
-- These tables store uploaded insurance plan documents and parsed benefit data
-- for accurate OON reimbursement predictions based on individual patient plans

-- Patient Plan Documents - stores uploaded insurance plan documents
CREATE TABLE IF NOT EXISTS patient_plan_documents (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  practice_id INTEGER NOT NULL REFERENCES practices(id),

  -- Document metadata
  document_type VARCHAR NOT NULL, -- 'sbc', 'eob', 'plan_contract', 'insurance_card', 'other'
  file_name VARCHAR NOT NULL,
  file_url VARCHAR NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR,

  -- Processing status
  status VARCHAR DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  parsed_at TIMESTAMP,
  parse_error TEXT,

  -- Consent tracking
  patient_consent_given BOOLEAN DEFAULT FALSE,
  consent_date TIMESTAMP,
  consent_method VARCHAR, -- 'portal', 'email', 'in_person'

  -- Audit
  uploaded_by VARCHAR REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Patient Plan Benefits - stores parsed benefit data from insurance documents
CREATE TABLE IF NOT EXISTS patient_plan_benefits (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id),
  practice_id INTEGER NOT NULL REFERENCES practices(id),
  document_id INTEGER REFERENCES patient_plan_documents(id),

  -- Plan identification
  plan_name VARCHAR,
  plan_type VARCHAR, -- 'PPO', 'HMO', 'EPO', 'POS', 'HDHP', 'Indemnity'
  insurance_provider VARCHAR,
  group_number VARCHAR,
  policy_number VARCHAR,
  effective_date DATE,
  termination_date DATE,

  -- OON Benefit Details (critical for predictions!)
  oon_deductible_individual DECIMAL(10, 2),
  oon_deductible_family DECIMAL(10, 2),
  oon_deductible_met DECIMAL(10, 2),
  oon_coinsurance_percent DECIMAL(5, 2), -- What patient pays (e.g., 40%)
  oon_out_of_pocket_max DECIMAL(10, 2),
  oon_out_of_pocket_met DECIMAL(10, 2),

  -- Allowed Amount Methodology (critical for predictions!)
  allowed_amount_method VARCHAR, -- 'ucr', 'medicare_percent', 'fair_health', 'plan_schedule', 'unknown'
  allowed_amount_percent DECIMAL(5, 2), -- e.g., 150 for 150% of Medicare
  allowed_amount_source VARCHAR, -- e.g., 'Fair Health', 'HIAA', 'Medicare'

  -- Mental Health Specific
  mental_health_parity BOOLEAN,
  mental_health_visit_limit INTEGER,
  mental_health_visits_used INTEGER,
  mental_health_prior_auth_required BOOLEAN,
  mental_health_copay DECIMAL(10, 2),

  -- In-Network comparison
  inn_deductible_individual DECIMAL(10, 2),
  inn_coinsurance_percent DECIMAL(5, 2),
  inn_out_of_pocket_max DECIMAL(10, 2),

  -- Telehealth coverage
  telehealth_covered BOOLEAN,
  telehealth_oon_same_as_in_person BOOLEAN,

  -- Raw extracted data
  raw_extracted_data JSONB,
  extraction_confidence DECIMAL(3, 2), -- 0-1 confidence score

  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  verified_by VARCHAR REFERENCES users(id),
  verified_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_plan_documents_patient ON patient_plan_documents(patient_id);
CREATE INDEX IF NOT EXISTS idx_plan_documents_practice ON patient_plan_documents(practice_id);
CREATE INDEX IF NOT EXISTS idx_plan_documents_status ON patient_plan_documents(status);

CREATE INDEX IF NOT EXISTS idx_plan_benefits_patient ON patient_plan_benefits(patient_id);
CREATE INDEX IF NOT EXISTS idx_plan_benefits_practice ON patient_plan_benefits(practice_id);
CREATE INDEX IF NOT EXISTS idx_plan_benefits_active ON patient_plan_benefits(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_plan_benefits_provider ON patient_plan_benefits(insurance_provider);
