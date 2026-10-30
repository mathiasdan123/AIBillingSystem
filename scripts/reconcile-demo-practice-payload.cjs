// See run-reconcile-demo-practice.sh. DRY_RUN=1 rolls back.
const { Client } = require('pg');

// Tables whose own rows are filtered via a prefetched id set or subquery
// (children of another scoped table). Run before DIRECT below -- several of
// these (appeal_outcomes, treatment_goals, payment_plan_installments,
// referral_communications) subquery a DIRECT table by practice_id, so that
// table must still exist when this runs. $1=practiceId, $2=patientIds,
// $3=claimIds, $4=sessionIds, $5=soapNoteIds, $6=goalIds, $7=remittanceIds,
// $8=conversationIds, $9=messageIds (prefetched below, see ids()).
const JOINED = [
  ['claim_line_items', 'DELETE FROM claim_line_items WHERE claim_id=ANY($3)'],
  ['claim_follow_ups', 'DELETE FROM claim_follow_ups WHERE claim_id=ANY($3)'],
  ['claim_corrections', 'DELETE FROM claim_corrections WHERE claim_id=ANY($3)'],
  ['claim_outcomes', 'DELETE FROM claim_outcomes WHERE claim_id=ANY($3)'],
  ['claim_status_checks', 'DELETE FROM claim_status_checks WHERE claim_id=ANY($3)'],
  ['appeal_outcomes', 'DELETE FROM appeal_outcomes WHERE appeal_id IN (SELECT id FROM appeals WHERE practice_id=$1)'],
  ['payment_postings', 'DELETE FROM payment_postings WHERE claim_id=ANY($3)'],
  ['eligibility_checks', 'DELETE FROM eligibility_checks WHERE patient_id=ANY($2)'],
  ['eligibility_alerts', 'DELETE FROM eligibility_alerts WHERE patient_id=ANY($2)'],
  ['soap_note_goal_progress', 'DELETE FROM soap_note_goal_progress WHERE soap_note_id=ANY($5)'],
  ['soap_notes', 'DELETE FROM soap_notes WHERE session_id=ANY($4)'],
  ['goal_progress_notes', 'DELETE FROM goal_progress_notes WHERE goal_id=ANY($6)'],
  ['treatment_objectives', 'DELETE FROM treatment_objectives WHERE goal_id=ANY($6)'],
  ['treatment_interventions', 'DELETE FROM treatment_interventions WHERE goal_id=ANY($6)'],
  ['treatment_goals', 'DELETE FROM treatment_goals WHERE treatment_plan_id IN (SELECT id FROM treatment_plans WHERE practice_id=$1)'],
  ['payment_plan_installments', 'DELETE FROM payment_plan_installments WHERE payment_plan_id IN (SELECT id FROM payment_plans WHERE practice_id=$1)'],
  ['remittance_line_items', 'DELETE FROM remittance_line_items WHERE remittance_id=ANY($7)'],
  ['deposit_match_members', 'DELETE FROM deposit_match_members WHERE remittance_id=ANY($7)'],
  ['message_notifications', 'DELETE FROM message_notifications WHERE message_id=ANY($9)'],
  ['messages', 'DELETE FROM messages WHERE conversation_id=ANY($8)'],
  ['patient_consents', 'DELETE FROM patient_consents WHERE patient_id=ANY($2)'],
  ['patient_portal_access', 'DELETE FROM patient_portal_access WHERE patient_id=ANY($2)'],
  ['patient_insurance_authorizations', 'DELETE FROM patient_insurance_authorizations WHERE patient_id=ANY($2)'],
  ['patient_plan_documents', 'DELETE FROM patient_plan_documents WHERE patient_id=ANY($2)'],
  ['patient_plan_benefits', 'DELETE FROM patient_plan_benefits WHERE patient_id=ANY($2)'],
  ['patient_payment_methods', 'DELETE FROM patient_payment_methods WHERE patient_id=ANY($2)'],
  ['referral_communications', 'DELETE FROM referral_communications WHERE referral_id IN (SELECT id FROM referrals WHERE practice_id=$1)'],
];

// Tables deleted by practice_id alone, in FK-safe order (e.g. claims before
// treatment_sessions: claims.session_id references it; everything before
// patients, the root). No "insurances" row: that's the global payer
// catalog, not per-patient -- insurance fields live directly on patients.
const DIRECT = [
  'appeals', 'superbills', 'ai_learning_data', 'data_capture_events',
  'activity_progress_log', 'soap_note_drafts', 'initial_evaluations',
  'progress_notes', 'treatment_plans', 'payment_plans', 'payment_transactions',
  'patient_payments', 'payments', 'invoices', 'time_entries',
  'deposit_exceptions', 'deposit_matches', 'remittance_advice', 'expenses',
  'conversations', 'patient_documents', 'patient_statements',
  'patient_assessments', 'assessment_schedules', 'survey_responses',
  'survey_assignments', 'treatment_authorizations', 'patient_progress_notes',
  'referrals', 'appointment_requests', 'online_bookings', 'waitlist',
  'review_requests', 'patient_feedback', 'appointments', 'recovery_events',
  'claims', 'treatment_sessions', 'patients',
];

async function ids(c, sql, params) {
  const r = await c.query(sql, params);
  return r.rows.map((row) => row.id);
}

(async () => {
  const dryRun = process.env.DRY_RUN === '1';
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    const pr = await c.query('SELECT id, name FROM practices WHERE is_demo=true LIMIT 1');
    if (!pr.rowCount) throw new Error('No practice with is_demo=true found.');
    const id = pr.rows[0].id;
    console.log(`Demo practice: #${id} ${pr.rows[0].name}`);
    const before = await c.query('SELECT COUNT(*) FROM patients WHERE practice_id=$1', [id]);
    console.log(`Patients before: ${before.rows[0].count} (expected 6)`);

    const patientIds = await ids(c, 'SELECT id FROM patients WHERE practice_id=$1', [id]);
    const claimIds = await ids(c, 'SELECT id FROM claims WHERE practice_id=$1', [id]);
    const sessionIds = await ids(c, 'SELECT id FROM treatment_sessions WHERE practice_id=$1', [id]);
    const soapNoteIds = await ids(c, 'SELECT id FROM soap_notes WHERE session_id=ANY($1)', [sessionIds]);
    const goalIds = await ids(c, 'SELECT tg.id FROM treatment_goals tg JOIN treatment_plans tp ON tg.treatment_plan_id=tp.id WHERE tp.practice_id=$1', [id]);
    const remittanceIds = await ids(c, 'SELECT id FROM remittance_advice WHERE practice_id=$1', [id]);
    const conversationIds = await ids(c, 'SELECT id FROM conversations WHERE practice_id=$1', [id]);
    const messageIds = await ids(c, 'SELECT id FROM messages WHERE conversation_id=ANY($1)', [conversationIds]);
    const params = [id, patientIds, claimIds, sessionIds, soapNoteIds, goalIds, remittanceIds, conversationIds, messageIds];

    let n = 0;
    const run = async (label, sql, p) => {
      await c.query('SAVEPOINT sp');
      try {
        const r = await c.query(sql, p);
        await c.query('RELEASE SAVEPOINT sp');
        if (r.rowCount) { console.log(`  -${r.rowCount} ${label}`); n += r.rowCount; }
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT sp');
        console.log(`  err ${label}: ${e.message}`);
      }
    };
    for (const [label, sql] of JOINED) await run(label, sql, params);
    for (const t of DIRECT) await run(t, `DELETE FROM ${t} WHERE practice_id=$1`, params);

    console.log(`\nTotal deleted: ${n}. Next demo-login reseeds the canonical 6.`);
    if (dryRun) { await c.query('ROLLBACK'); console.log('\nDRY RUN — rolled back, nothing changed.'); }
    else { await c.query('COMMIT'); console.log('\nCommitted.'); }
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('Reconcile failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
