// Wipe demo-practice data so ensureDemoPractice() reseeds the canonical 6
// patients on next demo-login. Full background in run-reconcile-demo-practice.sh.
// DRY_RUN=1 rolls back instead of committing.
const { Client } = require('pg');

// Same FK-safe order as server/routes/admin.ts's reset-demo-data route,
// rescoped to the demo practice (is_demo=true) via $1=practiceId.
const D = [
  ['claim_line_items', 'DELETE FROM claim_line_items WHERE claim_id IN (SELECT id FROM claims WHERE practice_id=$1)'],
  ['claim_follow_ups', 'DELETE FROM claim_follow_ups WHERE claim_id IN (SELECT id FROM claims WHERE practice_id=$1)'],
  ['claim_corrections', 'DELETE FROM claim_corrections WHERE claim_id IN (SELECT id FROM claims WHERE practice_id=$1)'],
  ['claim_outcomes', 'DELETE FROM claim_outcomes WHERE claim_id IN (SELECT id FROM claims WHERE practice_id=$1)'],
  ['claim_status_checks', 'DELETE FROM claim_status_checks WHERE claim_id IN (SELECT id FROM claims WHERE practice_id=$1)'],
  ['appeal_outcomes', 'DELETE FROM appeal_outcomes WHERE appeal_id IN (SELECT id FROM appeals WHERE practice_id=$1)'],
  ['appeals', 'DELETE FROM appeals WHERE practice_id=$1'],
  ['payment_postings', 'DELETE FROM payment_postings WHERE claim_id IN (SELECT id FROM claims WHERE practice_id=$1)'],
  ['superbills', 'DELETE FROM superbills WHERE practice_id=$1'],
  ['eligibility_checks', 'DELETE FROM eligibility_checks WHERE patient_id IN (SELECT id FROM patients WHERE practice_id=$1)'],
  ['eligibility_alerts', 'DELETE FROM eligibility_alerts WHERE patient_id IN (SELECT id FROM patients WHERE practice_id=$1)'],
  ['soap_note_goal_progress', 'DELETE FROM soap_note_goal_progress WHERE soap_note_id IN (SELECT id FROM soap_notes WHERE practice_id=$1)'],
  ['soap_note_drafts', 'DELETE FROM soap_note_drafts WHERE practice_id=$1'],
  ['soap_notes', 'DELETE FROM soap_notes WHERE practice_id=$1'],
  ['treatment_sessions', 'DELETE FROM treatment_sessions WHERE practice_id=$1'],
  ['goal_progress_notes', 'DELETE FROM goal_progress_notes WHERE goal_id IN (SELECT id FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE practice_id=$1))'],
  ['treatment_objectives', 'DELETE FROM treatment_objectives WHERE goal_id IN (SELECT id FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE practice_id=$1))'],
  ['treatment_interventions', 'DELETE FROM treatment_interventions WHERE goal_id IN (SELECT id FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE practice_id=$1))'],
  ['treatment_goals', 'DELETE FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE practice_id=$1)'],
  ['treatment_plans', 'DELETE FROM treatment_plans WHERE practice_id=$1'],
  ['payment_plan_installments', 'DELETE FROM payment_plan_installments WHERE plan_id IN (SELECT id FROM payment_plans WHERE practice_id=$1)'],
  ['payment_plans', 'DELETE FROM payment_plans WHERE practice_id=$1'],
  ['payment_transactions', 'DELETE FROM payment_transactions WHERE practice_id=$1'],
  ['patient_payments', 'DELETE FROM patient_payments WHERE practice_id=$1'],
  ['payments', 'DELETE FROM payments WHERE practice_id=$1'],
  ['invoices', 'DELETE FROM invoices WHERE practice_id=$1'],
  ['time_entries', 'DELETE FROM time_entries WHERE practice_id=$1'],
  ['remittance_line_items', 'DELETE FROM remittance_line_items WHERE remittance_id IN (SELECT id FROM remittance_advice WHERE practice_id=$1)'],
  ['remittance_advice', 'DELETE FROM remittance_advice WHERE practice_id=$1'],
  ['expenses', 'DELETE FROM expenses WHERE practice_id=$1'],
  ['message_notifications', 'DELETE FROM message_notifications WHERE conversation_id IN (SELECT id FROM conversations WHERE practice_id=$1)'],
  ['messages', 'DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE practice_id=$1)'],
  ['conversations', 'DELETE FROM conversations WHERE practice_id=$1'],
  ['patient_documents', 'DELETE FROM patient_documents WHERE practice_id=$1'],
  ['patient_statements', 'DELETE FROM patient_statements WHERE practice_id=$1'],
  ['patient_consents', 'DELETE FROM patient_consents WHERE patient_id IN (SELECT id FROM patients WHERE practice_id=$1)'],
  ['patient_assessments', 'DELETE FROM patient_assessments WHERE practice_id=$1'],
  ['assessment_schedules', 'DELETE FROM assessment_schedules WHERE practice_id=$1'],
  ['survey_responses', 'DELETE FROM survey_responses WHERE practice_id=$1'],
  ['survey_assignments', 'DELETE FROM survey_assignments WHERE practice_id=$1'],
  ['patient_portal_access', 'DELETE FROM patient_portal_access WHERE patient_id IN (SELECT id FROM patients WHERE practice_id=$1)'],
  ['patient_insurance_authorizations', 'DELETE FROM patient_insurance_authorizations WHERE patient_id IN (SELECT id FROM patients WHERE practice_id=$1)'],
  ['treatment_authorizations', 'DELETE FROM treatment_authorizations WHERE practice_id=$1'],
  ['patient_plan_documents', 'DELETE FROM patient_plan_documents WHERE patient_id IN (SELECT id FROM patients WHERE practice_id=$1)'],
  ['patient_plan_benefits', 'DELETE FROM patient_plan_benefits WHERE patient_id IN (SELECT id FROM patients WHERE practice_id=$1)'],
  ['patient_payment_methods', 'DELETE FROM patient_payment_methods WHERE patient_id IN (SELECT id FROM patients WHERE practice_id=$1)'],
  ['patient_progress_notes', 'DELETE FROM patient_progress_notes WHERE practice_id=$1'],
  ['referral_communications', 'DELETE FROM referral_communications WHERE referral_id IN (SELECT id FROM referrals WHERE practice_id=$1)'],
  ['referrals', 'DELETE FROM referrals WHERE practice_id=$1'],
  ['appointment_requests', 'DELETE FROM appointment_requests WHERE practice_id=$1'],
  ['online_bookings', 'DELETE FROM online_bookings WHERE practice_id=$1'],
  ['waitlist', 'DELETE FROM waitlist WHERE practice_id=$1'],
  ['review_requests', 'DELETE FROM review_requests WHERE practice_id=$1'],
  ['patient_feedback', 'DELETE FROM patient_feedback WHERE practice_id=$1'],
  ['appointments', 'DELETE FROM appointments WHERE practice_id=$1'],
  ['claims', 'DELETE FROM claims WHERE practice_id=$1'],
  ['insurances', 'DELETE FROM insurances WHERE patient_id IN (SELECT id FROM patients WHERE practice_id=$1)'],
  ['patients', 'DELETE FROM patients WHERE practice_id=$1'],
];

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
    let n = 0;
    for (const [label, sql] of D) {
      try {
        const r = await c.query(sql, [id]);
        if (r.rowCount) { console.log(`  -${r.rowCount} ${label}`); n += r.rowCount; }
      } catch (e) { console.log(`  err ${label}: ${e.message}`); }
    }
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
