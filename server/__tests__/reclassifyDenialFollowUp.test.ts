import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * reclassifyDenialAppealFollowUps: on Reopen to Draft, the claim's open
 * denial_appeal follow-up becomes a correction_resubmit task. The WHERE must
 * be scoped to the caller's practice and to that one claim, and must only
 * touch open denial_appeal rows. The db is faked; the SET and WHERE the
 * service builds are inspected by rendering them through the pg dialect.
 */

const captured: { set?: any; where?: any } = {};
vi.mock('../db', () => ({
  db: {
    update: () => ({
      set: (values: any) => {
        captured.set = values;
        return {
          where: (cond: any) => {
            captured.where = cond;
            return { returning: async () => [{ id: 1, followUpType: 'correction_resubmit' }] };
          },
        };
      },
    }),
  },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { reclassifyDenialAppealFollowUps } from '../services/claimFollowUpService';

const renderWhere = () => new PgDialect().sqlToQuery(captured.where);

beforeEach(() => {
  captured.set = undefined;
  captured.where = undefined;
});

describe('reclassifyDenialAppealFollowUps', () => {
  it('rewrites the task type, status and notes, carrying the old denial reason', async () => {
    const rows = await reclassifyDenialAppealFollowUps(42, 1, {
      reason: 'add prior auth number',
      previousDenialReason: 'CO-197: precertification absent',
      claimNumber: 'DEMO-2-1006',
    });
    expect(rows).toHaveLength(1);
    expect(captured.set).toMatchObject({ followUpType: 'correction_resubmit', status: 'pending' });
    expect(captured.set.notes).toBe(
      'Claim DEMO-2-1006 reopened to draft for correction: add prior auth number. Fix and resubmit (replacement claim). Previous denial reason: CO-197: precertification absent',
    );
    expect(captured.set.updatedAt).toBeInstanceOf(Date);
  });

  it('scopes the update to the claim, the practice, open rows, and the denial_appeal type only', async () => {
    await reclassifyDenialAppealFollowUps(42, 1, { reason: 'fix modifier' });
    const q = renderWhere();
    expect(q.sql).toContain('"claim_id" = ');
    expect(q.sql).toContain('"practice_id" = ');
    expect(q.sql).toContain('"follow_up_type" = ');
    expect(q.sql).toMatch(/"status" in \(/);
    expect(q.params).toEqual([42, 1, 'denial_appeal', 'pending', 'in_progress']);
  });

  it('omits the previous-denial clause when there was no denial reason', async () => {
    await reclassifyDenialAppealFollowUps(42, 1, { reason: 'fix modifier', previousDenialReason: null });
    expect(captured.set.notes).toBe('Claim 42 reopened to draft for correction: fix modifier. Fix and resubmit (replacement claim).');
  });
});
