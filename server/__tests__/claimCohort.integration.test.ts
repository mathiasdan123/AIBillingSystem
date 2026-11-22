/**
 * The claim population behind the paid rate and denial rate, against a REAL
 * PostgreSQL.
 *
 * The dashboard stats, the Claims page summary and the Daily Insights 7-day
 * rate each run their own query. They must count the same claims, so this seeds
 * one set of rows and runs all three. The rows include the cases a mocked
 * database cannot judge: rejected claims, reopened claims (back in draft with
 * their original send timestamps), claims that never left draft, demo-tagged
 * rows, and another practice's rows.
 *
 * Self-skips unless CLAIM_COHORT_DATABASE_URL is set (CI provides a postgres
 * service container; locally: a scratch Postgres). The test works in its own
 * schema with a claims table holding the columns these queries read, and drops
 * the schema afterwards.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const DB_URL = process.env.CLAIM_COHORT_DATABASE_URL ?? '';
const SCHEMA = `claim_cohort_test_${process.pid}`;

vi.mock('../db', async () => {
  const url = process.env.CLAIM_COHORT_DATABASE_URL ?? '';
  if (!url) return { db: {} };
  const { Pool: P } = await import('pg');
  const { drizzle: d } = await import('drizzle-orm/node-postgres');
  const pool = new P({ connectionString: url, options: `-c search_path=claim_cohort_test_${process.pid}` });
  return { db: d(pool) };
});

const run = DB_URL ? describe : describe.skip;

run('claim rate cohort against real Postgres', () => {
  let admin: Pool;
  let testDb: ReturnType<typeof drizzle>;
  let getDashboardStats: (practiceId: number) => Promise<any>;
  let getClaimsStatusSummary: (practiceId: number) => Promise<any>;
  let getClaimCountsByDateRange: (db: any, practiceId: number, start: Date, end: Date) => Promise<any>;

  const PRACTICE = 1;
  const OTHER_PRACTICE = 2;
  const SENT = new Date();

  // [status, submittedAt, clearinghouseSubmittedAt, isDemo, practice]
  type Row = [string, Date | null, Date | null, boolean, number];
  const rows: Record<string, Row> = {
    // ---- in the cohort -------------------------------------------------
    paid1: ['paid', SENT, SENT, false, PRACTICE],
    paid2: ['paid', SENT, null, false, PRACTICE],
    denied: ['denied', SENT, SENT, false, PRACTICE],
    pending: ['submitted', SENT, SENT, false, PRACTICE],
    inAppeal: ['appeal', SENT, SENT, false, PRACTICE],
    // Rejected by the clearinghouse/payer front end: transmitted, so in the base.
    rejected: ['rejected', null, null, false, PRACTICE],
    // A denied or rejected claim that was REOPENED: back to draft for correction,
    // but it still has the timestamps from when it was first sent.
    reopenedFromDenial: ['draft', SENT, SENT, false, PRACTICE],
    reopenedClearinghouseOnly: ['draft', null, SENT, false, PRACTICE],
    // Marked submitted by status alone (no timestamps recorded).
    submittedStatusOnly: ['submitted', null, null, false, PRACTICE],
    // ---- not in the cohort ---------------------------------------------
    plainDraft: ['draft', null, null, false, PRACTICE],
    held: ['held', null, null, false, PRACTICE],
    // ---- excluded rows ---------------------------------------------------
    demoPaid: ['paid', SENT, SENT, true, PRACTICE],
    demoDenied: ['denied', SENT, SENT, true, PRACTICE],
    demoSubmitted: ['submitted', SENT, SENT, true, PRACTICE],
    otherPracticePaid: ['paid', SENT, SENT, false, OTHER_PRACTICE],
    otherPracticeDenied: ['denied', SENT, SENT, false, OTHER_PRACTICE],
  };

  // Cohort for PRACTICE, by hand from the table above:
  //   paid1, paid2, denied, pending, inAppeal, rejected, reopenedFromDenial,
  //   reopenedClearinghouseOnly, submittedStatusOnly  = 9 claims
  // of which 2 are paid and 1 is denied.
  const EXPECTED = { transmitted: 9, transmittedPaid: 2, transmittedDenied: 1 };

  beforeAll(async () => {
    admin = new Pool({ connectionString: DB_URL });
    await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    // Only the columns the three queries read.
    await admin.query(`
      CREATE TABLE ${SCHEMA}.claims (
        id serial PRIMARY KEY,
        practice_id integer NOT NULL,
        is_demo boolean NOT NULL DEFAULT false,
        status varchar DEFAULT 'draft',
        total_amount numeric(10,2) NOT NULL DEFAULT 100,
        paid_amount numeric(10,2),
        submitted_at timestamp,
        paid_at timestamp,
        clearinghouse_submitted_at timestamp,
        denial_prediction jsonb,
        created_at timestamp DEFAULT now()
      )`);
    for (const [status, submittedAt, chAt, isDemo, practice] of Object.values(rows)) {
      await admin.query(
        `INSERT INTO ${SCHEMA}.claims (practice_id, is_demo, status, submitted_at, clearinghouse_submitted_at, paid_amount, paid_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [practice, isDemo, status, submittedAt, chAt, status === 'paid' ? 100 : null, status === 'paid' ? SENT : null],
      );
    }
    testDb = drizzle(new Pool({ connectionString: DB_URL, options: `-c search_path=${SCHEMA}` }));
    ({ getDashboardStats } = await import('../storage/analytics'));
    ({ getClaimsStatusSummary } = await import('../storage/claims'));
    ({ getClaimCountsByDateRange } = await import('../services/insightsReportService'));
  }, 60_000);

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
      await admin.end();
    }
  });

  it('dashboard: counts the cohort, including rejected and reopened claims, and no demo or other-practice rows', async () => {
    const stats = await getDashboardStats(PRACTICE);
    expect(stats.transmittedClaims).toBe(EXPECTED.transmitted);
    expect(stats.successRate).toBeCloseTo((EXPECTED.transmittedPaid / EXPECTED.transmitted) * 100, 6);
    expect(stats.denialRate).toBeCloseTo((EXPECTED.transmittedDenied / EXPECTED.transmitted) * 100, 6);
  });

  it('dashboard: average days to payment is unavailable, not a placeholder number', async () => {
    const stats = await getDashboardStats(PRACTICE);
    expect(stats.avgDaysToPayment).toBeNull();
  });

  it('claims page summary: same cohort and the same demo exclusion as the dashboard', async () => {
    const summary = await getClaimsStatusSummary(PRACTICE);
    expect(summary.transmitted).toBe(EXPECTED.transmitted);
    expect(summary.transmittedPaid).toBe(EXPECTED.transmittedPaid);
    expect(summary.transmittedDenied).toBe(EXPECTED.transmittedDenied);
  });

  it('daily insights: same cohort and demo exclusion for the claims in the window', async () => {
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 60 * 60 * 1000);
    const counts = await getClaimCountsByDateRange(testDb, PRACTICE, start, end);
    expect(counts.transmitted).toBe(EXPECTED.transmitted);
    expect(counts.transmittedDenied).toBe(EXPECTED.transmittedDenied);
  });

  it('daily insights: its totals also leave demo-tagged and other-practice rows out', async () => {
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 60 * 60 * 1000);
    const counts = await getClaimCountsByDateRange(testDb, PRACTICE, start, end);
    // 11 non-demo claims for the practice (9 in the cohort + plain draft + held).
    expect(counts.total).toBe(11);
  });

  it('a claim reopened for correction stays in the base but is not counted as denied', async () => {
    const stats = await getDashboardStats(PRACTICE);
    // 1 denied of 9, not 1 of 7: the two reopened claims did not drop out of the base.
    expect(stats.denialRate).toBeCloseTo((1 / 9) * 100, 6);
    expect(stats.denialRate).not.toBeCloseTo((1 / 7) * 100, 2);
  });

  it('a rejected claim lowers the paid rate but is not counted as a denial', async () => {
    const stats = await getDashboardStats(PRACTICE);
    expect(stats.successRate).toBeCloseTo((2 / 9) * 100, 6);
    expect(stats.denialRate).toBeCloseTo((1 / 9) * 100, 6);
  });
});
