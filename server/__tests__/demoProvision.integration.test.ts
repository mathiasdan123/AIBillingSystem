/**
 * Demo practice provisioning against a REAL PostgreSQL.
 *
 * Why: the demo payment backfill shipped in #483 selected a column the
 * claims table does not have. Its unit tests mock the pg pool, so they
 * could not see Postgres refuse the query; production found out. This
 * suite provisions the demo practice through the same path "Try Free Demo"
 * uses (ensureDemoPractice: create, seed, then the seeded-practice repairs
 * and the payment backfill) against a database built from
 * shared/schema.ts, and asserts the rows exist.
 *
 * Self-skips unless DEMO_PROVISION_DATABASE_URL is set (CI provides a
 * postgres service container; locally: a scratch Postgres). The schema is
 * generated with drizzle-kit (no interactive prompt, unlike `push`) and
 * applied statement by statement; the database is expected to be empty.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Client } from 'pg';
import { getBusinessTimeZone, zonedAddDays, zonedDateString } from '../utils/timezone';

const DB_URL = process.env.DEMO_PROVISION_DATABASE_URL ?? '';
const run = DB_URL ? describe : describe.skip;

const REPO_ROOT = path.resolve(__dirname, '..', '..');

async function applySchema(url: string): Promise<void> {
  const out = mkdtempSync(path.join(tmpdir(), 'demo-provision-schema-'));
  execFileSync('npx', ['drizzle-kit', 'generate', '--dialect', 'postgresql', '--schema', 'shared/schema.ts', '--out', out], {
    cwd: REPO_ROOT,
    stdio: 'pipe',
    timeout: 180_000,
  });
  const sqlFile = readdirSync(out).find((f) => f.endsWith('.sql'));
  if (!sqlFile) throw new Error(`drizzle-kit generate produced no SQL in ${out}`);
  const statements = readFileSync(path.join(out, sqlFile), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const existing = await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'");
    if (existing.rows[0].n > 0) throw new Error('DEMO_PROVISION_DATABASE_URL must point at an empty database');
    for (const statement of statements) await client.query(statement);
    // A small payer catalog so the demo claims can be linked to payers, and
    // the CPT / ICD-10 rows the seeded service lines use.
    await client.query(
      `INSERT INTO insurances (name, payer_code) VALUES ('Aetna', '00400'), ('Cigna', '00500'), ('UnitedHealth', '00600'), ('Blue Cross Blue Shield', '00300')`,
    );
    await client.query(
      `INSERT INTO cpt_codes (code, description, category, base_rate, billing_units)
       VALUES ('97530', 'Therapeutic activities', 'treatment', '289.00', 1), ('97110', 'Therapeutic exercises', 'treatment', '289.00', 1), ('97140', 'Manual therapy', 'treatment', '289.00', 1)`,
    );
    await client.query(`INSERT INTO icd10_codes (code, description, category) VALUES ('F82', 'Specific developmental disorder of motor function', 'developmental')`);
  } finally {
    await client.end();
  }
}

run('demo practice provisioning (real Postgres)', () => {
  let client: Client;
  let demo: typeof import('../services/demoPractice');
  let dbModule: typeof import('../db');
  let practiceId = 0;

  const count = async (sql: string, params: any[] = []) => Number((await client.query(sql, params)).rows[0].n);

  beforeAll(async () => {
    await applySchema(DB_URL);
    // The server's db module reads DATABASE_URL at import time, so the
    // environment is set before the dynamic imports below.
    process.env.DATABASE_URL = DB_URL;
    // A throwaway key unless a valid one is given (CI once passed an unquoted
    // all-digit value, which YAML turned into the integer 0).
    if (!/^[0-9a-fA-F]{64}$/.test(process.env.PHI_ENCRYPTION_KEY ?? '')) {
      process.env.PHI_ENCRYPTION_KEY = 'a'.repeat(64);
    }
    process.env.SESSION_SECRET ||= 'demo-provision-integration-session-secret';
    process.env.TIMEZONE ||= 'America/New_York';
    dbModule = await import('../db');
    await dbModule.dbReady;
    demo = await import('../services/demoPractice');
    client = new Client({ connectionString: DB_URL });
    await client.connect();
  }, 240_000);

  afterAll(async () => {
    await client?.end();
    const pool = await dbModule?.getPool();
    await pool?.end();
  });

  it('first "Try Free Demo" login creates, seeds and backfills the demo practice', async () => {
    const practice = await demo.ensureDemoPractice();
    practiceId = practice.id;
    expect(practice.isDemo).toBe(true);

    expect(await count('SELECT count(*)::int AS n FROM patients WHERE practice_id = $1', [practiceId])).toBe(7); // 6 seeded + Riley Nodob
    expect(await count('SELECT count(*)::int AS n FROM claims WHERE practice_id = $1', [practiceId])).toBe(9);
    expect(await count("SELECT count(*)::int AS n FROM claims WHERE practice_id = $1 AND status = 'paid'", [practiceId])).toBe(3);

    // The payment backfill: one processed ERA, one matched line and one ERA
    // posting per paid claim; a copay where the write-off covers one.
    expect(await count("SELECT count(*)::int AS n FROM remittance_advice WHERE practice_id = $1 AND status = 'processed'", [practiceId])).toBe(3);
    expect(await count("SELECT count(*)::int AS n FROM remittance_line_items l JOIN remittance_advice r ON r.id = l.remittance_id WHERE r.practice_id = $1 AND l.status = 'matched' AND l.claim_id IS NOT NULL AND l.auto_posted_at IS NOT NULL", [practiceId])).toBe(3);
    expect(await count("SELECT count(*)::int AS n FROM payment_postings WHERE practice_id = $1 AND source = 'era' AND reversed = false", [practiceId])).toBe(3);
    expect(await count("SELECT count(*)::int AS n FROM payment_transactions WHERE practice_id = $1 AND type = 'payment' AND category = 'copay' AND status = 'completed'", [practiceId])).toBe(2);

    // Each posting equals its claim's paid amount; each remittance equals its posting.
    expect(await count(`SELECT count(*)::int AS n FROM payment_postings p JOIN claims c ON c.id = p.claim_id WHERE p.practice_id = $1 AND p.payment_amount <> c.paid_amount`, [practiceId])).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM remittance_advice r JOIN remittance_line_items l ON l.remittance_id = r.id WHERE r.practice_id = $1 AND r.total_payment_amount <> l.paid_amount`, [practiceId])).toBe(0);

    // Dates: every submitted claim was created before it was submitted, and
    // the ERA is dated on the claim's paid day.
    expect(await count('SELECT count(*)::int AS n FROM claims WHERE practice_id = $1 AND submitted_at IS NOT NULL AND created_at >= submitted_at', [practiceId])).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM payment_postings p JOIN claims c ON c.id = p.claim_id WHERE p.practice_id = $1 AND p.payment_date <> (c.paid_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date`, [practiceId])).toBe(0);

    // Payer link: every DEMO claim points at a catalog row.
    expect(await count("SELECT count(*)::int AS n FROM claims WHERE practice_id = $1 AND claim_number LIKE 'DEMO-%' AND insurance_id IS NULL", [practiceId])).toBe(0);

    // Service lines: every DEMO claim has exactly one line that reconciles with its total,
    // dated on the claim's service day, and the demo ERA line names that same code.
    expect(await count(`SELECT count(*)::int AS n FROM claims c WHERE c.practice_id = $1 AND c.claim_number LIKE 'DEMO-%' AND (SELECT count(*) FROM claim_line_items l WHERE l.claim_id = c.id) <> 1`, [practiceId])).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM claims c JOIN claim_line_items l ON l.claim_id = c.id WHERE c.practice_id = $1 AND c.claim_number LIKE 'DEMO-%' AND (l.amount <> c.total_amount OR l.units <> 1 OR l.modifier <> 'GO' OR l.icd10_code_id IS NULL)`, [practiceId])).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM claims c JOIN claim_line_items l ON l.claim_id = c.id WHERE c.practice_id = $1 AND c.claim_number LIKE 'DEMO-%' AND l.date_of_service <> (c.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date`, [practiceId])).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM remittance_line_items rl JOIN claim_line_items cl ON cl.claim_id = rl.claim_id JOIN cpt_codes cc ON cc.id = cl.cpt_code_id JOIN remittance_advice r ON r.id = rl.remittance_id WHERE r.practice_id = $1 AND rl.cpt_code <> cc.code`, [practiceId])).toBe(0);
    expect((await client.query(`SELECT cc.code, c.total_amount::text AS total FROM claims c JOIN claim_line_items l ON l.claim_id = c.id JOIN cpt_codes cc ON cc.id = l.cpt_code_id WHERE c.practice_id = $1 AND c.claim_number LIKE 'DEMO-%' ORDER BY c.id`, [practiceId])).rows.map((r: any) => `${r.total}=${r.code}`)).toEqual([
      '289.00=97530', '216.00=97110', '289.00=97530', '216.00=97110', '289.00=97530', '150.00=97140', '216.00=97110', '289.00=97530', '216.00=97110',
    ]);
  }, 120_000);

  it('the demo practice carries a fake billing identity and a seeded draft passes the pre-submission scrub', async () => {
    const { storage } = await import('../storage');
    const practice: any = await storage.getPractice(practiceId);
    expect(practice.npi).toBe('0000000001');
    expect(practice.taxId).toBe('00-0000000');
    expect(practice.address).toBe('123 Demo Way, Springfield, NJ 07000');
    expect(practice.billingContactPhone).toBeTruthy();
    // Stored encrypted, not as plain text.
    const raw = (await client.query('SELECT tax_id FROM practices WHERE id = $1', [practiceId])).rows[0].tax_id;
    expect(raw).not.toBe('00-0000000');
    expect(JSON.parse(raw)).toHaveProperty('ciphertext');

    const { scrubClaim } = await import('../services/claimScrubber');
    const draft = (await client.query(`SELECT id FROM claims WHERE practice_id = $1 AND status = 'draft' AND claim_number LIKE 'DEMO-%' ORDER BY id LIMIT 1`, [practiceId])).rows[0];
    expect(draft).toBeTruthy();
    const scrub = await scrubClaim(draft.id, practiceId);
    expect(scrub.errors).toEqual([]);
    expect(scrub.warnings).not.toContain('Practice address is not set');
    expect(scrub.passed).toBe(true);
  }, 60_000);

  it('a demo practice created before the identity existed (production on 2026-11-19) is repaired by the next login, keeping a prospect\'s own edits', async () => {
    await client.query(`UPDATE practices SET tax_id = NULL, address = '', billing_contact_phone = NULL, address_city = 'Prospect Town' WHERE id = $1`, [practiceId]);
    await demo.ensureDemoPractice();
    const { storage } = await import('../storage');
    const practice: any = await storage.getPractice(practiceId);
    expect(practice.taxId).toBe('00-0000000');
    expect(practice.address).toBe('123 Demo Way, Springfield, NJ 07000');
    expect(practice.billingContactPhone).toBe('(555) 010-0000');
    expect(practice.addressCity).toBe('Prospect Town'); // not overwritten
    await client.query(`UPDATE practices SET address_city = 'Springfield' WHERE id = $1`, [practiceId]);
  }, 60_000);

  it('a second login is a no-op: nothing is duplicated', async () => {
    const before = await count('SELECT (SELECT count(*) FROM remittance_advice) + (SELECT count(*) FROM remittance_line_items) + (SELECT count(*) FROM payment_postings) + (SELECT count(*) FROM payment_transactions) + (SELECT count(*) FROM claims) + (SELECT count(*) FROM patients) AS n');
    const again = await demo.ensureDemoPractice();
    expect(again.id).toBe(practiceId);
    const after = await count('SELECT (SELECT count(*) FROM remittance_advice) + (SELECT count(*) FROM remittance_line_items) + (SELECT count(*) FROM payment_postings) + (SELECT count(*) FROM payment_transactions) + (SELECT count(*) FROM claims) + (SELECT count(*) FROM patients) AS n');
    expect(after).toBe(before);
  }, 60_000);

  it('repairs a practice seeded before the backfill existed (the production state on 2026-11-19)', async () => {
    // Strip the payment rows and un-link the payers, and make every claim
    // look created at seed time, after its own submission.
    await client.query('DELETE FROM payment_transactions WHERE practice_id = $1', [practiceId]);
    await client.query('DELETE FROM payment_postings WHERE practice_id = $1', [practiceId]);
    await client.query('DELETE FROM remittance_line_items WHERE remittance_id IN (SELECT id FROM remittance_advice WHERE practice_id = $1)', [practiceId]);
    await client.query('DELETE FROM remittance_advice WHERE practice_id = $1', [practiceId]);
    await client.query('UPDATE claims SET insurance_id = NULL, created_at = now() WHERE practice_id = $1', [practiceId]);
    await client.query("DELETE FROM claim_line_items WHERE claim_id IN (SELECT id FROM claims WHERE practice_id = $1 AND claim_number LIKE 'DEMO-%')", [practiceId]);

    await demo.ensureDemoPractice();
    expect(await count(`SELECT count(*)::int AS n FROM claim_line_items l JOIN claims c ON c.id = l.claim_id WHERE c.practice_id = $1 AND c.claim_number LIKE 'DEMO-%'`, [practiceId])).toBe(9);

    expect(await count('SELECT count(*)::int AS n FROM remittance_advice WHERE practice_id = $1', [practiceId])).toBe(3);
    expect(await count('SELECT count(*)::int AS n FROM payment_postings WHERE practice_id = $1', [practiceId])).toBe(3);
    expect(await count('SELECT count(*)::int AS n FROM payment_transactions WHERE practice_id = $1', [practiceId])).toBe(2);
    expect(await count('SELECT count(*)::int AS n FROM claims WHERE practice_id = $1 AND submitted_at IS NOT NULL AND created_at >= submitted_at', [practiceId])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM claims WHERE practice_id = $1 AND claim_number LIKE 'DEMO-%' AND insurance_id IS NULL", [practiceId])).toBe(0);
  }, 60_000);

  // ---- date roll-forward (#491) ----

  const AGE_DAYS = 30;
  /** Age every seeded row by AGE_DAYS, the way a demo seeded weeks ago looks; hand-made rows are not touched. */
  async function ageSeededRows() {
    const d = [practiceId, AGE_DAYS];
    await client.query(`UPDATE claims SET created_at = created_at - make_interval(days => $2::int), submitted_at = submitted_at - make_interval(days => $2::int), paid_at = paid_at - make_interval(days => $2::int) WHERE practice_id = $1 AND claim_number LIKE 'DEMO-%'`, d);
    await client.query(`UPDATE remittance_advice SET received_date = received_date - $2::int, check_date = check_date - $2::int, processed_at = processed_at - make_interval(days => $2::int), created_at = created_at - make_interval(days => $2::int) WHERE practice_id = $1`, d);
    await client.query(`UPDATE remittance_line_items SET service_date = service_date - $2::int, matched_at = matched_at - make_interval(days => $2::int), auto_posted_at = auto_posted_at - make_interval(days => $2::int) WHERE remittance_id IN (SELECT id FROM remittance_advice WHERE practice_id = $1)`, d);
    await client.query(`UPDATE payment_postings SET payment_date = payment_date - $2::int, posted_at = posted_at - make_interval(days => $2::int), created_at = created_at - make_interval(days => $2::int) WHERE practice_id = $1`, d);
    await client.query(`UPDATE payment_transactions SET processed_at = processed_at - make_interval(days => $2::int), created_at = created_at - make_interval(days => $2::int) WHERE practice_id = $1`, d);
    // Age appointments the way the clock does, wall-clock preserved in the practice zone (the raw interval would shift the local time across DST).
    await client.query(`UPDATE appointments SET start_time = ${demo.shiftTimestampByLocalDaysSql('start_time', '$2', '$4')}, end_time = ${demo.shiftTimestampByLocalDaysSql('end_time', '$2', '$4')} WHERE practice_id = $1 AND notes = $3`, [practiceId, -AGE_DAYS, demo.DEMO_SEED_APPOINTMENT_MARKER, getBusinessTimeZone()]);
  }
  const newestPaidDay = async () => (await client.query(`SELECT to_char(max(paid_at) AT TIME ZONE 'UTC' AT TIME ZONE $2, 'YYYY-MM-DD') AS d FROM claims WHERE practice_id = $1 AND claim_number LIKE 'DEMO-%' AND status = 'paid'`, [practiceId, getBusinessTimeZone()])).rows[0].d as string;
  const intendedNewestDay = () => zonedDateString(zonedAddDays(new Date(), demo.DEMO_NEWEST_PAID_OFFSET_DAYS, getBusinessTimeZone()), getBusinessTimeZone());

  it('a demo seeded weeks ago is rolled forward by the next login, and three concurrent logins apply the shift exactly once', async () => {
    // A hand-booked appointment that looks like a seeded one but carries its own notes, and a hand-made claim: neither may move.
    const [{ id: patientId }] = (await client.query('SELECT id FROM patients WHERE practice_id = $1 ORDER BY id LIMIT 1', [practiceId])).rows;
    const [{ id: therapistId }] = (await client.query("SELECT id FROM users WHERE practice_id = $1 AND role = 'therapist' LIMIT 1", [practiceId])).rows;
    const handStart = '2026-10-20 14:00:00';
    await client.query(`INSERT INTO appointments (practice_id, patient_id, therapist_id, title, notes, start_time, end_time, duration_minutes, status) VALUES ($1, $2, $3, 'Occupational Therapy', 'Parent requested this slot', $4, $4::timestamp + interval '45 minutes', 45, 'scheduled')`, [practiceId, patientId, therapistId, handStart]);
    await client.query(`INSERT INTO claims (practice_id, patient_id, claim_number, total_amount, status, created_at) VALUES ($1, $2, 'CLM-HANDMADE', '200.00', 'draft', '2026-10-10 12:00:00')`, [practiceId, patientId]);

    expect(await newestPaidDay()).toBe(intendedNewestDay());
    const before = (await client.query(`SELECT min(r.received_date)::text AS era, min(p.payment_date)::text AS posting, min(t.processed_at)::text AS copay, min(a.start_time)::text AS appt FROM remittance_advice r, payment_postings p, payment_transactions t, appointments a WHERE r.practice_id = $1 AND p.practice_id = $1 AND t.practice_id = $1 AND a.practice_id = $1 AND a.notes = $2`, [practiceId, demo.DEMO_SEED_APPOINTMENT_MARKER])).rows[0];

    await ageSeededRows();
    expect(await newestPaidDay()).toBe(zonedDateString(zonedAddDays(new Date(), demo.DEMO_NEWEST_PAID_OFFSET_DAYS - AGE_DAYS, getBusinessTimeZone()), getBusinessTimeZone()));

    await Promise.all([demo.ensureDemoPractice(), demo.ensureDemoPractice(), demo.ensureDemoPractice()]);

    // Back to its intended age: shifted once by AGE_DAYS, not three times.
    expect(await newestPaidDay()).toBe(intendedNewestDay());
    const after = (await client.query(`SELECT min(r.received_date)::text AS era, min(p.payment_date)::text AS posting, min(t.processed_at)::text AS copay, min(a.start_time)::text AS appt FROM remittance_advice r, payment_postings p, payment_transactions t, appointments a WHERE r.practice_id = $1 AND p.practice_id = $1 AND t.practice_id = $1 AND a.practice_id = $1 AND a.notes = $2`, [practiceId, demo.DEMO_SEED_APPOINTMENT_MARKER])).rows[0];
    expect(after).toEqual(before);
    // The copay description names the shifted service date.
    expect(await count(`SELECT count(*)::int AS n FROM payment_transactions t JOIN remittance_line_items l ON l.claim_id = t.claim_id WHERE t.practice_id = $1 AND t.description NOT LIKE '%' || l.service_date::text || '%'`, [practiceId])).toBe(0);
    // Hand-made rows did not move; the hand-booked appointment is still on its day.
    expect((await client.query("SELECT created_at::text AS c FROM claims WHERE claim_number = 'CLM-HANDMADE'")).rows[0].c).toBe('2026-10-10 12:00:00');
    expect((await client.query("SELECT start_time::text AS s FROM appointments WHERE notes = 'Parent requested this slot'")).rows[0].s).toBe(handStart);
    // A further login changes nothing.
    await demo.ensureDemoPractice();
    expect(await newestPaidDay()).toBe(intendedNewestDay());
  }, 120_000);

  it('the appointment shift keeps the wall-clock time across the DST change (October EDT to November EST, and March EST to EDT)', async () => {
    const sql = `SELECT (${demo.shiftTimestampByLocalDaysSql("$1::timestamp", '$2', '$3')})::text AS shifted`;
    expect((await client.query(sql, ['2026-10-20 14:00:00', 30, 'America/New_York'])).rows[0].shifted).toBe('2026-11-19 15:00:00'); // 10:00 EDT -> 10:00 EST
    expect((await client.query(sql, ['2026-03-01 15:00:00', 10, 'America/New_York'])).rows[0].shifted).toBe('2026-03-11 14:00:00'); // 10:00 EST -> 10:00 EDT
    expect((await client.query(sql, ['2026-11-05 15:00:00', 7, 'America/New_York'])).rows[0].shifted).toBe('2026-11-12 15:00:00'); // no change
  }, 30_000);

  it('a failure in the appointment step rolls the whole shift back, and the next login repairs it in full', async () => {
    await ageSeededRows();
    const agedDay = await newestPaidDay();
    await client.query(`CREATE OR REPLACE FUNCTION demo_block_appt() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'appointment update blocked'; END $$ LANGUAGE plpgsql`);
    await client.query(`CREATE TRIGGER demo_block_appt BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION demo_block_appt()`);
    try {
      await demo.ensureDemoPractice();
      // Financial rows must not have moved while the appointment step failed.
      expect(await newestPaidDay()).toBe(agedDay);
      expect(await count(`SELECT count(*)::int AS n FROM remittance_advice WHERE practice_id = $1 AND received_date > current_date - $2::int`, [practiceId, AGE_DAYS])).toBe(0);
    } finally {
      await client.query('DROP TRIGGER IF EXISTS demo_block_appt ON appointments');
      await client.query('DROP FUNCTION IF EXISTS demo_block_appt()');
    }
    await demo.ensureDemoPractice();
    expect(await newestPaidDay()).toBe(intendedNewestDay());
  }, 120_000);

  // ---- one posting identity per remittance line (#497 review) ----

  it('two simultaneous postings for the same remittance line record exactly one payment (manual/manual, manual/auto)', async () => {
    const { postRemittanceLinePayment, findLinePosting } = await import('../services/paymentPostingService');
    const claim = (await client.query(`SELECT id FROM claims WHERE practice_id = $1 AND status = 'submitted' ORDER BY id LIMIT 1`, [practiceId])).rows[0];
    expect(claim).toBeTruthy();
    const era = await client.query(
      `INSERT INTO remittance_advice (practice_id, received_date, payer_name, check_number, check_date, total_payment_amount, status, file_hash)
       VALUES ($1, current_date, 'Aetna QA Synthetic', 'QA-RACE-1', current_date, '0.00', 'pending', 'qa-race-1') RETURNING id`,
      [practiceId],
    );
    const remittanceId = era.rows[0].id;
    const line = await client.query(
      `INSERT INTO remittance_line_items (remittance_id, claim_id, patient_name, cpt_code, charged_amount, paid_amount, adjustment_amount, patient_responsibility, status, match_type, claim_status_code, adjustment_reason_codes)
       VALUES ($1, $2, 'QA Patient', '97140', '100.00', '0.00', '100.00', '0.00', 'matched', 'manual', '4', '[{"code":"CO-197","description":"x"}]'::jsonb) RETURNING id`,
      [remittanceId, claim.id],
    );
    const lineId = line.rows[0].id;
    const posting = (postedBy: string | null) => ({
      remittanceLineItemId: lineId, source: 'era', claimId: claim.id, payerName: 'Aetna QA Synthetic', checkNumber: 'QA-RACE-1',
      paymentDate: new Date().toISOString().slice(0, 10), paymentAmount: '0.00', adjustmentAmount: '100.00', patientResponsibility: '0.00',
      adjustmentReason: 'CO-197: x', postedBy,
    });

    // The manual route and the auto path (or two clicks) racing on one line.
    const outcomes = await Promise.all([
      postRemittanceLinePayment(practiceId, posting(null) as any),
      postRemittanceLinePayment(practiceId, posting(null) as any),
      postRemittanceLinePayment(practiceId, posting(null) as any),
    ]);
    expect(outcomes.filter((o) => !o.alreadyPosted)).toHaveLength(1);
    expect(outcomes.filter((o) => o.alreadyPosted)).toHaveLength(2);
    expect(await count('SELECT count(*)::int AS n FROM payment_postings WHERE remittance_line_item_id = $1 AND reversed = false', [lineId])).toBe(1);
    const receipt = await findLinePosting(lineId);
    expect(receipt?.remittanceLineItemId).toBe(lineId);

    // A crash between the committed posting and the line marker: the marker
    // is missing, the posting is the truth, and a retry posts nothing new.
    expect((await client.query('SELECT posted_at FROM remittance_line_items WHERE id = $1', [lineId])).rows[0].posted_at).toBeNull();
    const retry = await postRemittanceLinePayment(practiceId, posting('biller-1') as any);
    expect(retry.alreadyPosted).toBe(true);
    expect(await count('SELECT count(*)::int AS n FROM payment_postings WHERE remittance_line_item_id = $1', [lineId])).toBe(1);

    // A reversed posting frees the identity, so a re-post after a reversal is allowed.
    await client.query('UPDATE payment_postings SET reversed = true, reversed_at = now(), reversal_reason = $2 WHERE remittance_line_item_id = $1', [lineId, 'test']);
    const afterReversal = await postRemittanceLinePayment(practiceId, posting(null) as any);
    expect(afterReversal.alreadyPosted).toBe(false);
    expect(await count('SELECT count(*)::int AS n FROM payment_postings WHERE remittance_line_item_id = $1 AND reversed = false', [lineId])).toBe(1);
  }, 60_000);

  it('the demo backfill links each ERA posting to its remittance line', async () => {
    expect(await count(`SELECT count(*)::int AS n FROM payment_postings p JOIN remittance_line_items l ON l.id = p.remittance_line_item_id JOIN remittance_advice r ON r.id = l.remittance_id WHERE p.practice_id = $1 AND r.check_number LIKE 'DEMO-CHK%'`, [practiceId])).toBeGreaterThanOrEqual(3);
  });
});
