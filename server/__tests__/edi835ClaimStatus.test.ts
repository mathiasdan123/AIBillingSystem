/**
 * CLP02 (claim status) survives flattening and normalization (demo billing
 * test 2026-11-19, item 5). The parser read it and dropped it, so a denial
 * (4) stored as a remittance line was indistinguishable from a processed
 * claim.
 */
import { describe, it, expect } from 'vitest';
import { parse835, flattenToLineItems } from '../services/edi835Parser';
import { normalizeStedi835 } from '../services/stedi835Normalizer';

// Two claims: one processed (1) with a CO-45 write-off, one denied (4) with CO-197.
const DENIAL_835 = [
  'ISA*00*          *00*          *ZZ*AETNA          *ZZ*PRACTICE       *261118*1200*^*00501*000000001*0*T*:~',
  'GS*HP*AETNA*PRACTICE*20261118*1200*1*X*005010X221A1~',
  'ST*835*0001~',
  'BPR*I*160.00*C*ACH*CCP*01*999999992*DA*123456*1234567890**01*999999993*DA*654321*20261118~',
  'TRN*1*QA-SYN-1*1234567890~',
  'N1*PR*AETNA~',
  'N1*PE*DEMO PRACTICE*XX*1234567890~',
  'CLP*CLM-PAID*1*250.00*160.00*40.00*12*PAYER-A~',
  'NM1*QC*1*EXAMPLE*AVA****MI*W1~',
  'SVC*HC:97530*250.00*160.00**1~',
  'DTM*472*20261110~',
  'CAS*CO*45*50.00~',
  'CAS*PR*2*40.00~',
  'CLP*CLM-MWNVFA08-DIJSKH*4*100.00*0.00*0.00*12*PAYER-B~',
  'NM1*QC*1*EXAMPLE*ETHAN****MI*W2~',
  'SVC*HC:97140*100.00*0.00**1~',
  'DTM*472*20261117~',
  'CAS*CO*197*100.00~',
  'SE*18*0001~',
  'GE*1*1~',
  'IEA*1*000000001~',
].join('\n');

describe('flattenToLineItems carries CLP02', () => {
  it('a processed claim is 1, a denied claim is 4', () => {
    const parsed = parse835(DENIAL_835);
    expect(parsed.claims.map((c) => c.claimStatusCode)).toEqual(['1', '4']);

    const lines = flattenToLineItems(parsed);
    expect(lines).toHaveLength(2);

    const paid = lines.find((l) => l.claimReference === 'CLM-PAID')!;
    expect(paid.claimStatusCode).toBe('1');
    expect(paid.paidAmount).toBe(160);
    expect(paid.adjustmentReasonCodes.map((c) => c.code)).toEqual(['CO-45', 'PR-2']);

    const denied = lines.find((l) => l.claimReference === 'CLM-MWNVFA08-DIJSKH')!;
    expect(denied.claimStatusCode).toBe('4');
    expect(denied.paidAmount).toBe(0);
    expect(denied.chargedAmount).toBe(100);
    expect(denied.contractualAdjustment).toBe(100);
    expect(denied.adjustmentReasonCodes).toEqual([
      { code: 'CO-197', description: 'Contractual Obligations: Precertification/authorization/notification absent' },
    ]);
  });

  it('a claim with no service lines still carries its status', () => {
    const noSvc = DENIAL_835.replace('SVC*HC:97140*100.00*0.00**1~\nDTM*472*20261117~\n', '');
    const lines = flattenToLineItems(parse835(noSvc));
    const denied = lines.find((l) => l.claimReference === 'CLM-MWNVFA08-DIJSKH')!;
    expect(denied.cptCode).toBeNull();
    expect(denied.claimStatusCode).toBe('4');
  });
});

describe('normalizeStedi835 carries CLP02', () => {
  const report = (claimStatusCode: unknown, withLines = true) => ({
    transactions: [
      {
        financialInformation: { totalActualProviderPaymentAmount: 0 },
        detailInfo: [
          {
            paymentInfo: [
              {
                patientName: { firstName: 'Ethan', lastName: 'Example', memberId: 'W2' },
                claimPaymentInfo: {
                  patientControlNumber: 'CLM-MWNVFA08-DIJSKH',
                  claimStatusCode,
                  totalClaimChargeAmount: 100,
                  claimPaymentAmount: 0,
                  claimStatementPeriodStart: '20261117',
                },
                serviceLines: withLines
                  ? [
                      {
                        serviceDate: '20261117',
                        servicePaymentInformation: { adjudicatedProcedureCode: '97140', lineItemChargeAmount: 100, lineItemProviderPaymentAmount: 0 },
                        serviceAdjustments: [{ claimAdjustmentGroupCode: 'CO', adjustmentReasonCode1: '197', adjustmentAmount1: 100 }],
                      },
                    ]
                  : [],
              },
            ],
          },
        ],
      },
    ],
  });

  it('on a service line', () => {
    const r = normalizeStedi835(report('4'));
    expect(r.lineItems[0].claimStatusCode).toBe('4');
    expect(r.lineItems[0].adjustmentReasonCodes).toEqual(['197']);
  });

  it('on a claim-level-only line, and as a string when Stedi sends a number', () => {
    expect(normalizeStedi835(report(4, false)).lineItems[0].claimStatusCode).toBe('4');
  });

  it('null when absent', () => {
    expect(normalizeStedi835(report(undefined)).lineItems[0].claimStatusCode).toBeNull();
    expect(normalizeStedi835(report('')).lineItems[0].claimStatusCode).toBeNull();
  });
});
