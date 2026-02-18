-- =====================================================
-- TherapyBill AI - Row Level Security (RLS) Policies
-- HIPAA-Compliant Practice-Based Data Isolation
-- =====================================================
-- Run this in Supabase SQL Editor to secure your database
-- =====================================================

-- =====================================================
-- STEP 1: Create helper function to get user's practice_id
-- =====================================================

CREATE OR REPLACE FUNCTION auth.user_practice_id()
RETURNS INTEGER AS $$
  SELECT practice_id::INTEGER
  FROM users
  WHERE id = auth.uid()::TEXT
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION auth.is_admin()
RETURNS BOOLEAN AS $$
  SELECT role = 'admin'
  FROM users
  WHERE id = auth.uid()::TEXT
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- =====================================================
-- STEP 2: Enable RLS on all tables
-- =====================================================

-- Auth/System tables
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE practices ENABLE ROW LEVEL SECURITY;

-- Patient data (PHI - Critical)
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_portal_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_insurance_authorizations ENABLE ROW LEVEL SECURITY;

-- Clinical data
ALTER TABLE treatment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE soap_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE soap_note_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE soap_note_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_interventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_progress_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome_measure_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_schedules ENABLE ROW LEVEL SECURITY;

-- Billing/Claims
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_plan_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE appeals ENABLE ROW LEVEL SECURITY;

-- Insurance/Eligibility
ALTER TABLE eligibility_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligibility_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE payer_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payer_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_data_cache ENABLE ROW LEVEL SECURITY;

-- Scheduling
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE therapist_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE therapist_time_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_bookings ENABLE ROW LEVEL SECURITY;

-- Telehealth
ALTER TABLE telehealth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE telehealth_settings ENABLE ROW LEVEL SECURITY;

-- Communication
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_notifications ENABLE ROW LEVEL SECURITY;

-- Reviews/Feedback
ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_reviews ENABLE ROW LEVEL SECURITY;

-- Referrals
ALTER TABLE referral_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_communications ENABLE ROW LEVEL SECURITY;

-- Compliance/Audit
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE breach_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE amendment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE baa_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorization_audit_log ENABLE ROW LEVEL SECURITY;

-- Analytics/Optimization
ALTER TABLE reimbursement_optimizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reimbursement_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_capture_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cpt_code_mappings ENABLE ROW LEVEL SECURITY;

-- Practice Settings
ALTER TABLE practice_payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- Reference tables (shared, read-only for authenticated users)
ALTER TABLE insurances ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_billing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_billing_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE cpt_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cpt_code_equivalencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE icd10_codes ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- STEP 3: Create RLS Policies
-- =====================================================

-- -----------------------------------------------------
-- USERS TABLE
-- Users can see other users in their practice
-- -----------------------------------------------------
CREATE POLICY "users_same_practice" ON users
  FOR ALL USING (practice_id = auth.user_practice_id());

CREATE POLICY "users_self_access" ON users
  FOR ALL USING (id = auth.uid()::TEXT);

-- -----------------------------------------------------
-- PRACTICES TABLE
-- Users can only access their own practice
-- -----------------------------------------------------
CREATE POLICY "practices_own_practice" ON practices
  FOR ALL USING (id = auth.user_practice_id());

-- -----------------------------------------------------
-- SESSIONS TABLE (Auth sessions - system managed)
-- -----------------------------------------------------
CREATE POLICY "sessions_own" ON sessions
  FOR ALL USING (true); -- Managed by Supabase auth

-- -----------------------------------------------------
-- PATIENTS TABLE (PHI - Critical)
-- -----------------------------------------------------
CREATE POLICY "patients_practice_isolation" ON patients
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PATIENT CONSENTS
-- -----------------------------------------------------
CREATE POLICY "patient_consents_practice" ON patient_consents
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PATIENT PORTAL ACCESS
-- -----------------------------------------------------
CREATE POLICY "patient_portal_practice" ON patient_portal_access
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PATIENT DOCUMENTS
-- -----------------------------------------------------
CREATE POLICY "patient_documents_practice" ON patient_documents
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PATIENT STATEMENTS
-- -----------------------------------------------------
CREATE POLICY "patient_statements_practice" ON patient_statements
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PATIENT PAYMENT METHODS
-- -----------------------------------------------------
CREATE POLICY "patient_payment_methods_practice" ON patient_payment_methods
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PATIENT ASSESSMENTS
-- -----------------------------------------------------
CREATE POLICY "patient_assessments_practice" ON patient_assessments
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PATIENT INSURANCE AUTHORIZATIONS
-- -----------------------------------------------------
CREATE POLICY "patient_auth_practice" ON patient_insurance_authorizations
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- TREATMENT SESSIONS
-- -----------------------------------------------------
CREATE POLICY "treatment_sessions_practice" ON treatment_sessions
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- SOAP NOTES (Clinical PHI)
-- -----------------------------------------------------
CREATE POLICY "soap_notes_practice" ON soap_notes
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- SOAP NOTE TEMPLATES
-- -----------------------------------------------------
CREATE POLICY "soap_templates_practice" ON soap_note_templates
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- SOAP NOTE DRAFTS
-- -----------------------------------------------------
CREATE POLICY "soap_drafts_practice" ON soap_note_drafts
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- TREATMENT PLANS
-- -----------------------------------------------------
CREATE POLICY "treatment_plans_practice" ON treatment_plans
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- TREATMENT GOALS
-- -----------------------------------------------------
CREATE POLICY "treatment_goals_practice" ON treatment_goals
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- TREATMENT OBJECTIVES
-- -----------------------------------------------------
CREATE POLICY "treatment_objectives_practice" ON treatment_objectives
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- TREATMENT INTERVENTIONS
-- -----------------------------------------------------
CREATE POLICY "treatment_interventions_practice" ON treatment_interventions
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- GOAL PROGRESS NOTES
-- -----------------------------------------------------
CREATE POLICY "goal_progress_practice" ON goal_progress_notes
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- OUTCOME MEASURE TEMPLATES
-- -----------------------------------------------------
CREATE POLICY "outcome_templates_practice" ON outcome_measure_templates
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- ASSESSMENT SCHEDULES
-- -----------------------------------------------------
CREATE POLICY "assessment_schedules_practice" ON assessment_schedules
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- CLAIMS (Financial PHI)
-- -----------------------------------------------------
CREATE POLICY "claims_practice" ON claims
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- CLAIM LINE ITEMS (via claim)
-- -----------------------------------------------------
CREATE POLICY "claim_items_practice" ON claim_line_items
  FOR ALL USING (
    claim_id IN (SELECT id FROM claims WHERE practice_id = auth.user_practice_id())
  );

-- -----------------------------------------------------
-- INVOICES
-- -----------------------------------------------------
CREATE POLICY "invoices_practice" ON invoices
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PAYMENTS
-- -----------------------------------------------------
CREATE POLICY "payments_practice" ON payments
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PAYMENT TRANSACTIONS
-- -----------------------------------------------------
CREATE POLICY "payment_transactions_practice" ON payment_transactions
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PAYMENT PLANS
-- -----------------------------------------------------
CREATE POLICY "payment_plans_practice" ON payment_plans
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PAYMENT PLAN INSTALLMENTS (via payment plan)
-- -----------------------------------------------------
CREATE POLICY "installments_practice" ON payment_plan_installments
  FOR ALL USING (
    payment_plan_id IN (SELECT id FROM payment_plans WHERE practice_id = auth.user_practice_id())
  );

-- -----------------------------------------------------
-- EXPENSES
-- -----------------------------------------------------
CREATE POLICY "expenses_practice" ON expenses
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- APPEALS
-- -----------------------------------------------------
CREATE POLICY "appeals_practice" ON appeals
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- ELIGIBILITY CHECKS
-- -----------------------------------------------------
CREATE POLICY "eligibility_practice" ON eligibility_checks
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- ELIGIBILITY ALERTS
-- -----------------------------------------------------
CREATE POLICY "eligibility_alerts_practice" ON eligibility_alerts
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- INSURANCE RATES
-- -----------------------------------------------------
CREATE POLICY "insurance_rates_practice" ON insurance_rates
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PAYER INTEGRATIONS
-- -----------------------------------------------------
CREATE POLICY "payer_integrations_practice" ON payer_integrations
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PAYER CREDENTIALS (Sensitive!)
-- -----------------------------------------------------
CREATE POLICY "payer_credentials_practice" ON payer_credentials
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- INSURANCE DATA CACHE
-- -----------------------------------------------------
CREATE POLICY "insurance_cache_practice" ON insurance_data_cache
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- APPOINTMENTS
-- -----------------------------------------------------
CREATE POLICY "appointments_practice" ON appointments
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- WAITLIST
-- -----------------------------------------------------
CREATE POLICY "waitlist_practice" ON waitlist
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- APPOINTMENT TYPES
-- -----------------------------------------------------
CREATE POLICY "appointment_types_practice" ON appointment_types
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- THERAPIST AVAILABILITY
-- -----------------------------------------------------
CREATE POLICY "availability_practice" ON therapist_availability
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- THERAPIST TIME OFF
-- -----------------------------------------------------
CREATE POLICY "timeoff_practice" ON therapist_time_off
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- BOOKING SETTINGS
-- -----------------------------------------------------
CREATE POLICY "booking_settings_practice" ON booking_settings
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- ONLINE BOOKINGS
-- -----------------------------------------------------
CREATE POLICY "online_bookings_practice" ON online_bookings
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- TELEHEALTH SESSIONS
-- -----------------------------------------------------
CREATE POLICY "telehealth_sessions_practice" ON telehealth_sessions
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- TELEHEALTH SETTINGS
-- -----------------------------------------------------
CREATE POLICY "telehealth_settings_practice" ON telehealth_settings
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- CONVERSATIONS (Messaging)
-- -----------------------------------------------------
CREATE POLICY "conversations_practice" ON conversations
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- MESSAGES
-- -----------------------------------------------------
CREATE POLICY "messages_practice" ON messages
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- MESSAGE NOTIFICATIONS
-- -----------------------------------------------------
CREATE POLICY "notifications_practice" ON message_notifications
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- REVIEW REQUESTS
-- -----------------------------------------------------
CREATE POLICY "reviews_practice" ON review_requests
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PATIENT FEEDBACK
-- -----------------------------------------------------
CREATE POLICY "feedback_practice" ON patient_feedback
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- GOOGLE REVIEWS
-- -----------------------------------------------------
CREATE POLICY "google_reviews_practice" ON google_reviews
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- REFERRAL SOURCES
-- -----------------------------------------------------
CREATE POLICY "referral_sources_practice" ON referral_sources
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- REFERRALS
-- -----------------------------------------------------
CREATE POLICY "referrals_practice" ON referrals
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- REFERRAL COMMUNICATIONS
-- -----------------------------------------------------
CREATE POLICY "referral_comms_practice" ON referral_communications
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- AUDIT LOG (Admin only for viewing)
-- -----------------------------------------------------
CREATE POLICY "audit_log_practice" ON audit_log
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- BREACH INCIDENTS (Admin only)
-- -----------------------------------------------------
CREATE POLICY "breach_incidents_practice" ON breach_incidents
  FOR ALL USING (
    practice_id = auth.user_practice_id()
    AND auth.is_admin()
  );

-- Allow all practice users to INSERT breach reports
CREATE POLICY "breach_incidents_insert" ON breach_incidents
  FOR INSERT WITH CHECK (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- AMENDMENT REQUESTS
-- -----------------------------------------------------
CREATE POLICY "amendments_practice" ON amendment_requests
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- BAA RECORDS (Admin only)
-- -----------------------------------------------------
CREATE POLICY "baa_records_admin" ON baa_records
  FOR ALL USING (
    practice_id = auth.user_practice_id()
    AND auth.is_admin()
  );

-- -----------------------------------------------------
-- AUTHORIZATION AUDIT LOG
-- -----------------------------------------------------
CREATE POLICY "auth_audit_practice" ON authorization_audit_log
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- REIMBURSEMENT OPTIMIZATIONS
-- -----------------------------------------------------
CREATE POLICY "optimizations_practice" ON reimbursement_optimizations
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- REIMBURSEMENT BENCHMARKS
-- -----------------------------------------------------
CREATE POLICY "benchmarks_practice" ON reimbursement_benchmarks
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- DATA CAPTURE EVENTS
-- -----------------------------------------------------
CREATE POLICY "data_events_practice" ON data_capture_events
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- CPT CODE MAPPINGS
-- -----------------------------------------------------
CREATE POLICY "cpt_mappings_practice" ON cpt_code_mappings
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- PRACTICE PAYMENT SETTINGS
-- -----------------------------------------------------
CREATE POLICY "payment_settings_practice" ON practice_payment_settings
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- INVITES
-- -----------------------------------------------------
CREATE POLICY "invites_practice" ON invites
  FOR ALL USING (practice_id = auth.user_practice_id());

-- -----------------------------------------------------
-- REFERENCE TABLES (Read-only for all authenticated users)
-- These are shared across practices
-- -----------------------------------------------------

-- INSURANCES (shared reference)
CREATE POLICY "insurances_read" ON insurances
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "insurances_admin_write" ON insurances
  FOR ALL USING (auth.is_admin());

-- INSURANCE BILLING RULES (shared reference)
CREATE POLICY "billing_rules_read" ON insurance_billing_rules
  FOR SELECT USING (auth.role() = 'authenticated');

-- INSURANCE BILLING PREFERENCES (shared reference)
CREATE POLICY "billing_prefs_read" ON insurance_billing_preferences
  FOR SELECT USING (auth.role() = 'authenticated');

-- CPT CODES (shared reference)
CREATE POLICY "cpt_codes_read" ON cpt_codes
  FOR SELECT USING (auth.role() = 'authenticated');

-- CPT CODE EQUIVALENCIES (shared reference)
CREATE POLICY "cpt_equiv_read" ON cpt_code_equivalencies
  FOR SELECT USING (auth.role() = 'authenticated');

-- ICD10 CODES (shared reference)
CREATE POLICY "icd10_read" ON icd10_codes
  FOR SELECT USING (auth.role() = 'authenticated');

-- =====================================================
-- STEP 4: Grant necessary permissions
-- =====================================================

-- Grant usage on auth schema functions
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.user_practice_id() TO authenticated;
GRANT EXECUTE ON FUNCTION auth.is_admin() TO authenticated;

-- =====================================================
-- VERIFICATION QUERIES
-- Run these to verify RLS is working
-- =====================================================

-- Check which tables have RLS enabled:
-- SELECT schemaname, tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;

-- Check policies on a specific table:
-- SELECT * FROM pg_policies WHERE tablename = 'patients';

-- =====================================================
-- NOTES FOR PRODUCTION
-- =====================================================
-- 1. Test thoroughly in staging before production
-- 2. Ensure all users have practice_id set
-- 3. Monitor for any permission errors in logs
-- 4. Consider adding audit triggers for sensitive tables
-- 5. Review policies quarterly for HIPAA compliance
-- =====================================================
