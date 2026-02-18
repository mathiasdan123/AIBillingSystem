-- =====================================================
-- RLS Verification Script
-- Run this AFTER applying rls_policies.sql
-- =====================================================

-- 1. Check all tables have RLS enabled
SELECT
  schemaname,
  tablename,
  CASE WHEN rowsecurity THEN 'ENABLED' ELSE 'DISABLED' END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY rls_status DESC, tablename;

-- 2. Count policies per table
SELECT
  tablename,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- 3. List all policies with details
SELECT
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 4. Test: This should return only YOUR practice's data
-- SELECT COUNT(*) FROM patients;

-- 5. Verify helper functions exist
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'auth'
  AND routine_name IN ('user_practice_id', 'is_admin');
