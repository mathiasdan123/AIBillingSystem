/**
 * A sync must never invent "not enrolled".
 *
 * normalizeStediResponse read the status off each TRANSACTION entry. Stedi does
 * not always repeat it there — it can sit at the enrollment level — so the
 * lookup returned undefined, and mapStediEnrollmentStatus turns a missing
 * value into 'not_enrolled'.
 *
 * The result: pressing "Sync from clearinghouse" an hour after successfully
 * filing a Cigna ERA enrollment reported "2 updated" and flipped that
 * enrollment from Pending back to Not enrolled. The practice is then told it
 * has no enrollment when it has one in flight, and the natural response — file
 * it again — cannot work, because Stedi rejects the duplicate.
 *
 * Unknown is not a status. A row whose status cannot be read is left alone.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { normalizeStediResponse } from '../services/stediEnrollmentMappers';

describe('normalizeStediResponse status handling', () => {
  it('falls back to the enrollment-level status', () => {
    const rows = normalizeStediResponse({
      enrollments: [
        {
          payerName: 'Cigna',
          payerId: '62308',
          status: 'PROVISIONING',
          // No per-transaction status — only the enroll flag.
          transactions: { claimPayment: { enroll: true } },
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].transactionType).toBe('era');
    expect(rows[0].status).toBe('pending');
  });

  it('SKIPS a transaction with no readable status anywhere', () => {
    const rows = normalizeStediResponse({
      enrollments: [
        {
          payerName: 'Cigna',
          payerId: '62308',
          transactions: { claimPayment: { enroll: true } },
        },
      ],
    });

    // Skipped, NOT emitted as not_enrolled — writing that would overwrite a
    // real pending enrollment with a guess.
    expect(rows).toHaveLength(0);
  });

  it('still honours an explicit withdrawal', () => {
    const rows = normalizeStediResponse({
      enrollments: [
        {
          payerName: 'Cigna',
          payerId: '62308',
          transactions: { claimPayment: { status: 'CANCELLED' } },
        },
      ],
    });

    // An explicit cancellation IS authoritative and must still downgrade.
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('not_enrolled');
  });

  it('maps a LIVE enrollment to enrolled', () => {
    const rows = normalizeStediResponse({
      enrollments: [
        {
          payerName: 'Horizon Blue Cross and Blue Shield of New Jersey',
          payerId: '22099',
          transactions: { claimPayment: { status: 'LIVE' } },
        },
      ],
    });

    expect(rows[0].status).toBe('enrolled');
  });
});
