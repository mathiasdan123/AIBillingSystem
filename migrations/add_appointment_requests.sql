-- Migration: Add appointment_requests table for patient portal appointment requests
-- This table stores appointment requests from patients that require admin approval

CREATE TABLE IF NOT EXISTS appointment_requests (
    id SERIAL PRIMARY KEY,
    practice_id INTEGER NOT NULL REFERENCES practices(id),
    patient_id INTEGER NOT NULL REFERENCES patients(id),
    appointment_type_id INTEGER REFERENCES appointment_types(id),
    therapist_id VARCHAR REFERENCES users(id),

    -- Request details
    requested_date VARCHAR NOT NULL, -- YYYY-MM-DD format
    requested_time VARCHAR NOT NULL, -- HH:MM format
    notes TEXT,

    -- Status tracking
    status VARCHAR NOT NULL DEFAULT 'pending_approval', -- pending_approval, approved, rejected, cancelled
    rejection_reason TEXT,

    -- If approved, link to the created appointment
    appointment_id INTEGER REFERENCES appointments(id),

    -- Processing information
    processed_at TIMESTAMP,
    processed_by_id VARCHAR REFERENCES users(id),

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_appointment_requests_practice_id ON appointment_requests(practice_id);
CREATE INDEX IF NOT EXISTS idx_appointment_requests_patient_id ON appointment_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointment_requests_status ON appointment_requests(status);
CREATE INDEX IF NOT EXISTS idx_appointment_requests_created_at ON appointment_requests(created_at);
