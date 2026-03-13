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
  type PatientStatement,
  type InsertPatientStatement,
} from '@shared/schema';
import { db } from '../db';
import logger from './logger';

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

  // Build line items from claims
  const lineItems: StatementLineItem[] = patientClaims.map((claim: typeof patientClaims[number]) => {
    const totalAmount = parseFloat(claim.totalAmount) || 0;
    const paidAmount = parseFloat(claim.paidAmount || '0') || 0;
    const patientOwes = Math.max(0, totalAmount - paidAmount);

    return {
      dateOfService: claim.createdAt
        ? claim.createdAt.toISOString().split('T')[0]
        : startDate,
      description: `Claim #${claim.claimNumber || claim.id}`,
      charges: totalAmount.toFixed(2),
      insurancePaid: paidAmount.toFixed(2),
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

  let previousBalance = 0;
  for (const stmt of previousStatements) {
    const balance = parseFloat(stmt.patientBalance) || 0;
    const paid = parseFloat(stmt.paidAmount || '0') || 0;
    previousBalance += Math.max(0, balance - paid);
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
    adjustments: '0.00',
    patientBalance: (totalPatientBalance + previousBalance).toFixed(2),
    previousBalance: previousBalance.toFixed(2),
    lineItems,
    status: 'draft',
  };

  const [statement] = await db
    .insert(patientStatements)
    .values(insertData)
    .returning();

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
    patientName: `${r.patientFirstName || ''} ${r.patientLastName || ''}`.trim(),
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
