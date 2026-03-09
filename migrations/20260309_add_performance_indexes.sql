-- Migration: Add performance indexes identified by audit
-- Run this on production PostgreSQL database

-- =============================================
-- PATIENT INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_patients_practice_id ON patients(practice_id);
CREATE INDEX IF NOT EXISTS idx_patients_practice_name ON patients(practice_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_patients_dob ON patients(date_of_birth);
CREATE INDEX IF NOT EXISTS idx_patients_deleted_at ON patients(deleted_at) WHERE deleted_at IS NOT NULL;

-- =============================================
-- CLAIMS INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_claims_practice_id ON claims(practice_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_patient_id ON claims(patient_id);
CREATE INDEX IF NOT EXISTS idx_claims_submitted_at_status ON claims(submitted_at, status);
CREATE INDEX IF NOT EXISTS idx_claims_claim_number ON claims(claim_number);
CREATE INDEX IF NOT EXISTS idx_claims_practice_status ON claims(practice_id, status);

-- =============================================
-- CLAIM LINE ITEMS INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_claim_line_items_claim_id ON claim_line_items(claim_id);

-- =============================================
-- TREATMENT SESSIONS INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_treatment_sessions_practice_date ON treatment_sessions(practice_id, session_date);
CREATE INDEX IF NOT EXISTS idx_treatment_sessions_patient_id ON treatment_sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatment_sessions_therapist_id ON treatment_sessions(therapist_id);

-- =============================================
-- APPOINTMENTS INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_appointments_practice_start ON appointments(practice_id, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_therapist_start ON appointments(therapist_id, start_time);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);

-- =============================================
-- SOAP NOTES INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_soap_notes_session_id ON soap_notes(session_id);
CREATE INDEX IF NOT EXISTS idx_soap_notes_patient_id ON soap_notes(patient_id);
CREATE INDEX IF NOT EXISTS idx_soap_notes_practice_id ON soap_notes(practice_id);

-- =============================================
-- AUDIT LOG INDEXES (some already exist)
-- =============================================
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);

-- =============================================
-- ELIGIBILITY INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_eligibility_checks_patient_date ON eligibility_checks(patient_id, check_date);

-- =============================================
-- PAYMENT INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_payments_practice_date ON payments(practice_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_claim_id ON payments(claim_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_practice_date ON payment_transactions(practice_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_patient_id ON payment_transactions(patient_id);

-- =============================================
-- APPEALS INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_appeals_claim_id_status ON appeals(claim_id, status);
CREATE INDEX IF NOT EXISTS idx_appeals_practice_id ON appeals(practice_id);
CREATE INDEX IF NOT EXISTS idx_appeals_deadline ON appeals(deadline_date) WHERE status NOT IN ('won', 'lost', 'partial');

-- =============================================
-- MESSAGES INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_practice_id ON conversations(practice_id);

-- =============================================
-- REFERRALS INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_referrals_practice_id ON referrals(practice_id);
CREATE INDEX IF NOT EXISTS idx_referrals_patient_id ON referrals(patient_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);

-- =============================================
-- TREATMENT PLANS INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_treatment_plans_patient_id ON treatment_plans(patient_id);
CREATE INDEX IF NOT EXISTS idx_treatment_plans_practice_id ON treatment_plans(practice_id);
CREATE INDEX IF NOT EXISTS idx_treatment_goals_plan_id ON treatment_goals(treatment_plan_id);
CREATE INDEX IF NOT EXISTS idx_treatment_objectives_goal_id ON treatment_objectives(goal_id);

-- =============================================
-- INSURANCE DATA INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_insurance_data_cache_patient ON insurance_data_cache(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_plan_benefits_patient ON patient_plan_benefits(patient_id);

-- =============================================
-- TELEHEALTH INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_telehealth_sessions_practice ON telehealth_sessions(practice_id);
CREATE INDEX IF NOT EXISTS idx_telehealth_sessions_start ON telehealth_sessions(start_time);

-- =============================================
-- ONLINE BOOKINGS INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_online_bookings_practice ON online_bookings(practice_id);
CREATE INDEX IF NOT EXISTS idx_online_bookings_date ON online_bookings(appointment_date);

-- =============================================
-- WAITLIST INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_waitlist_practice_status ON waitlist(practice_id, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_patient_id ON waitlist(patient_id);

-- Note: Run ANALYZE after creating indexes to update statistics
-- ANALYZE patients;
-- ANALYZE claims;
-- ANALYZE claim_line_items;
-- etc.
