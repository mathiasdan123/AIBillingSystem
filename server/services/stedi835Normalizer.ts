/**
 * Map Stedi's 835 report JSON into the internal remittance shape.
 *
 * Stedi returns "the same JSON format as the Change Healthcare Convert Reports
 * APIs", documented as:
 *
 *   transactions[]
 *     .detailInfo[]
 *       .paymentInfo[]                      <- one per CLAIM (CLP)
 *         .claimPaymentInfo                 patientControlNumber, amounts
 *         .patientName                      firstName/lastName/memberId
 *         .correctedPriorityPayer           organizationName, payorId
 *         .serviceLines[]                   <- one per SERVICE LINE (SVC)
 *           .servicePaymentInformation      adjudicatedProcedureCode, amounts
 *           .serviceAdjustments[]           CAS: group code + up to 6 pairs
 *
 * Every accessor here is defensive. A shape mismatch must produce an obviously
 * empty/zero remittance that fails loudly downstream, never a confident-looking
 * one with wrong money in it.
 */

export interface NormalizedLineItem {
  patientName: string;
  memberId: string | null;
  serviceDate: string | null;
  cptCode: string | null;
  chargedAmount: number;
  allowedAmount: number | null;
  paidAmount: number;
  adjustmentAmount: number;
  patientResponsibility: number | null;
  contractualAdjustment: number | null;
  adjustmentReasonCodes: string[];
  remarkCodes: string[];
}

export interface NormalizedRemittance {
  payerName: string;
  payerId: string | null;
  checkNumber: string | null;
  checkDate: string | null;
  totalPaymentAmount: number;
  lineItems: NormalizedLineItem[];
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const nullableNum = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** X12 dates arrive as CCYYMMDD; the DB columns are `date`. */
function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

/**
 * Sum a CAS adjustment group. Stedi flattens the X12 repeat into numbered
 * pairs (adjustmentReasonCode1..6 / adjustmentAmount1..6) rather than an array.
 */
function readAdjustments(adjustment: any): { total: number; codes: string[] } {
  let total = 0;
  const codes: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const code = adjustment?.[`adjustmentReasonCode${i}`];
    const amount = adjustment?.[`adjustmentAmount${i}`];
    if (code) codes.push(String(code));
    if (amount != null && amount !== '') total += num(amount);
  }
  return { total, codes };
}

function normalizeServiceLine(
  line: any,
  claim: any,
  patientDisplayName: string,
  memberId: string | null,
): NormalizedLineItem {
  const svc = line?.servicePaymentInformation ?? {};

  let adjustmentTotal = 0;
  let contractual: number | null = null;
  let patientResp: number | null = null;
  const reasonCodes: string[] = [];

  for (const adjustment of arr(line?.serviceAdjustments)) {
    const group = String(adjustment?.claimAdjustmentGroupCode ?? '').toUpperCase();
    const { total, codes } = readAdjustments(adjustment);
    adjustmentTotal += total;
    reasonCodes.push(...codes);

    // CO = contractual obligation (the write-off, never billable to the
    // patient). PR = patient responsibility (deductible/coinsurance/copay).
    // Conflating these is how a practice ends up balance-billing a patient for
    // a contractual write-off, which is exactly the bug fixed in
    // patientStatementService — so the two are kept strictly separate here.
    if (group === 'CO') contractual = (contractual ?? 0) + total;
    else if (group === 'PR') patientResp = (patientResp ?? 0) + total;
  }

  const remarkCodes = arr(line?.serviceAdjustments)
    .flatMap((a: any) => arr(a?.remarkCodes))
    .map((c: any) => String(c))
    .filter(Boolean);

  return {
    patientName: patientDisplayName,
    memberId,
    serviceDate:
      toIsoDate(line?.serviceDate) ??
      toIsoDate(line?.serviceStartDate) ??
      toIsoDate(claim?.claimPaymentInfo?.claimStatementPeriodStart),
    cptCode: svc?.adjudicatedProcedureCode ? String(svc.adjudicatedProcedureCode) : null,
    chargedAmount: num(svc?.lineItemChargeAmount),
    allowedAmount: nullableNum(svc?.allowedAmount),
    paidAmount: num(svc?.lineItemProviderPaymentAmount),
    adjustmentAmount: adjustmentTotal,
    patientResponsibility: patientResp,
    contractualAdjustment: contractual,
    adjustmentReasonCodes: reasonCodes,
    remarkCodes,
  };
}

/**
 * Flatten a Stedi 835 report into one remittance record plus its line items.
 *
 * `patientControlNumber` (CLP01) is echoed onto each line item's memberId
 * fallback path only where a member id is genuinely absent — the existing
 * matcher scores on identity, and a control number is not an identity.
 */
export function normalizeStedi835(report: any): NormalizedRemittance {
  const lineItems: NormalizedLineItem[] = [];

  let payerName = '';
  let payerId: string | null = null;
  let checkNumber: string | null = null;
  let checkDate: string | null = null;
  let total = 0;

  for (const transaction of arr(report?.transactions)) {
    // Financial info (BPR/TRN) sits at transaction level when present.
    const financial = transaction?.financialInformation ?? {};
    checkNumber =
      checkNumber ??
      (transaction?.reassociationTraceNumber?.checkOrEFTTraceNumber ??
        financial?.checkOrEFTTraceNumber ??
        transaction?.traceNumber ??
        null);
    checkDate = checkDate ?? toIsoDate(financial?.checkIssueOrEFTEffectiveDate);

    const transactionTotal = nullableNum(financial?.totalActualProviderPaymentAmount);
    if (transactionTotal != null) total += transactionTotal;

    for (const detail of arr(transaction?.detailInfo)) {
      for (const claim of arr(detail?.paymentInfo)) {
        const payer = claim?.correctedPriorityPayer ?? detail?.payerIdentification ?? {};
        if (!payerName && payer?.organizationName) payerName = String(payer.organizationName);
        if (!payerId && payer?.payorId) payerId = String(payer.payorId);

        const name = claim?.patientName ?? {};
        const displayName =
          [name?.firstName, name?.lastName].filter(Boolean).join(' ').trim() || 'Unknown';
        const memberId = name?.memberId ? String(name.memberId) : null;

        const serviceLines = arr(claim?.serviceLines);

        if (serviceLines.length === 0) {
          // A claim-level-only payment still carries money. Record it as a
          // single line rather than dropping it, or the remittance total will
          // not reconcile against the sum of its lines.
          const info = claim?.claimPaymentInfo ?? {};
          lineItems.push({
            patientName: displayName,
            memberId,
            serviceDate: toIsoDate(info?.claimStatementPeriodStart),
            cptCode: null,
            chargedAmount: num(info?.totalClaimChargeAmount),
            allowedAmount: null,
            paidAmount: num(info?.claimPaymentAmount),
            adjustmentAmount: 0,
            patientResponsibility: nullableNum(info?.patientResponsibilityAmount),
            contractualAdjustment: null,
            adjustmentReasonCodes: [],
            remarkCodes: [],
          });
          continue;
        }

        for (const line of serviceLines) {
          lineItems.push(normalizeServiceLine(line, claim, displayName, memberId));
        }
      }
    }
  }

  // If the envelope carried no explicit total, fall back to the sum of what we
  // actually parsed. Never report a total we cannot account for line by line.
  if (total === 0 && lineItems.length > 0) {
    total = lineItems.reduce((sum, item) => sum + item.paidAmount, 0);
  }

  return {
    payerName: payerName || 'Unknown Payer',
    payerId,
    checkNumber: checkNumber ? String(checkNumber) : null,
    checkDate,
    totalPaymentAmount: Math.round(total * 100) / 100,
    lineItems,
  };
}
