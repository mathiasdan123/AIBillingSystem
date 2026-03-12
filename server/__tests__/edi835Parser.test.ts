import { describe, it, expect } from 'vitest';
import {
  parse835,
  flattenToLineItems,
  getAdjustmentGroupDescription,
  getReasonCodeDescription,
} from '../services/edi835Parser';
import type { Parsed835, Parsed835Claim } from '../services/edi835Parser';

// Minimal valid 835 with standard segment terminator ~
// ISA is exactly 106 chars before segment terminator (element sep *, sub-element sep :, segment term ~)
const SAMPLE_835 = [
  'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *230101*1200*^*00501*000000001*0*P*:~',
  'GS*HP*SENDER*RECEIVER*20230101*1200*1*X*005010X221A1~',
  'ST*835*0001~',
  'BPR*I*1500.00*C*ACH*CCP*01*999999999*DA*1234567890**01*999888777*DA*9876543210*20230115~',
  'TRN*1*TRACE123*1234567890~',
  'DTM*405*20230115~',
  'N1*PR*ACME INSURANCE*XV*12345~',
  'N1*PE*THERAPY CLINIC*XX*9876543210~',
  'CLP*CLM-001*1*500.00*450.00*30.00*12*PAYER-CTRL-001~',
  'NM1*QC*1*DOE*JANE****MI*MEM001~',
  'SVC*HC:97530:GO*250.00*225.00**2~',
  'DTM*472*20230105~',
  'CAS*CO*45*25.00~',
  'AMT*B6*225.00~',
  'SVC*HC:97110*250.00*225.00**2~',
  'DTM*472*20230105~',
  'CAS*PR*1*20.00*1~',
  'CLP*CLM-002*1*300.00*250.00*20.00*12~',
  'NM1*IL*1*SMITH*JOHN****MI*MEM002~',
  'SVC*HC:97535*300.00*250.00**3~',
  'CAS*CO*45*30.00~',
  'CAS*PR*2*20.00~',
  'SE*20*0001~',
  'GE*1*1~',
  'IEA*1*000000001~',
].join('\n');

describe('edi835Parser', () => {
  // ---- ISA parsing ----

  it('should parse ISA interchange envelope', () => {
    const result = parse835(SAMPLE_835);
    expect(result.interchange.senderId).toBe('SENDER');
    expect(result.interchange.receiverId).toBe('RECEIVER');
    expect(result.interchange.controlNumber).toBe('000000001');
  });

  // ---- GS parsing ----

  it('should parse GS functional group', () => {
    const result = parse835(SAMPLE_835);
    expect(result.functionalGroup.senderId).toBe('SENDER');
    expect(result.functionalGroup.receiverId).toBe('RECEIVER');
    expect(result.functionalGroup.controlNumber).toBe('1');
  });

  // ---- BPR parsing ----

  it('should parse BPR payment information', () => {
    const result = parse835(SAMPLE_835);
    expect(result.payment.transactionType).toBe('I');
    expect(result.payment.totalAmount).toBe(1500.00);
    expect(result.payment.paymentMethod).toBe('ACH');
  });

  // ---- TRN parsing ----

  it('should parse TRN trace number', () => {
    const result = parse835(SAMPLE_835);
    expect(result.traceNumber).toBe('TRACE123');
  });

  // ---- N1 parsing ----

  it('should parse payer name from N1*PR segment', () => {
    const result = parse835(SAMPLE_835);
    expect(result.payment.payerName).toBe('ACME INSURANCE');
    expect(result.payment.payerId).toBe('12345');
  });

  it('should parse payee name from N1*PE segment', () => {
    const result = parse835(SAMPLE_835);
    expect(result.payment.payeeName).toBe('THERAPY CLINIC');
    expect(result.payment.payeeId).toBe('9876543210');
  });

  // ---- CLP claim parsing ----

  it('should parse multiple CLP claims', () => {
    const result = parse835(SAMPLE_835);
    expect(result.claims.length).toBe(2);
  });

  it('should parse CLP claim details', () => {
    const result = parse835(SAMPLE_835);
    const claim1 = result.claims[0];
    expect(claim1.patientControlNumber).toBe('CLM-001');
    expect(claim1.claimStatusCode).toBe('1');
    expect(claim1.chargedAmount).toBe(500.00);
    expect(claim1.paidAmount).toBe(450.00);
    expect(claim1.patientResponsibility).toBe(30.00);
    expect(claim1.claimFilingIndicator).toBe('12');
    expect(claim1.payerClaimControlNumber).toBe('PAYER-CTRL-001');
  });

  // ---- NM1 patient name ----

  it('should parse patient name from NM1*QC', () => {
    const result = parse835(SAMPLE_835);
    expect(result.claims[0].patientName).toBe('JANE DOE');
    expect(result.claims[0].memberId).toBeUndefined(); // QC doesn't set memberId
  });

  it('should parse subscriber name and member ID from NM1*IL', () => {
    const result = parse835(SAMPLE_835);
    const claim2 = result.claims[1];
    expect(claim2.patientName).toBe('JOHN SMITH');
    expect(claim2.memberId).toBe('MEM002');
  });

  // ---- SVC service line parsing ----

  it('should parse SVC service lines with procedure codes', () => {
    const result = parse835(SAMPLE_835);
    const claim1 = result.claims[0];
    expect(claim1.serviceLines.length).toBe(2);

    expect(claim1.serviceLines[0].procedureCode).toBe('97530');
    expect(claim1.serviceLines[0].modifiers).toEqual(['GO']);
    expect(claim1.serviceLines[0].chargedAmount).toBe(250.00);
    expect(claim1.serviceLines[0].paidAmount).toBe(225.00);
    expect(claim1.serviceLines[0].units).toBe(2);
  });

  it('should parse SVC without modifiers', () => {
    const result = parse835(SAMPLE_835);
    const svc2 = result.claims[0].serviceLines[1];
    expect(svc2.procedureCode).toBe('97110');
    expect(svc2.modifiers).toEqual([]);
  });

  // ---- DTM date parsing ----

  it('should parse service date from DTM*472', () => {
    const result = parse835(SAMPLE_835);
    expect(result.claims[0].serviceLines[0].serviceDate).toBe('2023-01-05');
  });

  it('should parse check date from DTM*405', () => {
    const result = parse835(SAMPLE_835);
    expect(result.payment.checkDate).toBe('2023-01-15');
  });

  // ---- CAS adjustment parsing ----

  it('should parse CAS adjustments on service lines', () => {
    const result = parse835(SAMPLE_835);
    const svc1Adj = result.claims[0].serviceLines[0].adjustments;
    expect(svc1Adj.length).toBe(1);
    expect(svc1Adj[0].groupCode).toBe('CO');
    expect(svc1Adj[0].reasonCode).toBe('45');
    expect(svc1Adj[0].amount).toBe(25.00);
  });

  it('should parse CAS with quantity', () => {
    const result = parse835(SAMPLE_835);
    const svc2Adj = result.claims[0].serviceLines[1].adjustments;
    expect(svc2Adj.length).toBe(1);
    expect(svc2Adj[0].groupCode).toBe('PR');
    expect(svc2Adj[0].reasonCode).toBe('1');
    expect(svc2Adj[0].amount).toBe(20.00);
    expect(svc2Adj[0].quantity).toBe(1);
  });

  it('should parse multiple CAS segments on a single service line', () => {
    const result = parse835(SAMPLE_835);
    const claim2 = result.claims[1];
    // The SVC under CLM-002 has two CAS segments (CO*45 and PR*2)
    const adj = claim2.serviceLines[0].adjustments;
    expect(adj.length).toBe(2);
    expect(adj[0].groupCode).toBe('CO');
    expect(adj[1].groupCode).toBe('PR');
  });

  // ---- AMT parsing ----

  it('should parse AMT*B6 allowed amount', () => {
    const result = parse835(SAMPLE_835);
    expect(result.claims[0].serviceLines[0].allowedAmount).toBe(225.00);
  });

  // ---- Utility functions ----

  it('should return correct adjustment group descriptions', () => {
    expect(getAdjustmentGroupDescription('CO')).toBe('Contractual Obligations');
    expect(getAdjustmentGroupDescription('PR')).toBe('Patient Responsibility');
    expect(getAdjustmentGroupDescription('OA')).toBe('Other Adjustments');
    expect(getAdjustmentGroupDescription('XX')).toBe('XX'); // unknown code returns itself
  });

  it('should return correct reason code descriptions', () => {
    expect(getReasonCodeDescription('1')).toBe('Deductible amount');
    expect(getReasonCodeDescription('45')).toContain('fee schedule');
    expect(getReasonCodeDescription('9999')).toBe('Reason code 9999'); // unknown
  });

  // ---- flattenToLineItems ----

  it('should flatten parsed 835 into line items', () => {
    const result = parse835(SAMPLE_835);
    const items = flattenToLineItems(result);

    // 2 service lines in claim1 + 1 in claim2 = 3 items
    expect(items.length).toBe(3);

    expect(items[0].cptCode).toBe('97530');
    expect(items[0].patientName).toBe('JANE DOE');
    expect(items[0].paidAmount).toBe(225.00);
    expect(items[0].serviceDate).toBe('2023-01-05');
    expect(items[0].adjustmentReasonCodes.length).toBeGreaterThan(0);
  });

  it('should create claim-level line item when no service lines exist', () => {
    const parsed: Parsed835 = {
      interchange: { senderId: 'S', receiverId: 'R', date: '2023-01-01', controlNumber: '1' },
      functionalGroup: { senderId: 'S', receiverId: 'R', date: '2023-01-01', controlNumber: '1' },
      payment: { transactionType: 'I', totalAmount: 100, paymentMethod: 'CHK' },
      claims: [{
        patientControlNumber: 'CLM-X',
        claimStatusCode: '1',
        chargedAmount: 100,
        paidAmount: 80,
        patientResponsibility: 20,
        patientName: 'Test Patient',
        serviceLines: [],
        adjustments: [{ groupCode: 'CO', reasonCode: '45', amount: 20 }],
      }],
      rawSegments: [],
    };

    const items = flattenToLineItems(parsed);
    expect(items.length).toBe(1);
    expect(items[0].cptCode).toBeNull();
    expect(items[0].chargedAmount).toBe(100);
    expect(items[0].paidAmount).toBe(80);
    expect(items[0].adjustmentAmount).toBe(20);
    expect(items[0].remarkCodes).toEqual([]);
  });

  it('should use patientControlNumber as fallback when patientName is missing', () => {
    const parsed: Parsed835 = {
      interchange: { senderId: 'S', receiverId: 'R', date: '', controlNumber: '1' },
      functionalGroup: { senderId: 'S', receiverId: 'R', date: '', controlNumber: '1' },
      payment: { transactionType: 'I', totalAmount: 0, paymentMethod: 'CHK' },
      claims: [{
        patientControlNumber: 'CTRL-123',
        claimStatusCode: '1',
        chargedAmount: 50,
        paidAmount: 50,
        patientResponsibility: 0,
        serviceLines: [],
        adjustments: [],
      }],
      rawSegments: [],
    };

    const items = flattenToLineItems(parsed);
    expect(items[0].patientName).toBe('CTRL-123');
  });

  // ---- Malformed / edge-case input ----

  it('should handle empty input', () => {
    const result = parse835('');
    expect(result.claims.length).toBe(0);
    expect(result.payment.totalAmount).toBe(0);
  });

  it('should handle input with only ISA segment', () => {
    const isa = 'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *230101*1200*^*00501*000000001*0*P*:~';
    const result = parse835(isa);
    expect(result.interchange.senderId).toBe('SENDER');
    expect(result.claims.length).toBe(0);
  });

  it('should handle CLP without any SVC lines', () => {
    const edi = [
      'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *230101*1200*^*00501*000000001*0*P*:~',
      'GS*HP*S*R*20230101*1200*1*X*005010X221A1~',
      'ST*835*0001~',
      'BPR*I*100.00*C*CHK~',
      'CLP*CLM-NOSVC*1*100.00*80.00*20.00~',
      'SE*5*0001~',
      'GE*1*1~',
      'IEA*1*000000001~',
    ].join('\n');

    const result = parse835(edi);
    expect(result.claims.length).toBe(1);
    expect(result.claims[0].serviceLines.length).toBe(0);
    expect(result.claims[0].patientControlNumber).toBe('CLM-NOSVC');
  });

  it('should preserve raw segments for debugging', () => {
    const result = parse835(SAMPLE_835);
    expect(result.rawSegments.length).toBeGreaterThan(0);
    expect(result.rawSegments.some(s => s.startsWith('ISA'))).toBe(true);
  });

  it('should handle CRLF line endings', () => {
    const crlfEdi = SAMPLE_835.replace(/\n/g, '\r\n');
    const result = parse835(crlfEdi);
    expect(result.claims.length).toBe(2);
    expect(result.interchange.senderId).toBe('SENDER');
  });
});
