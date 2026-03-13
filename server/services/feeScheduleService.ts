/**
 * Fee Schedule Service
 *
 * Manages insurance fee schedules - expected reimbursement rates from each
 * payer for each CPT code. Supports CRUD, bulk import, CSV export, and
 * actual-vs-expected reimbursement comparison.
 */

import { eq, and, desc, gte, lte, sql, isNull, or } from 'drizzle-orm';
import {
  feeSchedules,
  type FeeSchedule,
  type InsertFeeSchedule,
} from '@shared/schema';
import { db } from '../db';
import logger from './logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeeScheduleCreateData {
  payerName: string;
  cptCode: string;
  description?: string;
  billedAmount: string;
  expectedReimbursement: string;
  effectiveDate: string;
  expirationDate?: string | null;
  notes?: string | null;
}

export interface FeeScheduleUpdateData {
  payerName?: string;
  cptCode?: string;
  description?: string | null;
  billedAmount?: string;
  expectedReimbursement?: string;
  effectiveDate?: string;
  expirationDate?: string | null;
  notes?: string | null;
}

export interface UnderpaymentResult {
  claimId: number;
  payerName: string;
  cptCode: string;
  billedAmount: string;
  paidAmount: string;
  expectedReimbursement: string;
  difference: string;
  percentOfExpected: string;
}

export interface ComparisonReport {
  totalClaims: number;
  totalExpected: number;
  totalPaid: number;
  totalDifference: number;
  underpayments: UnderpaymentResult[];
}

// ---------------------------------------------------------------------------
// Service Functions
// ---------------------------------------------------------------------------

/**
 * Create a single fee schedule entry.
 */
export async function createFeeScheduleEntry(
  practiceId: number,
  data: FeeScheduleCreateData,
): Promise<FeeSchedule> {
  const insertData: InsertFeeSchedule = {
    practiceId,
    payerName: data.payerName,
    cptCode: data.cptCode,
    description: data.description ?? null,
    billedAmount: data.billedAmount,
    expectedReimbursement: data.expectedReimbursement,
    effectiveDate: data.effectiveDate,
    expirationDate: data.expirationDate ?? null,
    notes: data.notes ?? null,
  };

  const [entry] = await db.insert(feeSchedules).values(insertData).returning();

  logger.info('Fee schedule entry created', {
    feeScheduleId: entry.id,
    practiceId,
    payerName: data.payerName,
    cptCode: data.cptCode,
  });

  return entry;
}

/**
 * Bulk import multiple fee schedule entries at once.
 */
export async function bulkImportFeeSchedule(
  practiceId: number,
  entries: FeeScheduleCreateData[],
): Promise<FeeSchedule[]> {
  if (entries.length === 0) {
    return [];
  }

  const insertRows: InsertFeeSchedule[] = entries.map((data) => ({
    practiceId,
    payerName: data.payerName,
    cptCode: data.cptCode,
    description: data.description ?? null,
    billedAmount: data.billedAmount,
    expectedReimbursement: data.expectedReimbursement,
    effectiveDate: data.effectiveDate,
    expirationDate: data.expirationDate ?? null,
    notes: data.notes ?? null,
  }));

  const results = await db.insert(feeSchedules).values(insertRows).returning();

  logger.info('Fee schedule bulk import completed', {
    practiceId,
    count: results.length,
  });

  return results;
}

/**
 * List fee schedule entries with optional payer and CPT code filters.
 */
export async function getFeeSchedule(
  practiceId: number,
  payerName?: string,
  cptCode?: string,
): Promise<FeeSchedule[]> {
  const conditions = [eq(feeSchedules.practiceId, practiceId)];

  if (payerName) {
    conditions.push(eq(feeSchedules.payerName, payerName));
  }
  if (cptCode) {
    conditions.push(eq(feeSchedules.cptCode, cptCode));
  }

  const results = await db
    .select()
    .from(feeSchedules)
    .where(and(...conditions))
    .orderBy(desc(feeSchedules.effectiveDate));

  return results;
}

/**
 * Lookup the expected reimbursement for a specific payer/CPT code combo.
 * Returns the most recent effective entry that is not expired.
 */
export async function getExpectedReimbursement(
  practiceId: number,
  payerName: string,
  cptCode: string,
): Promise<FeeSchedule | null> {
  const today = new Date().toISOString().split('T')[0];

  const [entry] = await db
    .select()
    .from(feeSchedules)
    .where(
      and(
        eq(feeSchedules.practiceId, practiceId),
        eq(feeSchedules.payerName, payerName),
        eq(feeSchedules.cptCode, cptCode),
        lte(feeSchedules.effectiveDate, today),
        or(
          isNull(feeSchedules.expirationDate),
          gte(feeSchedules.expirationDate, today),
        ),
      ),
    )
    .orderBy(desc(feeSchedules.effectiveDate))
    .limit(1);

  return entry ?? null;
}

/**
 * Update a fee schedule entry (scoped to practice).
 */
export async function updateFeeScheduleEntry(
  id: number,
  practiceId: number,
  updates: FeeScheduleUpdateData,
): Promise<FeeSchedule> {
  // Verify the entry exists and belongs to this practice
  const [existing] = await db
    .select()
    .from(feeSchedules)
    .where(and(eq(feeSchedules.id, id), eq(feeSchedules.practiceId, practiceId)));

  if (!existing) {
    throw new Error(`Fee schedule entry ${id} not found for practice ${practiceId}`);
  }

  const setData: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.payerName !== undefined) setData.payerName = updates.payerName;
  if (updates.cptCode !== undefined) setData.cptCode = updates.cptCode;
  if (updates.description !== undefined) setData.description = updates.description;
  if (updates.billedAmount !== undefined) setData.billedAmount = updates.billedAmount;
  if (updates.expectedReimbursement !== undefined) setData.expectedReimbursement = updates.expectedReimbursement;
  if (updates.effectiveDate !== undefined) setData.effectiveDate = updates.effectiveDate;
  if (updates.expirationDate !== undefined) setData.expirationDate = updates.expirationDate;
  if (updates.notes !== undefined) setData.notes = updates.notes;

  const [updated] = await db
    .update(feeSchedules)
    .set(setData)
    .where(and(eq(feeSchedules.id, id), eq(feeSchedules.practiceId, practiceId)))
    .returning();

  logger.info('Fee schedule entry updated', { feeScheduleId: id, practiceId });

  return updated;
}

/**
 * Delete a fee schedule entry (scoped to practice).
 */
export async function deleteFeeScheduleEntry(
  id: number,
  practiceId: number,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(feeSchedules)
    .where(and(eq(feeSchedules.id, id), eq(feeSchedules.practiceId, practiceId)));

  if (!existing) {
    throw new Error(`Fee schedule entry ${id} not found for practice ${practiceId}`);
  }

  await db
    .delete(feeSchedules)
    .where(and(eq(feeSchedules.id, id), eq(feeSchedules.practiceId, practiceId)));

  logger.info('Fee schedule entry deleted', { feeScheduleId: id, practiceId });
}

/**
 * Compare actual claim payments vs fee schedule expectations for a date range.
 * Flags underpayments (actual paid < expected reimbursement).
 */
export async function compareActualVsExpected(
  practiceId: number,
  startDate: string,
  endDate: string,
): Promise<ComparisonReport> {
  // Use a SQL join to compare actual payments vs fee schedule expectations
  const comparisonResults = await db.execute(sql`
    SELECT
      c.id as claim_id,
      COALESCE(i.provider_name, 'Unknown') as payer_name,
      cli.cpt_code_id,
      cpt.code as cpt_code,
      cli.amount as billed_amount,
      c.paid_amount,
      fs.expected_reimbursement,
      (CAST(fs.expected_reimbursement AS numeric) - CAST(c.paid_amount AS numeric)) as difference
    FROM claims c
    JOIN claim_line_items cli ON cli.claim_id = c.id
    JOIN cpt_codes cpt ON cpt.id = cli.cpt_code_id
    LEFT JOIN insurances i ON i.id = c.insurance_id
    LEFT JOIN fee_schedules fs ON
      fs.practice_id = c.practice_id
      AND fs.cpt_code = cpt.code
      AND COALESCE(i.provider_name, '') = fs.payer_name
      AND fs.effective_date <= COALESCE(c.paid_at, c.created_at)
      AND (fs.expiration_date IS NULL OR fs.expiration_date >= COALESCE(c.paid_at, c.created_at))
    WHERE c.practice_id = ${practiceId}
      AND c.status = 'paid'
      AND c.paid_at >= ${startDate}::timestamp
      AND c.paid_at <= ${endDate}::timestamp
      AND fs.id IS NOT NULL
    ORDER BY difference DESC
  `);

  const rows = comparisonResults.rows as Array<{
    claim_id: number;
    payer_name: string;
    cpt_code: string;
    billed_amount: string;
    paid_amount: string;
    expected_reimbursement: string;
    difference: string;
  }>;

  const underpayments: UnderpaymentResult[] = [];
  let totalExpected = 0;
  let totalPaid = 0;

  for (const row of rows) {
    const paid = parseFloat(row.paid_amount ?? '0');
    const expected = parseFloat(row.expected_reimbursement ?? '0');
    totalPaid += paid;
    totalExpected += expected;

    const diff = expected - paid;
    if (diff > 0) {
      underpayments.push({
        claimId: row.claim_id,
        payerName: row.payer_name,
        cptCode: row.cpt_code,
        billedAmount: row.billed_amount,
        paidAmount: row.paid_amount,
        expectedReimbursement: row.expected_reimbursement,
        difference: diff.toFixed(2),
        percentOfExpected: expected > 0 ? ((paid / expected) * 100).toFixed(1) : '0.0',
      });
    }
  }

  return {
    totalClaims: rows.length,
    totalExpected,
    totalPaid,
    totalDifference: totalExpected - totalPaid,
    underpayments,
  };
}

/**
 * Export fee schedule entries as CSV text.
 */
export async function exportFeeSchedule(
  practiceId: number,
  payerName?: string,
): Promise<string> {
  const entries = await getFeeSchedule(practiceId, payerName);

  const headers = [
    'Payer Name',
    'CPT Code',
    'Description',
    'Billed Amount',
    'Expected Reimbursement',
    'Effective Date',
    'Expiration Date',
    'Notes',
  ];

  const csvRows = [headers.join(',')];

  for (const entry of entries) {
    const row = [
      escapeCsvField(entry.payerName),
      escapeCsvField(entry.cptCode),
      escapeCsvField(entry.description ?? ''),
      entry.billedAmount,
      entry.expectedReimbursement,
      entry.effectiveDate,
      entry.expirationDate ?? '',
      escapeCsvField(entry.notes ?? ''),
    ];
    csvRows.push(row.join(','));
  }

  return csvRows.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
