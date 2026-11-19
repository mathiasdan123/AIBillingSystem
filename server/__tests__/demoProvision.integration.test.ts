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
    // A small payer catalog so the demo claims can be linked to payers.
    await client.query(
      `INSERT INTO insurances (name, payer_code) VALUES ('Aetna', '00400'), ('Cigna', '00500'), ('UnitedHealth', '00600'), ('Blue Cross Blue Shield', '00300')`,
    );
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
    process.env.PHI_ENCRYPTION_KEY ||= 'a'.repeat(64);
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
  }, 120_000);

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

    await demo.ensureDemoPractice();

    expect(await count('SELECT count(*)::int AS n FROM remittance_advice WHERE practice_id = $1', [practiceId])).toBe(3);
    expect(await count('SELECT count(*)::int AS n FROM payment_postings WHERE practice_id = $1', [practiceId])).toBe(3);
    expect(await count('SELECT count(*)::int AS n FROM payment_transactions WHERE practice_id = $1', [practiceId])).toBe(2);
    expect(await count('SELECT count(*)::int AS n FROM claims WHERE practice_id = $1 AND submitted_at IS NOT NULL AND created_at >= submitted_at', [practiceId])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM claims WHERE practice_id = $1 AND claim_number LIKE 'DEMO-%' AND insurance_id IS NULL", [practiceId])).toBe(0);
  }, 60_000);
});
