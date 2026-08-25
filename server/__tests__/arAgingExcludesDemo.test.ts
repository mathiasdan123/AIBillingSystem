/**
 * A/R ageing must not count demo claims.
 *
 * Every other metric in storage/analytics.ts filters demo rows out via
 * NOT_DEMO_CLAIM. getDaysInAR did not, and practice 1 — the founder's real
 * practice — still carries legacy showcase claims (CLM-DEMO-004/005/007)
 * marked 'submitted' with clearinghouseClaimId NULL. They were never
 * transmitted to a clearinghouse, let alone a payer.
 *
 * So a practice that has submitted ZERO real claims reported $794 outstanding
 * at an average of 145 days in A/R, all sitting in the 120+ bucket. That is
 * the dangerous direction for this particular number: 145 days is the shape
 * of a serious collections problem, and once the dashboard shows it as
 * routine, a REAL claim ageing past 120 days looks like more of the same
 * instead of the thing someone has to go chase before timely-filing runs out.
 *
 * The demo rows are left in place deliberately — they are what the demo
 * practice renders — so the fix belongs in the query, not in a DELETE.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { captured } = vi.hoisted(() => ({ captured: { where: [] as unknown[] } }));

vi.mock('../db', () => {
  const rows: unknown[] = [];
  const makeQuery = () => {
    const q: Record<string, unknown> = {};
    // Every builder method returns the same object, so the chain can end
    // wherever the implementation ends it (.groupBy(), .where(), ...).
    for (const m of ['from', 'innerJoin', 'leftJoin', 'groupBy', 'orderBy', 'limit']) {
      q[m] = () => q;
    }
    q.where = (cond: unknown) => {
      captured.where.push(cond);
      return q;
    };
    // Thenable: awaiting the builder resolves to rows, as Drizzle does.
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve);
    return q;
  };
  const db = { select: () => makeQuery() };
  return { db, getDb: () => db };
});
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getDaysInAR } from '../storage/analytics';

import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * Serialize a captured Drizzle condition to real SQL text.
 *
 * The obvious approach — walking the condition object for a column named
 * 'is_demo' — is VACUOUS: a Drizzle column holds a back-reference to its
 * table, and the table definition lists every column, so the walk finds
 * 'is_demo' through claims.practiceId alone. That version of this test passed
 * against the unfixed code. Serializing to SQL is what actually distinguishes
 * "the filter is in the WHERE clause" from "the table happens to have the
 * column".
 */
const dialect = new PgDialect();
const toSql = (cond: unknown): string => dialect.sqlToQuery(cond as never).sql;

beforeEach(() => {
  captured.where = [];
});

describe('getDaysInAR', () => {
  it('filters demo claims out of the ageing query', async () => {
    await getDaysInAR(1);

    expect(captured.where.length).toBeGreaterThan(0);
    // Not "some query mentions is_demo" — EVERY ageing query must, or the
    // bucket totals and the per-insurance breakdown disagree with each other.
    for (const cond of captured.where) {
      expect(toSql(cond)).toContain('is_demo');
    }
  });

  it('still scopes to the practice', async () => {
    await getDaysInAR(1);

    // The demo filter is an addition, not a replacement: dropping the
    // practice scope here would leak one practice's receivables into
    // another's dashboard.
    for (const cond of captured.where) {
      expect(toSql(cond)).toContain('practice_id');
    }
  });
});
