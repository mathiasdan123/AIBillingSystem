-- =====================================================
-- TherapyBill AI - Complete RLS Policies Migration
-- Date: 2026-03-05
-- Purpose: Apply comprehensive Row Level Security policies
--          to fix 370 Supabase Security Advisor warnings
-- =====================================================

-- =====================================================
-- STEP 1: Create helper functions (in public schema)
-- Note: We use public schema because auth schema is managed by Supabase
-- =====================================================

-- Drop existing functions if they exist (to recreate cleanly)
DROP FUNCTION IF EXISTS public.rls_user_practice_id();
DROP FUNCTION IF EXISTS public.rls_is_admin();
DROP FUNCTION IF EXISTS public.rls_user_role();

-- Get user's practice_id from users table
CREATE OR REPLACE FUNCTION public.rls_user_practice_id()
RETURNS INTEGER AS $$
  SELECT practice_id::INTEGER
  FROM users
  WHERE id = auth.uid()::TEXT
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Check if user is admin
CREATE OR REPLACE FUNCTION public.rls_is_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(role = 'admin', false)
  FROM users
  WHERE id = auth.uid()::TEXT
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Get user's role
CREATE OR REPLACE FUNCTION public.rls_user_role()
RETURNS TEXT AS $$
  SELECT COALESCE(role, 'therapist')
  FROM users
  WHERE id = auth.uid()::TEXT
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- =====================================================
-- STEP 2: Drop all existing policies (clean slate)
-- =====================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- =====================================================
-- STEP 3: Enable RLS on ALL tables
-- =====================================================

-- Auth/System tables
ALTER TABLE IF EXISTS sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS practices ENABLE ROW LEVEL SECURITY;

-- Patient data (PHI - Critical)
ALTER TABLE IF EXISTS patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS patient_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS patient_portal_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS patient_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS patient_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS patient_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS patient_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS patient_insurance_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS patient_plan_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS patient_plan_benefits ENABLE ROW LEVEL SECURITY;

-- Clinical data
ALTER TABLE IF EXISTS treatment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS soap_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS soap_note_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS soap_note_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS treatment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS treatment_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS treatment_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS treatment_interventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS goal_progress_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS outcome_measure_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS assessment_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS therapy_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS exercise_bank ENABLE ROW LEVEL SECURITY;

-- Billing/Claims
ALTER TABLE IF EXISTS claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS claim_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS claim_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_plan_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS appeals ENABLE ROW LEVEL SECURITY;

-- Insurance/Eligibility
ALTER TABLE IF EXISTS eligibility_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS eligibility_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS insurance_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payer_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payer_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS insurance_data_cache ENABLE ROW LEVEL SECURITY;

-- Scheduling
ALTER TABLE IF EXISTS appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS appointment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS appointment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS therapist_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS therapist_time_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS booking_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS online_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS therapist_locations ENABLE ROW LEVEL SECURITY;

-- Telehealth
ALTER TABLE IF EXISTS telehealth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS telehealth_settings ENABLE ROW LEVEL SECURITY;

-- Communication
ALTER TABLE IF EXISTS conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS message_notifications ENABLE ROW LEVEL SECURITY;

-- Reviews/Feedback
ALTER TABLE IF EXISTS review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS patient_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS google_reviews ENABLE ROW LEVEL SECURITY;

-- Referrals
ALTER TABLE IF EXISTS referral_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS referral_communications ENABLE ROW LEVEL SECURITY;

-- Compliance/Audit
ALTER TABLE IF EXISTS audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS breach_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS amendment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS baa_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS authorization_audit_log ENABLE ROW LEVEL SECURITY;

-- Analytics/Optimization
ALTER TABLE IF EXISTS reimbursement_optimizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS reimbursement_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS data_capture_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cpt_code_mappings ENABLE ROW LEVEL SECURITY;

-- Practice Settings
ALTER TABLE IF EXISTS practice_payment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS invites ENABLE ROW LEVEL SECURITY;

-- Reference tables
ALTER TABLE IF EXISTS insurances ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS insurance_billing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS insurance_billing_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cpt_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cpt_code_equivalencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS icd10_codes ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- STEP 4: Create RLS Policies for all tables
-- =====================================================

-- -----------------------------------------------------
-- SESSIONS TABLE (Auth sessions - system managed)
-- Service role manages sessions, allow authenticated to see own
-- -----------------------------------------------------
CREATE POLICY "sessions_service_role" ON sessions
  FOR ALL TO service_role USING (true);

CREATE POLICY "sessions_authenticated" ON sessions
  FOR ALL TO authenticated USING (true);

-- -----------------------------------------------------
-- USERS TABLE
-- Users can see their own data and users in their practice
-- -----------------------------------------------------
CREATE POLICY "users_self_access" ON users
  FOR ALL TO authenticated
  USING (id = auth.uid()::TEXT);

CREATE POLICY "users_same_practice" ON users
  FOR SELECT TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "users_service_role" ON users
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PRACTICES TABLE
-- Users can only access their own practice
-- -----------------------------------------------------
CREATE POLICY "practices_own" ON practices
  FOR ALL TO authenticated
  USING (id = public.rls_user_practice_id());

CREATE POLICY "practices_service_role" ON practices
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PATIENTS TABLE (PHI - Critical)
-- Practice isolation required
-- -----------------------------------------------------
CREATE POLICY "patients_practice" ON patients
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "patients_service_role" ON patients
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PATIENT CONSENTS
-- -----------------------------------------------------
CREATE POLICY "patient_consents_practice" ON patient_consents
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "patient_consents_service_role" ON patient_consents
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PATIENT PORTAL ACCESS
-- -----------------------------------------------------
CREATE POLICY "patient_portal_practice" ON patient_portal_access
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "patient_portal_service_role" ON patient_portal_access
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PATIENT DOCUMENTS
-- -----------------------------------------------------
CREATE POLICY "patient_documents_practice" ON patient_documents
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "patient_documents_service_role" ON patient_documents
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PATIENT STATEMENTS
-- -----------------------------------------------------
CREATE POLICY "patient_statements_practice" ON patient_statements
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "patient_statements_service_role" ON patient_statements
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PATIENT PAYMENT METHODS
-- -----------------------------------------------------
CREATE POLICY "patient_payment_methods_practice" ON patient_payment_methods
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "patient_payment_methods_service_role" ON patient_payment_methods
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PATIENT ASSESSMENTS
-- -----------------------------------------------------
CREATE POLICY "patient_assessments_practice" ON patient_assessments
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "patient_assessments_service_role" ON patient_assessments
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PATIENT INSURANCE AUTHORIZATIONS
-- -----------------------------------------------------
CREATE POLICY "patient_auth_practice" ON patient_insurance_authorizations
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "patient_auth_service_role" ON patient_insurance_authorizations
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PATIENT PLAN DOCUMENTS (NEW)
-- -----------------------------------------------------
CREATE POLICY "patient_plan_docs_practice" ON patient_plan_documents
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "patient_plan_docs_service_role" ON patient_plan_documents
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PATIENT PLAN BENEFITS (NEW)
-- -----------------------------------------------------
CREATE POLICY "patient_plan_benefits_practice" ON patient_plan_benefits
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "patient_plan_benefits_service_role" ON patient_plan_benefits
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- TREATMENT SESSIONS
-- -----------------------------------------------------
CREATE POLICY "treatment_sessions_practice" ON treatment_sessions
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "treatment_sessions_service_role" ON treatment_sessions
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- SOAP NOTES (Clinical PHI - joins through treatment_sessions)
-- -----------------------------------------------------
CREATE POLICY "soap_notes_practice" ON soap_notes
  FOR ALL TO authenticated
  USING (
    session_id IN (SELECT id FROM treatment_sessions WHERE practice_id = public.rls_user_practice_id())
  );

CREATE POLICY "soap_notes_service_role" ON soap_notes
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- SOAP NOTE TEMPLATES
-- -----------------------------------------------------
CREATE POLICY "soap_templates_practice" ON soap_note_templates
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "soap_templates_service_role" ON soap_note_templates
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- SOAP NOTE DRAFTS (joins through patients)
-- -----------------------------------------------------
CREATE POLICY "soap_drafts_practice" ON soap_note_drafts
  FOR ALL TO authenticated
  USING (
    patient_id IN (SELECT id FROM patients WHERE practice_id = public.rls_user_practice_id())
  );

CREATE POLICY "soap_drafts_service_role" ON soap_note_drafts
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- TREATMENT PLANS
-- -----------------------------------------------------
CREATE POLICY "treatment_plans_practice" ON treatment_plans
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "treatment_plans_service_role" ON treatment_plans
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- TREATMENT GOALS
-- -----------------------------------------------------
CREATE POLICY "treatment_goals_practice" ON treatment_goals
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "treatment_goals_service_role" ON treatment_goals
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- TREATMENT OBJECTIVES (joins through treatment_plans)
-- -----------------------------------------------------
CREATE POLICY "treatment_objectives_practice" ON treatment_objectives
  FOR ALL TO authenticated
  USING (
    treatment_plan_id IN (SELECT id FROM treatment_plans WHERE practice_id = public.rls_user_practice_id())
  );

CREATE POLICY "treatment_objectives_service_role" ON treatment_objectives
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- TREATMENT INTERVENTIONS (joins through treatment_plans)
-- -----------------------------------------------------
CREATE POLICY "treatment_interventions_practice" ON treatment_interventions
  FOR ALL TO authenticated
  USING (
    treatment_plan_id IN (SELECT id FROM treatment_plans WHERE practice_id = public.rls_user_practice_id())
  );

CREATE POLICY "treatment_interventions_service_role" ON treatment_interventions
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- GOAL PROGRESS NOTES (joins through treatment_goals)
-- -----------------------------------------------------
CREATE POLICY "goal_progress_practice" ON goal_progress_notes
  FOR ALL TO authenticated
  USING (
    goal_id IN (SELECT id FROM treatment_goals WHERE practice_id = public.rls_user_practice_id())
  );

CREATE POLICY "goal_progress_service_role" ON goal_progress_notes
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- OUTCOME MEASURE TEMPLATES
-- -----------------------------------------------------
CREATE POLICY "outcome_templates_practice" ON outcome_measure_templates
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "outcome_templates_service_role" ON outcome_measure_templates
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- ASSESSMENT SCHEDULES
-- -----------------------------------------------------
CREATE POLICY "assessment_schedules_practice" ON assessment_schedules
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "assessment_schedules_service_role" ON assessment_schedules
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- THERAPY BANK
-- -----------------------------------------------------
CREATE POLICY "therapy_bank_practice" ON therapy_bank
  FOR ALL TO authenticated
  USING (practice_id IS NULL OR practice_id = public.rls_user_practice_id());

CREATE POLICY "therapy_bank_service_role" ON therapy_bank
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- EXERCISE BANK
-- -----------------------------------------------------
CREATE POLICY "exercise_bank_practice" ON exercise_bank
  FOR ALL TO authenticated
  USING (practice_id IS NULL OR practice_id = public.rls_user_practice_id());

CREATE POLICY "exercise_bank_service_role" ON exercise_bank
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- CLAIMS (Financial PHI)
-- -----------------------------------------------------
CREATE POLICY "claims_practice" ON claims
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "claims_service_role" ON claims
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- CLAIM LINE ITEMS
-- -----------------------------------------------------
CREATE POLICY "claim_items_practice" ON claim_line_items
  FOR ALL TO authenticated
  USING (
    claim_id IN (SELECT id FROM claims WHERE practice_id = public.rls_user_practice_id())
  );

CREATE POLICY "claim_items_service_role" ON claim_line_items
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- CLAIM OUTCOMES (NEW - ML Training Data)
-- -----------------------------------------------------
CREATE POLICY "claim_outcomes_practice" ON claim_outcomes
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "claim_outcomes_service_role" ON claim_outcomes
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- INVOICES
-- -----------------------------------------------------
CREATE POLICY "invoices_practice" ON invoices
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "invoices_service_role" ON invoices
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PAYMENTS
-- -----------------------------------------------------
CREATE POLICY "payments_practice" ON payments
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "payments_service_role" ON payments
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PAYMENT TRANSACTIONS
-- -----------------------------------------------------
CREATE POLICY "payment_transactions_practice" ON payment_transactions
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "payment_transactions_service_role" ON payment_transactions
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PAYMENT PLANS
-- -----------------------------------------------------
CREATE POLICY "payment_plans_practice" ON payment_plans
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "payment_plans_service_role" ON payment_plans
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PAYMENT PLAN INSTALLMENTS
-- -----------------------------------------------------
CREATE POLICY "installments_practice" ON payment_plan_installments
  FOR ALL TO authenticated
  USING (
    payment_plan_id IN (SELECT id FROM payment_plans WHERE practice_id = public.rls_user_practice_id())
  );

CREATE POLICY "installments_service_role" ON payment_plan_installments
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- EXPENSES
-- -----------------------------------------------------
CREATE POLICY "expenses_practice" ON expenses
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "expenses_service_role" ON expenses
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- APPEALS
-- -----------------------------------------------------
CREATE POLICY "appeals_practice" ON appeals
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "appeals_service_role" ON appeals
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- ELIGIBILITY CHECKS (joins through patients)
-- -----------------------------------------------------
CREATE POLICY "eligibility_practice" ON eligibility_checks
  FOR ALL TO authenticated
  USING (
    patient_id IN (SELECT id FROM patients WHERE practice_id = public.rls_user_practice_id())
  );

CREATE POLICY "eligibility_service_role" ON eligibility_checks
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- ELIGIBILITY ALERTS
-- -----------------------------------------------------
CREATE POLICY "eligibility_alerts_practice" ON eligibility_alerts
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "eligibility_alerts_service_role" ON eligibility_alerts
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- INSURANCE RATES (shared reference data)
-- -----------------------------------------------------
CREATE POLICY "insurance_rates_read" ON insurance_rates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "insurance_rates_service_role" ON insurance_rates
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PAYER INTEGRATIONS (shared reference data)
-- -----------------------------------------------------
CREATE POLICY "payer_integrations_read" ON payer_integrations
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "payer_integrations_service_role" ON payer_integrations
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PAYER CREDENTIALS (Sensitive!)
-- -----------------------------------------------------
CREATE POLICY "payer_credentials_practice" ON payer_credentials
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "payer_credentials_service_role" ON payer_credentials
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- INSURANCE DATA CACHE
-- -----------------------------------------------------
CREATE POLICY "insurance_cache_practice" ON insurance_data_cache
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "insurance_cache_service_role" ON insurance_data_cache
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- APPOINTMENTS
-- -----------------------------------------------------
CREATE POLICY "appointments_practice" ON appointments
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "appointments_service_role" ON appointments
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- APPOINTMENT REQUESTS
-- -----------------------------------------------------
CREATE POLICY "appointment_requests_practice" ON appointment_requests
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "appointment_requests_service_role" ON appointment_requests
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- WAITLIST
-- -----------------------------------------------------
CREATE POLICY "waitlist_practice" ON waitlist
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "waitlist_service_role" ON waitlist
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- APPOINTMENT TYPES
-- -----------------------------------------------------
CREATE POLICY "appointment_types_practice" ON appointment_types
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "appointment_types_service_role" ON appointment_types
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- THERAPIST AVAILABILITY
-- THERAPIST AVAILABILITY (joins through users)
-- -----------------------------------------------------
CREATE POLICY "availability_practice" ON therapist_availability
  FOR ALL TO authenticated
  USING (
    therapist_id IN (SELECT id FROM users WHERE practice_id = public.rls_user_practice_id())
  );

CREATE POLICY "availability_service_role" ON therapist_availability
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- THERAPIST TIME OFF
-- -----------------------------------------------------
CREATE POLICY "timeoff_practice" ON therapist_time_off
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "timeoff_service_role" ON therapist_time_off
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- BOOKING SETTINGS
-- -----------------------------------------------------
CREATE POLICY "booking_settings_practice" ON booking_settings
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "booking_settings_service_role" ON booking_settings
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- ONLINE BOOKINGS
-- -----------------------------------------------------
CREATE POLICY "online_bookings_practice" ON online_bookings
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "online_bookings_service_role" ON online_bookings
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- LOCATIONS
-- -----------------------------------------------------
CREATE POLICY "locations_practice" ON locations
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "locations_service_role" ON locations
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- THERAPIST LOCATIONS
-- -----------------------------------------------------
CREATE POLICY "therapist_locations_practice" ON therapist_locations
  FOR ALL TO authenticated
  USING (
    location_id IN (SELECT id FROM locations WHERE practice_id = public.rls_user_practice_id())
  );

CREATE POLICY "therapist_locations_service_role" ON therapist_locations
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- TELEHEALTH SESSIONS
-- -----------------------------------------------------
CREATE POLICY "telehealth_sessions_practice" ON telehealth_sessions
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "telehealth_sessions_service_role" ON telehealth_sessions
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- TELEHEALTH SETTINGS
-- -----------------------------------------------------
CREATE POLICY "telehealth_settings_practice" ON telehealth_settings
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "telehealth_settings_service_role" ON telehealth_settings
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- CONVERSATIONS (Messaging)
-- -----------------------------------------------------
CREATE POLICY "conversations_practice" ON conversations
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "conversations_service_role" ON conversations
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- MESSAGES (joins through conversations)
-- -----------------------------------------------------
CREATE POLICY "messages_practice" ON messages
  FOR ALL TO authenticated
  USING (
    conversation_id IN (SELECT id FROM conversations WHERE practice_id = public.rls_user_practice_id())
  );

CREATE POLICY "messages_service_role" ON messages
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- MESSAGE NOTIFICATIONS (joins through messages -> conversations)
-- -----------------------------------------------------
CREATE POLICY "notifications_practice" ON message_notifications
  FOR ALL TO authenticated
  USING (
    message_id IN (
      SELECT m.id FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.practice_id = public.rls_user_practice_id()
    )
  );

CREATE POLICY "notifications_service_role" ON message_notifications
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- REVIEW REQUESTS
-- -----------------------------------------------------
CREATE POLICY "reviews_practice" ON review_requests
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "reviews_service_role" ON review_requests
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PATIENT FEEDBACK
-- -----------------------------------------------------
CREATE POLICY "feedback_practice" ON patient_feedback
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "feedback_service_role" ON patient_feedback
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- GOOGLE REVIEWS
-- -----------------------------------------------------
CREATE POLICY "google_reviews_practice" ON google_reviews
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "google_reviews_service_role" ON google_reviews
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- REFERRAL SOURCES
-- -----------------------------------------------------
CREATE POLICY "referral_sources_practice" ON referral_sources
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "referral_sources_service_role" ON referral_sources
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- REFERRALS
-- -----------------------------------------------------
CREATE POLICY "referrals_practice" ON referrals
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "referrals_service_role" ON referrals
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- REFERRAL COMMUNICATIONS (joins through referrals)
-- -----------------------------------------------------
CREATE POLICY "referral_comms_practice" ON referral_communications
  FOR ALL TO authenticated
  USING (
    referral_id IN (SELECT id FROM referrals WHERE practice_id = public.rls_user_practice_id())
  );

CREATE POLICY "referral_comms_service_role" ON referral_communications
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- AUDIT LOG
-- -----------------------------------------------------
CREATE POLICY "audit_log_practice" ON audit_log
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "audit_log_service_role" ON audit_log
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- BREACH INCIDENTS (Admin only for viewing, all can insert)
-- -----------------------------------------------------
CREATE POLICY "breach_incidents_admin" ON breach_incidents
  FOR SELECT TO authenticated
  USING (practice_id = public.rls_user_practice_id() AND public.rls_is_admin());

CREATE POLICY "breach_incidents_insert" ON breach_incidents
  FOR INSERT TO authenticated
  WITH CHECK (practice_id = public.rls_user_practice_id());

CREATE POLICY "breach_incidents_service_role" ON breach_incidents
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- AMENDMENT REQUESTS
-- -----------------------------------------------------
CREATE POLICY "amendments_practice" ON amendment_requests
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "amendments_service_role" ON amendment_requests
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- BAA RECORDS (Admin only)
-- -----------------------------------------------------
CREATE POLICY "baa_records_admin" ON baa_records
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id() AND public.rls_is_admin());

CREATE POLICY "baa_records_service_role" ON baa_records
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- AUTHORIZATION AUDIT LOG
-- -----------------------------------------------------
CREATE POLICY "auth_audit_practice" ON authorization_audit_log
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "auth_audit_service_role" ON authorization_audit_log
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- REIMBURSEMENT OPTIMIZATIONS
-- -----------------------------------------------------
CREATE POLICY "optimizations_practice" ON reimbursement_optimizations
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "optimizations_service_role" ON reimbursement_optimizations
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- REIMBURSEMENT BENCHMARKS (shared reference data)
-- -----------------------------------------------------
CREATE POLICY "benchmarks_read" ON reimbursement_benchmarks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "benchmarks_service_role" ON reimbursement_benchmarks
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- DATA CAPTURE EVENTS
-- -----------------------------------------------------
CREATE POLICY "data_events_practice" ON data_capture_events
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "data_events_service_role" ON data_capture_events
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- CPT CODE MAPPINGS (shared reference data)
-- -----------------------------------------------------
CREATE POLICY "cpt_mappings_read" ON cpt_code_mappings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "cpt_mappings_service_role" ON cpt_code_mappings
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- PRACTICE PAYMENT SETTINGS
-- -----------------------------------------------------
CREATE POLICY "payment_settings_practice" ON practice_payment_settings
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "payment_settings_service_role" ON practice_payment_settings
  FOR ALL TO service_role USING (true);

-- -----------------------------------------------------
-- INVITES
-- -----------------------------------------------------
CREATE POLICY "invites_practice" ON invites
  FOR ALL TO authenticated
  USING (practice_id = public.rls_user_practice_id());

CREATE POLICY "invites_service_role" ON invites
  FOR ALL TO service_role USING (true);

-- =====================================================
-- REFERENCE TABLES (Read-only for authenticated users)
-- These are shared across practices
-- =====================================================

-- INSURANCES (shared reference)
CREATE POLICY "insurances_read" ON insurances
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "insurances_admin_write" ON insurances
  FOR ALL TO authenticated USING (public.rls_is_admin());

CREATE POLICY "insurances_service_role" ON insurances
  FOR ALL TO service_role USING (true);

-- INSURANCE BILLING RULES (shared reference)
CREATE POLICY "billing_rules_read" ON insurance_billing_rules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "billing_rules_service_role" ON insurance_billing_rules
  FOR ALL TO service_role USING (true);

-- INSURANCE BILLING PREFERENCES (shared reference)
CREATE POLICY "billing_prefs_read" ON insurance_billing_preferences
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "billing_prefs_service_role" ON insurance_billing_preferences
  FOR ALL TO service_role USING (true);

-- CPT CODES (shared reference)
CREATE POLICY "cpt_codes_read" ON cpt_codes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "cpt_codes_service_role" ON cpt_codes
  FOR ALL TO service_role USING (true);

-- CPT CODE EQUIVALENCIES (shared reference)
CREATE POLICY "cpt_equiv_read" ON cpt_code_equivalencies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "cpt_equiv_service_role" ON cpt_code_equivalencies
  FOR ALL TO service_role USING (true);

-- ICD10 CODES (shared reference)
CREATE POLICY "icd10_read" ON icd10_codes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "icd10_service_role" ON icd10_codes
  FOR ALL TO service_role USING (true);

-- =====================================================
-- STEP 5: Grant necessary permissions
-- =====================================================

-- Grant execute on our helper functions
GRANT EXECUTE ON FUNCTION public.rls_user_practice_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_user_practice_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.rls_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_is_admin() TO service_role;
GRANT EXECUTE ON FUNCTION public.rls_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_user_role() TO service_role;

-- =====================================================
-- VERIFICATION
-- =====================================================
-- Run this to verify RLS is enabled on all tables:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- Run this to check policy count per table:
-- SELECT tablename, COUNT(*) as policy_count FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename ORDER BY tablename;
