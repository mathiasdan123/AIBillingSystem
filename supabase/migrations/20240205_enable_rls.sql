-- Enable Row Level Security on all tables
-- This migration secures the database against unauthorized direct access
-- while allowing the application's service role to continue functioning.

-- Architecture Note:
-- This app uses server-side data access through Drizzle ORM with a service role.
-- RLS is enabled to prevent unauthorized direct database access (e.g., from the client).
-- The service_role bypasses RLS by default, so the server continues to work normally.
-- Multi-tenant isolation is handled at the application layer via practiceId filtering.

-- ==========================================
-- SESSIONS TABLE (Express session store)
-- ==========================================
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PRACTICES TABLE
-- ==========================================
ALTER TABLE practices ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- USERS TABLE
-- ==========================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PATIENTS TABLE
-- ==========================================
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- INSURANCES TABLE (reference data)
-- ==========================================
ALTER TABLE insurances ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- CPT_CODES TABLE (reference data)
-- ==========================================
ALTER TABLE cpt_codes ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- ICD10_CODES TABLE (reference data)
-- ==========================================
ALTER TABLE icd10_codes ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- TREATMENT_SESSIONS TABLE
-- ==========================================
ALTER TABLE treatment_sessions ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- SOAP_NOTES TABLE
-- ==========================================
ALTER TABLE soap_notes ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- CPT_CODE_MAPPINGS TABLE
-- ==========================================
ALTER TABLE cpt_code_mappings ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- CLAIMS TABLE
-- ==========================================
ALTER TABLE claims ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- CLAIM_LINE_ITEMS TABLE
-- ==========================================
ALTER TABLE claim_line_items ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- EXPENSES TABLE
-- ==========================================
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- REIMBURSEMENT_OPTIMIZATIONS TABLE
-- ==========================================
ALTER TABLE reimbursement_optimizations ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- REIMBURSEMENT_BENCHMARKS TABLE (reference data)
-- ==========================================
ALTER TABLE reimbursement_benchmarks ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- DATA_CAPTURE_EVENTS TABLE
-- ==========================================
ALTER TABLE data_capture_events ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- SOAP_NOTE_TEMPLATES TABLE
-- ==========================================
ALTER TABLE soap_note_templates ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- SOAP_NOTE_DRAFTS TABLE
-- ==========================================
ALTER TABLE soap_note_drafts ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- APPOINTMENTS TABLE
-- ==========================================
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- WAITLIST TABLE
-- ==========================================
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- REVIEW_REQUESTS TABLE
-- ==========================================
ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- GOOGLE_REVIEWS TABLE
-- ==========================================
ALTER TABLE google_reviews ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- APPOINTMENT_TYPES TABLE
-- ==========================================
ALTER TABLE appointment_types ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- THERAPIST_AVAILABILITY TABLE
-- ==========================================
ALTER TABLE therapist_availability ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- THERAPIST_TIME_OFF TABLE
-- ==========================================
ALTER TABLE therapist_time_off ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- BOOKING_SETTINGS TABLE
-- ==========================================
ALTER TABLE booking_settings ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- ONLINE_BOOKINGS TABLE
-- ==========================================
ALTER TABLE online_bookings ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- TELEHEALTH_SESSIONS TABLE
-- ==========================================
ALTER TABLE telehealth_sessions ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- TELEHEALTH_SETTINGS TABLE
-- ==========================================
ALTER TABLE telehealth_settings ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- INVOICES TABLE
-- ==========================================
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- INVITES TABLE
-- ==========================================
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PAYMENTS TABLE
-- ==========================================
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- ELIGIBILITY_CHECKS TABLE
-- ==========================================
ALTER TABLE eligibility_checks ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PATIENT_INSURANCE_AUTHORIZATIONS TABLE
-- ==========================================
ALTER TABLE patient_insurance_authorizations ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PAYER_INTEGRATIONS TABLE (reference data)
-- ==========================================
ALTER TABLE payer_integrations ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PAYER_CREDENTIALS TABLE
-- ==========================================
ALTER TABLE payer_credentials ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- INSURANCE_DATA_CACHE TABLE
-- ==========================================
ALTER TABLE insurance_data_cache ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- AUTHORIZATION_AUDIT_LOG TABLE
-- ==========================================
ALTER TABLE authorization_audit_log ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- APPEALS TABLE
-- ==========================================
ALTER TABLE appeals ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- INSURANCE_RATES TABLE
-- ==========================================
ALTER TABLE insurance_rates ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- AUDIT_LOG TABLE
-- ==========================================
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- BREACH_INCIDENTS TABLE
-- ==========================================
ALTER TABLE breach_incidents ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- AMENDMENT_REQUESTS TABLE
-- ==========================================
ALTER TABLE amendment_requests ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- BAA_RECORDS TABLE
-- ==========================================
ALTER TABLE baa_records ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- CONVERSATIONS TABLE
-- ==========================================
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- MESSAGES TABLE
-- ==========================================
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- MESSAGE_NOTIFICATIONS TABLE
-- ==========================================
ALTER TABLE message_notifications ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PATIENT_PORTAL_ACCESS TABLE
-- ==========================================
ALTER TABLE patient_portal_access ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PATIENT_DOCUMENTS TABLE
-- ==========================================
ALTER TABLE patient_documents ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PATIENT_STATEMENTS TABLE
-- ==========================================
ALTER TABLE patient_statements ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- ELIGIBILITY_ALERTS TABLE
-- ==========================================
ALTER TABLE eligibility_alerts ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- TREATMENT_PLANS TABLE
-- ==========================================
ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- TREATMENT_GOALS TABLE
-- ==========================================
ALTER TABLE treatment_goals ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- TREATMENT_OBJECTIVES TABLE
-- ==========================================
ALTER TABLE treatment_objectives ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- TREATMENT_INTERVENTIONS TABLE
-- ==========================================
ALTER TABLE treatment_interventions ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- GOAL_PROGRESS_NOTES TABLE
-- ==========================================
ALTER TABLE goal_progress_notes ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- OUTCOME_MEASURE_TEMPLATES TABLE
-- ==========================================
ALTER TABLE outcome_measure_templates ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PATIENT_ASSESSMENTS TABLE
-- ==========================================
ALTER TABLE patient_assessments ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- ASSESSMENT_SCHEDULES TABLE
-- ==========================================
ALTER TABLE assessment_schedules ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- REFERRAL_SOURCES TABLE
-- ==========================================
ALTER TABLE referral_sources ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- REFERRALS TABLE
-- ==========================================
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- REFERRAL_COMMUNICATIONS TABLE
-- ==========================================
ALTER TABLE referral_communications ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PATIENT_PAYMENT_METHODS TABLE
-- ==========================================
ALTER TABLE patient_payment_methods ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PAYMENT_TRANSACTIONS TABLE
-- ==========================================
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PAYMENT_PLANS TABLE
-- ==========================================
ALTER TABLE payment_plans ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PAYMENT_PLAN_INSTALLMENTS TABLE
-- ==========================================
ALTER TABLE payment_plan_installments ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- PRACTICE_PAYMENT_SETTINGS TABLE
-- ==========================================
ALTER TABLE practice_payment_settings ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- VERIFICATION
-- ==========================================
-- After running this migration, verify RLS is enabled on all tables:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';

-- The service_role key used by the server bypasses RLS automatically.
-- If you need client-side access to specific tables (e.g., for real-time),
-- add policies for those tables using auth.uid() or similar functions.
