/**
 * Collapse legacy duplicate soap_note_drafts rows so the unique index
 * idx_soap_draft_therapist_patient (therapist_id, patient_id) can be created.
 *
 * Background (therapybill-qa #3): storage.upsertSoapDraft uses
 * ON CONFLICT (therapist_id, patient_id), which needs a unique index. The
 * index was only ever declared in migrations/add_soap_draft_columns.sql,
 * which the deploy pipeline never runs (prod applies shared/schema.ts via
 * `drizzle-kit push`). The index is now declared in the schema, but
 * CREATE UNIQUE INDEX fails if duplicates already exist, which would halt
 * the deploy. This runs ahead of db:push and keeps the newest row per
 * (therapist_id, patient_id).
 *
 * "Newest" = greatest updated_at, then last_saved_at, then id. Rows where
 * therapist_id or patient_id is NULL are left alone: NULLs never collide
 * in a unique index, so they cannot block index creation.
 *
 * Idempotent: with no duplicates it changes nothing and exits 0.
 * Runs in one transaction. DRY_RUN=1 rolls it back after reporting.
 * Fed to the app container as `node -e` (the prod image has no scripts/ dir).
 */
const { Client } = require('pg');

(async () => {
  const dryRun = process.env.DRY_RUN === '1';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT 1 FROM pg_indexes
        WHERE tablename = 'soap_note_drafts'
          AND indexname = 'idx_soap_draft_therapist_patient'`
    );
    console.log(
      `idx_soap_draft_therapist_patient currently ${existing.rowCount ? 'EXISTS' : 'MISSING'} on soap_note_drafts`
    );

    const groups = await client.query(
      `SELECT therapist_id, patient_id, COUNT(*)::int AS n
         FROM soap_note_drafts
        WHERE therapist_id IS NOT NULL AND patient_id IS NOT NULL
        GROUP BY therapist_id, patient_id
       HAVING COUNT(*) > 1
        ORDER BY n DESC, therapist_id, patient_id`
    );
    console.log(`Duplicate (therapist_id, patient_id) groups: ${groups.rowCount}`);
    for (const g of groups.rows) {
      console.log(`  therapist=${g.therapist_id} patient=${g.patient_id} rows=${g.n}`);
    }

    const removed = await client.query(
      `DELETE FROM soap_note_drafts d
        USING (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY therapist_id, patient_id
                   ORDER BY updated_at DESC NULLS LAST,
                            last_saved_at DESC NULLS LAST,
                            id DESC
                 ) AS rn
            FROM soap_note_drafts
           WHERE therapist_id IS NOT NULL AND patient_id IS NOT NULL
        ) ranked
        WHERE d.id = ranked.id AND ranked.rn > 1
        RETURNING d.id, d.therapist_id, d.patient_id, d.updated_at`
    );
    console.log(`\nRemoved ${removed.rowCount} older duplicate row(s):`);
    for (const r of removed.rows) {
      console.log(`  id=${r.id} therapist=${r.therapist_id} patient=${r.patient_id} updated_at=${r.updated_at?.toISOString?.() ?? r.updated_at}`);
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN - transaction rolled back, nothing changed.');
    } else {
      await client.query('COMMIT');
      console.log(`\nCommitted. soap_note_drafts is ready for idx_soap_draft_therapist_patient.`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('soap_note_drafts dedupe failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
