/**
 * Underpayment-review shared service.
 *
 * Single source of truth for "review underpayments" and "draft underpayment
 * dispute". Both the in-app Blanche dispatcher (server/routes/ai-assistant.ts)
 * and the MCP tools (server/mcp/tools/denials.ts) call these so the two
 * surfaces stay in lockstep.
 *
 * The dispute letter text generator lives here too (it was previously a
 * private helper inside ai-assistant.ts) so both surfaces emit identical
 * letters.
 */

import { db } from '../db';
import { eq, and, desc, ilike, lte, isNotNull } from 'drizzle-orm';
import { remittanceAdvice, remittanceLineItems, claims, feeSchedules } from '@shared/schema';
import { storage } from '../storage';
import { assessUnderpayment } from './underpaymentAnalyzer';

export interface UnderpaymentEntry {
  claimId: number;
  claimNumber: string | null;
  patientName: string;
  cptCode: string | null;
  payerName: string;
  serviceDate: string | null;
  billedAmount: number;
  expectedReimbursement: number | null;
  paidAmount: number;
  underpaymentAmount: number;
  adjustmentAnalysis: Array<{ code: string; description: string; amount: number; category: string; disputable: boolean; explanation: string }>;
  worthDisputing: boolean;
  recommendation: string;
}

export interface ReviewUnderpaymentsResult {
  totalLineItemsReviewed?: number;
  totalUnderpayments?: number;
  totalUnderpaidAmount?: string;
  totalWorthDisputing?: number;
  underpayments: UnderpaymentEntry[];
  message: string;
}

/**
 * Review matched ERA/835 remittance line items and flag underpayments,
 * comparing paid amounts to the contracted/expected reimbursement.
 */
export async function reviewUnderpayments(
  practiceId: number,
  daysBack = 90,
): Promise<ReviewUnderpaymentsResult> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const matchedLineItems = await db
    .select({
      lineItemId: remittanceLineItems.id,
      claimId: remittanceLineItems.claimId,
      cptCode: remittanceLineItems.cptCode,
      chargedAmount: remittanceLineItems.chargedAmount,
      allowedAmount: remittanceLineItems.allowedAmount,
      paidAmount: remittanceLineItems.paidAmount,
      adjustmentAmount: remittanceLineItems.adjustmentAmount,
      adjustmentReasonCodes: remittanceLineItems.adjustmentReasonCodes,
      patientName: remittanceLineItems.patientName,
      serviceDate: remittanceLineItems.serviceDate,
      payerName: remittanceAdvice.payerName,
      claimNumber: claims.claimNumber,
      claimTotalAmount: claims.totalAmount,
      claimExpectedAmount: claims.expectedAmount,
      claimStatus: claims.status,
      remittanceDate: remittanceAdvice.receivedDate,
    })
    .from(remittanceLineItems)
    .innerJoin(remittanceAdvice, eq(remittanceLineItems.remittanceId, remittanceAdvice.id))
    .innerJoin(claims, eq(remittanceLineItems.claimId, claims.id))
    .where(
      and(
        eq(remittanceAdvice.practiceId, practiceId),
        eq(remittanceLineItems.status, 'matched'),
        isNotNull(remittanceLineItems.claimId),
      ),
    )
    .orderBy(desc(remittanceAdvice.receivedDate))
    .limit(100);

  if (matchedLineItems.length === 0) {
    return {
      message: 'No matched remittance line items found. Upload and auto-match ERA/835 files first to enable underpayment detection.',
      underpayments: [],
      totalUnderpayments: 0,
      totalUnderpaidAmount: '$0.00',
    };
  }

  const underpayments: UnderpaymentEntry[] = [];
  let totalUnderpaidAmount = 0;
  let totalWorthDisputing = 0;

  for (const li of matchedLineItems) {
    const paidAmt = parseFloat(String(li.paidAmount || '0'));
    const billedAmt = parseFloat(String(li.chargedAmount || '0'));

    let expectedReimbursement: number | null = null;
    if (li.claimExpectedAmount) {
      expectedReimbursement = parseFloat(String(li.claimExpectedAmount));
    }

    if (expectedReimbursement === null && li.cptCode && li.payerName) {
      try {
        const today = new Date().toISOString().split('T')[0];
        const feeEntries = await db
          .select()
          .from(feeSchedules)
          .where(
            and(
              eq(feeSchedules.practiceId, practiceId),
              eq(feeSchedules.cptCode, li.cptCode),
              ilike(feeSchedules.payerName, `%${li.payerName}%`),
              lte(feeSchedules.effectiveDate, today),
            ),
          )
          .orderBy(desc(feeSchedules.effectiveDate))
          .limit(1);
        if (feeEntries.length > 0) {
          expectedReimbursement = parseFloat(String(feeEntries[0].expectedReimbursement));
        }
      } catch {
        // Non-blocking
      }
    }

    const adjustmentCodes = Array.isArray(li.adjustmentReasonCodes)
      ? (li.adjustmentReasonCodes as Array<{ code: string; description?: string; amount?: number }>)
      : [];
    const totalAdjustmentAmount = parseFloat(String(li.adjustmentAmount || '0'));
    const adjustmentsWithAmounts = adjustmentCodes.map((adj) => {
      const adjAmount = typeof adj.amount === 'number' ? adj.amount : (
        adjustmentCodes.length > 0 ? totalAdjustmentAmount / adjustmentCodes.length : 0
      );
      return { code: adj.code || '', amount: adjAmount };
    });

    const assessment = assessUnderpayment({
      adjustments: adjustmentsWithAmounts,
      billedAmount: billedAmt,
      paidAmount: paidAmt,
      expectedReimbursement,
      claimId: li.claimId || undefined,
      cptCode: li.cptCode || undefined,
    });

    if (assessment.isUnderpaid) {
      totalUnderpaidAmount += assessment.underpaymentAmount;
      if (assessment.worthDisputing) totalWorthDisputing++;

      underpayments.push({
        claimId: li.claimId!,
        claimNumber: li.claimNumber,
        patientName: li.patientName,
        cptCode: li.cptCode,
        payerName: li.payerName,
        serviceDate: li.serviceDate,
        billedAmount: billedAmt,
        expectedReimbursement,
        paidAmount: paidAmt,
        underpaymentAmount: assessment.underpaymentAmount,
        adjustmentAnalysis: assessment.adjustmentAnalyses.map((a) => ({
          code: a.code,
          description: a.description,
          amount: a.amount,
          category: a.category,
          disputable: a.disputable,
          explanation: a.explanation,
        })),
        worthDisputing: assessment.worthDisputing,
        recommendation: assessment.recommendation,
      });
    }
  }

  return {
    totalLineItemsReviewed: matchedLineItems.length,
    totalUnderpayments: underpayments.length,
    totalUnderpaidAmount: `$${totalUnderpaidAmount.toFixed(2)}`,
    totalWorthDisputing,
    underpayments: underpayments.slice(0, 20),
    message: underpayments.length > 0
      ? `Found ${underpayments.length} underpaid claim(s) totaling $${totalUnderpaidAmount.toFixed(2)}. ${totalWorthDisputing} appear(s) worth disputing. I can draft dispute letters for any of them.`
      : 'No underpayments detected in matched remittance data. All payments appear to be in line with expected reimbursement rates.',
  };
}

export interface DraftUnderpaymentDisputeResult extends Record<string, unknown> {
  disputeLetter: string;
  recommendedActions: string[];
  message: string;
}

/**
 * Draft an underpayment dispute letter for a specific claim, using its matched
 * ERA/835 remittance data and the practice's fee schedule. Tenant-scoped:
 * throws if the claim is missing or belongs to another practice.
 */
export async function draftUnderpaymentDispute(
  practiceId: number,
  claimId: number,
): Promise<DraftUnderpaymentDisputeResult> {
  const disputeClaim = await storage.getClaim(claimId);
  if (!disputeClaim) throw new Error(`Claim ${claimId} not found.`);
  if ((disputeClaim as any).practiceId !== practiceId) {
    throw new Error('Claim does not belong to this practice.');
  }

  let disputePatient = {
    firstName: 'Unknown',
    lastName: 'Patient',
    dateOfBirth: null as string | null,
    insuranceProvider: null as string | null,
    insuranceId: null as string | null,
  };
  if ((disputeClaim as any).patientId) {
    const pat = await storage.getPatient((disputeClaim as any).patientId);
    if (pat) {
      disputePatient = {
        firstName: pat.firstName,
        lastName: pat.lastName,
        dateOfBirth: pat.dateOfBirth,
        insuranceProvider: pat.insuranceProvider,
        insuranceId: pat.insuranceId || pat.policyNumber || null,
      };
    }
  }

  const disputePractice = await storage.getPractice(practiceId);

  const matchedRemitItems = await db
    .select({
      lineItemId: remittanceLineItems.id,
      cptCode: remittanceLineItems.cptCode,
      chargedAmount: remittanceLineItems.chargedAmount,
      allowedAmount: remittanceLineItems.allowedAmount,
      paidAmount: remittanceLineItems.paidAmount,
      adjustmentAmount: remittanceLineItems.adjustmentAmount,
      adjustmentReasonCodes: remittanceLineItems.adjustmentReasonCodes,
      remarkCodes: remittanceLineItems.remarkCodes,
      serviceDate: remittanceLineItems.serviceDate,
      payerName: remittanceAdvice.payerName,
      payerId: remittanceAdvice.payerId,
      checkNumber: remittanceAdvice.checkNumber,
      checkDate: remittanceAdvice.checkDate,
    })
    .from(remittanceLineItems)
    .innerJoin(remittanceAdvice, eq(remittanceLineItems.remittanceId, remittanceAdvice.id))
    .where(eq(remittanceLineItems.claimId, claimId));

  if (matchedRemitItems.length === 0) {
    throw new Error('No remittance/ERA data found for this claim. Upload and match an ERA file first, then try again.');
  }

  const remitItem = matchedRemitItems[0];
  const paidAmt = parseFloat(String(remitItem.paidAmount || '0'));
  const billedAmt = parseFloat(String(remitItem.chargedAmount || '0'));
  const payerName = remitItem.payerName || disputePatient.insuranceProvider || 'Insurance Company';

  let expectedReimbursement: number | null = null;
  let feeScheduleSource = '';

  if ((disputeClaim as any).expectedAmount) {
    expectedReimbursement = parseFloat(String((disputeClaim as any).expectedAmount));
    feeScheduleSource = 'claim expected amount';
  }

  if (expectedReimbursement === null && remitItem.cptCode) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const feeEntries = await db
        .select()
        .from(feeSchedules)
        .where(
          and(
            eq(feeSchedules.practiceId, practiceId),
            eq(feeSchedules.cptCode, remitItem.cptCode),
            ilike(feeSchedules.payerName, `%${payerName}%`),
            lte(feeSchedules.effectiveDate, today),
          ),
        )
        .orderBy(desc(feeSchedules.effectiveDate))
        .limit(1);
      if (feeEntries.length > 0) {
        expectedReimbursement = parseFloat(String(feeEntries[0].expectedReimbursement));
        feeScheduleSource = `fee schedule (effective ${feeEntries[0].effectiveDate})`;
      }
    } catch {
      // Non-blocking
    }
  }

  const adjustmentCodes = Array.isArray(remitItem.adjustmentReasonCodes)
    ? (remitItem.adjustmentReasonCodes as Array<{ code: string; description?: string; amount?: number }>)
    : [];
  const totalAdjustmentAmount = parseFloat(String(remitItem.adjustmentAmount || '0'));
  const adjustmentsWithAmounts = adjustmentCodes.map((adj) => {
    const adjAmount = typeof adj.amount === 'number' ? adj.amount : (
      adjustmentCodes.length > 0 ? totalAdjustmentAmount / adjustmentCodes.length : 0
    );
    return { code: adj.code || '', amount: adjAmount };
  });

  const assessment = assessUnderpayment({
    adjustments: adjustmentsWithAmounts,
    billedAmount: billedAmt,
    paidAmount: paidAmt,
    expectedReimbursement,
    claimId,
    cptCode: remitItem.cptCode || undefined,
  });

  const underpaymentAmount = expectedReimbursement ? (expectedReimbursement - paidAmt) : (billedAmt - paidAmt);

  const disputeContext = {
    claimId: (disputeClaim as any).id,
    claimNumber: (disputeClaim as any).claimNumber,
    patientName: `${disputePatient.firstName} ${disputePatient.lastName}`,
    patientDOB: disputePatient.dateOfBirth,
    memberId: disputePatient.insuranceId,
    payerName,
    payerId: remitItem.payerId,
    checkNumber: remitItem.checkNumber,
    checkDate: remitItem.checkDate,
    serviceDate: remitItem.serviceDate,
    cptCode: remitItem.cptCode,
    billedAmount: `$${billedAmt.toFixed(2)}`,
    allowedAmount: remitItem.allowedAmount ? `$${parseFloat(String(remitItem.allowedAmount)).toFixed(2)}` : null,
    paidAmount: `$${paidAmt.toFixed(2)}`,
    expectedReimbursement: expectedReimbursement ? `$${expectedReimbursement.toFixed(2)}` : 'Not available — no fee schedule entry found',
    feeScheduleSource,
    underpaymentAmount: `$${underpaymentAmount.toFixed(2)}`,
    adjustmentAnalysis: assessment.adjustmentAnalyses.map((a) => ({
      code: a.code,
      description: a.description,
      amount: `$${a.amount.toFixed(2)}`,
      category: a.category,
      disputable: a.disputable,
      explanation: a.explanation,
      recommendedAction: a.recommendedAction,
    })),
    patientResponsibilityTotal: `$${assessment.patientResponsibilityTotal.toFixed(2)}`,
    contractualAdjustmentTotal: `$${assessment.contractualAdjustmentTotal.toFixed(2)}`,
    payerInitiatedTotal: `$${assessment.payerInitiatedTotal.toFixed(2)}`,
    worthDisputing: assessment.worthDisputing,
    practiceName: disputePractice?.name || 'Practice',
    practiceNPI: disputePractice?.npi || null,
    practiceAddress: disputePractice?.address || null,
    practicePhone: disputePractice?.phone || null,
  };

  const disputeLetter = generateDisputeLetterText(disputeContext);

  return {
    ...disputeContext,
    disputeLetter,
    recommendedActions: [
      assessment.worthDisputing ? 'Submit this dispute letter to the payer via their provider dispute process' : 'This may not be worth disputing — the adjustments appear standard',
      'Keep a copy of the dispute letter and all supporting documentation',
      'Follow up with the payer in 30 days if no response received',
      expectedReimbursement ? 'Reference the contracted rate from your fee schedule as evidence' : 'Consider adding fee schedule entries for this payer/CPT combination to enable better tracking',
    ],
    message: assessment.worthDisputing
      ? 'Dispute letter drafted. Review and customize before sending to the payer. The letter references your contracted rate and identifies the specific adjustment codes that appear incorrect.'
      : 'I\'ve drafted a dispute letter, but note that the adjustments on this claim may be standard contractual adjustments. Review the analysis carefully before deciding to dispute.',
  };
}

/**
 * Render the plain-text underpayment dispute letter. Moved here from
 * ai-assistant.ts so the in-app and MCP surfaces emit identical letters.
 */
export function generateDisputeLetterText(context: {
  claimNumber: string | null;
  patientName: string;
  patientDOB: string | null;
  memberId: string | null;
  payerName: string;
  serviceDate: string | null;
  cptCode: string | null;
  billedAmount: string;
  paidAmount: string;
  expectedReimbursement: string;
  underpaymentAmount: string;
  adjustmentAnalysis: Array<{ code: string; description: string; amount: string; disputable: boolean; explanation: string }>;
  practiceName: string;
  practiceNPI: string | null;
  practiceAddress: string | null;
  practicePhone: string | null;
}): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const disputableAdj = context.adjustmentAnalysis.filter((a) => a.disputable);
  const adjSection = disputableAdj.length > 0
    ? disputableAdj.map((a) =>
        `  - Adjustment ${a.code} (${a.description}): ${a.amount} — ${a.explanation}`,
      ).join('\n')
    : '  - No specific disputable adjustment codes identified, but the total payment is below the contracted rate.';

  return `${today}

${context.payerName}
Provider Dispute Department

RE: Underpayment Dispute
Claim Number: ${context.claimNumber || 'N/A'}
Patient: ${context.patientName}
Date of Birth: ${context.patientDOB || 'On file'}
Member ID: ${context.memberId || 'On file'}
Date of Service: ${context.serviceDate || 'See claim'}
CPT Code: ${context.cptCode || 'See claim'}

Dear Claims Department,

I am writing to dispute the reimbursement amount for the above-referenced claim. Our records indicate that the payment received does not reflect the contracted reimbursement rate for this service.

PAYMENT DETAILS:
- Billed Amount: ${context.billedAmount}
- Expected Reimbursement (Contracted Rate): ${context.expectedReimbursement}
- Amount Paid: ${context.paidAmount}
- Underpayment Amount: ${context.underpaymentAmount}

ADJUSTMENT CODES IN QUESTION:
${adjSection}

Based on our provider agreement, the expected reimbursement for CPT code ${context.cptCode || '[code]'} is ${context.expectedReimbursement}. The payment of ${context.paidAmount} represents an underpayment of ${context.underpaymentAmount} below the contracted rate.

We respectfully request that this claim be reprocessed at the correct contracted rate. Please review the applicable fee schedule and provider agreement on file for verification.

If there has been a change to the fee schedule or contracted rates, please provide written notification of the effective date and updated rates as required under our provider agreement.

Please process this dispute within 30 business days per applicable state prompt-payment regulations. If you require additional information, please contact our office.

Sincerely,

${context.practiceName}
NPI: ${context.practiceNPI || '[NPI]'}
${context.practiceAddress || '[Address]'}
${context.practicePhone || '[Phone]'}`;
}
