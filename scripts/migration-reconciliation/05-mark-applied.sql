-- =============================================================================
-- 05-mark-applied.sql — mark the regenerated baseline as ALREADY APPLIED
-- without running any of its DDL. (Step 5 of docs/migration-safety-gap.md.)
--
-- HOW DRIZZLE DECIDES WHAT TO RUN (drizzle-kit 0.31.9 / drizzle-orm):
--   * Journal table: drizzle.__drizzle_migrations
--       (id SERIAL PK, hash text NOT NULL, created_at bigint)
--   * `drizzle-kit migrate` reads ONLY the newest row (ORDER BY created_at
--     DESC LIMIT 1) and applies every migration whose journal "when"
--     (folderMillis) is GREATER than that row's created_at.
--   * On apply it inserts (hash, created_at) where hash is the sha256 hex
--     digest of the ENTIRE .sql file text and created_at is the "when"
--     value from migrations/meta/_journal.json.
--
-- So: inserting one row with the baseline's exact hash + "when" makes
-- `drizzle-kit migrate` treat 0000_baseline.sql as done and apply nothing.
--
-- DO NOT EDIT VALUES BY HAND. Run 05-print-mark-applied.sh — it computes
-- :hash and :created_at from the files on disk and prints the exact psql
-- invocation (it never executes anything). If 0000_baseline.sql changes by
-- even one byte after the hash was computed, the recorded hash is stale;
-- re-run 05-print-mark-applied.sh.
--
-- Idempotent: the INSERT is skipped when a row with this hash exists.
-- Safe-by-construction: everything here is additive (CREATE IF NOT EXISTS
-- on a bookkeeping schema/table + one INSERT). No application object is
-- touched. Reversal = DELETE the row (printed by 05-print-mark-applied.sh).
--
-- ORDER OF OPERATIONS (enforced by the runbook, not by this file):
--   1st: run against the RESTORED COPY, then `drizzle-kit migrate` against
--        the restored copy must report nothing to apply.
--   2nd: only after that passes, a human runs the SAME command against
--        production — the single production write of the whole procedure.
--
-- Usage (printed, with values filled in, by 05-print-mark-applied.sh):
--   psql "<url>" -v ON_ERROR_STOP=1 \
--     -v hash='<sha256-of-0000_baseline.sql>' \
--     -v created_at='<journal "when" millis>' \
--     -f scripts/migration-reconciliation/05-mark-applied.sql
-- =============================================================================

\set ON_ERROR_STOP on

-- Sanity-gate the variables before touching anything. If -v hash / -v
-- created_at were not supplied at all, psql leaves :'hash' as literal text,
-- the SELECT below is a syntax error, and ON_ERROR_STOP aborts — also safe.
SELECT (length(:'hash') = 64 AND :'hash' ~ '^[0-9a-f]{64}$') AS hash_ok \gset
\if :hash_ok
\else
  \echo 'ABORT: -v hash is not a 64-char sha256 hex digest. Re-run 05-print-mark-applied.sh.'
  \warn 'Nothing was written.'
  SELECT abort_bad_hash_variable;  -- deliberate error -> nonzero exit
\endif

SELECT (:'created_at' ~ '^[0-9]{13}$') AS created_at_ok \gset
\if :created_at_ok
\else
  \echo 'ABORT: -v created_at is not epoch milliseconds (13 digits). Re-run 05-print-mark-applied.sh.'
  \warn 'Nothing was written.'
  SELECT abort_bad_created_at_variable;  -- deliberate error -> nonzero exit
\endif

-- push never creates drizzle's bookkeeping objects, so on a database that
-- has only ever seen `drizzle-kit push` these two statements do the work;
-- on one that already has them they are no-ops.
CREATE SCHEMA IF NOT EXISTS "drizzle";

CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

-- The one row. WHERE NOT EXISTS keeps re-runs harmless.
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT :'hash', (:'created_at')::bigint
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = :'hash'
);

-- Show the resulting journal so the operator can paste it into the
-- maintenance-window notes.
SELECT id, hash, created_at,
       to_timestamp(created_at / 1000.0) AS created_at_ts
FROM "drizzle"."__drizzle_migrations"
ORDER BY created_at;
