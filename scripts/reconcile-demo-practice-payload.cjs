/**
 * Wipe the isolated demo practice's clinical/billing data and let
 * ensureDemoPractice() reseed it on the next demo-login.
 *
 * Triggered by the "therapybill-demo-path-broken" CloudWatch alarm (synthetic
 * canary: health -> demo-login -> patients==6) going into ALARM.
 *
 * ROOT CAUSE
 *
 * server/services/demoPractice.ts seeds exactly 6 patients (DEMO_PATIENTS)
 * into the isolated demo practice the FIRST time ensureDemoPractice() is
 * called, then only reseeds when the practice has ZERO patients:
 *
 *   const existingPatients = await storage.getPatients(practice.id);
 *   if (existingPatients.length === 0) { await seedDemoData(practice.id); }
 *
 * "We give live demos to prospects" (module header) -- anyone clicking
 * through a live demo can add, delete, or otherwise mutate patients,
 * appointments, claims, SOAP notes, invoices, etc. in that shared sandbox.
 * Once the count drifts away from 6 (almost certainly upward -- adding a
 * patient mid-pitch is the obvious demo move), it stays drifted forever:
 * the "seed if empty" guard never fires again, so nothing self-heals, and
 * the canary alarms on every subsequent run until someone intervenes.
 *
 * This script is that intervention for right now. It does NOT reseed --
 * seeding patients/appointments/claims with realistic encrypted PHI-shaped
 * data is Drizzle/TypeScript logic (seedDemoData) that doesn't port cleanly
 * to a raw-SQL ECS payload. Instead it deletes everything under the demo
 * practice (patients and every FK-dependent row, same deletion order
 * server/routes/admin.ts's reset-demo-data route already uses, rescoped
 * here to the is_demo=true practice specifically rather than a caller's own
 * practiceId) and stops. ensureDemoPractice()'s existing "seed if empty"
 * path reseeds the canonical 6 patients automatically on the very next
 * demo-login -- including the next canary run.
 *
 * DOES NOT FIX THE RECURRENCE: the same drift will happen again the next
 * time someone adds/removes a patient during a live demo. Whether
 * ensureDemoPractice() should reconcile to canonical on every login (safe
 * at login time, but risks disrupting a second, concurrent demo session
 * sharing the same singleton demo practice) is a product call, flagged
 * separately -- not decided here.
 *
 * Fed to the prod app container verbatim as `node -e <this file>` by
 * scripts/run-reconcile-demo-practice.sh (same mechanism as the Anthem
 * crosswalk, billing-percentage, and MFA re-enrollment scripts).
 *
 * Runs in one transaction. DRY_RUN=1 in the environment rolls it back.
 */
const { Client } = require('pg');

(async () => {
  const dryRun = process.env.DRY_RUN === '1';
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');

    const practiceRes = await client.query(
      `SELECT id, name FROM practices WHERE is_demo = true LIMIT 1`
    );
    if (practiceRes.rowCount === 0) {
      throw new Error('No practice with is_demo=true found -- nothing to reconcile.');
    }
    const practiceId = practiceRes.rows[0].id;
    console.log(`Demo practice: #${practiceId} ${practiceRes.rows[0].name}`);

    const before = await client.query(
      `SELECT id, first_name, last_name FROM patients WHERE practice_id = $1 ORDER BY id`,
      [practiceId],
    );
    console.log(`Patients before: ${before.rowCount} (expected 6)`);

    let deleted = 0;
    const run = async (label, text, params) => {
      try {
        const result = await client.query(text, params);
        const count = result.rowCount ?? 0;
        if (count > 0) {
          console.log(`  deleted ${count} from ${label}`);
          deleted += count;
        }
      } catch (err) {
        console.log(`  error on ${label}: ${err.message}`);
      }
    };

    // Same FK-safe order as server/routes/admin.ts POST /admin/reset-demo-data,
    // rescoped to the demo practice by id instead of a caller's own practiceId.
    await run('claim_line_items', `DELETE FROM claim_line_items WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = $1)`, [practiceId]);
    await run('claim_follow_ups', `DELETE FROM claim_follow_ups WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = $1)`, [practiceId]);
    await run('claim_corrections', `DELETE FROM claim_corrections WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = $1)`, [practiceId]);
    await run('claim_outcomes', `DELETE FROM claim_outcomes WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = $1)`, [practiceId]);
    await run('claim_status_checks', `DELETE FROM claim_status_checks WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = $1)`, [practiceId]);
    await run('appeal_outcomes', `DELETE FROM appeal_outcomes WHERE appeal_id IN (SELECT id FROM appeals WHERE practice_id = $1)`, [practiceId]);
    await run('appeals', `DELETE FROM appeals WHERE practice_id = $1`, [practiceId]);
    await run('payment_postings', `DELETE FROM payment_postings WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = $1)`, [practiceId]);
    await run('superbills', `DELETE FROM superbills WHERE practice_id = $1`, [practiceId]);
    await run('eligibility_checks', `DELETE FROM eligibility_checks WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = $1)`, [practiceId]);
    await run('eligibility_alerts', `DELETE FROM eligibility_alerts WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = $1)`, [practiceId]);
    await run('soap_note_goal_progress', `DELETE FROM soap_note_goal_progress WHERE soap_note_id IN (SELECT id FROM soap_notes WHERE practice_id = $1)`, [practiceId]);
    await run('soap_note_drafts', `DELETE FROM soap_note_drafts WHERE practice_id = $1`, [practiceId]);
    await run('soap_notes', `DELETE FROM soap_notes WHERE practice_id = $1`, [practiceId]);
    await run('treatment_sessions', `DELETE FROM treatment_sessions WHERE practice_id = $1`, [practiceId]);
    await run('goal_progress_notes', `DELETE FROM goal_progress_notes WHERE goal_id IN (SELECT id FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE practice_id = $1))`, [practiceId]);
    await run('treatment_objectives', `DELETE FROM treatment_objectives WHERE goal_id IN (SELECT id FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE practice_id = $1))`, [practiceId]);
    await run('treatment_interventions', `DELETE FROM treatment_interventions WHERE goal_id IN (SELECT id FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE practice_id = $1))`, [practiceId]);
    await run('treatment_goals', `DELETE FROM treatment_goals WHERE plan_id IN (SELECT id FROM treatment_plans WHERE practice_id = $1)`, [practiceId]);
    await run('treatment_plans', `DELETE FROM treatment_plans WHERE practice_id = $1`, [practiceId]);
    await run('payment_plan_installments', `DELETE FROM payment_plan_installments WHERE plan_id IN (SELECT id FROM payment_plans WHERE practice_id = $1)`, [practiceId]);
    await run('payment_plans', `DELETE FROM payment_plans WHERE practice_id = $1`, [practiceId]);
    await run('payment_transactions', `DELETE FROM payment_transactions WHERE practice_id = $1`, [practiceId]);
    await run('patient_payments', `DELETE FROM patient_payments WHERE practice_id = $1`, [practiceId]);
    await run('payments', `DELETE FROM payments WHERE practice_id = $1`, [practiceId]);
    await run('invoices', `DELETE FROM invoices WHERE practice_id = $1`, [practiceId]);
    await run('time_entries', `DELETE FROM time_entries WHERE practice_id = $1`, [practiceId]);
    await run('remittance_line_items', `DELETE FROM remittance_line_items WHERE remittance_id IN (SELECT id FROM remittance_advice WHERE practice_id = $1)`, [practiceId]);
    await run('remittance_advice', `DELETE FROM remittance_advice WHERE practice_id = $1`, [practiceId]);
    await run('expenses', `DELETE FROM expenses WHERE practice_id = $1`, [practiceId]);
    await run('message_notifications', `DELETE FROM message_notifications WHERE conversation_id IN (SELECT id FROM conversations WHERE practice_id = $1)`, [practiceId]);
    await run('messages', `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE practice_id = $1)`, [practiceId]);
    await run('conversations', `DELETE FROM conversations WHERE practice_id = $1`, [practiceId]);
    await run('patient_documents', `DELETE FROM patient_documents WHERE practice_id = $1`, [practiceId]);
    await run('patient_statements', `DELETE FROM patient_statements WHERE practice_id = $1`, [practiceId]);
    await run('patient_consents', `DELETE FROM patient_consents WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = $1)`, [practiceId]);
    await run('patient_assessments', `DELETE FROM patient_assessments WHERE practice_id = $1`, [practiceId]);
    await run('assessment_schedules', `DELETE FROM assessment_schedules WHERE practice_id = $1`, [practiceId]);
    await run('survey_responses', `DELETE FROM survey_responses WHERE practice_id = $1`, [practiceId]);
    await run('survey_assignments', `DELETE FROM survey_assignments WHERE practice_id = $1`, [practiceId]);
    await run('patient_portal_access', `DELETE FROM patient_portal_access WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = $1)`, [practiceId]);
    await run('patient_insurance_authorizations', `DELETE FROM patient_insurance_authorizations WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = $1)`, [practiceId]);
    await run('treatment_authorizations', `DELETE FROM treatment_authorizations WHERE practice_id = $1`, [practiceId]);
    await run('patient_plan_documents', `DELETE FROM patient_plan_documents WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = $1)`, [practiceId]);
    await run('patient_plan_benefits', `DELETE FROM patient_plan_benefits WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = $1)`, [practiceId]);
    await run('patient_payment_methods', `DELETE FROM patient_payment_methods WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = $1)`, [practiceId]);
    await run('patient_progress_notes', `DELETE FROM patient_progress_notes WHERE practice_id = $1`, [practiceId]);
    await run('referral_communications', `DELETE FROM referral_communications WHERE referral_id IN (SELECT id FROM referrals WHERE practice_id = $1)`, [practiceId]);
    await run('referrals', `DELETE FROM referrals WHERE practice_id = $1`, [practiceId]);
    await run('appointment_requests', `DELETE FROM appointment_requests WHERE practice_id = $1`, [practiceId]);
    await run('online_bookings', `DELETE FROM online_bookings WHERE practice_id = $1`, [practiceId]);
    await run('waitlist', `DELETE FROM waitlist WHERE practice_id = $1`, [practiceId]);
    await run('review_requests', `DELETE FROM review_requests WHERE practice_id = $1`, [practiceId]);
    await run('patient_feedback', `DELETE FROM patient_feedback WHERE practice_id = $1`, [practiceId]);
    await run('appointments', `DELETE FROM appointments WHERE practice_id = $1`, [practiceId]);
    await run('claims', `DELETE FROM claims WHERE practice_id = $1`, [practiceId]);
    await run('insurances', `DELETE FROM insurances WHERE patient_id IN (SELECT id FROM patients WHERE practice_id = $1)`, [practiceId]);
    await run('patients', `DELETE FROM patients WHERE practice_id = $1`, [practiceId]);

    console.log(`\nTotal rows deleted: ${deleted}`);
    console.log('Patients now 0 -- ensureDemoPractice() will reseed the canonical 6 on the next demo-login.');

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('\nDRY RUN — transaction rolled back, nothing changed.');
    } else {
      await client.query('COMMIT');
      console.log('\nCommitted.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Reconcile failed, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
