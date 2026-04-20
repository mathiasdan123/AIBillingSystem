import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Save original env
const originalEnv = { ...process.env };

describe('stediService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.STEDI_API_KEY = 'test-api-key-123';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('isStediConfigured', () => {
    it('returns true when STEDI_API_KEY is set', async () => {
      const { isStediConfigured } = await import('../services/stediService');
      expect(isStediConfigured()).toBe(true);
    });

    it('returns false when STEDI_API_KEY is not set', async () => {
      delete process.env.STEDI_API_KEY;
      const { isStediConfigured } = await import('../services/stediService');
      expect(isStediConfigured()).toBe(false);
    });
  });

  describe('PAYER_IDS', () => {
    it('contains common insurance payer IDs', async () => {
      const { PAYER_IDS } = await import('../services/stediService');
      expect(PAYER_IDS.aetna).toBe('60054');
      expect(PAYER_IDS.cigna).toBe('62308');
      expect(PAYER_IDS.medicare).toBe('CMS');
      expect(PAYER_IDS.united).toBe('87726');
    });
  });

  describe('checkEligibility', () => {
    const sampleRequest = {
      subscriber: {
        memberId: 'MEM123',
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1990-05-15',
      },
      provider: {
        npi: '1234567890',
        organizationName: 'Test Practice',
      },
      payer: {
        id: '60054',
        name: 'Aetna',
      },
    };

    it('returns active status for valid eligibility response', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          benefitsInformation: [
            { code: '1', informationCode: 'A' },
          ],
          planInformation: {
            planName: 'Aetna Gold',
            groupNumber: 'GRP456',
          },
        }),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const { checkEligibility } = await import('../services/stediService');
      const result = await checkEligibility(sampleRequest);

      expect(result.status).toBe('active');
      expect(result.planName).toBe('Aetna Gold');
      expect(result.groupNumber).toBe('GRP456');
    });

    it('returns inactive status when inactive benefit found', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          benefitsInformation: [
            { code: '6', informationCode: 'I' },
          ],
        }),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const { checkEligibility } = await import('../services/stediService');
      const result = await checkEligibility(sampleRequest);

      expect(result.status).toBe('inactive');
    });

    it('returns unknown status with errors on API error response', async () => {
      const mockResponse = {
        ok: false,
        json: vi.fn().mockResolvedValue({ message: 'Invalid payer ID' }),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const { checkEligibility } = await import('../services/stediService');
      const result = await checkEligibility(sampleRequest);

      expect(result.status).toBe('unknown');
      expect(result.errors).toContain('Invalid payer ID');
    });

    it('handles network errors gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network timeout')));

      const { checkEligibility } = await import('../services/stediService');
      const result = await checkEligibility(sampleRequest);

      expect(result.status).toBe('unknown');
      expect(result.errors).toContain('Network timeout');
      expect(result.raw).toBeNull();
    });

    it('sends correct authorization header', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ benefitsInformation: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { checkEligibility } = await import('../services/stediService');
      await checkEligibility(sampleRequest);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain('/eligibility-checks');
      const headers = callArgs[1].headers;
      expect(headers.Authorization).toBe('Key test-api-key-123');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('includes dependent info when patient is not self', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ benefitsInformation: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const requestWithDependent = {
        ...sampleRequest,
        patient: {
          firstName: 'Child',
          lastName: 'Doe',
          dateOfBirth: '2015-03-20',
          relationshipToSubscriber: 'child' as const,
        },
      };

      const { checkEligibility } = await import('../services/stediService');
      await checkEligibility(requestWithDependent);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.dependent).toBeDefined();
      expect(body.dependent.firstName).toBe('Child');
      expect(body.dependent.relationshipCode).toBe('19'); // child code
    });

    it('parses copay and deductible from response', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          benefitsInformation: [
            { code: '1', informationCode: 'A' },
            { code: 'B', amount: 30, serviceTypeCode: '98' },
            { code: 'C', amount: 1500, remainingAmount: 800 },
            { code: 'G', amount: 5000, remainingAmount: 3000 },
            { code: 'A', percent: 20 },
          ],
        }),
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

      const { checkEligibility } = await import('../services/stediService');
      const result = await checkEligibility(sampleRequest);

      expect(result.copay?.primary).toBe(30);
      expect(result.deductible?.individual).toBe(1500);
      expect(result.deductible?.remaining).toBe(800);
      expect(result.outOfPocketMax?.individual).toBe(5000);
      expect(result.coinsurance).toBe(20);
    });
  });

  describe('submitClaim', () => {
    const sampleClaim = {
      claimId: 'CLM001',
      totalAmount: 150.00,
      placeOfService: '11',
      dateOfService: '2026-03-01',
      patient: {
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1990-05-15',
        gender: 'F' as const,
        address: { line1: '123 Main St', city: 'Springfield', state: 'IL', zip: '62701' },
        memberId: 'MEM123',
      },
      provider: {
        npi: '1234567890',
        taxId: '123456789',
        organizationName: 'Test Practice',
        address: { line1: '456 Oak Ave', city: 'Springfield', state: 'IL', zip: '62702' },
      },
      payer: { id: '60054', name: 'Aetna' },
      serviceLines: [
        {
          procedureCode: '90837',
          diagnosisCodes: ['F41.1'],
          amount: 150.00,
          units: 1,
          dateOfService: '2026-03-01',
        },
      ],
      diagnosisCodes: ['F41.1'],
    };

    it('returns success on accepted claim', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ claimId: 'STEDI-001' }),
      }));

      const { submitClaim } = await import('../services/stediService');
      const result = await submitClaim(sampleClaim);

      expect(result.success).toBe(true);
      expect(result.status).toBe('accepted');
      expect(result.stediClaimId).toBe('STEDI-001');
      expect(result.claimId).toBe('CLM001');
    });

    it('returns rejected status on API error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ message: 'Invalid NPI' }),
      }));

      const { submitClaim } = await import('../services/stediService');
      const result = await submitClaim(sampleClaim);

      expect(result.success).toBe(false);
      expect(result.status).toBe('rejected');
      expect(result.errors).toContain('Invalid NPI');
    });

    it('handles network errors on claim submission', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

      const { submitClaim } = await import('../services/stediService');
      const result = await submitClaim(sampleClaim);

      expect(result.success).toBe(false);
      expect(result.status).toBe('rejected');
      expect(result.errors).toContain('Connection refused');
    });
  });

  describe('checkClaimStatus', () => {
    const statusRequest = {
      claimId: 'CLM001',
      payer: { id: '60054' },
      provider: { npi: '1234567890' },
      subscriber: {
        memberId: 'MEM123',
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1990-05-15',
      },
      dateOfService: '2026-03-01',
    };

    it('returns paid status with payment details', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          claimStatus: {
            statusCategoryCode: 'F1',
            paidAmount: 120.00,
            paidDate: '2026-03-15',
            checkNumber: 'CHK9999',
          },
        }),
      }));

      const { checkClaimStatus } = await import('../services/stediService');
      const result = await checkClaimStatus(statusRequest);

      expect(result.status).toBe('paid');
      expect(result.paidAmount).toBe(120.00);
      expect(result.checkNumber).toBe('CHK9999');
    });

    it('returns denied status with denial reason', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          claimStatus: {
            statusCategoryCode: 'D0',
            denialReason: 'Not medically necessary',
          },
        }),
      }));

      const { checkClaimStatus } = await import('../services/stediService');
      const result = await checkClaimStatus(statusRequest);

      // After Phase 1 of the Stedi remediation plan, the internal status
      // bucket distinguishes 'finalized_denied' from the coarse 'denied' the
      // claims table sees. The bucket is what stediService returns; the
      // mapping to claim.status happens downstream.
      expect(result.status).toBe('finalized_denied');
      expect(result.denialReason).toBe('Not medically necessary');
    });
  });

  describe('missing API key', () => {
    it('throws error when calling API without STEDI_API_KEY', async () => {
      delete process.env.STEDI_API_KEY;
      vi.stubGlobal('fetch', vi.fn());

      const { checkEligibility } = await import('../services/stediService');
      const result = await checkEligibility({
        subscriber: { memberId: 'X', firstName: 'A', lastName: 'B', dateOfBirth: '2000-01-01' },
        provider: { npi: '111' },
        payer: { id: '222' },
      });

      // Should fail with an error about missing API key
      expect(result.status).toBe('unknown');
      expect(result.errors![0]).toContain('STEDI_API_KEY');
    });
  });

  // Phase 4 — STC audit helpers used by the pre-appointment eligibility cron
  // and consumed in the BenefitsVerificationCard UI banner.
  describe('extractReturnedStcsFromRawStediResponse', () => {
    it('returns empty array for null/undefined/empty input', async () => {
      const { extractReturnedStcsFromRawStediResponse } = await import('../services/stediService');
      expect(extractReturnedStcsFromRawStediResponse(null)).toEqual([]);
      expect(extractReturnedStcsFromRawStediResponse(undefined)).toEqual([]);
      expect(extractReturnedStcsFromRawStediResponse({})).toEqual([]);
    });

    it('extracts + dedupes STCs from benefitsInformation[].serviceTypeCodes', async () => {
      const { extractReturnedStcsFromRawStediResponse } = await import('../services/stediService');
      const raw = {
        benefitsInformation: [
          { code: '1', serviceTypeCodes: ['30', 'AE'] },
          { code: '1', serviceTypeCodes: ['AE'] },
          { code: '6', serviceTypeCodes: ['AD'] },
        ],
      };
      const out = extractReturnedStcsFromRawStediResponse(raw).sort();
      expect(out).toEqual(['30', 'AD', 'AE']);
    });

    it('also picks up coverageDetails[].serviceType for the stediService parser path', async () => {
      const { extractReturnedStcsFromRawStediResponse } = await import('../services/stediService');
      const raw = {
        coverageDetails: [
          { serviceType: 'AE', coverage: 'active', inNetwork: true },
          { serviceType: '30', coverage: 'active', inNetwork: true },
        ],
      };
      expect(extractReturnedStcsFromRawStediResponse(raw).sort()).toEqual(['30', 'AE']);
    });
  });

  describe('isStcDowngrade', () => {
    it('returns false when only generic (30) was requested', async () => {
      const { isStcDowngrade } = await import('../services/stediService');
      expect(isStcDowngrade(['30'], [])).toBe(false);
      expect(isStcDowngrade(['30'], ['30'])).toBe(false);
    });

    it('returns true when therapy-specific asked but payer returned nothing', async () => {
      const { isStcDowngrade } = await import('../services/stediService');
      expect(isStcDowngrade(['AE', '30'], [])).toBe(true);
    });

    it('returns true when therapy-specific asked but payer answered only 30', async () => {
      const { isStcDowngrade } = await import('../services/stediService');
      expect(isStcDowngrade(['AE', '30'], ['30'])).toBe(true);
    });

    it('returns false when payer returned the specific STC we asked for', async () => {
      const { isStcDowngrade } = await import('../services/stediService');
      expect(isStcDowngrade(['AE', '30'], ['AE', '30'])).toBe(false);
      expect(isStcDowngrade(['AD'], ['AD'])).toBe(false);
    });
  });
});
