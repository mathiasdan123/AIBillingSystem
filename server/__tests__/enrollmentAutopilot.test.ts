/**
 * Enrollment autopilot — deriving what a practice must enrol in.
 *
 * The enrollment screen was driven by KNOWN_PAYERS: eight hardcoded payers
 * with hardcoded requiresEnrollment flags. Both halves failed at onboarding:
 *
 *   - Horizon BCBS NJ, the payer this platform's first real claim goes to,
 *     was not on the list, so it could not appear on the screen at all.
 *   - The flags were guesses. Stedi actually reports Horizon as eligibility
 *     SUPPORTED, professional claims SUPPORTED, ERA ENROLLMENT_REQUIRED.
 *     Guessing "claims required" sends a practice chasing paperwork no payer
 *     asked for; guessing "ERA not required" leaves them permanently unable to
 *     auto-post payments without anyone knowing why.
 *
 * So nothing is declared. The payer list comes from what the practice bills,
 * and the requirements come from Stedi today.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  claimPayers: [] as any[],
  patientPayers: [] as any[],
  enrollments: [] as any[],
  patientRows: [] as any[],
  whereCall: 0,
  search: vi.fn(),
}));

vi.mock('../db', () => {
  const db: any = {
    select: () => ({
      from: () => ({
        // Claims discovery joins insurances; patient discovery does NOT (its
        // insuranceId is a member number, not a foreign key). The mock has to
        // serve both shapes or it stops resembling the code under test.
        innerJoin: () => ({
          where: () => ({ groupBy: () => Promise.resolve(H.claimPayers) }),
        }),
        where: () => {
          // Two awaited .where() queries run in order: patient rows first
          // (discovery), then the existing enrollments. Patient discovery no
          // longer groups in SQL — the payer name is encrypted, so it cannot
          // be grouped or compared there.
          const result: any = {
            groupBy: () => Promise.resolve(H.claimPayers),
            then: (resolve: any) => {
              const rows = H.whereCall++ === 0 ? H.patientRows : H.enrollments;
              return Promise.resolve(rows).then(resolve);
            },
          };
          return result;
        },
      }),
    }),
  };
  return { db, getDb: () => db };
});
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/stediService', () => ({ searchPayers: H.search }));
vi.mock('../services/phiEncryptionService', () => ({
  // Mirrors the real thing: an encryption envelope decrypts to its plaintext,
  // anything else passes through.
  decryptField: (v: any) => {
    if (typeof v === 'string' && v.startsWith('{"ciphertext"')) {
      try {
        return JSON.parse(v).__plain ?? null;
      } catch {
        return null;
      }
    }
    return v;
  },
}));

import { buildEnrollmentPlan } from '../services/enrollmentAutopilotService';

/** Stedi's real answer for Horizon BCBS NJ, verified 2026-08-25. */
const HORIZON = {
  payerId: '22099',
  displayName: 'Horizon Blue Cross and Blue Shield of New Jersey',
  aliases: ['22099', 'NJBCBS'],
  transactionSupport: {
    eligibilityCheck: 'SUPPORTED',
    professionalClaimSubmission: 'SUPPORTED',
    eraPayment: 'ENROLLMENT_REQUIRED',
  },
};

const proposalFor = (plan: any, tx: string) =>
  plan.payers[0].proposals.find((p: any) => p.transactionType === tx);

beforeEach(() => {
  vi.clearAllMocks();
  H.claimPayers = [{ name: 'Horizon BCBS NJ', payerCode: '22099', usageCount: 3 }];
  H.patientPayers = [];
  H.patientRows = [];
  H.enrollments = [];
  H.whereCall = 0;
  H.search.mockResolvedValue([HORIZON]);
});

describe('buildEnrollmentPlan', () => {
  it('finds a payer that was never in the hardcoded list', async () => {
    const plan = await buildEnrollmentPlan(1);

    expect(plan.payers).toHaveLength(1);
    expect(plan.payers[0].payerId).toBe('22099');
    expect(plan.payers[0].unresolved).toBe(false);
  });

  it('flags ERA as needed and claims as NOT needed, per Stedi', async () => {
    const plan = await buildEnrollmentPlan(1);

    // The exact asymmetry that matters: you can bill Horizon today, but you
    // cannot receive remittances until enrolled.
    expect(proposalFor(plan, 'era').needed).toBe(true);
    expect(proposalFor(plan, 'claims').needed).toBe(false);
    expect(proposalFor(plan, 'eligibility').needed).toBe(false);
    expect(plan.actionableCount).toBe(1);
  });

  it('explains why an unnecessary enrollment is unnecessary', async () => {
    const plan = await buildEnrollmentPlan(1);

    // Silence would read as "not done yet" and send someone chasing it.
    expect(proposalFor(plan, 'claims').reason).toMatch(/no enrollment required/i);
  });

  it('does not re-propose something already enrolled', async () => {
    H.enrollments = [
      { payerName: 'Horizon BCBS NJ', transactionType: 'era', status: 'enrolled' },
    ];

    const plan = await buildEnrollmentPlan(1);

    expect(proposalFor(plan, 'era').needed).toBe(false);
    expect(plan.actionableCount).toBe(0);
  });

  it('does not re-propose something already pending with the payer', async () => {
    H.enrollments = [
      { payerName: 'Horizon BCBS NJ', transactionType: 'era', status: 'pending' },
    ];

    const plan = await buildEnrollmentPlan(1);

    expect(proposalFor(plan, 'era').needed).toBe(false);
    expect(proposalFor(plan, 'era').reason).toMatch(/waiting on the payer/i);
  });

  it('re-proposes a rejected enrollment', async () => {
    H.enrollments = [
      { payerName: 'Horizon BCBS NJ', transactionType: 'era', status: 'rejected' },
    ];

    const plan = await buildEnrollmentPlan(1);

    // A rejection is unfinished work, not a settled state.
    expect(proposalFor(plan, 'era').needed).toBe(true);
    expect(proposalFor(plan, 'era').reason).toMatch(/rejected/i);
  });

  it('reports an unresolvable payer instead of dropping it', async () => {
    H.search.mockResolvedValue([]);

    const plan = await buildEnrollmentPlan(1);

    // Silently omitting a payer the practice bills recreates exactly the gap
    // the hardcoded list had.
    expect(plan.payers[0].unresolved).toBe(true);
    expect(plan.unresolvedCount).toBe(1);
  });

  it('survives a payer lookup that throws', async () => {
    H.search.mockRejectedValue(new Error('Stedi 503'));

    const plan = await buildEnrollmentPlan(1);

    expect(plan.payers[0].unresolved).toBe(true);
    expect(plan.payers).toHaveLength(1);
  });

  it('includes payers from patients who have no claim yet', async () => {
    H.claimPayers = [];
    H.patientRows = [
      {
        insuranceProvider: '{"ciphertext":"x","__plain":"Horizon BCBS NJ"}',
        insurancePayerId: '22099',
      },
    ];

    const plan = await buildEnrollmentPlan(1);

    // Enrollment lead time is weeks. Waiting for the first claim to discover
    // the need is already too late.
    expect(plan.payers).toHaveLength(1);
    expect(plan.actionableCount).toBe(1);
  });

  it('NEVER surfaces an encryption envelope as a payer name', async () => {
    H.claimPayers = [];
    // patients.insuranceProvider is PHI-encrypted at rest. Reading it straight
    // from the column and grouping in SQL produced one "payer" per patient,
    // named with the raw {"ciphertext":...,"iv":...,"tag":...} envelope, and
    // rendered it onto the page.
    H.patientRows = [
      { insuranceProvider: '{"ciphertext":"1fd43b","iv":"e0186d","tag":"3a52b7"}', insurancePayerId: null },
    ];

    const plan = await buildEnrollmentPlan(1);

    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain('ciphertext');
    expect(serialized).not.toContain('iv"');
    // Undecryptable is dropped, not displayed: an envelope is not a payer name
    // and showing it is worse than showing nothing.
    expect(plan.payers).toHaveLength(0);
  });

  it('groups patients on the DECRYPTED name, not the ciphertext', async () => {
    H.claimPayers = [];
    // Same payer, two patients. Each row carries its own IV, so the ciphertext
    // differs — grouping in SQL would report two separate payers.
    H.patientRows = [
      { insuranceProvider: '{"ciphertext":"aaa","__plain":"Cigna"}', insurancePayerId: '62308' },
      { insuranceProvider: '{"ciphertext":"bbb","__plain":"Cigna"}', insurancePayerId: '62308' },
    ];

    const plan = await buildEnrollmentPlan(1);

    expect(plan.payers).toHaveLength(1);
    expect(plan.payers[0].usageCount).toBe(2);
  });

  it('never marks a NOT_SUPPORTED transaction as needed', async () => {
    H.search.mockResolvedValue([
      {
        ...HORIZON,
        transactionSupport: { ...HORIZON.transactionSupport, eraPayment: 'NOT_SUPPORTED' },
      },
    ]);

    const plan = await buildEnrollmentPlan(1);

    // Enrolling in something the clearinghouse cannot do is pure wasted effort.
    expect(proposalFor(plan, 'era').needed).toBe(false);
    expect(plan.actionableCount).toBe(0);
  });
});
