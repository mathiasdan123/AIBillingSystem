import { describe, it, expect, vi } from 'vitest';

// recoveryLedger imports the live db connection at module load; the compose
// function under test is pure, so stub the connection out.
vi.mock('../db', () => ({ db: {} }));
import { composeRecoveryLedgerStats } from '../storage/recoveryLedger';

/**
 * Recovery Ledger v2 money semantics. This is a money-claims surface, so the
 * composition rules are pinned:
 *  - valueDelivered = realized cash ONLY (appeals recovered + underpayments
 *    RECOVERED). The identified-but-uncollected gap must never leak into it.
 *  - Event-sourced (ledger) underpayment snapshots take precedence over the
 *    legacy live computation once any events exist.
 *  - Denial pillars are never monetized.
 */

const base = {
  appeals: { resolved: 0, won: 0, totalAppealed: 0, totalRecovered: 0 },
  caughtLedger: { count: 0, amountCents: 0 },
  caughtLegacy: { count: 0, amount: 0 },
  recovered: { count: 0, amountCents: 0 },
  denialsFlaggedLedger: 0,
  denialsFlaggedLegacy: 0,
  denialsRemediated: 0,
};

describe('composeRecoveryLedgerStats', () => {
  it('valueDelivered is realized cash only — identified gap never blends in', () => {
    const stats = composeRecoveryLedgerStats({
      ...base,
      appeals: { resolved: 4, won: 2, totalAppealed: 1000, totalRecovered: 600 },
      caughtLedger: { count: 3, amountCents: 50_000 }, // $500 identified
      recovered: { count: 1, amountCents: 12_500 },    // $125 collected
    });
    expect(stats.valueDelivered).toBe(725);      // 600 + 125
    expect(stats.valueIdentified).toBe(500);     // reported separately
    expect(stats.underpaymentsRecovered.amount).toBe(125);
  });

  it('prefers immutable ledger snapshots over the legacy live computation', () => {
    const stats = composeRecoveryLedgerStats({
      ...base,
      caughtLedger: { count: 2, amountCents: 20_000 },
      caughtLegacy: { count: 9, amount: 999 }, // stale live computation
    });
    expect(stats.underpaymentsCaught).toEqual({ count: 2, amount: 200, source: 'ledger' });
  });

  it('falls back to legacy computation when no events exist (pre-v2 / demo)', () => {
    const stats = composeRecoveryLedgerStats({
      ...base,
      caughtLegacy: { count: 4, amount: 321.5 },
    });
    expect(stats.underpaymentsCaught).toEqual({ count: 4, amount: 321.5, source: 'legacy' });
  });

  it('never monetizes denial pillars', () => {
    const stats = composeRecoveryLedgerStats({
      ...base,
      denialsFlaggedLedger: 5,
      denialsFlaggedLegacy: 3,
      denialsRemediated: 2,
    });
    expect(stats.denialsFlagged.count).toBe(5); // max of ledger/legacy
    expect(stats.denialsRemediated.count).toBe(2);
    expect(stats.valueDelivered).toBe(0);
    expect(stats.valueIdentified).toBe(0);
  });

  it('appeal success rate over resolved appeals; zero-safe', () => {
    const stats = composeRecoveryLedgerStats({
      ...base,
      appeals: { resolved: 5, won: 3, totalAppealed: 2000, totalRecovered: 1500 },
    });
    expect(stats.appealsRecovered.successRate).toBe(60);
    expect(composeRecoveryLedgerStats(base).appealsRecovered.successRate).toBe(0);
  });
});
