import { describe, it, expect } from 'vitest';
import {
  buildRejectionHints,
  isClaimInRejectionState,
  isLikelyPriorAuthDenial,
} from '../services/rejectionHints';

// Minimal fixture builders — keep tests readable without pulling in full schema types.
const freshEligibility = (overrides: Record<string, any> = {}) => ({
  id: 1,
  patientId: 1,
  status: 'active',
  checkedAt: new Date(),
  checkDate: new Date(),
  stcDowngraded: false,
  serviceTypeCodes: null,
  returnedServiceTypeCodes: null,
  ...overrides,
});

const lineItem = (code: string, therapyCategory: string | null = null) => ({
  cptCodeId: 1,
  cptCode: { code, therapyCategory },
});

describe('isClaimInRejectionState', () => {
  it('returns true for denied claims', () => {
    expect(isClaimInRejectionState({ status: 'denied' })).toBe(true);
  });
  it('returns true for rejected claims', () => {
    expect(isClaimInRejectionState({ status: 'rejected' })).toBe(true);
  });
  it('returns true for clearinghouse A7/A8/F4/D0', () => {
    expect(isClaimInRejectionState({ clearinghouseStatus: 'A7' })).toBe(true);
    expect(isClaimInRejectionState({ clearinghouseStatus: 'A8' })).toBe(true);
    expect(isClaimInRejectionState({ clearinghouseStatus: 'F4' })).toBe(true);
    expect(isClaimInRejectionState({ clearinghouseStatus: 'D0' })).toBe(true);
  });
  it('returns false for paid/held/draft', () => {
    expect(isClaimInRejectionState({ status: 'paid' })).toBe(false);
    expect(isClaimInRejectionState({ status: 'held' })).toBe(false);
    expect(isClaimInRejectionState({ status: 'draft' })).toBe(false);
  });
});

describe('buildRejectionHints', () => {
  it('returns [] for non-rejected claims', () => {
    const hints = buildRejectionHints({
      claim: { status: 'paid' } as any,
      lineItems: [lineItem('97530', 'OT')],
      eligibility: freshEligibility() as any,
    });
    expect(hints).toEqual([]);
  });

  it('surfaces STC downgrade + per-category mismatch', () => {
    const hints = buildRejectionHints({
      claim: { status: 'denied', denialReason: 'Service not covered' } as any,
      lineItems: [lineItem('97530', 'OT'), lineItem('97110', 'PT')],
      eligibility: freshEligibility({
        stcDowngraded: true,
        serviceTypeCodes: ['AE', 'AD', '30'],
        returnedServiceTypeCodes: ['30'],
      }) as any,
    });
    // Should mention both OT and PT
    const downgradeHint = hints.find((h) => h.includes('generic coverage (STC 30)'));
    expect(downgradeHint).toBeDefined();
    expect(downgradeHint).toMatch(/OT/);
    expect(downgradeHint).toMatch(/PT/);
  });

  it('emits downgrade hint even if no per-line mismatch', () => {
    const hints = buildRejectionHints({
      claim: { status: 'denied' } as any,
      lineItems: [lineItem('99213', null)], // uncategorized
      eligibility: freshEligibility({
        stcDowngraded: true,
        returnedServiceTypeCodes: ['30'],
      }) as any,
    });
    expect(hints.some((h) => h.includes('generic coverage'))).toBe(true);
  });

  it('skips downgrade hint when payer returned the specialty STC', () => {
    const hints = buildRejectionHints({
      claim: { status: 'denied' } as any,
      lineItems: [lineItem('97530', 'OT')],
      eligibility: freshEligibility({
        stcDowngraded: false,
        returnedServiceTypeCodes: ['AE'],
      }) as any,
    });
    expect(hints.find((h) => h.includes('generic coverage'))).toBeUndefined();
  });

  it('flags stale eligibility > 90 days old', () => {
    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    const hints = buildRejectionHints({
      claim: { status: 'denied' } as any,
      lineItems: [lineItem('97530', 'OT')],
      eligibility: freshEligibility({ checkedAt: oldDate, checkDate: oldDate }) as any,
    });
    expect(hints.some((h) => h.includes('120 days ago'))).toBe(true);
  });

  it('flags missing eligibility entirely', () => {
    const hints = buildRejectionHints({
      claim: { status: 'denied' } as any,
      lineItems: [lineItem('97530', 'OT')],
      eligibility: null,
    });
    expect(hints.some((h) => h.includes('No eligibility check has ever been run'))).toBe(true);
  });

  it('flags inactive coverage on rejected claim', () => {
    const hints = buildRejectionHints({
      claim: { status: 'rejected' } as any,
      lineItems: [lineItem('97530', 'OT')],
      eligibility: freshEligibility({ status: 'inactive' }) as any,
    });
    expect(hints.some((h) => h.includes('INACTIVE'))).toBe(true);
  });

  it('returns [] when rejected but eligibility is fresh + active + no downgrade', () => {
    const hints = buildRejectionHints({
      claim: { status: 'denied' } as any,
      lineItems: [lineItem('97530', 'OT')],
      eligibility: freshEligibility() as any,
    });
    expect(hints).toEqual([]);
  });

  it('surfaces a prior-auth hint when denial reason indicates missing auth', () => {
    const hints = buildRejectionHints({
      claim: {
        status: 'denied',
        denialReason: 'CO-197: Precertification/authorization absent',
        authorizationNumber: null,
      } as any,
      lineItems: [lineItem('97530', 'OT')],
      eligibility: freshEligibility() as any,
    });
    expect(hints.some((h) => h.includes('prior-authorization'))).toBe(true);
    expect(hints.some((h) => h.includes('retroactive auth'))).toBe(true);
  });

  it('does NOT surface the prior-auth hint when auth is already on the claim', () => {
    const hints = buildRejectionHints({
      claim: {
        status: 'denied',
        denialReason: 'Prior authorization required',
        authorizationNumber: 'AUTH-12345',
      } as any,
      lineItems: [lineItem('97530', 'OT')],
      eligibility: freshEligibility() as any,
    });
    expect(hints.some((h) => h.includes('prior-authorization'))).toBe(false);
  });
});

describe('isLikelyPriorAuthDenial', () => {
  it('detects CARC codes CO-62 / CO-197 / CO-198', () => {
    expect(isLikelyPriorAuthDenial('CO-62: no precert')).toBe(true);
    expect(isLikelyPriorAuthDenial('CO-197: missing auth')).toBe(true);
    expect(isLikelyPriorAuthDenial('CO-198: auth exceeded')).toBe(true);
    // Space variant (CO 197)
    expect(isLikelyPriorAuthDenial('denial CO 197 here')).toBe(true);
  });

  it('does not falsely match adjacent codes (CO-620, CO-1970)', () => {
    expect(isLikelyPriorAuthDenial('CO-620 different denial')).toBe(false);
    expect(isLikelyPriorAuthDenial('CO-1970 different denial')).toBe(false);
  });

  it('detects plain-text phrasings', () => {
    expect(isLikelyPriorAuthDenial('Prior authorization required')).toBe(true);
    expect(isLikelyPriorAuthDenial('Pre-cert missing')).toBe(true);
    expect(isLikelyPriorAuthDenial('pre-auth not obtained')).toBe(true);
    expect(isLikelyPriorAuthDenial('Precertification absent')).toBe(true);
    expect(isLikelyPriorAuthDenial('Authorization missing for this service')).toBe(true);
  });

  it('returns false for unrelated denials', () => {
    expect(isLikelyPriorAuthDenial('Service not covered')).toBe(false);
    expect(isLikelyPriorAuthDenial('Invalid procedure code')).toBe(false);
    expect(isLikelyPriorAuthDenial('Deductible not met')).toBe(false);
    expect(isLikelyPriorAuthDenial(null)).toBe(false);
    expect(isLikelyPriorAuthDenial(undefined)).toBe(false);
    expect(isLikelyPriorAuthDenial('')).toBe(false);
  });
});
