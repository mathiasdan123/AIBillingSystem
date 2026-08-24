/**
 * A patient statement must bill ONLY the patient-responsibility amount the
 * payer adjudicated — never the contractual write-off.
 *
 * The old arithmetic was `charge - insurance paid`. On a typical visit
 * ($200 charged, $110 allowed, $80 paid, $30 PR) that billed the patient
 * $120 instead of $30. The $90 difference is precisely the discount the
 * practice agreed to accept in its payer contract; passing it to the patient
 * is balance billing, which is prohibited for an in-network provider and is
 * the kind of thing that draws a state complaint rather than a support
 * ticket.
 *
 * These tests pin the 835 parser's PR/CO split, which is where the billable
 * amount is established.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, getDb: () => ({}) }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { parse835, flattenToLineItems } from '../services/edi835Parser';

/**
 * Minimal 835 for one $200 service: allowed $110, paid $80,
 * CO-45 $90 (contractual write-off) and PR-2 $30 (coinsurance).
 */
const ERA_835 = [
  'ISA*00*          *00*          *ZZ*PAYER          *ZZ*PROVIDER       *260815*1200*^*00501*000000001*0*P*:~',
  'GS*HP*PAYER*PROVIDER*20260815*1200*1*X*005010X221A1~',
  'ST*835*0001~',
  'BPR*I*80*C*ACH*CCP*01*999999999*DA*123456789*1234567890**01*999988880*DA*98765*20260815~',
  'TRN*1*CHK1001*1234567890~',
  'N1*PR*HORIZON BCBS NJ~',
  'N1*PE*WONDER KIDS THERAPY CENTER*XX*1023896321~',
  'CLP*CLM-1*1*200*80*30*12*PAYERCTRL1*11~',
  'NM1*QC*1*DOE*JANE****MI*MEM123~',
  'SVC*HC:97110*200*80**1~',
  'DTM*472*20260801~',
  'CAS*CO*45*90~',
  'CAS*PR*2*30~',
  'SE*13*0001~',
  'GE*1*1~',
  'IEA*1*000000001~',
].join('');

describe('835 parsing separates patient responsibility from the write-off', () => {
  it('splits CO (write-off) from PR (billable to patient)', () => {
    const parsed = parse835(ERA_835);
    const items = flattenToLineItems(parsed);

    expect(items.length).toBeGreaterThan(0);
    const item = items[0];

    // The patient owes the PR-2 coinsurance only.
    expect(item.patientResponsibility).toBe(30);
    // The CO-45 amount is the practice's write-off, never billable.
    expect(item.contractualAdjustment).toBe(90);
  });

  it('never lets the billable amount equal charge minus insurance paid', () => {
    const parsed = parse835(ERA_835);
    const item = flattenToLineItems(parsed)[0];

    const naive = item.chargedAmount - item.paidAmount; // the old, wrong math
    expect(naive).toBe(120);
    expect(item.patientResponsibility).toBe(30);
    expect(item.patientResponsibility).not.toBe(naive);
  });

  it('keeps adjustmentAmount as the combined total, so it cannot be mistaken for the patient share', () => {
    const parsed = parse835(ERA_835);
    const item = flattenToLineItems(parsed)[0];

    // adjustmentAmount mixes both groups — this is exactly why statements
    // must not derive a patient balance from it.
    expect(item.adjustmentAmount).toBe(120);
    expect(item.adjustmentAmount).toBe(item.patientResponsibility + item.contractualAdjustment);
  });
});
