/**
 * Automated ERA (835) ingestion.
 *
 * Until this existed, remittances could only enter the system by a human
 * downloading an 835 and pasting it into the upload box. Everything downstream
 * was built and working — matching, posting, underpayment detection, patient
 * responsibility — behind a manual step nobody would perform reliably. A
 * payer's money would land in the practice's bank account and the system would
 * never know, so claims sat open in A/R and patients were never billed their
 * share.
 *
 * Polls Stedi for processed 835 transactions, fetches each, and runs it
 * through the SAME ingestion and auto-match path as a manual upload.
 *
 * Two properties matter more than throughput here:
 *
 * 1. NEVER SKIP. The high-water mark is deliberately rewound by
 *    OVERLAP_MINUTES on each run, so the window always re-covers recent time.
 *    A cursor advanced tightly to "now" would drop any transaction Stedi
 *    finished processing during the run itself — and a silently missed
 *    remittance is money that never gets posted.
 *
 * 2. NEVER DOUBLE-POST. Re-seeing a transaction is therefore normal, not
 *    exceptional, and is absorbed by the stediTransactionId uniqueness check
 *    in ingestRemittance.
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import { practices } from '@shared/schema';
import { db } from '../db';
import logger from './logger';
import { getStediApiKeyForPractice, isStediConfigured } from './stediService';
import { pollTransactions, fetch835Report, is835 } from './stediEraService';
import { normalizeStedi835 } from './stedi835Normalizer';
import { ingestRemittance } from './remittanceIngestionService';
import { autoMatchRemittance } from './eraAutoMatchService';
import { encryptRemittanceLineItem } from './phiEncryptionService';

/** How far back to look the first time a practice is polled. */
const INITIAL_LOOKBACK_DAYS = 30;
/** Rewind applied to the cursor every run, so the window always overlaps. */
const OVERLAP_MINUTES = 90;
/** Guard against an unbounded backfill hammering Stedi in one run. */
const MAX_PAGES_PER_PRACTICE = 20;
/**
 * Auto-posting can be turned off for a cautious rollout. ERAs are still
 * ingested; they simply wait for someone to press Auto-match.
 */
const AUTO_POST = process.env.ERA_AUTO_POST !== 'false';

export interface EraPollSummary {
  practicesPolled: number;
  transactionsSeen: number;
  remittancesIngested: number;
  duplicatesSkipped: number;
  lineItemsMatched: number;
  postingFailures: number;
  errors: Array<{ practiceId: number; transactionId?: string; error: string }>;
}

function emptySummary(): EraPollSummary {
  return {
    practicesPolled: 0,
    transactionsSeen: 0,
    remittancesIngested: 0,
    duplicatesSkipped: 0,
    lineItemsMatched: 0,
    postingFailures: 0,
    errors: [],
  };
}

/**
 * Practices eligible for polling: real (not demo) and actually live.
 *
 * Sandbox practices are excluded because their key resolves to the global test
 * key — polling under it would pull another account's transactions into their
 * remittance list.
 */
async function getPollablePractices() {
  return db
    .select({ id: practices.id, name: practices.name, lastEraPolledAt: practices.lastEraPolledAt })
    .from(practices)
    .where(
      and(
        // Live requires an explicit false — an unset flag means sandbox.
        eq(practices.sandboxMode, false),
        // Exclude the demo sandbox. isDemo is nullable on legacy rows, and
        // `is_demo != true` evaluates to NULL (not true) for those, which
        // would silently drop real practices from the sweep.
        or(eq(practices.isDemo, false), isNull(practices.isDemo)),
      ),
    );
}

async function pollPractice(
  practice: { id: number; lastEraPolledAt: Date | null },
  summary: EraPollSummary,
): Promise<void> {
  const { apiKey, isSandbox } = await getStediApiKeyForPractice(practice.id);

  // Belt and braces: getPollablePractices already filters, but sandbox
  // resolution is the one thing that must never be wrong here.
  if (isSandbox) {
    logger.info('Skipping ERA poll for sandbox practice', { practiceId: practice.id });
    return;
  }

  const startedAt = new Date();
  const since =
    practice.lastEraPolledAt ??
    new Date(Date.now() - INITIAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  let pageToken: string | undefined;
  let pages = 0;

  do {
    const page = await pollTransactions({
      apiKey,
      startDateTime: pageToken ? undefined : since.toISOString(),
      pageToken,
    });

    for (const transaction of page.transactions) {
      summary.transactionsSeen++;
      if (!is835(transaction)) continue;

      try {
        await ingestOne(practice.id, transaction.transactionId, apiKey, summary);
      } catch (err: any) {
        // One bad remittance must not abort the sweep for the rest.
        logger.error('ERA ingestion failed', {
          practiceId: practice.id,
          transactionId: transaction.transactionId,
          error: err?.message,
        });
        summary.errors.push({
          practiceId: practice.id,
          transactionId: transaction.transactionId,
          error: err?.message ?? 'unknown',
        });
      }
    }

    pageToken = page.nextPageToken ?? undefined;
    pages++;
  } while (pageToken && pages < MAX_PAGES_PER_PRACTICE);

  if (pageToken) {
    // Say so rather than let a truncated sweep look complete.
    logger.warn('ERA poll hit the page cap; more transactions remain', {
      practiceId: practice.id,
      maxPages: MAX_PAGES_PER_PRACTICE,
    });
  }

  // Rewind the cursor so the next run re-covers the tail of this one.
  const nextCursor = new Date(startedAt.getTime() - OVERLAP_MINUTES * 60 * 1000);
  await db
    .update(practices)
    .set({ lastEraPolledAt: nextCursor })
    .where(eq(practices.id, practice.id));
}

async function ingestOne(
  practiceId: number,
  transactionId: string,
  apiKey: string,
  summary: EraPollSummary,
): Promise<void> {
  const report = await fetch835Report({ apiKey, transactionId });
  const normalized = normalizeStedi835(report);

  const outcome = await ingestRemittance(practiceId, normalized, {
    stediTransactionId: transactionId,
    rawData: report,
    encryptLineItem: encryptRemittanceLineItem,
  });

  if (outcome.status === 'duplicate') {
    summary.duplicatesSkipped++;
    return;
  }

  summary.remittancesIngested++;
  logger.info('Ingested ERA from Stedi', {
    practiceId,
    transactionId,
    remittanceId: outcome.remittanceId,
    payer: normalized.payerName,
    total: normalized.totalPaymentAmount,
  });

  if (!AUTO_POST) return;

  // Same matching a human gets from the Auto-match button: identity is
  // mandatory and the score must clear the threshold. Anything short of that
  // stays unmatched for review rather than being posted on a guess.
  const matchResult = await autoMatchRemittance(practiceId, outcome.remittanceId, null);
  if (!matchResult) return;

  summary.lineItemsMatched += matchResult.matched;
  summary.postingFailures += matchResult.postingFailures.length;

  if (matchResult.postingFailures.length > 0) {
    // Matched but NOT recorded is the dangerous state: the claim looks
    // reconciled while the money is missing from collections.
    logger.error('ERA auto-match recorded matches with failed postings', {
      practiceId,
      remittanceId: outcome.remittanceId,
      failures: matchResult.postingFailures,
    });
  }
}

/**
 * Poll Stedi for new ERAs across all live practices and ingest them.
 */
export async function pollAndIngestEras(): Promise<EraPollSummary> {
  const summary = emptySummary();

  if (!isStediConfigured()) {
    logger.warn('Stedi not configured; skipping ERA poll');
    return summary;
  }

  const pollable = await getPollablePractices();
  logger.info('Starting ERA poll', { practices: pollable.length });

  for (const practice of pollable) {
    try {
      await pollPractice(practice as any, summary);
      summary.practicesPolled++;
    } catch (err: any) {
      logger.error('ERA poll failed for practice', {
        practiceId: practice.id,
        error: err?.message,
      });
      summary.errors.push({ practiceId: practice.id, error: err?.message ?? 'unknown' });
    }
  }

  logger.info('Completed ERA poll', summary);
  return summary;
}
