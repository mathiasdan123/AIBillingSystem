import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock storage
const mockStorage = vi.hoisted(() => ({
  getPatientConsents: vi.fn(),
  hasRequiredTreatmentConsents: vi.fn(),
}));

vi.mock('../storage', () => ({
  storage: mockStorage,
}));

// Mock logger
vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { requirePatientConsent } from '../middleware/consentCheck';

function createMockReq(overrides: any = {}): Partial<Request> {
  return {
    params: {},
    body: {},
    originalUrl: '/api/patients/1',
    method: 'GET',
    user: { claims: { sub: 'user-123' } },
    ...overrides,
  } as any;
}

function createMockRes(): { res: Partial<Response>; statusCode: number | null; jsonBody: any } {
  const state = { statusCode: null as number | null, jsonBody: null as any };
  const res: any = {
    status: vi.fn().mockImplementation((code: number) => {
      state.statusCode = code;
      return res;
    }),
    json: vi.fn().mockImplementation((body: any) => {
      state.jsonBody = body;
      return res;
    }),
  };
  return { res, ...state };
}

describe('Consent Check Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call next() when no patient ID is present in the request', () => {
    const req = createMockReq({ params: {}, body: {} });
    const { res } = createMockRes();
    const next = vi.fn();
    requirePatientConsent(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('should extract patient ID from params.id', async () => {
    const req = createMockReq({ params: { id: '42' } });
    const { res } = createMockRes();
    const next = vi.fn();
    mockStorage.getPatientConsents.mockResolvedValue([{ id: 1, consentType: 'treatment' }]);
    mockStorage.hasRequiredTreatmentConsents.mockResolvedValue({ hasConsent: true, missingConsents: [] });

    requirePatientConsent(req as Request, res as Response, next);
    // Wait for async
    await vi.waitFor(() => expect(mockStorage.getPatientConsents).toHaveBeenCalledWith(42));
  });

  it('should extract patient ID from params.patientId', async () => {
    const req = createMockReq({ params: { patientId: '99' } });
    const { res } = createMockRes();
    const next = vi.fn();
    mockStorage.getPatientConsents.mockResolvedValue([{ id: 1 }]);
    mockStorage.hasRequiredTreatmentConsents.mockResolvedValue({ hasConsent: true, missingConsents: [] });

    requirePatientConsent(req as Request, res as Response, next);
    await vi.waitFor(() => expect(mockStorage.getPatientConsents).toHaveBeenCalledWith(99));
  });

  it('should extract patient ID from request body', async () => {
    const req = createMockReq({ params: {}, body: { patientId: 77 } });
    const { res } = createMockRes();
    const next = vi.fn();
    mockStorage.getPatientConsents.mockResolvedValue([{ id: 1 }]);
    mockStorage.hasRequiredTreatmentConsents.mockResolvedValue({ hasConsent: true, missingConsents: [] });

    requirePatientConsent(req as Request, res as Response, next);
    await vi.waitFor(() => expect(mockStorage.getPatientConsents).toHaveBeenCalledWith(77));
  });

  it('should skip consent check for invalid patient IDs (non-numeric, zero, negative)', () => {
    const next = vi.fn();
    const { res } = createMockRes();

    // Non-numeric
    requirePatientConsent(createMockReq({ params: { id: 'abc' } }) as Request, res as Response, next);
    expect(next).toHaveBeenCalled();

    next.mockClear();
    // Zero
    requirePatientConsent(createMockReq({ params: { id: '0' } }) as Request, res as Response, next);
    expect(next).toHaveBeenCalled();

    next.mockClear();
    // Negative
    requirePatientConsent(createMockReq({ params: { id: '-5' } }) as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('should allow access (call next) when consent is granted', async () => {
    const req = createMockReq({ params: { id: '1' } });
    const { res } = createMockRes();
    const next = vi.fn();

    mockStorage.getPatientConsents.mockResolvedValue([
      { id: 1, consentType: 'treatment', status: 'active' },
      { id: 2, consentType: 'hipaa_release', status: 'active' },
    ]);
    mockStorage.hasRequiredTreatmentConsents.mockResolvedValue({ hasConsent: true, missingConsents: [] });

    requirePatientConsent(req as Request, res as Response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
  });

  it('should deny access (403) when required consents are missing', async () => {
    const req = createMockReq({ params: { id: '1' } });
    const { res } = createMockRes();
    const next = vi.fn();

    mockStorage.getPatientConsents.mockResolvedValue([
      { id: 1, consentType: 'treatment', status: 'active' },
    ]);
    mockStorage.hasRequiredTreatmentConsents.mockResolvedValue({
      hasConsent: false,
      missingConsents: ['hipaa_release'],
    });

    requirePatientConsent(req as Request, res as Response, next);
    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(403));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'CONSENT_REQUIRED',
          missingConsents: ['hipaa_release'],
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should allow access with warning for legacy patients (no consent records)', async () => {
    const req = createMockReq({ params: { id: '1' } });
    const { res } = createMockRes();
    const next = vi.fn();

    mockStorage.getPatientConsents.mockResolvedValue([]);

    requirePatientConsent(req as Request, res as Response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalled());
    // Should not have called hasRequiredTreatmentConsents
    expect(mockStorage.hasRequiredTreatmentConsents).not.toHaveBeenCalled();
  });

  it('should deny access (403) on system error (fail-closed)', async () => {
    const req = createMockReq({ params: { id: '1' } });
    const { res } = createMockRes();
    const next = vi.fn();

    mockStorage.getPatientConsents.mockRejectedValue(new Error('Database connection lost'));

    requirePatientConsent(req as Request, res as Response, next);
    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(403));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'CONSENT_REQUIRED',
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should prefer params.id over body.patientId', async () => {
    const req = createMockReq({ params: { id: '10' }, body: { patientId: 20 } });
    const { res } = createMockRes();
    const next = vi.fn();

    mockStorage.getPatientConsents.mockResolvedValue([{ id: 1 }]);
    mockStorage.hasRequiredTreatmentConsents.mockResolvedValue({ hasConsent: true, missingConsents: [] });

    requirePatientConsent(req as Request, res as Response, next);
    await vi.waitFor(() => expect(mockStorage.getPatientConsents).toHaveBeenCalledWith(10));
  });

  it('should handle body.patientId as a string', async () => {
    const req = createMockReq({ params: {}, body: { patientId: '55' } });
    const { res } = createMockRes();
    const next = vi.fn();

    mockStorage.getPatientConsents.mockResolvedValue([{ id: 1 }]);
    mockStorage.hasRequiredTreatmentConsents.mockResolvedValue({ hasConsent: true, missingConsents: [] });

    requirePatientConsent(req as Request, res as Response, next);
    await vi.waitFor(() => expect(mockStorage.getPatientConsents).toHaveBeenCalledWith(55));
  });

  it('should return 403 with CONSENT_REQUIRED when hasConsent is false and missingConsents is empty', async () => {
    const req = createMockReq({ params: { id: '1' } });
    const { res } = createMockRes();
    const next = vi.fn();

    mockStorage.getPatientConsents.mockResolvedValue([{ id: 1, consentType: 'other' }]);
    mockStorage.hasRequiredTreatmentConsents.mockResolvedValue({ hasConsent: false, missingConsents: [] });

    requirePatientConsent(req as Request, res as Response, next);
    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(403));
    expect(next).not.toHaveBeenCalled();
  });
});
