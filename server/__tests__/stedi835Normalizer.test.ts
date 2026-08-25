/**
 * Mapping Stedi's 835 JSON into the internal remittance shape.
 *
 * The single most consequential thing here is keeping CAS groups apart. CO is
 * the contractual write-off and is NEVER billable to the patient; PR is what
 * the patient actually owes. Patient statements bill from patientResponsibility,
 * so folding CO into it bills the patient the practice's own write-off — the
 * balance-billing bug fixed in patientStatementService, re-entering through the
 * parser instead.
 *
 * Everything is also defensive by design: a shape mismatch must yield an
 * obviously empty remittance, never a confident-looking one with wrong money.
 */
import { describe, it, expect } from 'vitest';
import { normalizeStedi835 } from '../services/stedi835Normalizer';

/** Shaped after Stedi's documented Change-compatible 835 report JSON. */
const REPORT = {
  meta: { transactionId: 'txn-1' },
  transactions: [
    {
      financialInformation: {
        totalActualProviderPaymentAmount: 160,
        checkOrEFTTraceNumber: 'CHK-9001',
        checkIssueOrEFTEffectiveDate: '20260820',
      },
      detailInfo: [
        {
          paymentInfo: [
            {
              correctedPriorityPayer: {
                organizationName: 'Horizon Blue Cross Blue Shield of New Jersey',
                payorId: '22099',
              },
              patientName: { firstName: 'Eliyahu', lastName: 'Stein', memberId: 'M12345' },
              claimPaymentInfo: {
                patientControlNumber: 'CLM-1001',
                totalClaimChargeAmount: 250,
                claimPaymentAmount: 160,
                claimStatementPeriodStart: '20260812',
              },
              serviceLines: [
                {
                  serviceDate: '20260812',
                  servicePaymentInformation: {
                    adjudicatedProcedureCode: '97153',
                    lineItemChargeAmount: 250,
                    lineItemProviderPaymentAmount: 160,
                    allowedAmount: 200,
                  },
                  serviceAdjustments: [
                    {
                      claimAdjustmentGroupCode: 'CO',
                      adjustmentReasonCode1: '45',
                      adjustmentAmount1: 50,
                    },
                    {
                      claimAdjustmentGroupCode: 'PR',
                      adjustmentReasonCode1: '2',
                      adjustmentAmount1: 40,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('normalizeStedi835', () => {
  it('pulls payer, check and total off the envelope', () => {
    const r = normalizeStedi835(REPORT);

    expect(r.payerName).toBe('Horizon Blue Cross Blue Shield of New Jersey');
    expect(r.payerId).toBe('22099');
    expect(r.checkNumber).toBe('CHK-9001');
    expect(r.checkDate).toBe('2026-08-20'); // CCYYMMDD -> ISO
    expect(r.totalPaymentAmount).toBe(160);
  });

  it('keeps CO (write-off) out of patient responsibility', () => {
    const [line] = normalizeStedi835(REPORT).lineItems;

    // $40 PR is the patient's. The $50 CO is the practice's write-off and must
    // never reach a statement.
    expect(line.patientResponsibility).toBe(40);
    expect(line.contractualAdjustment).toBe(50);
  });

  it('maps the service line money and code', () => {
    const [line] = normalizeStedi835(REPORT).lineItems;

    expect(line.cptCode).toBe('97153');
    expect(line.chargedAmount).toBe(250);
    expect(line.paidAmount).toBe(160);
    expect(line.allowedAmount).toBe(200);
    expect(line.serviceDate).toBe('2026-08-12');
    expect(line.patientName).toBe('Eliyahu Stein');
    expect(line.memberId).toBe('M12345');
    expect(line.adjustmentReasonCodes).toEqual(['45', '2']);
  });

  it('sums the numbered CAS pairs rather than reading only the first', () => {
    const multi = structuredClone(REPORT) as any;
    multi.transactions[0].detailInfo[0].paymentInfo[0].serviceLines[0].serviceAdjustments = [
      {
        claimAdjustmentGroupCode: 'PR',
        adjustmentReasonCode1: '1',
        adjustmentAmount1: 10,
        adjustmentReasonCode2: '2',
        adjustmentAmount2: 15,
      },
    ];

    const [line] = normalizeStedi835(multi).lineItems;
    // X12 packs up to six reason/amount pairs into one CAS. Reading only the
    // first silently understates what the patient owes.
    expect(line.patientResponsibility).toBe(25);
  });

  it('still records a claim-level payment that has no service lines', () => {
    const claimOnly = structuredClone(REPORT) as any;
    claimOnly.transactions[0].detailInfo[0].paymentInfo[0].serviceLines = [];

    const r = normalizeStedi835(claimOnly);

    // Dropping it would leave the remittance total unreconcilable against its
    // own line items.
    expect(r.lineItems).toHaveLength(1);
    expect(r.lineItems[0].paidAmount).toBe(160);
  });

  it('returns an empty remittance for an unrecognised shape instead of inventing one', () => {
    for (const junk of [null, {}, { transactions: 'nope' }, { foo: 'bar' }]) {
      const r = normalizeStedi835(junk as any);
      expect(r.lineItems).toEqual([]);
      expect(r.totalPaymentAmount).toBe(0);
      expect(r.payerName).toBe('Unknown Payer');
    }
  });

  it('falls back to the sum of lines when the envelope carries no total', () => {
    const noTotal = structuredClone(REPORT) as any;
    delete noTotal.transactions[0].financialInformation.totalActualProviderPaymentAmount;

    // Never report a total that cannot be accounted for line by line.
    expect(normalizeStedi835(noTotal).totalPaymentAmount).toBe(160);
  });
});
