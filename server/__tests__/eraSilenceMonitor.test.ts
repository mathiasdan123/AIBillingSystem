/**
 * Telling "no remittances yet" apart from "the integration is broken".
 *
 * This system has already lost months to an absence that looked normal: the
 * Stedi endpoints in stediService 404'd on every call, and the only symptom
 * was that nothing happened — which is exactly what a quiet week looks like.
 * The ERA poller is exposed to the same trap, and more so, because its
 * response envelope has never been observed against a live account.
 *
 * The alarm fires only when all three hold at once, because each alone is
 * unremarkable:
 *   enrolled for ERA   (otherwise no remittance is expected at all)
 *   claims being paid  (otherwise there is nothing to remit)
 *   nothing polled     (otherwise it plainly works)
 *
 * Getting the conjunction wrong in either direction is costly: too eager and
 * the alert is ignored, too lax and the silence goes unnoticed again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  practices: [] as any[],
  enrolledCount: 0,
  paidCount: 0,
  lastEra: null as string | null,
}));

vi.mock('../db', () => {
  // Each select() resolves in the order the service issues them:
  // practices, then per practice: enrolled -> paid -> lastEra.
  let phase = 0;
  const db: any = {
    select: (cols: any) => ({
      from: (table: any) => {
        const build = (rows: any) => ({
          where: () => Promise.resolve(rows),
        });
        // Distinguish by the requested column shape.
        if (cols && 'id' in cols && 'name' in cols) {
          phase = 0;
          return build(H.practices);
        }
        if (cols && 'n' in cols) {
          const rows = phase === 0 ? [{ n: H.enrolledCount }] : [{ n: H.paidCount }];
          phase = 1;
          return build(rows);
        }
        return build([{ latest: H.lastEra }]);
      },
    }),
  };
  return { db, getDb: () => db };
});
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  findSilentEraPractices,
  describeFinding,
  SILENCE_DAYS,
} from '../services/eraSilenceMonitor';

const NOW = new Date('2026-08-25T12:00:00Z');
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

beforeEach(() => {
  H.practices = [{ id: 1, name: 'Wonderkids' }];
  H.enrolledCount = 1;
  H.paidCount = 3;
  H.lastEra = null;
});

describe('findSilentEraPractices', () => {
  it('flags an enrolled, paid, silent practice', async () => {
    const report = await findSilentEraPractices(NOW);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].practiceId).toBe(1);
    // Never received anything at all through the poller.
    expect(report.findings[0].daysSinceLastPolledEra).toBeNull();
  });

  it('stays quiet when the practice is not ERA-enrolled', async () => {
    H.enrolledCount = 0;

    // Pre-enrolment silence is the expected state, not a fault. Alerting here
    // would train the recipient to ignore the alert.
    expect((await findSilentEraPractices(NOW)).findings).toEqual([]);
  });

  it('stays quiet when no money is moving', async () => {
    H.paidCount = 0;

    // A newly enrolled practice with no paid claims has nothing to remit.
    expect((await findSilentEraPractices(NOW)).findings).toEqual([]);
  });

  it('stays quiet when a remittance arrived recently', async () => {
    H.lastEra = daysAgo(2);

    expect((await findSilentEraPractices(NOW)).findings).toEqual([]);
  });

  it('flags again once the last remittance ages past the window', async () => {
    H.lastEra = daysAgo(SILENCE_DAYS + 5);

    const report = await findSilentEraPractices(NOW);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].daysSinceLastPolledEra).toBe(SILENCE_DAYS + 5);
  });

  it('ignores sandbox practices', async () => {
    H.practices = [];

    const report = await findSilentEraPractices(NOW);
    expect(report.practicesChecked).toBe(0);
    expect(report.findings).toEqual([]);
  });
});

describe('describeFinding', () => {
  it('says it is a fault, not quiet — and names the thing to check', async () => {
    const [finding] = (await findSilentEraPractices(NOW)).findings;
    const text = describeFinding(finding);

    expect(text).toMatch(/broken integration/i);
    // The specific lesson from the 404 months: do not assume the payer simply
    // sent nothing.
    expect(text).toMatch(/envelope/i);
    expect(text).toMatch(/never|NO remittance/i);
  });
});
