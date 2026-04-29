import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }) },
}));

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { buildPlanBenefitsSection, buildPrecedentsSection } from '../services/claudeAppealService';
import type { ClaimPrecedent } from '../services/claimPrecedentService';

describe('buildPlanBenefitsSection', () => {
  it('returns empty string when no benefits provided', () => {
    expect(buildPlanBenefitsSection(null)).toBe('');
    expect(buildPlanBenefitsSection(undefined)).toBe('');
    expect(buildPlanBenefitsSection({})).toBe('');
  });

  it('surfaces plan name and type from columns', () => {
    const result = buildPlanBenefitsSection({
      planName: 'Aetna PPO Standard',
      planType: 'PPO',
      rawExtractedData: {},
    });
    expect(result).toContain('Aetna PPO Standard (PPO)');
  });

  it('surfaces per-discipline visit limits from rawExtractedData', () => {
    const result = buildPlanBenefitsSection({
      planName: 'Test Plan',
      rawExtractedData: {
        therapy_limits: { ot: 60, pt: 60, st: 30, combined: false },
      },
    });
    expect(result).toContain('OT 60 visits/year');
    expect(result).toContain('PT 60 visits/year');
    expect(result).toContain('ST 30 visits/year');
  });

  it('surfaces combined therapy cap when present', () => {
    const result = buildPlanBenefitsSection({
      rawExtractedData: {
        therapy_limits: { combined: true, combined_limit: 60 },
      },
    });
    expect(result).toContain('Combined OT/PT/ST cap: 60 visits/year');
  });

  it('surfaces verbatim exclusions and instructs Claude how to use them', () => {
    const result = buildPlanBenefitsSection({
      rawExtractedData: {
        exclusions: [
          'Educational, vocational, or recreational therapy is not covered.',
          'Services for the convenience of the member are not covered.',
        ],
      },
    });
    expect(result).toContain('Plan exclusions');
    expect(result).toContain('"Educational, vocational, or recreational therapy is not covered."');
    expect(result).toContain('"Services for the convenience of the member are not covered."');
  });

  it('caps exclusions at 8 to control prompt size', () => {
    const tenExclusions = Array.from({ length: 10 }, (_, i) => `Exclusion clause ${i + 1}.`);
    const result = buildPlanBenefitsSection({
      rawExtractedData: { exclusions: tenExclusions },
    });
    expect(result).toContain('Exclusion clause 1.');
    expect(result).toContain('Exclusion clause 8.');
    expect(result).not.toContain('Exclusion clause 9.');
  });

  it('surfaces verbatim medical necessity criteria', () => {
    const criteria = 'Medically necessary services are those required to diagnose or treat a covered condition.';
    const result = buildPlanBenefitsSection({
      rawExtractedData: { medical_necessity_criteria: criteria },
    });
    expect(result).toContain('verbatim definition of medical necessity');
    expect(result).toContain(`"${criteria}"`);
  });

  it('surfaces network adequacy language for OON denials', () => {
    const language = 'When no in-network provider is available within 30 miles, OON services are covered at in-network rates.';
    const result = buildPlanBenefitsSection({
      rawExtractedData: { network_adequacy_language: language },
    });
    expect(result).toContain('network-adequacy language');
    expect(result).toContain(`"${language}"`);
  });

  it('surfaces appeal rights timeframes', () => {
    const result = buildPlanBenefitsSection({
      rawExtractedData: {
        appeal_rights: {
          first_level_days: 180,
          second_level_days: 60,
          payer_response_days: 30,
        },
      },
    });
    expect(result).toContain('first-level appeal: 180 days');
    expect(result).toContain('second-level: 60 days');
    expect(result).toContain('payer must respond within: 30 days');
  });

  it('surfaces prior auth requirements', () => {
    const result = buildPlanBenefitsSection({
      rawExtractedData: {
        prior_auth_required_for: ['97530 after visit 30', '92526'],
      },
    });
    expect(result).toContain('Prior authorization required for: 97530 after visit 30, 92526');
  });

  it('surfaces OON benefits from columns', () => {
    const result = buildPlanBenefitsSection({
      oonDeductibleIndividual: '3000',
      oonCoinsurancePercent: '40',
      oonOutOfPocketMax: '12000',
      rawExtractedData: {},
    });
    expect(result).toContain('OON deductible: $3000');
    expect(result).toContain('OON coinsurance: 40%');
    expect(result).toContain('OON OOP max: $12000');
  });

  it('surfaces per-CPT coverage status', () => {
    const result = buildPlanBenefitsSection({
      rawExtractedData: {
        coverage_status: [
          { code: '97530', covered: true, notes: 'Therapeutic Activities' },
          { code: 'NOT_COVERED', covered: false, notes: 'Excluded' },
        ],
      },
    });
    expect(result).toContain('97530: covered — Therapeutic Activities');
    expect(result).toContain('NOT_COVERED: NOT covered — Excluded');
  });

  it('combines multiple data sources into one section header', () => {
    const result = buildPlanBenefitsSection({
      planName: 'Aetna PPO Standard',
      rawExtractedData: {
        therapy_limits: { ot: 60 },
        exclusions: ['Educational therapy'],
      },
    });
    expect(result.startsWith('## Plan Benefits')).toBe(true);
    expect(result).toContain('Aetna PPO Standard');
    expect(result).toContain('OT 60 visits/year');
    expect(result).toContain('"Educational therapy"');
  });
});

describe('buildPrecedentsSection', () => {
  it('returns empty string when precedents is null/undefined/empty', () => {
    expect(buildPrecedentsSection(null)).toBe('');
    expect(buildPrecedentsSection(undefined)).toBe('');
    expect(buildPrecedentsSection(new Map())).toBe('');
  });

  it('formats precedents grouped by CPT with header instructing Claude not to fabricate', () => {
    const map = new Map<string, ClaimPrecedent[]>();
    map.set('97530', [
      {
        claimId: 100,
        claimNumber: 'CLM-100',
        insuranceId: 5,
        paidAmount: 289,
        paidAt: new Date('2026-01-15T00:00:00Z'),
        dateOfService: '2026-01-10',
        cptCode: '97530',
        diagnosisCode: 'F84.0',
        units: 1,
      },
    ]);
    const result = buildPrecedentsSection(map);
    expect(result).toContain('## Prior Paid Claims');
    expect(result).toContain('Do not fabricate additional precedents');
    expect(result).toContain('For CPT 97530');
    expect(result).toContain('claim #CLM-100');
    expect(result).toContain('paid 2026-01-15');
  });

  it('skips CPTs with empty precedent lists', () => {
    const map = new Map<string, ClaimPrecedent[]>();
    map.set('97530', [
      {
        claimId: 1,
        claimNumber: 'A',
        insuranceId: 5,
        paidAmount: 100,
        paidAt: new Date(),
        dateOfService: '2026-01-01',
        cptCode: '97530',
        units: 1,
      },
    ]);
    map.set('97110', []); // empty — should be skipped
    const result = buildPrecedentsSection(map);
    expect(result).toContain('For CPT 97530');
    expect(result).not.toContain('For CPT 97110');
  });

  it('returns empty when all CPTs have empty precedent lists', () => {
    const map = new Map<string, ClaimPrecedent[]>();
    map.set('97530', []);
    map.set('97110', []);
    expect(buildPrecedentsSection(map)).toBe('');
  });
});
