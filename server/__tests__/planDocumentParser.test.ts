import { describe, it, expect } from 'vitest';
import { transformParsedData } from '../services/planDocumentParser';

describe('planDocumentParser - transformParsedData', () => {
  describe('appeal-relevant fields (Phase 0)', () => {
    it('extracts per-discipline therapy visit limits', () => {
      const result = transformParsedData({
        therapy_limits: { ot: 60, pt: 60, st: 30, combined: false, combined_limit: null },
      });
      expect(result.otVisitLimit).toBe(60);
      expect(result.ptVisitLimit).toBe(60);
      expect(result.stVisitLimit).toBe(30);
      expect(result.habilitativeServicesCombined).toBe(false);
      expect(result.combinedTherapyVisitLimit).toBeUndefined();
    });

    it('handles a combined-cap therapy plan', () => {
      const result = transformParsedData({
        therapy_limits: { ot: null, pt: null, st: null, combined: true, combined_limit: 60 },
      });
      expect(result.habilitativeServicesCombined).toBe(true);
      expect(result.combinedTherapyVisitLimit).toBe(60);
    });

    it('preserves verbatim exclusion clauses for appeal quoting', () => {
      const exclusions = [
        'Educational, vocational, or recreational therapy is not covered.',
        'Services provided primarily for the convenience of the member are not covered.',
      ];
      const result = transformParsedData({ exclusions });
      expect(result.exclusions).toEqual(exclusions);
    });

    it('drops empty / non-string entries from exclusions', () => {
      const result = transformParsedData({
        exclusions: ['Real exclusion text', '', '   ', null, 42, 'Another exclusion'],
      });
      expect(result.exclusions).toEqual(['Real exclusion text', 'Another exclusion']);
    });

    it('returns undefined exclusions when input is not an array', () => {
      expect(transformParsedData({ exclusions: 'not an array' }).exclusions).toBeUndefined();
      expect(transformParsedData({}).exclusions).toBeUndefined();
    });

    it('extracts appeal rights timeframes', () => {
      const result = transformParsedData({
        appeal_rights: {
          first_level_days: 180,
          second_level_days: 60,
          external_review_days: 120,
          payer_response_days: 30,
        },
      });
      expect(result.appealRights).toEqual({
        firstLevelDays: 180,
        secondLevelDays: 60,
        externalReviewDays: 120,
        payerResponseDays: 30,
      });
    });

    it('preserves verbatim medical necessity criteria for appeal citations', () => {
      const criteria = 'Services are medically necessary when they are required to diagnose or treat an illness, injury, condition, or its symptoms.';
      const result = transformParsedData({ medical_necessity_criteria: criteria });
      expect(result.medicalNecessityCriteria).toBe(criteria);
    });

    it('preserves verbatim network adequacy language', () => {
      const language = 'When no in-network provider is available within 30 miles, out-of-network services will be covered at the in-network benefit level.';
      const result = transformParsedData({ network_adequacy_language: language });
      expect(result.networkAdequacyLanguage).toBe(language);
    });

    it('extracts service-category copays as a typed map', () => {
      const result = transformParsedData({
        service_category_copays: {
          specialist: 40,
          primary_care: 25,
          therapy: 30,
          urgent_care: '75', // string input should still parse
        },
      });
      expect(result.serviceCategoryCopays).toEqual({
        specialist: 40,
        primary_care: 25,
        therapy: 30,
        urgent_care: 75,
      });
    });

    it('drops non-numeric copay values rather than crashing', () => {
      const result = transformParsedData({
        service_category_copays: {
          specialist: 40,
          weird_field: 'not a number',
          another: null,
        },
      });
      expect(result.serviceCategoryCopays).toEqual({ specialist: 40 });
    });

    it('extracts prior_auth_required_for as string array', () => {
      const result = transformParsedData({
        prior_auth_required_for: ['97530 after visit 30', '92526', '   '],
      });
      expect(result.priorAuthRequiredFor).toEqual(['97530 after visit 30', '92526']);
    });

    it('extracts coverage_status with required fields', () => {
      const result = transformParsedData({
        coverage_status: [
          { code: '97530', covered: true, notes: 'Therapeutic Activities' },
          { code: '92507', covered: true }, // notes optional
          { covered: false, notes: 'no code, should be filtered' },
          { code: '99999', covered: 'truthy string' }, // covered coerced to bool
        ],
      });
      expect(result.coverageStatus).toEqual([
        { code: '97530', covered: true, notes: 'Therapeutic Activities' },
        { code: '92507', covered: true, notes: undefined },
        { code: '99999', covered: true, notes: undefined },
      ]);
    });
  });

  describe('backward compatibility', () => {
    it('still extracts existing OON benefit fields', () => {
      const result = transformParsedData({
        plan_name: 'Aetna PPO Standard',
        out_of_network: {
          deductible: { individual: 3000, family: 6000 },
          coinsurance: 40,
          out_of_pocket_max: { individual: 12000 },
        },
        allowed_amount_method: 'medicare_percent',
        allowed_amount_percent: 150,
      });
      expect(result.planName).toBe('Aetna PPO Standard');
      expect(result.oonDeductibleIndividual).toBe(3000);
      expect(result.oonDeductibleFamily).toBe(6000);
      expect(result.oonCoinsurancePercent).toBe(40);
      expect(result.oonOutOfPocketMax).toBe(12000);
      expect(result.allowedAmountMethod).toBe('medicare_percent');
      expect(result.allowedAmountPercent).toBe(150);
    });

    it('returns undefined for new fields when not provided', () => {
      const result = transformParsedData({
        plan_name: 'Old Document Style',
      });
      expect(result.otVisitLimit).toBeUndefined();
      expect(result.exclusions).toBeUndefined();
      expect(result.appealRights).toBeUndefined();
      expect(result.medicalNecessityCriteria).toBeUndefined();
      expect(result.coverageStatus).toBeUndefined();
    });
  });
});
