-- Migration: Add automatic updated_at triggers
-- This ensures updated_at fields are automatically maintained

-- Create the trigger function (if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables with updated_at columns

-- Users table
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Practices table
DROP TRIGGER IF EXISTS update_practices_updated_at ON practices;
CREATE TRIGGER update_practices_updated_at
    BEFORE UPDATE ON practices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Patients table
DROP TRIGGER IF EXISTS update_patients_updated_at ON patients;
CREATE TRIGGER update_patients_updated_at
    BEFORE UPDATE ON patients
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Claims table
DROP TRIGGER IF EXISTS update_claims_updated_at ON claims;
CREATE TRIGGER update_claims_updated_at
    BEFORE UPDATE ON claims
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Treatment sessions table
DROP TRIGGER IF EXISTS update_treatment_sessions_updated_at ON treatment_sessions;
CREATE TRIGGER update_treatment_sessions_updated_at
    BEFORE UPDATE ON treatment_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- SOAP notes table
DROP TRIGGER IF EXISTS update_soap_notes_updated_at ON soap_notes;
CREATE TRIGGER update_soap_notes_updated_at
    BEFORE UPDATE ON soap_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Appointments table
DROP TRIGGER IF EXISTS update_appointments_updated_at ON appointments;
CREATE TRIGGER update_appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Appeals table
DROP TRIGGER IF EXISTS update_appeals_updated_at ON appeals;
CREATE TRIGGER update_appeals_updated_at
    BEFORE UPDATE ON appeals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Treatment plans table
DROP TRIGGER IF EXISTS update_treatment_plans_updated_at ON treatment_plans;
CREATE TRIGGER update_treatment_plans_updated_at
    BEFORE UPDATE ON treatment_plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Treatment goals table
DROP TRIGGER IF EXISTS update_treatment_goals_updated_at ON treatment_goals;
CREATE TRIGGER update_treatment_goals_updated_at
    BEFORE UPDATE ON treatment_goals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Conversations table
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Messages table
DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;
CREATE TRIGGER update_messages_updated_at
    BEFORE UPDATE ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Waitlist table
DROP TRIGGER IF EXISTS update_waitlist_updated_at ON waitlist;
CREATE TRIGGER update_waitlist_updated_at
    BEFORE UPDATE ON waitlist
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Referrals table
DROP TRIGGER IF EXISTS update_referrals_updated_at ON referrals;
CREATE TRIGGER update_referrals_updated_at
    BEFORE UPDATE ON referrals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Telehealth sessions table
DROP TRIGGER IF EXISTS update_telehealth_sessions_updated_at ON telehealth_sessions;
CREATE TRIGGER update_telehealth_sessions_updated_at
    BEFORE UPDATE ON telehealth_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Payment transactions table
DROP TRIGGER IF EXISTS update_payment_transactions_updated_at ON payment_transactions;
CREATE TRIGGER update_payment_transactions_updated_at
    BEFORE UPDATE ON payment_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- BAA records table
DROP TRIGGER IF EXISTS update_baa_records_updated_at ON baa_records;
CREATE TRIGGER update_baa_records_updated_at
    BEFORE UPDATE ON baa_records
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Breach incidents table
DROP TRIGGER IF EXISTS update_breach_incidents_updated_at ON breach_incidents;
CREATE TRIGGER update_breach_incidents_updated_at
    BEFORE UPDATE ON breach_incidents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Amendment requests table
DROP TRIGGER IF EXISTS update_amendment_requests_updated_at ON amendment_requests;
CREATE TRIGGER update_amendment_requests_updated_at
    BEFORE UPDATE ON amendment_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Patient consents table
DROP TRIGGER IF EXISTS update_patient_consents_updated_at ON patient_consents;
CREATE TRIGGER update_patient_consents_updated_at
    BEFORE UPDATE ON patient_consents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insurance rates table
DROP TRIGGER IF EXISTS update_insurance_rates_updated_at ON insurance_rates;
CREATE TRIGGER update_insurance_rates_updated_at
    BEFORE UPDATE ON insurance_rates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Online bookings table
DROP TRIGGER IF EXISTS update_online_bookings_updated_at ON online_bookings;
CREATE TRIGGER update_online_bookings_updated_at
    BEFORE UPDATE ON online_bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Patient assessments table
DROP TRIGGER IF EXISTS update_patient_assessments_updated_at ON patient_assessments;
CREATE TRIGGER update_patient_assessments_updated_at
    BEFORE UPDATE ON patient_assessments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Reimbursement optimizations table
DROP TRIGGER IF EXISTS update_reimbursement_optimizations_updated_at ON reimbursement_optimizations;
CREATE TRIGGER update_reimbursement_optimizations_updated_at
    BEFORE UPDATE ON reimbursement_optimizations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Note: Run this migration on your PostgreSQL database to enable automatic timestamp updates
