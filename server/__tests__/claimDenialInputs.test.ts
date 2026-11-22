/**
 * Shared loader for the denial predictor's claim input (#489 review): the
 * route, the MCP tool and the compliance service all build the claim input
 * here, so they agree on the payer and the linked session's date. A session
 * is used only when it belongs to the claim's practice and patient; a
 * failed lookup is logged, never swallowed, and never fails the prediction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { storageStub, loggerStub } = vi.hoisted(() => ({
  storageStub: { getTreatmentSession: vi.fn(), getInsurances: vi.fn() },
  loggerStub: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../services/logger', () => ({ default: loggerStub }));

import { buildPredictDenialClaimInput, loadClaimSessionDate, resolveClaimInsuranceName } from '../services/claimDenialInputs';

const claim = { id: 42, claimNumber: 'DEMO-2-1004', totalAmount: '289.00', status: 'draft', insuranceId: 4, sessionId: 9, practiceId: 2, patientId: 102 };

describe('loadClaimSessionDate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the session day when the session belongs to the claim', async () => {
    storageStub.getTreatmentSession.mockResolvedValue({ id: 9, practiceId: 2, patientId: 102, sessionDate: '2026-10-26' });
    expect(await loadClaimSessionDate(claim)).toBe('2026-10-26');
    expect(loggerStub.warn).not.toHaveBeenCalled();
  });

  it('accepts a Date-valued session date', async () => {
    // The pg driver parses a `date` column as a Date at LOCAL midnight.
    storageStub.getTreatmentSession.mockResolvedValue({ id: 9, practiceId: 2, patientId: 102, sessionDate: new Date(2026, 9, 26) });
    expect(await loadClaimSessionDate(claim)).toBe('2026-10-26');
    storageStub.getTreatmentSession.mockResolvedValue({ id: 9, practiceId: 2, patientId: 102, sessionDate: 'not a date' });
    expect(await loadClaimSessionDate(claim)).toBeNull();
  });

  it('does not look anything up for a claim with no session', async () => {
    expect(await loadClaimSessionDate({ ...claim, sessionId: null })).toBeNull();
    expect(storageStub.getTreatmentSession).not.toHaveBeenCalled();
  });

  it('ignores a session from another practice or another patient, and says so', async () => {
    storageStub.getTreatmentSession.mockResolvedValue({ id: 9, practiceId: 3, patientId: 102, sessionDate: '2026-10-26' });
    expect(await loadClaimSessionDate(claim)).toBeNull();
    storageStub.getTreatmentSession.mockResolvedValue({ id: 9, practiceId: 2, patientId: 999, sessionDate: '2026-10-26' });
    expect(await loadClaimSessionDate(claim)).toBeNull();
    expect(loggerStub.warn).toHaveBeenCalledTimes(2);
    expect(loggerStub.warn.mock.calls[0][0]).toMatch(/does not belong to the claim/);
    expect(loggerStub.warn.mock.calls[0][1]).toMatchObject({ claimId: 42, sessionId: 9, claimPracticeId: 2, sessionPracticeId: 3 });
  });

  it('logs a missing session and a failed lookup instead of throwing', async () => {
    storageStub.getTreatmentSession.mockResolvedValue(undefined);
    expect(await loadClaimSessionDate(claim)).toBeNull();
    expect(loggerStub.warn).toHaveBeenCalledWith(expect.stringMatching(/not found/), { claimId: 42, sessionId: 9 });

    storageStub.getTreatmentSession.mockRejectedValue(new Error('connection reset'));
    expect(await loadClaimSessionDate(claim)).toBeNull();
    expect(loggerStub.error).toHaveBeenCalledWith(expect.stringMatching(/lookup failed/), expect.objectContaining({ claimId: 42, error: 'connection reset' }));
  });
});

describe('buildPredictDenialClaimInput', () => {
  beforeEach(() => vi.clearAllMocks());

  it('carries the identifiers, the claim payer and the session date', async () => {
    storageStub.getTreatmentSession.mockResolvedValue({ id: 9, practiceId: 2, patientId: 102, sessionDate: '2026-10-26' });
    storageStub.getInsurances.mockResolvedValue([{ id: 4, name: 'Aetna' }, { id: 5, name: 'Cigna' }]);
    expect(await buildPredictDenialClaimInput(claim)).toEqual({
      id: 42, claimNumber: 'DEMO-2-1004', totalAmount: '289.00', status: 'draft', insuranceId: 4,
      insuranceName: 'Aetna', sessionDate: '2026-10-26', sessionId: 9,
    });
  });

  it('a claim with no payer and a failed catalog lookup still gets an input', async () => {
    storageStub.getInsurances.mockRejectedValue(new Error('boom'));
    expect(await resolveClaimInsuranceName({ id: 1, insuranceId: 4 })).toBeNull();
    expect(loggerStub.warn).toHaveBeenCalledWith(expect.stringMatching(/payer lookup failed/), expect.objectContaining({ claimId: 1 }));
    expect(await resolveClaimInsuranceName({ id: 1, insuranceId: null })).toBeNull();
    const input = await buildPredictDenialClaimInput({ ...claim, insuranceId: null, sessionId: null });
    expect(input).toMatchObject({ insuranceName: null, sessionDate: null });
  });
});
