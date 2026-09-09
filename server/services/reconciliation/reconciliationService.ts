/**
 * Orchestrates deposit reconciliation for one practice: loads unmatched bank
 * credits and unreconciled remittances, runs the matching engine, persists
 * matches and (deduped) exceptions.
 */
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  bankTransactions,
  depositExceptions,
  depositMatchMembers,
  depositMatches,
  remittanceAdvice,
  type BankTransaction,
  type RemittanceAdvice,
} from '@shared/schema';
import logger from '../logger';
import {
  runMatching,
  type CandidateTransaction,
  type EngineOutcome,
  type ExpectedDeposit,
} from './matchingEngine';

export interface ReconcileResult extends EngineOutcome {
  practiceId: number;
  newExceptions: number;
}

export async function reconcilePractice(practiceId: number, today: string): Promise<ReconcileResult> {
  // Unmatched, posted bank credits for this practice.
  const txns: BankTransaction[] = await db
    .select()
    .from(bankTransactions)
    .where(and(eq(bankTransactions.practiceId, practiceId), eq(bankTransactions.status, 'unmatched')));
  const candidates: CandidateTransaction[] = txns.map((t: BankTransaction) => ({
    bankTransactionId: t.id,
    postedDate: String(t.postedDate),
    descriptor: t.descriptor,
    amountCents: t.amountCents,
    pending: t.pending,
  }));

  // Remittances not yet tied to any deposit match.
  const matchedRemittanceIds = db
    .select({ id: depositMatchMembers.remittanceId })
    .from(depositMatchMembers)
    .innerJoin(depositMatches, eq(depositMatchMembers.matchId, depositMatches.id))
    .where(eq(depositMatches.practiceId, practiceId));
  const remits: RemittanceAdvice[] = await db
    .select()
    .from(remittanceAdvice)
    .where(and(eq(remittanceAdvice.practiceId, practiceId), notInArray(remittanceAdvice.id, matchedRemittanceIds)));

  const expected: ExpectedDeposit[] = remits.map((r: RemittanceAdvice) => ({
    remittanceId: r.id,
    payerName: r.payerName,
    traceNumber: r.checkNumber ?? null,
    effectiveDate: String(r.checkDate ?? r.receivedDate),
    amountCents: Math.round(Number(r.totalPaymentAmount) * 100),
  }));

  const outcome = runMatching(candidates, expected, { today });

  let newExceptions = 0;
  await db.transaction(async (tx: any) => {
    for (const m of outcome.matches) {
      const [match] = await tx
        .insert(depositMatches)
        .values({
          practiceId,
          bankTransactionId: m.bankTransactionId,
          kind: m.kind,
          confidence: m.confidence.toFixed(2),
        })
        .returning();
      for (const remittanceId of m.remittanceIds) {
        await tx.insert(depositMatchMembers).values({ matchId: match!.id, remittanceId });
      }
      await tx
        .update(bankTransactions)
        .set({ status: 'matched' })
        .where(eq(bankTransactions.id, m.bankTransactionId));
    }

    for (const ex of outcome.exceptions) {
      // Dedupe: never re-open the same finding, even after the team resolves
      // it — a resolved missing_deposit would otherwise reappear every run.
      const existing = await tx
        .select({ id: depositExceptions.id })
        .from(depositExceptions)
        .where(
          and(
            eq(depositExceptions.practiceId, practiceId),
            eq(depositExceptions.type, ex.type),
            ex.remittanceId !== undefined
              ? eq(depositExceptions.remittanceId, ex.remittanceId)
              : isNull(depositExceptions.remittanceId),
            ex.bankTransactionId !== undefined
              ? eq(depositExceptions.bankTransactionId, ex.bankTransactionId)
              : isNull(depositExceptions.bankTransactionId),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;
      await tx.insert(depositExceptions).values({
        practiceId,
        type: ex.type,
        remittanceId: ex.remittanceId ?? null,
        bankTransactionId: ex.bankTransactionId ?? null,
        detail: ex.detail,
      });
      newExceptions++;
    }
  });

  logger.info('Deposit reconciliation run complete', {
    practiceId,
    matches: outcome.matches.length,
    newExceptions,
  });
  return { ...outcome, practiceId, newExceptions };
}

export interface DepositStatement {
  period: { from: string; to: string };
  remittedCents: number;
  depositedConfirmedCents: number;
  awaitingDeposit: Array<{
    remittanceId: number;
    payerName: string;
    effectiveDate: string;
    amountCents: number;
    exception: boolean;
  }>;
}

/** Remitted vs deposited-and-confirmed for a period, plus what's still awaited. */
export async function depositStatement(
  practiceId: number,
  from: string,
  to: string,
): Promise<DepositStatement> {
  const inPeriod = and(
    eq(remittanceAdvice.practiceId, practiceId),
    sql`coalesce(${remittanceAdvice.checkDate}, ${remittanceAdvice.receivedDate}) between ${from} and ${to}`,
  );
  const remits: RemittanceAdvice[] = await db.select().from(remittanceAdvice).where(inPeriod);

  const remitIds = remits.map((r: RemittanceAdvice) => r.id);
  const matchedRows = remitIds.length
    ? await db
        .select({ remittanceId: depositMatchMembers.remittanceId })
        .from(depositMatchMembers)
        .where(inArray(depositMatchMembers.remittanceId, remitIds))
    : [];
  const matchedIds = new Set(matchedRows.map((r: { remittanceId: number }) => r.remittanceId));

  const exceptionRows = remitIds.length
    ? await db
        .select({ remittanceId: depositExceptions.remittanceId })
        .from(depositExceptions)
        .where(
          and(
            inArray(depositExceptions.remittanceId, remitIds),
            eq(depositExceptions.type, 'missing_deposit'),
          ),
        )
    : [];
  const exceptionIds = new Set(exceptionRows.map((r: { remittanceId: number | null }) => r.remittanceId));

  const cents = (r: RemittanceAdvice) => Math.round(Number(r.totalPaymentAmount) * 100);
  return {
    period: { from, to },
    remittedCents: remits.reduce((s: number, r: RemittanceAdvice) => s + cents(r), 0),
    depositedConfirmedCents: remits.filter((r: RemittanceAdvice) => matchedIds.has(r.id)).reduce((s: number, r: RemittanceAdvice) => s + cents(r), 0),
    awaitingDeposit: remits
      .filter((r: RemittanceAdvice) => !matchedIds.has(r.id))
      .map((r: RemittanceAdvice) => ({
        remittanceId: r.id,
        payerName: r.payerName,
        effectiveDate: String(r.checkDate ?? r.receivedDate),
        amountCents: cents(r),
        exception: exceptionIds.has(r.id),
      })),
  };
}
