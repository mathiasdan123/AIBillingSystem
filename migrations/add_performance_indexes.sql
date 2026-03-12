-- Migration: Add composite performance indexes for critical query patterns
-- These supplement the indexes in 20260309_add_performance_indexes.sql
-- with additional composite indexes identified from query pattern analysis

-- =============================================
-- PATIENTS: composite (practice_id, deleted_at) for soft-delete filtered queries
-- =============================================
CREATE INDEX IF NOT EXISTS idx_patients_practice_deleted
  ON patients(practice_id, deleted_at);

-- =============================================
-- CLAIMS: composite (practice_id, status, created_at) for dashboard/filtered listing
-- =============================================
CREATE INDEX IF NOT EXISTS idx_claims_practice_status_created
  ON claims(practice_id, status, created_at);

-- =============================================
-- SOAP NOTES: (session_id, created_at) for session-scoped chronological queries
-- Note: soap_notes does not have a practice_id column; queries join via treatment_sessions
-- =============================================
CREATE INDEX IF NOT EXISTS idx_soap_notes_session_created
  ON soap_notes(session_id, created_at);

-- =============================================
-- AUDIT LOG: composite (user_id, practice_id, event_category) for audit queries
-- =============================================
CREATE INDEX IF NOT EXISTS idx_audit_log_user_practice_category
  ON audit_log(user_id, practice_id, event_category);

-- Note: Run ANALYZE after creating indexes to update query planner statistics
-- ANALYZE patients;
-- ANALYZE claims;
-- ANALYZE soap_notes;
-- ANALYZE audit_log;
