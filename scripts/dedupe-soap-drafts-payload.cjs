/**
 * Duplicate pre-check for soap_note_drafts, run ahead of `drizzle-kit push`
 * creating the unique index idx_soap_draft_therapist_patient
 * (therapist_id, patient_id). REPORT ONLY - this never modifies a row.
 *
 * Background (therapybill-qa #3): storage.upsertSoapDraft uses
 * ON CONFLICT (therapist_id, patient_id), which needs a unique index. The
 * index was only ever declared in migrations/add_soap_draft_columns.sql,
 * which the deploy pipeline never runs (prod applies shared/schema.ts via
 * `drizzle-kit push`). The index is now declared in the schema, but
 * CREATE UNIQUE INDEX fails if duplicate pairs already exist, which would
 * halt the deploy mid-migration with an opaque error.
 *
 * Behaviour (abort-and-report, per Daniel's revision approval on QA #3):
 *   - no duplicate (therapist_id, patient_id) groups -> prints a summary,
 *     exits 0, and the deploy goes on to db:push, which creates the index.
 *   - duplicate groups exist -> prints every group and every row in it
 *     (id, practice_id, created_at, updated_at, last_saved_at, newest flag),
 *     exits 1, and the deploy halts BEFORE db:push. Nothing is deleted.
 *     Deleting or backing up those rows is a separate decision for Daniel.
 *
 * Rows where therapist_id or patient_id is NULL are not duplicates: NULLs
 * never collide in a unique index, so they cannot block index creation.
 *
 * Read-only: SELECT statements only, no transaction, no locks beyond the
 * reads themselves. Idempotent. The file keeps the name of the original
 * (deleting) proposal so references in QA #3 and PR #454 stay valid.
 * Fed to the app container as `node -e` (the prod image has no scripts/ dir).
 */
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const existing = await client.query(
      `SELECT 1 FROM pg_indexes
        WHERE tablename = 'soap_note_drafts'
          AND indexname = 'idx_soap_draft_therapist_patient'`
    );
    console.log(
      `idx_soap_draft_therapist_patient currently ${existing.rowCount ? 'EXISTS' : 'MISSING'} on soap_note_drafts`
    );

    const totals = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE therapist_id IS NULL OR patient_id IS NULL)::int AS null_keyed
         FROM soap_note_drafts`
    );
    console.log(
      `soap_note_drafts rows: ${totals.rows[0].total} (${totals.rows[0].null_keyed} with a NULL therapist_id or patient_id, never duplicates)`
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

    if (groups.rowCount === 0) {
      console.log('\nNo duplicates. Safe for db:push to create idx_soap_draft_therapist_patient.');
      return;
    }

    const rows = await client.query(
      `SELECT d.id, d.practice_id, d.therapist_id, d.patient_id,
              d.created_at, d.updated_at, d.last_saved_at,
              ROW_NUMBER() OVER (
                PARTITION BY d.therapist_id, d.patient_id
                ORDER BY d.updated_at DESC NULLS LAST,
                         d.last_saved_at DESC NULLS LAST,
                         d.id DESC
              ) = 1 AS newest
         FROM soap_note_drafts d
        WHERE d.therapist_id IS NOT NULL AND d.patient_id IS NOT NULL
          AND (d.therapist_id, d.patient_id) IN (
                SELECT therapist_id, patient_id
                  FROM soap_note_drafts
                 WHERE therapist_id IS NOT NULL AND patient_id IS NOT NULL
                 GROUP BY therapist_id, patient_id
                HAVING COUNT(*) > 1)
        ORDER BY d.therapist_id, d.patient_id, d.updated_at DESC NULLS LAST, d.id DESC`
    );
    const ts = (v) => (v instanceof Date ? v.toISOString() : String(v));
    let extra = 0;
    for (const g of groups.rows) {
      extra += g.n - 1;
      console.log(`\n  therapist=${g.therapist_id} patient=${g.patient_id} rows=${g.n}`);
      for (const r of rows.rows.filter((r) => r.therapist_id === g.therapist_id && r.patient_id === g.patient_id)) {
        console.log(
          `    id=${r.id} practice=${r.practice_id} created=${ts(r.created_at)} updated=${ts(r.updated_at)} last_saved=${ts(r.last_saved_at)}${r.newest ? '  <- newest' : ''}`
        );
      }
    }
    console.log(
      `\nABORT: ${groups.rowCount} duplicate group(s), ${extra} surplus row(s). ` +
        `CREATE UNIQUE INDEX would fail, so the deploy halts here before db:push. ` +
        `No rows were changed. Resolving these rows is a separate decision (see therapybill-qa #3).`
    );
    process.exitCode = 1;
  } catch (err) {
    console.error('soap_note_drafts duplicate check failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
