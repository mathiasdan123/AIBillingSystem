-- Migration: Add therapist signature fields
-- Run this on Railway PostgreSQL

-- Add new columns to users table for therapist profiles
ALTER TABLE users ADD COLUMN IF NOT EXISTS credentials VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS license_number VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS npi_number VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS digital_signature TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_uploaded_at TIMESTAMP;

-- Add signature fields to soap_notes table
ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_id VARCHAR REFERENCES users(id);
ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_signature TEXT;
ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_signed_at TIMESTAMP;
ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_signed_name VARCHAR;
ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS therapist_credentials VARCHAR;
ALTER TABLE soap_notes ADD COLUMN IF NOT EXISTS signature_ip_address VARCHAR;
