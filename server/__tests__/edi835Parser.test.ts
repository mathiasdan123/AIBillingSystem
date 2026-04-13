import { describe, it, expect } from 'vitest';
import {
  parse835,
  flattenToLineItems,
  getAdjustmentGroupDescription,
  getReasonCodeDescription,
} from '../services/edi835Parser';
import type { Parsed835, Parsed835Claim } from '../services/edi835Parser';

// ====================================================================================
// Sample 835 Data - Aetna format (standard ordering)
// ====================================================================================

const AETNA_835 = [
  'ISA*00*          *00*          *ZZ*AETNA          *ZZ*HEALINGHANDS   *260401*1200*^*00501*000000001*0*P*:~',
  'GS*HP*AETNA*HEALINGHANDS*20260401*1200*1*X*005010X221A1~',
  'ST*835*0001~',
  'BPR*I*1250.00*C*ACH*CTX*01*999999999*DA*123456789*1234567890**01*999999999*DA*987654321*20260401~',
  'TRN*1*123456789*1234567890~',
  'DTM*405*20260401~',
  'N1*PR*AETNA*XV*60054~',
  'N1*PE*HEALING HANDS OT*XX*1234567890~',
  'CLP*PAT001-20260315*1*200.00*150.00*25.00*12*AETNA123*11~',
  'NM1*QC*1*HARTWELL*MASON****MI*MEM123456~',
  'SVC*HC:97530*200.00*150.00**4~',
  'DTM*472*20260315~',
  'CAS*CO*45*25.00~',
  'CAS*PR*1*25.00~',
  'AMT*B6*175.00~',
  'LQ*HE*N130~',
  'CLP*PAT002-20260315*1*350.00*300.00*30.00*12*AETNA456~',
  'NM1*QC*1*CHEN*LILY****MI*MEM789012~',
  'SVC*HC:97110:GO*175.00*150.00**2~',
  'DTM*472*20260315~',
  'CAS*CO*45*15.00~',
  'CAS*PR*3*10.00~',
  'SVC*HC:97530*175.00*150.00**2~',
  'DTM*472*20260315~',
  'CAS*CO*45*5.00~',
  'CAS*PR*1*20.00~',
  'AMT*B6*150.00~',
  'SE*26*0001~',
  'GE*1*1~',
  'IEA*1*000000001~',
].join('\n');

// ====================================================================================
// Blue Cross format - different segment ordering (N1 after CLP in some implementations,
// and uses > as sub-element separator)
// ====================================================================================

const BCBS_835 = [
  'ISA*00*          *00*          *ZZ*BCBS           *ZZ*PRACTICEABC    *260315*0900*^*00501*000000099*0*P*>~',
  'GS*HP*BCBS*PRACTICEABC*20260315*0900*99*X*005010X221A1~',
  'ST*835*0099~',
  'BPR*I*875.50*C*CHK****CHK98765***01*031100209*DA*11223344*20260320~',
  'TRN*1*987654321*9999999999~',
  'DTM*405*20260320~',
  'N1*PR*BLUE CROSS BLUE SHIELD*XV*BCBS1~',
  'N1*PE*ABC THERAPY*XX*5555555555~',
  'CLP*BC-CLM-100*1*450.00*375.50*50.00*MC*BCBS-CTRL-100~',
  'NM1*QC*1*RODRIGUEZ*MARIA~',
  'NM1*IL*1*RODRIGUEZ*CARLOS****MI*BCBS-MEM-500~',
  'SVC*HC>90837*225.00*187.75**1~',
  'DTM*472*20260301~',
  'CAS*CO*45*37.25~',
  'SVC*HC>97110>GP*225.00*187.75**3~',
  'DTM*472*20260301~',
  'CAS*CO*45*12.25~',
  'CAS*PR*2*25.00~',
  'LQ*HE*MA04~',
  'LQ*HE*N362~',
  'CLP*BC-CLM-101*2*500.00*500.00*0.00*12*BCBS-CTRL-101~',
  'NM1*QC*1*PARK*SUJIN****MI*BCBS-MEM-501~',
  'SVC*HC>90834*250.00*250.00**1~',
  'DTM*472*20260308~',
  'SVC*HC>90837*250.00*250.00**1~',
  'DTM*472*20260308~',
  'SE*24*0099~',
  'GE*1*99~',
  'IEA*1*000000099~',
].join('\n');

// ====================================================================================
// Complex 835 with edge cases: PI adjustments, zero-dollar adjustments, negative
// adjustments (recoupments), multi-triplet CAS, missing NM1, remark codes
// ====================================================================================

const COMPLEX_835 = [
  'ISA*00*          *00*          *ZZ*UNITEDHC       *ZZ*MYPRACTICE     *260410*1430*^*00501*000000050*0*P*:~',
  'GS*HP*UNITEDHC*MYPRACTICE*20260410*1430*50*X*005010X221A1~',
  'ST*835*0050~',
  'BPR*I*0.00*C*NON~',
  'TRN*1*UHC-TRACE-050*9999999999~',
  'DTM*405*20260410~',
  'N1*PR*UNITED HEALTHCARE*XV*87726~',
  'N1*PE*MY PRACTICE LLC*XX*1112223333~',
  // Claim with PI (payer-initiated) adjustment and multi-triplet CAS
  'CLP*UHC-CLM-200*1*600.00*0.00*0.00*12*UHC-CTRL-200~',
  'NM1*QC*1*WILLIAMS*ALEX****MI*UHC-MEM-700~',
  'SVC*HC:97535*300.00*0.00**4~',
  'DTM*472*20260401~',
  'CAS*PI*97*300.00~',
  'SVC*HC:97530*300.00*0.00**4~',
  'DTM*472*20260401~',
  'CAS*CO*45*100.00*0*96*200.00~',
  // Claim with NO NM1 segment at all
  'CLP*UHC-CLM-201*22*150.00*0.00*0.00*12*UHC-CTRL-201~',
  'SVC*HC:90837*150.00*0.00**1~',
  'DTM*472*20260403~',
  'CAS*CO*109*150.00~',
  'LQ*HE*N657~',
  // Claim with zero-dollar adjustment and negative adjustment (recoupment)
  'CLP*UHC-CLM-202*1*400.00*350.00*25.00*12*UHC-CTRL-202~',
  'NM1*QC*1*JOHNSON*TAYLOR****MI*UHC-MEM-701~',
  'SVC*HC:97110*200.00*175.00**2~',
  'DTM*472*20260405~',
  'CAS*CO*45*0.00~',
  'CAS*PR*1*25.00~',
  'SVC*HC:97530*200.00*175.00**2~',
  'DTM*472*20260405~',
  'CAS*OA*23*25.00~',
  'CAS*CR*253*-10.00~',
  'AMT*B6*175.00~',
  'SE*30*0050~',
  'GE*1*50~',
  'IEA*1*000000050~',
].join('\n');

// ====================================================================================
// Compact 835 without line breaks (segments separated only by ~)
// ====================================================================================

const NO_NEWLINE_835 =
  'ISA*00*          *00*          *ZZ*CIGNA          *ZZ*THERAPIST      *260401*1200*^*00501*000000005*0*P*:~' +
  'GS*HP*CIGNA*THERAPIST*20260401*1200*5*X*005010X221A1~' +
  'ST*835*0005~' +
  'BPR*I*200.00*C*ACH~' +
  'TRN*1*CIG-TRACE*9999~' +
  'N1*PR*CIGNA*XV*62308~' +
  'CLP*CIG-001*1*200.00*200.00*0.00*12~' +
  'NM1*QC*1*KIM*DAVID****MI*CIG-MEM-100~' +
  'SVC*HC:90837*200.00*200.00**1~' +
  'DTM*472*20260320~' +
  'SE*9*0005~' +
  'GE*1*5~' +
  'IEA*1*000000005~';

// ====================================================================================
// Tests
// ====================================================================================

describe('edi835Parser', () => {
  // =============== ISA parsing ===============

  describe('ISA interchange envelope', () => {
    it('should parse sender and receiver IDs (trimming padding)', () => {
      const result = parse835(AETNA_835);
      expect(result.interchange.senderId).toBe('AETNA');
      expect(result.interchange.receiverId).toBe('HEALINGHANDS');
      expect(result.interchange.controlNumber).toBe('000000001');
    });

    it('should parse ISA from BCBS format', () => {
      const result = parse835(BCBS_835);
      expect(result.interchange.senderId).toBe('BCBS');
      expect(result.interchange.receiverId).toBe('PRACTICEABC');
      expect(result.interchange.controlNumber).toBe('000000099');
    });

    it('should handle input with only ISA segment', () => {
      const isa = 'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *230101*1200*^*00501*000000001*0*P*:~';
      const result = parse835(isa);
      expect(result.interchange.senderId).toBe('SENDER');
      expect(result.claims.length).toBe(0);
    });
  });

  // =============== GS parsing ===============

  describe('GS functional group', () => {
    it('should parse GS segment', () => {
      const result = parse835(AETNA_835);
      expect(result.functionalGroup.senderId).toBe('AETNA');
      expect(result.functionalGroup.receiverId).toBe('HEALINGHANDS');
      expect(result.functionalGroup.controlNumber).toBe('1');
    });
  });

  // =============== BPR payment parsing ===============

  describe('BPR payment information', () => {
    it('should parse ACH payment', () => {
      const result = parse835(AETNA_835);
      expect(result.payment.transactionType).toBe('I');
      expect(result.payment.totalAmount).toBe(1250.00);
      expect(result.payment.paymentMethod).toBe('ACH');
      expect(result.payment.checkDate).toBe('2026-04-01');
    });

    it('should parse CHK payment method', () => {
      const result = parse835(BCBS_835);
      expect(result.payment.totalAmount).toBe(875.50);
      expect(result.payment.paymentMethod).toBe('CHK');
    });

    it('should parse zero-dollar payment (denial/information only)', () => {
      const result = parse835(COMPLEX_835);
      expect(result.payment.totalAmount).toBe(0.00);
      expect(result.payment.paymentMethod).toBe('NON');
    });
  });

  // =============== TRN trace number ===============

  describe('TRN trace number', () => {
    it('should parse trace number', () => {
      const result = parse835(AETNA_835);
      expect(result.traceNumber).toBe('123456789');
    });

    it('should parse check number from TRN03 when BPR does not have one', () => {
      const result = parse835(AETNA_835);
      // TRN*1*123456789*1234567890 - element 3 is 1234567890
      expect(result.payment.checkNumber).toBeDefined();
    });
  });

  // =============== N1 payer/payee parsing ===============

  describe('N1 payer and payee', () => {
    it('should parse payer from N1*PR', () => {
      const result = parse835(AETNA_835);
      expect(result.payment.payerName).toBe('AETNA');
      expect(result.payment.payerId).toBe('60054');
    });

    it('should parse payee from N1*PE', () => {
      const result = parse835(AETNA_835);
      expect(result.payment.payeeName).toBe('HEALING HANDS OT');
      expect(result.payment.payeeId).toBe('1234567890');
    });

    it('should parse BCBS payer info', () => {
      const result = parse835(BCBS_835);
      expect(result.payment.payerName).toBe('BLUE CROSS BLUE SHIELD');
      expect(result.payment.payerId).toBe('BCBS1');
    });
  });

  // =============== DTM date parsing ===============

  describe('DTM date handling', () => {
    it('should parse check date from DTM*405', () => {
      const result = parse835(AETNA_835);
      expect(result.payment.checkDate).toBe('2026-04-01');
    });

    it('should parse service date from DTM*472', () => {
      const result = parse835(AETNA_835);
      expect(result.claims[0].serviceLines[0].serviceDate).toBe('2026-03-15');
    });
  });

  // =============== CLP claim parsing ===============

  describe('CLP claim parsing', () => {
    it('should parse multiple claims in one 835', () => {
      const result = parse835(AETNA_835);
      expect(result.claims.length).toBe(2);
    });

    it('should parse claim details correctly', () => {
      const result = parse835(AETNA_835);
      const claim1 = result.claims[0];
      expect(claim1.patientControlNumber).toBe('PAT001-20260315');
      expect(claim1.claimStatusCode).toBe('1');
      expect(claim1.chargedAmount).toBe(200.00);
      expect(claim1.paidAmount).toBe(150.00);
      expect(claim1.patientResponsibility).toBe(25.00);
      expect(claim1.claimFilingIndicator).toBe('12');
      expect(claim1.payerClaimControlNumber).toBe('AETNA123');
    });

    it('should handle CLP with 8 elements (facility type code)', () => {
      const result = parse835(AETNA_835);
      // CLP*PAT001-20260315*1*200.00*150.00*25.00*12*AETNA123*11
      // element 8 (index 7) is payerClaimControlNumber, element 9 (index 8) is facility type
      expect(result.claims[0].payerClaimControlNumber).toBe('AETNA123');
    });

    it('should parse three claims in complex 835', () => {
      const result = parse835(COMPLEX_835);
      expect(result.claims.length).toBe(3);
    });

    it('should parse CLP status code 22 (reversal/recoupment)', () => {
      const result = parse835(COMPLEX_835);
      const claim2 = result.claims[1];
      expect(claim2.claimStatusCode).toBe('22');
    });

    it('should parse secondary claim (CLP status 2)', () => {
      const result = parse835(BCBS_835);
      const claim2 = result.claims[1];
      expect(claim2.claimStatusCode).toBe('2');
      expect(claim2.paidAmount).toBe(500.00);
    });

    it('should handle CLP without payerClaimControlNumber', () => {
      const result = parse835(NO_NEWLINE_835);
      const claim = result.claims[0];
      expect(claim.payerClaimControlNumber).toBeUndefined();
    });
  });

  // =============== NM1 patient name parsing ===============

  describe('NM1 patient/subscriber parsing', () => {
    it('should parse patient name from NM1*QC', () => {
      const result = parse835(AETNA_835);
      expect(result.claims[0].patientName).toBe('MASON HARTWELL');
    });

    it('should parse memberId from NM1*QC (element 9)', () => {
      const result = parse835(AETNA_835);
      expect(result.claims[0].memberId).toBe('MEM123456');
    });

    it('should parse NM1*IL subscriber and use as patient name fallback', () => {
      const result = parse835(BCBS_835);
      // Claim 1 has both QC and IL - QC sets name first, IL should not overwrite
      const claim1 = result.claims[0];
      expect(claim1.patientName).toBe('MARIA RODRIGUEZ');
      // But memberId comes from IL
      expect(claim1.memberId).toBe('BCBS-MEM-500');
    });

    it('should handle claim with no NM1 segment', () => {
      const result = parse835(COMPLEX_835);
      // Claim index 1 (UHC-CLM-201) has no NM1
      const claim2 = result.claims[1];
      expect(claim2.patientName).toBeUndefined();
      expect(claim2.memberId).toBeUndefined();
    });

    it('should handle NM1*QC with no first name', () => {
      const edi = [
        'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260401*1200*^*00501*000000001*0*P*:~',
        'GS*HP*S*R*20260401*1200*1*X*005010X221A1~',
        'ST*835*0001~',
        'BPR*I*100.00*C*ACH~',
        'CLP*X*1*100.00*100.00*0.00~',
        'NM1*QC*1*ONLYNAME~',
        'SE*5*0001~',
        'GE*1*1~',
        'IEA*1*000000001~',
      ].join('\n');
      const result = parse835(edi);
      expect(result.claims[0].patientName).toBe('ONLYNAME');
    });
  });

  // =============== SVC service line parsing ===============

  describe('SVC service line parsing', () => {
    it('should parse procedure code from composite element', () => {
      const result = parse835(AETNA_835);
      expect(result.claims[0].serviceLines[0].procedureCode).toBe('97530');
    });

    it('should parse modifiers from composite element', () => {
      const result = parse835(AETNA_835);
      const svc = result.claims[1].serviceLines[0];
      expect(svc.procedureCode).toBe('97110');
      expect(svc.modifiers).toEqual(['GO']);
    });

    it('should parse SVC without modifiers', () => {
      const result = parse835(AETNA_835);
      const svc = result.claims[0].serviceLines[0];
      expect(svc.procedureCode).toBe('97530');
      expect(svc.modifiers).toEqual([]);
    });

    it('should parse charged and paid amounts', () => {
      const result = parse835(AETNA_835);
      const svc = result.claims[0].serviceLines[0];
      expect(svc.chargedAmount).toBe(200.00);
      expect(svc.paidAmount).toBe(150.00);
    });

    it('should parse units', () => {
      const result = parse835(AETNA_835);
      expect(result.claims[0].serviceLines[0].units).toBe(4);
    });

    it('should parse multiple service lines under one claim', () => {
      const result = parse835(AETNA_835);
      expect(result.claims[1].serviceLines.length).toBe(2);
    });

    it('should handle > as sub-element separator (BCBS format)', () => {
      const result = parse835(BCBS_835);
      const svc1 = result.claims[0].serviceLines[0];
      expect(svc1.procedureCode).toBe('90837');
      expect(svc1.modifiers).toEqual([]);

      const svc2 = result.claims[0].serviceLines[1];
      expect(svc2.procedureCode).toBe('97110');
      expect(svc2.modifiers).toEqual(['GP']);
    });

    it('should handle SVC with zero paid amount (denied service)', () => {
      const result = parse835(COMPLEX_835);
      const svc = result.claims[0].serviceLines[0];
      expect(svc.paidAmount).toBe(0.00);
      expect(svc.chargedAmount).toBe(300.00);
    });
  });

  // =============== CAS adjustment parsing ===============

  describe('CAS adjustment parsing', () => {
    it('should parse CO-45 contractual adjustment', () => {
      const result = parse835(AETNA_835);
      const adj = result.claims[0].serviceLines[0].adjustments;
      expect(adj.some(a => a.groupCode === 'CO' && a.reasonCode === '45')).toBe(true);
    });

    it('should parse PR-1 deductible adjustment', () => {
      const result = parse835(AETNA_835);
      const adj = result.claims[0].serviceLines[0].adjustments;
      expect(adj.some(a => a.groupCode === 'PR' && a.reasonCode === '1' && a.amount === 25.00)).toBe(true);
    });

    it('should parse PR-3 copayment adjustment', () => {
      const result = parse835(AETNA_835);
      const claim2svc1 = result.claims[1].serviceLines[0];
      expect(claim2svc1.adjustments.some(a => a.groupCode === 'PR' && a.reasonCode === '3' && a.amount === 10.00)).toBe(true);
    });

    it('should parse PI-97 payer-initiated adjustment', () => {
      const result = parse835(COMPLEX_835);
      const svc = result.claims[0].serviceLines[0];
      expect(svc.adjustments.length).toBe(1);
      expect(svc.adjustments[0].groupCode).toBe('PI');
      expect(svc.adjustments[0].reasonCode).toBe('97');
      expect(svc.adjustments[0].amount).toBe(300.00);
    });

    it('should parse multi-triplet CAS segment (CO*45*100*0*96*200)', () => {
      const result = parse835(COMPLEX_835);
      const svc = result.claims[0].serviceLines[1];
      expect(svc.adjustments.length).toBe(2);
      expect(svc.adjustments[0].groupCode).toBe('CO');
      expect(svc.adjustments[0].reasonCode).toBe('45');
      expect(svc.adjustments[0].amount).toBe(100.00);
      expect(svc.adjustments[0].quantity).toBe(0);
      expect(svc.adjustments[1].reasonCode).toBe('96');
      expect(svc.adjustments[1].amount).toBe(200.00);
    });

    it('should parse multiple CAS segments on same service line', () => {
      const result = parse835(AETNA_835);
      const svc = result.claims[0].serviceLines[0];
      // CO*45*25 and PR*1*25 are separate CAS segments
      expect(svc.adjustments.length).toBe(2);
    });

    it('should parse zero-dollar adjustment', () => {
      const result = parse835(COMPLEX_835);
      // UHC-CLM-202 first SVC has CAS*CO*45*0.00
      const claim3 = result.claims[2];
      const svc1Adj = claim3.serviceLines[0].adjustments;
      expect(svc1Adj.some(a => a.groupCode === 'CO' && a.reasonCode === '45' && a.amount === 0.00)).toBe(true);
    });

    it('should parse negative adjustment (recoupment)', () => {
      const result = parse835(COMPLEX_835);
      const claim3 = result.claims[2];
      const svc2Adj = claim3.serviceLines[1].adjustments;
      const recoup = svc2Adj.find(a => a.groupCode === 'CR' && a.reasonCode === '253');
      expect(recoup).toBeDefined();
      expect(recoup!.amount).toBe(-10.00);
    });

    it('should parse OA (Other Adjustment) group code', () => {
      const result = parse835(COMPLEX_835);
      const claim3 = result.claims[2];
      const svc2Adj = claim3.serviceLines[1].adjustments;
      expect(svc2Adj.some(a => a.groupCode === 'OA' && a.reasonCode === '23')).toBe(true);
    });

    it('should parse CO-109 (claim not covered)', () => {
      const result = parse835(COMPLEX_835);
      const claim2 = result.claims[1];
      expect(claim2.serviceLines[0].adjustments.some(a =>
        a.groupCode === 'CO' && a.reasonCode === '109' && a.amount === 150.00
      )).toBe(true);
    });
  });

  // =============== AMT parsing ===============

  describe('AMT allowed amount', () => {
    it('should parse AMT*B6 allowed amount', () => {
      const result = parse835(AETNA_835);
      expect(result.claims[0].serviceLines[0].allowedAmount).toBe(175.00);
    });

    it('should not set allowedAmount when AMT*B6 is absent', () => {
      const result = parse835(AETNA_835);
      // First SVC of claim 2 has no AMT
      expect(result.claims[1].serviceLines[0].allowedAmount).toBeUndefined();
    });
  });

  // =============== LQ remark codes ===============

  describe('LQ remark code parsing', () => {
    it('should parse LQ*HE remark codes on service lines', () => {
      const result = parse835(AETNA_835);
      // LQ*HE*N130 appears after the first claim's service line
      const svc = result.claims[0].serviceLines[0];
      expect(svc.remarkCodes).toContain('N130');
    });

    it('should parse multiple remark codes', () => {
      const result = parse835(BCBS_835);
      // Two LQ segments after second SVC of first claim
      const svc = result.claims[0].serviceLines[1];
      expect(svc.remarkCodes).toContain('MA04');
      expect(svc.remarkCodes).toContain('N362');
    });

    it('should parse remark codes on claim with no NM1', () => {
      const result = parse835(COMPLEX_835);
      const claim2 = result.claims[1];
      expect(claim2.serviceLines[0].remarkCodes).toContain('N657');
    });
  });

  // =============== Segment terminator variations ===============

  describe('segment terminator handling', () => {
    it('should parse 835 without newlines (segments delimited by ~ only)', () => {
      const result = parse835(NO_NEWLINE_835);
      expect(result.claims.length).toBe(1);
      expect(result.claims[0].patientName).toBe('DAVID KIM');
      expect(result.claims[0].serviceLines[0].procedureCode).toBe('90837');
      expect(result.payment.payerName).toBe('CIGNA');
    });

    it('should handle CRLF line endings', () => {
      const crlfEdi = AETNA_835.replace(/\n/g, '\r\n');
      const result = parse835(crlfEdi);
      expect(result.claims.length).toBe(2);
      expect(result.interchange.senderId).toBe('AETNA');
    });

    it('should handle CR-only line endings', () => {
      const crEdi = AETNA_835.replace(/\n/g, '\r');
      const result = parse835(crEdi);
      expect(result.claims.length).toBe(2);
    });

    it('should handle mixed whitespace around segments', () => {
      const messyEdi = AETNA_835.replace(/~\n/g, '~  \n  ');
      const result = parse835(messyEdi);
      expect(result.claims.length).toBe(2);
    });
  });

  // =============== Sub-element separator ===============

  describe('sub-element separator detection', () => {
    it('should detect : as sub-element separator from ISA', () => {
      const result = parse835(AETNA_835);
      // SVC*HC:97530 should split on :
      expect(result.claims[0].serviceLines[0].procedureCode).toBe('97530');
    });

    it('should detect > as sub-element separator from ISA', () => {
      const result = parse835(BCBS_835);
      // SVC*HC>90837 should split on >
      expect(result.claims[0].serviceLines[0].procedureCode).toBe('90837');
    });
  });

  // =============== Empty / malformed input ===============

  describe('edge cases and malformed input', () => {
    it('should handle empty input', () => {
      const result = parse835('');
      expect(result.claims.length).toBe(0);
      expect(result.payment.totalAmount).toBe(0);
    });

    it('should handle whitespace-only input', () => {
      const result = parse835('   \n\n   ');
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
    });

    it('should preserve raw segments for debugging', () => {
      const result = parse835(AETNA_835);
      expect(result.rawSegments.length).toBeGreaterThan(0);
      expect(result.rawSegments.some(s => s.startsWith('ISA'))).toBe(true);
      expect(result.rawSegments.some(s => s.startsWith('CLP'))).toBe(true);
    });

    it('should handle CAS with missing amount gracefully', () => {
      const edi = [
        'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260401*1200*^*00501*000000001*0*P*:~',
        'GS*HP*S*R*20260401*1200*1*X*005010X221A1~',
        'ST*835*0001~',
        'BPR*I*100.00*C*ACH~',
        'CLP*X*1*100.00*100.00*0.00~',
        'SVC*HC:97530*100.00*100.00**1~',
        'CAS*CO*45~',
        'SE*6*0001~',
        'GE*1*1~',
        'IEA*1*000000001~',
      ].join('\n');

      const result = parse835(edi);
      // CAS*CO*45 has no amount, so it should be skipped
      expect(result.claims[0].serviceLines[0].adjustments.length).toBe(0);
    });
  });

  // =============== Utility functions ===============

  describe('utility functions', () => {
    it('should return correct adjustment group descriptions', () => {
      expect(getAdjustmentGroupDescription('CO')).toBe('Contractual Obligations');
      expect(getAdjustmentGroupDescription('PR')).toBe('Patient Responsibility');
      expect(getAdjustmentGroupDescription('OA')).toBe('Other Adjustments');
      expect(getAdjustmentGroupDescription('PI')).toBe('Payor Initiated Reductions');
      expect(getAdjustmentGroupDescription('CR')).toBe('Corrections/Reversals');
      expect(getAdjustmentGroupDescription('XX')).toBe('XX');
    });

    it('should return correct reason code descriptions', () => {
      expect(getReasonCodeDescription('1')).toBe('Deductible amount');
      expect(getReasonCodeDescription('2')).toBe('Coinsurance amount');
      expect(getReasonCodeDescription('3')).toBe('Copayment amount');
      expect(getReasonCodeDescription('45')).toContain('fee schedule');
      expect(getReasonCodeDescription('97')).toContain('not provided');
      expect(getReasonCodeDescription('109')).toContain('not covered');
      expect(getReasonCodeDescription('253')).toContain('Sequestration');
      expect(getReasonCodeDescription('9999')).toBe('Reason code 9999');
    });
  });

  // =============== flattenToLineItems ===============

  describe('flattenToLineItems', () => {
    it('should flatten Aetna 835 into correct number of line items', () => {
      const result = parse835(AETNA_835);
      const items = flattenToLineItems(result);
      // Claim 1: 1 SVC, Claim 2: 2 SVCs = 3 items
      expect(items.length).toBe(3);
    });

    it('should populate line item fields correctly', () => {
      const result = parse835(AETNA_835);
      const items = flattenToLineItems(result);

      expect(items[0].patientName).toBe('MASON HARTWELL');
      expect(items[0].memberId).toBe('MEM123456');
      expect(items[0].cptCode).toBe('97530');
      expect(items[0].serviceDate).toBe('2026-03-15');
      expect(items[0].chargedAmount).toBe(200.00);
      expect(items[0].paidAmount).toBe(150.00);
      expect(items[0].allowedAmount).toBe(175.00);
    });

    it('should aggregate adjustments from claim and service levels', () => {
      const result = parse835(AETNA_835);
      const items = flattenToLineItems(result);
      // First item has CO-45 ($25) and PR-1 ($25) adjustments
      expect(items[0].adjustmentAmount).toBe(50.00);
      expect(items[0].adjustmentReasonCodes.length).toBe(2);
    });

    it('should include remark codes in line items', () => {
      const result = parse835(AETNA_835);
      const items = flattenToLineItems(result);
      expect(items[0].remarkCodes.length).toBeGreaterThan(0);
      expect(items[0].remarkCodes[0].code).toBe('N130');
    });

    it('should flatten BCBS 835 with > separator', () => {
      const result = parse835(BCBS_835);
      const items = flattenToLineItems(result);
      // Claim 1: 2 SVCs, Claim 2: 2 SVCs = 4
      expect(items.length).toBe(4);
      expect(items[0].cptCode).toBe('90837');
      expect(items[1].cptCode).toBe('97110');
    });

    it('should flatten complex 835 with denied claims', () => {
      const result = parse835(COMPLEX_835);
      const items = flattenToLineItems(result);
      // Claim 1: 2 SVCs, Claim 2: 1 SVC, Claim 3: 2 SVCs = 5
      expect(items.length).toBe(5);

      // First item is denied (PI-97)
      expect(items[0].paidAmount).toBe(0.00);
      expect(items[0].adjustmentReasonCodes.some(a => a.code === 'PI-97')).toBe(true);
    });

    it('should handle negative adjustments in totals', () => {
      const result = parse835(COMPLEX_835);
      const items = flattenToLineItems(result);
      // Last item has OA-23 ($25) and CR-253 (-$10) = $15 net
      const lastItem = items[items.length - 1];
      expect(lastItem.adjustmentAmount).toBe(15.00);
    });

    it('should use patientControlNumber as fallback when patientName is missing', () => {
      const result = parse835(COMPLEX_835);
      const items = flattenToLineItems(result);
      // UHC-CLM-201 has no NM1, should use control number
      const deniedItem = items.find(i => i.cptCode === '90837');
      expect(deniedItem).toBeDefined();
      expect(deniedItem!.patientName).toBe('UHC-CLM-201');
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
  });
});
