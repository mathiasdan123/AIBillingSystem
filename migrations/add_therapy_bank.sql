-- Create therapy_bank table for practice-wide saved therapies in SOAP notes
CREATE TABLE IF NOT EXISTS therapy_bank (
    id SERIAL PRIMARY KEY,
    practice_id INTEGER NOT NULL REFERENCES practices(id),
    therapy_name VARCHAR NOT NULL,
    category VARCHAR,
    created_by VARCHAR REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create unique constraint to prevent duplicate therapy names within a practice
CREATE UNIQUE INDEX IF NOT EXISTS idx_therapy_bank_practice_name
    ON therapy_bank(practice_id, LOWER(therapy_name));

-- Create index for faster lookups by practice
CREATE INDEX IF NOT EXISTS idx_therapy_bank_practice ON therapy_bank(practice_id);
