-- Create exercise_bank table for practice-wide saved exercises in SOAP notes activities
CREATE TABLE IF NOT EXISTS exercise_bank (
    id SERIAL PRIMARY KEY,
    practice_id INTEGER NOT NULL REFERENCES practices(id),
    exercise_name VARCHAR NOT NULL,
    category VARCHAR NOT NULL,
    created_by VARCHAR REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create unique constraint to prevent duplicate exercise names within a practice and category
CREATE UNIQUE INDEX IF NOT EXISTS idx_exercise_bank_practice_category_name
    ON exercise_bank(practice_id, category, LOWER(exercise_name));

-- Create index for faster lookups by practice and category
CREATE INDEX IF NOT EXISTS idx_exercise_bank_practice ON exercise_bank(practice_id);
CREATE INDEX IF NOT EXISTS idx_exercise_bank_category ON exercise_bank(practice_id, category);
