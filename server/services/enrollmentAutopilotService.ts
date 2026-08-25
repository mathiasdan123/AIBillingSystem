/**
 * Enrollment autopilot — work out what a practice needs to enrol in, from its
 * own data and Stedi's live payer directory.
 *
 * The enrollment screen was driven by KNOWN_PAYERS: eight hardcoded payers
 * with hardcoded requiresEnrollment flags. Two consequences, both bad at
 * onboarding time:
 *
 *   1. A practice billing anything off that list could not see it at all.
 *      Horizon BCBS NJ — the payer this platform's first real claim goes to —
 *      was not on it.
 *   2. The requirement flags were guesses. Stedi reports Horizon as
 *      eligibility SUPPORTED, professional claims SUPPORTED, ERA
 *      ENROLLMENT_REQUIRED. Guessing "claims: true" would send a practice
 *      chasing an enrollment they never needed, while guessing "era: false"
 *      would leave them silently unable to auto-post payments.
 *
 * So the plan is derived, never declared: which payers does this practice
 * actually bill, what does Stedi say each one requires TODAY, and what is
 * already enrolled. The remainder is the work.
 *
 * This module only PREPARES the plan. Submitting an enrollment names the
 * practice's NPI and TIN to a payer, which is an outward-facing act that a
 * human approves.
 */
import { and, eq, sql } from 'drizzle-orm';
import { claims, insurances, patients, payerEnrollments } from '@shared/schema';
import { db } from '../db';
import logger from './logger';
import { searchPayers } from './stediService';

export type LocalTransactionType = 'eligibility' | 'claims' | 'era';

/** Maps our local transaction names onto Stedi's directory fields. */
const SUPPORT_FIELD: Record<LocalTransactionType, string> = {
  eligibility: 'eligibilityCheck',
  claims: 'professionalClaimSubmission',
  era: 'eraPayment',
};

export interface ProposedEnrollment {
  transactionType: LocalTransactionType;
  /** What Stedi says today: SUPPORTED | ENROLLMENT_REQUIRED | NOT_SUPPORTED. */
  stediSupport: string;
  /** Current local state: not_enrolled | pending | enrolled | rejected. */
  currentStatus: string;
  /** True when this is work the practice actually has to do. */
  needed: boolean;
  reason: string;
}

export interface PayerPlan {
  payerName: string;
  /** Resolved Stedi payer id, or null when the payer could not be matched. */
  payerId: string | null;
  /** How many of this practice's patients/claims reference this payer. */
  usageCount: number;
  /** Null payerId means we could not resolve it — a human must pick. */
  unresolved: boolean;
  proposals: ProposedEnrollment[];
}

export interface EnrollmentPlan {
  practiceId: number;
  payers: PayerPlan[];
  /** Enrollments that are needed and could be submitted right now. */
  actionableCount: number;
  /** Payers we could not resolve against Stedi — need a human to disambiguate. */
  unresolvedCount: number;
}

/**
 * Which payers does this practice actually bill?
 *
 * Derived from the insurances referenced by its own patients and claims, not
 * from a curated list. A payer nobody bills is noise; a payer someone bills is
 * work regardless of whether we anticipated it.
 */
export async function discoverPayers(
  practiceId: number,
): Promise<Array<{ name: string; payerCode: string | null; usageCount: number }>> {
  const rows = await db
    .select({
      name: insurances.name,
      payerCode: insurances.payerCode,
      usageCount: sql<number>`COUNT(*)::int`,
    })
    .from(claims)
    .innerJoin(insurances, eq(claims.insuranceId, insurances.id))
    .where(eq(claims.practiceId, practiceId))
    .groupBy(insurances.name, insurances.payerCode);

  // Patients with insurance but no claim yet still represent payers the
  // practice intends to bill — and enrollment lead time is measured in weeks,
  // so waiting for the first claim to discover the need is already too late.
  const fromPatients = await db
    .select({
      name: insurances.name,
      payerCode: insurances.payerCode,
      usageCount: sql<number>`COUNT(*)::int`,
    })
    .from(patients)
    .innerJoin(insurances, eq(patients.insuranceId, insurances.id))
    .where(eq(patients.practiceId, practiceId))
    .groupBy(insurances.name, insurances.payerCode);

  const merged = new Map<string, { name: string; payerCode: string | null; usageCount: number }>();
  for (const row of [...rows, ...fromPatients]) {
    if (!row.name) continue;
    const key = row.name.toLowerCase();
    const existing = merged.get(key);
    if (existing) existing.usageCount += row.usageCount;
    else merged.set(key, { name: row.name, payerCode: row.payerCode, usageCount: row.usageCount });
  }

  return Array.from(merged.values()).sort((a, b) => b.usageCount - a.usageCount);
}

function proposalFor(
  transactionType: LocalTransactionType,
  support: string | undefined,
  currentStatus: string,
): ProposedEnrollment {
  const stediSupport = support ?? 'UNKNOWN';

  if (stediSupport === 'NOT_SUPPORTED') {
    return {
      transactionType,
      stediSupport,
      currentStatus,
      needed: false,
      reason: 'The clearinghouse does not support this transaction for this payer.',
    };
  }

  if (stediSupport !== 'ENROLLMENT_REQUIRED') {
    return {
      transactionType,
      stediSupport,
      currentStatus,
      needed: false,
      // Being explicit matters: proposing an unnecessary enrollment sends the
      // practice chasing paperwork the payer never asked for.
      reason: 'No enrollment required — this works today.',
    };
  }

  if (currentStatus === 'enrolled') {
    return { transactionType, stediSupport, currentStatus, needed: false, reason: 'Already enrolled.' };
  }
  if (currentStatus === 'pending') {
    return {
      transactionType,
      stediSupport,
      currentStatus,
      needed: false,
      reason: 'Submitted — waiting on the payer.',
    };
  }

  return {
    transactionType,
    stediSupport,
    currentStatus,
    needed: true,
    reason:
      currentStatus === 'rejected'
        ? 'Previously rejected — needs resubmitting.'
        : 'Enrollment required and not yet requested.',
  };
}

/**
 * Build the enrollment plan for a practice.
 *
 * Deliberately tolerant of payer-resolution failure: an unresolved payer is
 * reported as unresolved rather than dropped. Silently omitting a payer the
 * practice bills would leave a gap nobody knows about, which is precisely the
 * failure mode the hardcoded list already had.
 */
export async function buildEnrollmentPlan(practiceId: number): Promise<EnrollmentPlan> {
  const discovered = await discoverPayers(practiceId);

  const existing = await db
    .select()
    .from(payerEnrollments)
    .where(eq(payerEnrollments.practiceId, practiceId));

  const statusByKey = new Map<string, string>();
  for (const row of existing) {
    statusByKey.set(`${(row.payerName ?? '').toLowerCase()}::${row.transactionType}`, row.status ?? 'not_enrolled');
  }

  const payers: PayerPlan[] = [];

  for (const payer of discovered) {
    let match: any = null;
    try {
      const results = await searchPayers(payer.payerCode || payer.name, { practiceId });
      match =
        results.find(
          (r: any) =>
            r.payerId === payer.payerCode ||
            (r.aliases ?? []).includes(payer.payerCode ?? '__none__'),
        ) ?? results[0] ?? null;
    } catch (err: any) {
      logger.warn('Payer lookup failed while building enrollment plan', {
        practiceId,
        payer: payer.name,
        error: err?.message,
      });
    }

    const support = match?.transactionSupport ?? {};
    const proposals = (Object.keys(SUPPORT_FIELD) as LocalTransactionType[]).map((tx) =>
      proposalFor(
        tx,
        match ? support[SUPPORT_FIELD[tx]] : undefined,
        statusByKey.get(`${payer.name.toLowerCase()}::${tx}`) ?? 'not_enrolled',
      ),
    );

    payers.push({
      payerName: match?.displayName ?? payer.name,
      payerId: match?.payerId ?? null,
      usageCount: payer.usageCount,
      unresolved: !match,
      proposals,
    });
  }

  return {
    practiceId,
    payers,
    actionableCount: payers
      .filter((p) => !p.unresolved)
      .reduce((n, p) => n + p.proposals.filter((x) => x.needed).length, 0),
    unresolvedCount: payers.filter((p) => p.unresolved).length,
  };
}
