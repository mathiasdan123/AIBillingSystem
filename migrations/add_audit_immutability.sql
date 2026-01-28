-- Add integrity hash column to audit_log
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS integrity_hash VARCHAR;

-- Prevent modification or deletion of audit_log rows
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log rows cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

-- Drop triggers if they exist (idempotent)
DROP TRIGGER IF EXISTS no_audit_log_update ON audit_log;
DROP TRIGGER IF EXISTS no_audit_log_delete ON audit_log;

CREATE TRIGGER no_audit_log_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER no_audit_log_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
