/**
 * Patient Statement Service
 *
 * Generates and manages patient billing statements - summaries sent to patients
 * showing what they owe after insurance processing.
 */

import { eq, and, sql, desc, gte, lte, inArray } from 'drizzle-orm';
import {
  patientStatements,
  claims,
  patients,
  paymentPostings,
  type PatientStatement,
  type InsertPatientStatement,
} from '@shared/schema';
import { db } from '../db';
import logger from './logger';
import { decryptField } from './phiEncryptionService';

export interface StatementLineItem {
  dateOfService: string;
  description: string;
  charges: string;
  insurancePaid: string;
  patientOwes: string;
}

export interface StatementFilters {
  patientId?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export interface OutstandingBalance {
  patientId: number;
  patientName: string;
  totalBalance: string;
  statementCount: number;
  oldestDueDate: string;
}

export interface AgingSummary {
  current: { count: number; total: string };
  thirtyDays: { count: number; total: string };
  sixtyDays: { count: number; total: string };
  ninetyPlusDays: { count: number; total: string };
  totalOutstanding: string;
}

/**
 * Generate a unique statement number.
 */
function generateStatementNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `STMT-${timestamp}-${random}`;
}

/**
 * Generate a patient statement from claims data for a given date range.
 */
export async function generateStatement(
  practiceId: number,
  patientId: number,
  startDate: string,
  endDate: string,
): Promise<PatientStatement> {
  // Fetch paid/processed claims for the patient in the date range
  const patientClaims = await db
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.practiceId, practiceId),
        eq(claims.patientId, patientId),
        gte(claims.createdAt, new Date(startDate)),
        lte(claims.createdAt, new Date(endDate)),
      ),
    );

  // What the patient owes comes from the payer's adjudication (the PR-group
  // amounts on the payment posting), NOT from charge - insurance paid.
  //
  // The old arithmetic billed the contractual write-off: $200 charged,
  // $110 allowed, $80 paid, $30 patient responsibility produced a $120
  // statement instead of $30. For an in-network practice that is balance
  // billing — the $90 difference is exactly the discount the practice agreed
  // to accept in the payer contract, and it cannot be passed to the patient.
  const claimIds = patientClaims.map((c: typeof patientClaims[number]) => c.id);
  const postings = claimIds.length
    ? await db
        .select({
          claimId: paymentPostings.claimId,
          patientResponsibility: sql<string>`COALESCE(SUM(CASE WHEN ${paymentPostings.reversed} = false THEN ${paymentPostings.patientResponsibility}::numeric ELSE 0 END), 0)::text`,
          paid: sql<string>`COALESCE(SUM(CASE WHEN ${paymentPostings.reversed} = false THEN ${paymentPostings.paymentAmount}::numeric ELSE 0 END), 0)::text`,
          postingCount: sql<number>`COUNT(*) FILTER (WHERE ${paymentPostings.reversed} = false)::int`,
        })
        .from(paymentPostings)
        .where(
          and(
            eq(paymentPostings.practiceId, practiceId),
            inArray(paymentPostings.claimId, claimIds),
          ),
        )
        .groupBy(paymentPostings.claimId)
    : [];

  const byClaim = new Map<number, { patientResponsibility: number; paid: number; postingCount: number }>();
  for (const p of postings) {
    byClaim.set(p.claimId, {
      patientResponsibility: parseFloat(p.patientResponsibility) || 0,
      paid: parseFloat(p.paid) || 0,
      postingCount: p.postingCount ?? 0,
    });
  }

  // Build line items from ADJUDICATED claims only. A claim the payer has not
  // adjudicated has no known patient share — billing it would charge the
  // patient the full sticker price for a visit insurance is about to pay for.
  const lineItems: StatementLineItem[] = patientClaims
    .filter((claim: typeof patientClaims[number]) => (byClaim.get(claim.id)?.postingCount ?? 0) > 0)
    .map((claim: typeof patientClaims[number]) => {
      const totalAmount = parseFloat(claim.totalAmount) || 0;
      const adjudicated = byClaim.get(claim.id)!;
      const patientOwes = Math.max(0, adjudicated.patientResponsibility);

      return {
        dateOfService: claim.createdAt
          ? claim.createdAt.toISOString().split('T')[0]
          : startDate,
        description: `Claim #${claim.claimNumber || claim.id}`,
        charges: totalAmount.toFixed(2),
        insurancePaid: adjudicated.paid.toFixed(2),
        patientOwes: patientOwes.toFixed(2),
      };
    });

  // Calculate totals
  let totalCharges = 0;
  let totalInsurancePaid = 0;
  let totalPatientBalance = 0;

  for (const item of lineItems) {
    totalCharges += parseFloat(item.charges);
    totalInsurancePaid += parseFloat(item.insurancePaid);
    totalPatientBalance += parseFloat(item.patientOwes);
  }

  // Check for previous unpaid balance from prior statements
  const previousStatements = await db
    .select()
    .from(patientStatements)
    .where(
      and(
        eq(patientStatements.practiceId, practiceId),
        eq(patientStatements.patientId, patientId),
        inArray(patientStatements.status, ['sent', 'overdue']),
      ),
    );

  /**
   * Rolling a balance forward has to CLOSE the statement it came from.
   *
   * The unpaid balance of every open statement was folded into the new one,
   * but the old statements were left open — so the same money appeared on
   * two live statements at once. A/R counted it twice, and a patient who
   * paid the new statement in full was still shown, and dunned for, the old
   * one.
   *
   * The superseded statements are marked below, after the new statement
   * exists, so a failure part-way through cannot close a statement whose
   * balance was never carried anywhere.
   */
  let previousBalance = 0;
  const supersededStatementIds: number[] = [];
  for (const stmt of previousStatements) {
    const balance = parseFloat(stmt.patientBalance) || 0;
    const paid = parseFloat(stmt.paidAmount || '0') || 0;
    const outstanding = Math.max(0, balance - paid);
    if (outstanding > 0) {
      previousBalance += outstanding;
      supersededStatementIds.push(stmt.id);
    }
  }

  // Set due date to 30 days from now
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  const insertData: InsertPatientStatement = {
    practiceId,
    patientId,
    statementNumber: generateStatementNumber(),
    statementDate: new Date().toISOString().split('T')[0],
    dueDate: dueDate.toISOString().split('T')[0],
    totalCharges: totalCharges.toFixed(2),
    insurancePaid: totalInsurancePaid.toFixed(2),
    // The contractual write-off, shown so the statement reconciles:
    // charges - insurance paid - adjustments = patient balance. Hardcoding
    // '0.00' made the statement appear to justify billing the write-off.
    adjustments: Math.max(0, totalCharges - totalInsurancePaid - totalPatientBalance).toFixed(2),
    patientBalance: (totalPatientBalance + previousBalance).toFixed(2),
    previousBalance: previousBalance.toFixed(2),
    lineItems,
    status: 'draft',
  };

  const [statement] = await db
    .insert(patientStatements)
    .values(insertData)
    .returning();

  // Close the statements whose balance this one now carries. Done AFTER the
  // insert: closing them first would lose the balance entirely if the insert
  // failed.
  if (supersededStatementIds.length > 0) {
    await db
      .update(patientStatements)
      .set({ status: 'superseded', updatedAt: new Date() })
      .where(inArray(patientStatements.id, supersededStatementIds));

    logger.info('Previous statements superseded by a rolled-forward balance', {
      patientId,
      supersededStatementIds,
      carriedForward: previousBalance.toFixed(2),
      newStatementId: statement.id,
    });
  }

  logger.info('Patient statement generated', {
    statementId: statement.id,
    practiceId,
    patientId,
    balance: statement.patientBalance,
  });

  return statement;
}

/**
 * List statements with optional filters.
 */
export async function getStatements(
  practiceId: number,
  filters?: StatementFilters,
): Promise<PatientStatement[]> {
  const conditions = [eq(patientStatements.practiceId, practiceId)];

  if (filters?.patientId) {
    conditions.push(eq(patientStatements.patientId, filters.patientId));
  }
  if (filters?.status) {
    conditions.push(eq(patientStatements.status, filters.status));
  }
  if (filters?.startDate) {
    conditions.push(gte(patientStatements.statementDate, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(patientStatements.statementDate, filters.endDate));
  }

  return db
    .select()
    .from(patientStatements)
    .where(and(...conditions))
    .orderBy(desc(patientStatements.createdAt));
}

/**
 * Get a single statement by ID.
 */
export async function getStatement(
  id: number,
  practiceId: number,
): Promise<PatientStatement | undefined> {
  const [statement] = await db
    .select()
    .from(patientStatements)
    .where(
      and(
        eq(patientStatements.id, id),
        eq(patientStatements.practiceId, practiceId),
      ),
    );

  return statement;
}

/**
 * Mark a statement as sent via a given method.
 */
export async function sendStatement(
  id: number,
  practiceId: number,
  method: 'email' | 'portal' | 'mail',
): Promise<PatientStatement | undefined> {
  const existing = await getStatement(id, practiceId);
  if (!existing) return undefined;

  const [updated] = await db
    .update(patientStatements)
    .set({
      status: 'sent',
      sentAt: new Date(),
      sentMethod: method,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(patientStatements.id, id),
        eq(patientStatements.practiceId, practiceId),
      ),
    )
    .returning();

  logger.info('Patient statement sent', {
    statementId: id,
    method,
    practiceId,
  });

  return updated;
}

/**
 * Record a patient payment against a statement.
 */
export async function recordPayment(
  id: number,
  practiceId: number,
  amount: number,
): Promise<PatientStatement | undefined> {
  const existing = await getStatement(id, practiceId);
  if (!existing) return undefined;

  const existingPaid = parseFloat(existing.paidAmount || '0') || 0;
  const newPaidTotal = existingPaid + amount;
  const balance = parseFloat(existing.patientBalance) || 0;
  const isPaidInFull = newPaidTotal >= balance;

  const [updated] = await db
    .update(patientStatements)
    .set({
      paidAmount: newPaidTotal.toFixed(2),
      paidAt: isPaidInFull ? new Date() : existing.paidAt,
      status: isPaidInFull ? 'paid' : existing.status,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(patientStatements.id, id),
        eq(patientStatements.practiceId, practiceId),
      ),
    )
    .returning();

  logger.info('Payment recorded on patient statement', {
    statementId: id,
    amount,
    newPaidTotal,
    isPaidInFull,
    practiceId,
  });

  return updated;
}

/**
 * Get patients with outstanding (unpaid) balances, sorted by amount descending.
 */
export async function getOutstandingBalances(
  practiceId: number,
): Promise<OutstandingBalance[]> {
  const results = await db
    .select({
      patientId: patientStatements.patientId,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      totalBalance: sql<string>`SUM(CAST(${patientStatements.patientBalance} AS numeric) - COALESCE(CAST(${patientStatements.paidAmount} AS numeric), 0))`,
      statementCount: sql<number>`COUNT(*)::int`,
      oldestDueDate: sql<string>`MIN(${patientStatements.dueDate})`,
    })
    .from(patientStatements)
    .innerJoin(patients, eq(patientStatements.patientId, patients.id))
    .where(
      and(
        eq(patientStatements.practiceId, practiceId),
        inArray(patientStatements.status, ['sent', 'overdue', 'collections']),
      ),
    )
    .groupBy(patientStatements.patientId, patients.firstName, patients.lastName)
    .orderBy(
      desc(
        sql`SUM(CAST(${patientStatements.patientBalance} AS numeric) - COALESCE(CAST(${patientStatements.paidAmount} AS numeric), 0))`,
      ),
    );

  return results.map((r: typeof results[number]) => ({
    patientId: r.patientId,
    // firstName/lastName are PHI-encrypted (raw join) — decrypt for display.
    patientName: `${decryptField(r.patientFirstName) || ''} ${decryptField(r.patientLastName) || ''}`.trim(),
    totalBalance: parseFloat(r.totalBalance || '0').toFixed(2),
    statementCount: r.statementCount,
    oldestDueDate: r.oldestDueDate,
  }));
}

/**
 * Get statement aging summary: current, 30, 60, 90+ days.
 */
export async function getAgingSummary(
  practiceId: number,
): Promise<AgingSummary> {
  const now = new Date();
  const thirtyAgo = new Date(now);
  thirtyAgo.setDate(thirtyAgo.getDate() - 30);
  const sixtyAgo = new Date(now);
  sixtyAgo.setDate(sixtyAgo.getDate() - 60);
  const ninetyAgo = new Date(now);
  ninetyAgo.setDate(ninetyAgo.getDate() - 90);

  const unpaidStatements = await db
    .select()
    .from(patientStatements)
    .where(
      and(
        eq(patientStatements.practiceId, practiceId),
        inArray(patientStatements.status, ['sent', 'overdue', 'collections']),
      ),
    );

  const buckets = {
    current: { count: 0, total: 0 },
    thirtyDays: { count: 0, total: 0 },
    sixtyDays: { count: 0, total: 0 },
    ninetyPlusDays: { count: 0, total: 0 },
  };

  for (const stmt of unpaidStatements) {
    const balance =
      (parseFloat(stmt.patientBalance) || 0) -
      (parseFloat(stmt.paidAmount || '0') || 0);
    if (balance <= 0) continue;

    const dueDate = new Date(stmt.dueDate);

    if (dueDate >= thirtyAgo) {
      buckets.current.count++;
      buckets.current.total += balance;
    } else if (dueDate >= sixtyAgo) {
      buckets.thirtyDays.count++;
      buckets.thirtyDays.total += balance;
    } else if (dueDate >= ninetyAgo) {
      buckets.sixtyDays.count++;
      buckets.sixtyDays.total += balance;
    } else {
      buckets.ninetyPlusDays.count++;
      buckets.ninetyPlusDays.total += balance;
    }
  }

  const totalOutstanding =
    buckets.current.total +
    buckets.thirtyDays.total +
    buckets.sixtyDays.total +
    buckets.ninetyPlusDays.total;

  return {
    current: { count: buckets.current.count, total: buckets.current.total.toFixed(2) },
    thirtyDays: { count: buckets.thirtyDays.count, total: buckets.thirtyDays.total.toFixed(2) },
    sixtyDays: { count: buckets.sixtyDays.count, total: buckets.sixtyDays.total.toFixed(2) },
    ninetyPlusDays: { count: buckets.ninetyPlusDays.count, total: buckets.ninetyPlusDays.total.toFixed(2) },
    totalOutstanding: totalOutstanding.toFixed(2),
  };
}
