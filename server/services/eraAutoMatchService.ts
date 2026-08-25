/**
 * ERA auto-matching and payment posting.
 *
 * Moved verbatim out of the POST /api/remittance/:id/auto-match handler so the
 * automated ERA poller and the manual "Auto-match" button run the SAME code.
 * Reimplementing matching for the cron would mean two money paths that drift,
 * and the one that drifted would post real payments onto the wrong claims.
 *
 * Matching is gated by eraMatchScoring.isAutoMatch: patient identity is
 * mandatory and the score must clear AUTO_MATCH_THRESHOLD. Corroborating
 * signals (service date, CPT, amount) can raise confidence in a claim already
 * tied to the patient, but can never establish the tie. Anything below the bar
 * is left `unmatched` for a human, whether a cron or a person triggered it.
 */
import { db } from '../db';
import {
  remittanceAdvice,
  remittanceLineItems,
  claims,
  claimLineItems,
  cptCodes,
  patients,
  feeSchedules,
} from '@shared/schema';
import { eq, and, desc, sql, ilike, lte } from 'drizzle-orm';
import { postPayment } from './paymentPostingService';
import { ensureUnderpaymentFollowUp } from './underpaymentPipelineService';
import { scoreClaimAgainstRemittanceLine, isAutoMatch } from './eraMatchScoring';
import { decryptRemittanceLineItem, decryptField } from './phiEncryptionService';
import logger from './logger';

export interface AutoMatchResult {
  matched: number;
  total: number;
  results: Array<{ lineItemId: number; claimId: number | null; matchType: string }>;
  /**
   * Lines matched to a claim whose payment posting FAILED. Non-empty means
   * money was matched but not recorded — callers must not present that as a
   * clean success.
   */
  postingFailures: Array<{ claimId: number; lineItemId: number }>;
}

/**
 * Auto-match a remittance's unmatched line items and post the payments.
 * Returns null when the remittance does not exist for this practice.
 */
export async function autoMatchRemittance(
  practiceId: number,
  remittanceId: number,
  postedBy: string | null = null,
): Promise<AutoMatchResult | null> {
  // Verify remittance belongs to practice
  const remittance = await db.query.remittanceAdvice.findFirst({
    where: and(
      eq(remittanceAdvice.id, remittanceId),
      eq(remittanceAdvice.practiceId, practiceId),
    ),
    with: { lineItems: true },
  });

  if (!remittance) {
    return null;
  }

  // Decrypt line-item PHI before matching — the matcher compares patientName
  // against claim patient names below.
  if (remittance.lineItems) {
    remittance.lineItems = remittance.lineItems.map(decryptRemittanceLineItem) as any;
  }

  // Get unmatched line items
  const unmatchedItems = remittance.lineItems.filter((li: any) => li.status === 'unmatched');

  if (unmatchedItems.length === 0) {
    return { matched: 0, total: 0, results: [], postingFailures: [] };
  }

  // Get all claims for this practice with patient info
  const practiceClaims = await db
    .select({
      claimId: claims.id,
      claimNumber: claims.claimNumber,
      patientId: claims.patientId,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
      totalAmount: claims.totalAmount,
      status: claims.status,
      createdAt: claims.createdAt,
    })
    .from(claims)
    .innerJoin(patients, eq(claims.patientId, patients.id))
    // A payer cannot be paying a claim that was never transmitted, so
    // drafts and held claims are not candidates. Leaving them in only
    // creates opportunities to post real money onto the wrong record.
    .where(
      and(
        eq(claims.practiceId, practiceId),
        sql`${claims.status} NOT IN ('draft', 'held')`,
      ),
    );

  // patients.firstName/lastName are PHI-encrypted at rest and this is a raw
  // join, so decrypt them — otherwise the name-matching below compares the
  // (decrypted) remittance name against ciphertext and never matches.
  for (const c of practiceClaims) {
    c.patientFirstName = decryptField(c.patientFirstName) as any;
    c.patientLastName = decryptField(c.patientLastName) as any;
  }

  // Get claim line items for service date + CPT matching
  const allClaimLineItems = await db
    .select()
    .from(claimLineItems)
    .where(
      sql`${claimLineItems.claimId} IN (SELECT id FROM claims WHERE practice_id = ${practiceId})`
    );

  // Resolve CPT ids to their actual codes. Without this the "CPT match"
  // below could only test that a line HAD a cpt id — which, on a NOT NULL
  // column, is always true.
  const allCptCodes = await db.select({ id: cptCodes.id, code: cptCodes.code }).from(cptCodes);
  const cptCodeById = new Map<number, string>();
  for (const c of allCptCodes) cptCodeById.set(c.id, String(c.code));

  // Build lookup structures
  const claimLineItemsByClaimId = new Map<number, typeof allClaimLineItems>();
  for (const cli of allClaimLineItems) {
    const existing = claimLineItemsByClaimId.get(cli.claimId) || [];
    existing.push(cli);
    claimLineItemsByClaimId.set(cli.claimId, existing);
  }

  let matchedCount = 0;
  const matchResults: Array<{ lineItemId: number; claimId: number | null; matchType: string }> = [];
  // Lines matched to a claim whose payment posting failed to record. These
  // are surfaced in the response — a "matched N" toast that hides a missing
  // payment is how collections silently go missing.
  const postingFailures: Array<{ claimId: number; lineItemId: number }> = [];

  for (const lineItem of unmatchedItems) {
    let bestMatch: { claimId: number; score: number; matchType: string } | null = null;

    for (const claim of practiceClaims) {
      const candidate = scoreClaimAgainstRemittanceLine(
        claim,
        claimLineItemsByClaimId.get(claim.claimId) || [],
        lineItem,
        cptCodeById,
      );

      // Identity is mandatory: corroborating signals can raise confidence in
      // a claim already tied to this patient, but can never establish the
      // tie. See services/eraMatchScoring.
      if (!isAutoMatch(candidate)) continue;

      if (candidate.score > (bestMatch?.score || 0)) {
        bestMatch = {
          claimId: claim.claimId,
          score: candidate.score,
          matchType: candidate.matchTypes.join('+'),
        };
      }
    }

    if (bestMatch) {
      // Update line item with match
      await db
        .update(remittanceLineItems)
        .set({
          claimId: bestMatch.claimId,
          status: 'matched',
        })
        .where(eq(remittanceLineItems.id, lineItem.id));

      // Record the payment. postPayment owns claim.paidAmount and status:
      // it SUMS non-reversed postings, so a multi-line ERA accumulates
      // instead of the last line overwriting the total, and a partial
      // payment lands on 'partial' rather than closing the claim. Writing
      // those fields here instead is what made a $0.01 payment mark a $200
      // claim fully paid and drop it out of A/R.
      const paidAmt = parseFloat(String(lineItem.paidAmount || '0'));
      const claimUpdate: Record<string, any> = {
        updatedAt: new Date(),
      };

      // --- Underpayment detection ---
      // Look up the fee schedule for this payer + CPT code to find expected reimbursement
      if (lineItem.cptCode && remittance.payerName) {
        try {
          const today = new Date().toISOString().split('T')[0];
          const feeScheduleEntries = await db
            .select()
            .from(feeSchedules)
            .where(
              and(
                eq(feeSchedules.practiceId, practiceId),
                eq(feeSchedules.cptCode, lineItem.cptCode),
                ilike(feeSchedules.payerName, `%${remittance.payerName}%`),
                lte(feeSchedules.effectiveDate, today),
              )
            )
            .orderBy(desc(feeSchedules.effectiveDate))
            .limit(1);

          if (feeScheduleEntries.length > 0) {
            const feeEntry = feeScheduleEntries[0];
            const expectedReimbursement = parseFloat(String(feeEntry.expectedReimbursement));

            // Flag as underpayment if paid amount is more than $5 below expected
            if (expectedReimbursement > 0 && paidAmt < expectedReimbursement - 5) {
              // Set expectedAmount on the claim for tracking
              claimUpdate.expectedAmount = String(expectedReimbursement);

              logger.info('Underpayment detected during ERA auto-match', {
                claimId: bestMatch.claimId,
                cptCode: lineItem.cptCode,
                payerName: remittance.payerName,
                expectedReimbursement,
                paidAmount: paidAmt,
                underpaymentAmount: expectedReimbursement - paidAmt,
              });

              // Surface the underpayment in the billing work queue.
              const matchedClaim = practiceClaims.find(
                (c: any) => c.claimId === bestMatch!.claimId,
              );
              await ensureUnderpaymentFollowUp({
                claimId: bestMatch.claimId,
                practiceId,
                claimNumber: matchedClaim?.claimNumber,
                expectedAmount: expectedReimbursement,
                paidAmount: paidAmt,
                cptCode: lineItem.cptCode,
                payerName: remittance.payerName,
              });
            }
          }
        } catch (feeErr) {
          // Non-blocking — don't fail the match if fee schedule lookup fails
          logger.error('Fee schedule lookup failed during underpayment detection', {
            error: feeErr instanceof Error ? feeErr.message : String(feeErr),
            cptCode: lineItem.cptCode,
            payerName: remittance.payerName,
          });
        }
      }

      await db
        .update(claims)
        .set(claimUpdate)
        .where(eq(claims.id, bestMatch.claimId));

      // The payment posting is the record the whole money path reads from
      // (A/R, patient statements, and the 6%-of-collections basis). Until
      // this call existed, ERA matching updated the claim and wrote no
      // posting at all, so collections read as $0 forever.
      try {
        await postPayment(practiceId, {
          // Authoritative: supersedes any 277-derived posting on this claim.
          source: 'era',
          claimId: bestMatch.claimId,
          payerName: remittance.payerName,
          checkNumber: remittance.checkNumber ?? null,
          paymentDate: remittance.checkDate ?? remittance.receivedDate,
          paymentAmount: String(paidAmt.toFixed(2)),
          adjustmentAmount: String(parseFloat(String(lineItem.adjustmentAmount || '0')).toFixed(2)),
          // Only the PR group is billable to the patient. Statements read
          // this; deriving a balance from charge - paid instead would bill
          // them the contractual write-off (balance billing).
          patientResponsibility: String(
            parseFloat(String((lineItem as any).patientResponsibility ?? '0')).toFixed(2),
          ),
          allowedAmount: lineItem.allowedAmount != null ? String(lineItem.allowedAmount) : null,
          postedBy,
        } as any);
      } catch (postError) {
        // A failed posting must be visible, not swallowed — the claim would
        // otherwise show matched with no money behind it.
        logger.error('ERA auto-match: failed to record payment posting', {
          claimId: bestMatch.claimId,
          remittanceId: remittance.id,
          error: postError instanceof Error ? postError.message : String(postError),
        });
        postingFailures.push({ claimId: bestMatch.claimId, lineItemId: lineItem.id });
      }

      matchedCount++;
      matchResults.push({ lineItemId: lineItem.id, claimId: bestMatch.claimId, matchType: bestMatch.matchType });
    } else {
      matchResults.push({ lineItemId: lineItem.id, claimId: null, matchType: 'no_match' });
    }
  }

  // Update remittance status
  const allItems = await db
    .select()
    .from(remittanceLineItems)
    .where(eq(remittanceLineItems.remittanceId, remittanceId));

  const allMatched = allItems.every((item: any) => item.status === 'matched');
  const someMatched = allItems.some((item: any) => item.status === 'matched');

  await db
    .update(remittanceAdvice)
    .set({
      status: allMatched ? 'processed' : someMatched ? 'pending' : 'pending',
      processedAt: allMatched ? new Date() : undefined,
    })
    .where(eq(remittanceAdvice.id, remittanceId));

  return { matched: matchedCount, total: unmatchedItems.length, results: matchResults, postingFailures };
}
