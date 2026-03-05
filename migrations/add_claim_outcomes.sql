-- Migration: Add claim_outcomes table for OON reimbursement ML training
-- This table tracks actual claim outcomes to improve reimbursement predictions

CREATE TABLE IF NOT EXISTS claim_outcomes (
  id SERIAL PRIMARY KEY,
  practice_id INTEGER NOT NULL REFERENCES practices(id),

  -- Link to existing claim if available
  claim_id INTEGER REFERENCES claims(id),

  -- Input features for prediction model
  cpt_code VARCHAR NOT NULL,
  insurance_provider VARCHAR NOT NULL,
  insurance_plan_type VARCHAR, -- PPO, HMO, EPO, POS, HDHP
  zip_code VARCHAR,
  billed_amount DECIMAL(10, 2) NOT NULL,
  provider_credential VARCHAR, -- PhD, LCSW, LMFT, etc.
  service_date DATE NOT NULL,
  network_status VARCHAR DEFAULT 'out_of_network', -- in_network, out_of_network

  -- Outcome data (filled when EOB/ERA received)
  allowed_amount DECIMAL(10, 2),
  paid_amount DECIMAL(10, 2),
  patient_responsibility DECIMAL(10, 2),
  coinsurance_applied DECIMAL(5, 2), -- percentage
  deductible_applied DECIMAL(10, 2),
  denial_reason TEXT,
  adjustment_reason_code VARCHAR, -- CARC/RARC codes

  -- Timing metadata
  days_to_payment INTEGER,
  submission_date TIMESTAMP,
  payment_date TIMESTAMP,

  -- For model training
  is_training_data BOOLEAN DEFAULT TRUE,
  prediction_accuracy DECIMAL(5, 4), -- How close was our prediction

  -- Our prediction at time of service (for accuracy tracking)
  predicted_allowed_amount DECIMAL(10, 2),
  predicted_reimbursement DECIMAL(10, 2),
  prediction_confidence VARCHAR, -- high, medium, low

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_claim_outcomes_practice ON claim_outcomes(practice_id);
CREATE INDEX IF NOT EXISTS idx_claim_outcomes_insurance ON claim_outcomes(insurance_provider);
CREATE INDEX IF NOT EXISTS idx_claim_outcomes_cpt ON claim_outcomes(cpt_code);
CREATE INDEX IF NOT EXISTS idx_claim_outcomes_service_date ON claim_outcomes(service_date);
CREATE INDEX IF NOT EXISTS idx_claim_outcomes_training ON claim_outcomes(is_training_data, allowed_amount) WHERE is_training_data = TRUE AND allowed_amount IS NOT NULL;

-- Composite index for ML queries
CREATE INDEX IF NOT EXISTS idx_claim_outcomes_ml_features ON claim_outcomes(cpt_code, insurance_provider, zip_code, network_status);
