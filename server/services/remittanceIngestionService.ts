/**
 * Shared remittance ingestion.
 *
 * Extracted from the POST /api/remittance/upload handler so the automated ERA
 * poller and the manual upload go through ONE path. Two ingestion paths would
 * drift, and the half that drifted would be the idempotency — which is the
 * half that decides whether a payment gets recorded twice.
 */
import crypto from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { remittanceAdvice, remittanceLineItems } from '@shared/schema';
import { db } from '../db';
import logger from './logger';
import type { NormalizedRemittance } from './stedi835Normalizer';

export type IngestOutcome =
  | { status: 'created'; remittanceId: number }
  | {
      status: 'duplicate';
      reason: 'transaction_id' | 'file_hash' | 'check_number';
      remittanceId: number;
    };

export interface IngestOptions {
  /** Stedi transaction id when this came from the poller. */
  stediTransactionId?: string | null;
  /** Raw payload to hash and store. Defaults to the normalized record. */
  rawData?: unknown;
  /** Skip the same-check-number guard (operator override on manual upload). */
  allowDuplicateCheck?: boolean;
  /** Encrypts PHI on line items before storage. */
  encryptLineItem: (item: any) => any;
}

export function hashRemittance(raw: unknown): string {
  return crypto
    .createHash('sha256')
    .update(typeof raw === 'string' ? raw : JSON.stringify(raw))
    .digest('hex');
}

/**
 * Insert a remittance and its line items, refusing duplicates.
 *
 * Three independent guards, in order of authority:
 *  1. stediTransactionId — exact, for polled ERAs. The poll window overlaps on
 *     purpose, so re-seeing a transaction is normal, not exceptional.
 *  2. fileHash — exact, for identical content.
 *  3. payer + check number + date — same money re-exported in a different
 *     format, which hashes differently.
 */
export async function ingestRemittance(
  practiceId: number,
  normalized: NormalizedRemittance,
  options: IngestOptions,
): Promise<IngestOutcome> {
  const { stediTransactionId = null, allowDuplicateCheck = false, encryptLineItem } = options;
  const rawForStorage = options.rawData ?? normalized;
  const fileHash = hashRemittance(rawForStorage);

  if (stediTransactionId) {
    const [existing] = await db
      .select({ id: remittanceAdvice.id })
      .from(remittanceAdvice)
      .where(
        and(
          eq(remittanceAdvice.practiceId, practiceId),
          eq(remittanceAdvice.stediTransactionId, stediTransactionId),
        ),
      )
      .limit(1);
    if (existing) {
      return { status: 'duplicate', reason: 'transaction_id', remittanceId: existing.id };
    }
  }

  const [duplicateFile] = await db
    .select({ id: remittanceAdvice.id })
    .from(remittanceAdvice)
    .where(and(eq(remittanceAdvice.practiceId, practiceId), eq(remittanceAdvice.fileHash, fileHash)))
    .limit(1);
  if (duplicateFile) {
    return { status: 'duplicate', reason: 'file_hash', remittanceId: duplicateFile.id };
  }

  if (normalized.checkNumber && !allowDuplicateCheck) {
    const [duplicateCheck] = await db
      .select({ id: remittanceAdvice.id })
      .from(remittanceAdvice)
      .where(
        and(
          eq(remittanceAdvice.practiceId, practiceId),
          eq(remittanceAdvice.payerName, normalized.payerName),
          eq(remittanceAdvice.checkNumber, normalized.checkNumber),
          normalized.checkDate ? eq(remittanceAdvice.checkDate, normalized.checkDate) : sql`TRUE`,
        ),
      )
      .limit(1);
    if (duplicateCheck) {
      return { status: 'duplicate', reason: 'check_number', remittanceId: duplicateCheck.id };
    }
  }

  const [remittance] = await db
    .insert(remittanceAdvice)
    .values({
      fileHash,
      stediTransactionId,
      practiceId,
      receivedDate: new Date().toISOString().split('T')[0],
      payerName: normalized.payerName,
      payerId: normalized.payerId,
      checkNumber: normalized.checkNumber,
      checkDate: normalized.checkDate,
      totalPaymentAmount: normalized.totalPaymentAmount.toFixed(2),
      rawData: rawForStorage as any,
      status: 'pending',
    })
    .returning();

  if (normalized.lineItems.length > 0) {
    const values = normalized.lineItems.map((item) => ({
      remittanceId: remittance.id,
      patientName: item.patientName,
      memberId: item.memberId,
      serviceDate: item.serviceDate,
      cptCode: item.cptCode,
      chargedAmount: item.chargedAmount != null ? String(item.chargedAmount) : null,
      allowedAmount: item.allowedAmount != null ? String(item.allowedAmount) : null,
      paidAmount: item.paidAmount != null ? String(item.paidAmount) : null,
      adjustmentAmount: item.adjustmentAmount != null ? String(item.adjustmentAmount) : null,
      patientResponsibility:
        item.patientResponsibility != null ? String(item.patientResponsibility) : null,
      contractualAdjustment:
        item.contractualAdjustment != null ? String(item.contractualAdjustment) : null,
      adjustmentReasonCodes: item.adjustmentReasonCodes,
      remarkCodes: item.remarkCodes,
      status: 'unmatched' as const,
    }));

    await db.insert(remittanceLineItems).values(values.map(encryptLineItem) as any);
  }

  logger.info('Remittance ingested', {
    remittanceId: remittance.id,
    practiceId,
    lineItems: normalized.lineItems.length,
    source: stediTransactionId ? 'stedi_poll' : 'upload',
  });

  return { status: 'created', remittanceId: remittance.id };
}
