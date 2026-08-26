/**
 * An enrollment must be filed against a payer id the clearinghouse recognises.
 *
 * The enrollment grid is seeded from a hardcoded list carrying INVENTED
 * identifiers for several payers: 'HORIZON_NJ', 'BCBS_FED', 'MEDICAID',
 * 'ANTHEM', 'TRICARE'. Stedi has never heard of any of them — Horizon BCBS NJ
 * is 22099. Clicking "Submit to Stedi" on the Horizon row would file an
 * enrollment against a payer that does not exist.
 *
 * That failure mode is expensive out of proportion to its size. ERA enrollment
 * takes 2–6 weeks; a practice that files against a bad id waits out that whole
 * window, concludes the payer is slow, and only discovers the mistake when
 * remittances never start arriving. It looks like progress the entire time.
 *
 * So the supplied id is a HINT. It is used only if the directory confirms it;
 * otherwise the payer is resolved by name; and if neither works the submission
 * is refused rather than sent somewhere meaningless.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  search: vi.fn(),
  createEnrollment: vi.fn(),
  practice: null as any,
}));

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/stediService', () => ({
  searchPayers: H.search,
  getStediApiKeyForPractice: async () => ({ apiKey: 'K', isSandbox: false }),
}));
vi.mock('../services/stediEnrollmentService', () => ({
  createStediEnrollment: H.createEnrollment,
  mapTransactionTypeToStedi: (t: string) => (t === 'era' ? 'claimPayment' : t),
}));
vi.mock('../services/errorSanitizer', () => ({ sanitizeExternalError: (e: any) => e }));
vi.mock('../storage', () => ({ storage: { getPractice: async () => H.practice } }));
vi.mock('../db', () => {
  const db: any = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }),
  };
  return { db, getDb: () => db };
});

import { submitEnrollmentForPractice } from '../services/payerEnrollmentSubmitService';

/** Stedi's real record for Horizon BCBS NJ. */
const HORIZON = {
  payerId: '22099',
  displayName: 'Horizon Blue Cross and Blue Shield of New Jersey',
  aliases: ['22099', 'NJBCBS', '100046'],
};
const CIGNA = { payerId: '62308', displayName: 'Cigna', aliases: ['62308', 'CIGNA'] };

const READY_PRACTICE = {
  id: 1,
  name: 'Wonderkids',
  stediProviderId: 'prov_1',
  enrollmentAuthorizedAt: new Date(),
  enrollmentNotificationEmail: 'billing@example.com',
  billingContactEmail: 'billing@example.com',
  billingContactPhone: '5551234567',
  billingContactName: 'Jane Doe',
  addressStreet: '1 Main St',
  addressCity: 'Lakewood',
  addressState: 'NJ',
  addressZip: '08701',
};

beforeEach(() => {
  vi.clearAllMocks();
  H.practice = READY_PRACTICE;
  H.createEnrollment.mockResolvedValue({ ok: true, enrollmentId: 'enr_1', status: 'PROVISIONING', localStatus: 'pending' });
});

describe('payer id resolution before enrolling', () => {
  it('replaces the invented HORIZON_NJ id with the real 22099', async () => {
    // First call (by the bogus id) finds nothing; the name lookup succeeds.
    H.search.mockResolvedValueOnce([]).mockResolvedValueOnce([HORIZON]);

    await submitEnrollmentForPractice(1, {
      payerName: 'Horizon BCBS NJ',
      payerId: 'HORIZON_NJ',
      transactionType: 'era',
    });

    expect(H.createEnrollment).toHaveBeenCalledTimes(1);
    expect(H.createEnrollment.mock.calls[0][1].payerId).toBe('22099');
  });

  it('keeps a supplied id the directory confirms', async () => {
    H.search.mockResolvedValue([CIGNA]);

    await submitEnrollmentForPractice(1, {
      payerName: 'Cigna',
      payerId: '62308',
      transactionType: 'era',
    });

    expect(H.createEnrollment.mock.calls[0][1].payerId).toBe('62308');
  });

  it('accepts an id that is an ALIAS of the real payer', async () => {
    H.search.mockResolvedValue([HORIZON]);

    await submitEnrollmentForPractice(1, {
      payerName: 'Horizon BCBS NJ',
      payerId: 'NJBCBS',
      transactionType: 'era',
    });

    // Resolves to the canonical id, not the alias.
    expect(H.createEnrollment.mock.calls[0][1].payerId).toBe('22099');
  });

  it('refuses when the payer cannot be matched at all', async () => {
    H.search.mockResolvedValue([]);

    await expect(
      submitEnrollmentForPractice(1, {
        payerName: 'Not A Real Payer',
        payerId: 'MADE_UP',
        transactionType: 'era',
      }),
    ).rejects.toThrow(/could not be matched/i);

    // An enrollment aimed at nothing is worse than none — it looks like
    // progress for the 2-6 weeks the practice spends waiting.
    expect(H.createEnrollment).not.toHaveBeenCalled();
  });

  it('refuses rather than guessing when the directory is unreachable', async () => {
    H.search.mockRejectedValue(new Error('Stedi 503'));

    await expect(
      submitEnrollmentForPractice(1, {
        payerName: 'Cigna',
        payerId: '62308',
        transactionType: 'era',
      }),
    ).rejects.toThrow(/could not reach the clearinghouse/i);

    expect(H.createEnrollment).not.toHaveBeenCalled();
  });
});
