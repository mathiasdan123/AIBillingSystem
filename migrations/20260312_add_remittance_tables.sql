-- 835 Remittance Advice tables for claims reconciliation
-- Tracks insurance payment explanations (ERA/835) and matches them to claims

CREATE TABLE IF NOT EXISTS remittance_advice (
  id SERIAL PRIMARY KEY,
  practice_id INTEGER NOT NULL REFERENCES practices(id),
  received_date DATE NOT NULL,
  payer_name VARCHAR NOT NULL,
  payer_id VARCHAR,
  check_number VARCHAR,
  check_date DATE,
  total_payment_amount DECIMAL(10, 2) NOT NULL,
  raw_data JSONB,
  processed_at TIMESTAMP,
  status VARCHAR NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remittance_advice_practice_status
  ON remittance_advice (practice_id, status);
CREATE INDEX IF NOT EXISTS idx_remittance_advice_practice_date
  ON remittance_advice (practice_id, received_date);

CREATE TABLE IF NOT EXISTS remittance_line_items (
  id SERIAL PRIMARY KEY,
  remittance_id INTEGER NOT NULL REFERENCES remittance_advice(id),
  claim_id INTEGER REFERENCES claims(id),
  patient_name VARCHAR NOT NULL,
  member_id VARCHAR,
  service_date DATE,
  cpt_code VARCHAR,
  charged_amount DECIMAL(10, 2),
  allowed_amount DECIMAL(10, 2),
  paid_amount DECIMAL(10, 2),
  adjustment_amount DECIMAL(10, 2),
  adjustment_reason_codes JSONB,
  remark_codes JSONB,
  status VARCHAR NOT NULL DEFAULT 'unmatched',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_remittance_line_items_remittance
  ON remittance_line_items (remittance_id);
CREATE INDEX IF NOT EXISTS idx_remittance_line_items_claim
  ON remittance_line_items (claim_id);
CREATE INDEX IF NOT EXISTS idx_remittance_line_items_status
  ON remittance_line_items (status);
