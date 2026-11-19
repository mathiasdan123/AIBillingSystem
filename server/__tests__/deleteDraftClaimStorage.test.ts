/**
 * storage.deleteDraftClaim removes, in one transaction, every row a DRAFT can
 * legitimately carry before the claim itself: risk-check evidence in
 * recovery_events (the pre-submit check writes a count-only
 * "denial_risk_flagged" row for a high-risk prediction, which is what made
 * every Submit-then-Delete draft fail with a foreign-key violation on the
 * demo pass of 2026-11-19), work-queue follow-ups, and line items.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  deletes: [] as Array<{ table: unknown; where: unknown }>,
  transactions: 0,
}));

vi.mock('../db', () => {
  const tx = {
    delete: (table: unknown) => ({
      where: async (where: unknown) => {
        H.deletes.push({ table, where });
      },
    }),
  };
  return {
    db: {
      transaction: async (fn: (t: typeof tx) => Promise<void>) => {
        H.transactions += 1;
        await fn(tx);
      },
      // Any non-transactional delete here would be a regression.
      delete: () => {
        throw new Error('deleteDraftClaim must delete inside db.transaction');
      },
    },
  };
});
vi.mock('../services/cacheService', () => ({
  cache: { get: vi.fn(), set: vi.fn(), del: vi.fn(), delPattern: vi.fn() },
  CacheKeys: new Proxy({}, { get: () => () => 'k' }),
}));

import { deleteDraftClaim } from '../storage/claims';
import { claims, claimLineItems, claimFollowUps, recoveryEvents } from '@shared/schema';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const render = (where: unknown) => new PgDialect().sqlToQuery(where as SQL);

beforeEach(() => {
  H.deletes.length = 0;
  H.transactions = 0;
});

describe('storage.deleteDraftClaim', () => {
  it('deletes recovery events, follow-ups and line items before the claim, all in one transaction', async () => {
    await deleteDraftClaim(42);

    expect(H.transactions).toBe(1);
    expect(H.deletes.map((d) => d.table)).toEqual([recoveryEvents, claimFollowUps, claimLineItems, claims]);
    // Every statement is scoped to this one claim.
    for (const d of H.deletes) expect(render(d.where).params).toContain(42);
  });

  it("removes only the draft's own risk-check evidence from recovery_events", async () => {
    await deleteDraftClaim(42);

    const { sql, params } = render(H.deletes[0].where);
    expect(sql).toMatch(/"claim_id" = \$1/);
    expect(sql).toMatch(/"event_type" in \(\$2, \$3\)/);
    expect(params).toEqual([42, 'denial_risk_flagged', 'denial_risk_remediated']);
    // Money evidence (underpayment_*, appeal_recovered) is NOT in the list:
    // if a "draft" has any, the FK blocks the delete and the route says so.
    expect(params).not.toContain('underpayment_detected');
    expect(params).not.toContain('underpayment_recovered');
    expect(params).not.toContain('appeal_recovered');
  });

  it("deletes the claim row only while it is still a draft", async () => {
    await deleteDraftClaim(42);

    const { sql, params } = render(H.deletes[3].where);
    expect(sql).toMatch(/"id" = \$1 and .*"status" = \$2/);
    expect(params).toEqual([42, 'draft']);
  });
});
