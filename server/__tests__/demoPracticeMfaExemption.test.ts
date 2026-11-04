/**
 * Demo-practice MFA exemption.
 *
 * Live failure this guards (2026-10-26 to 2026-11-04): the mfaSecret
 * encryption fix force-reset every enrollment, including the shared
 * demo@therapybill.com account behind the public "Try Free Demo" button.
 * mfa-setup-required reads mfaEnabled from the account record, so every
 * prospect was walled off with "Set Up Two-Factor Authentication" until an
 * admin happened to re-enroll that account by hand. Demo-practice users
 * must never be gated on MFA; real-practice users must always be.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStorage = vi.hoisted(() => ({
  getUser: vi.fn(),
  getPractice: vi.fn(),
}));
vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('../services/platformAdmin', () => ({
  isPlatformAdminEmail: (email: string | null | undefined) => email === 'platform@therapybill.com',
}));

import { isMfaExemptDemoUser, clearDemoPracticeCache } from '../middleware/demoPracticeExemption';
import { mfaRequired } from '../middleware/mfa-required';
import { mfaSetupRequired } from '../middleware/mfa-setup-required';

function req(overrides: any = {}): any {
  return {
    path: '/api/patients',
    originalUrl: '/api/patients',
    user: { claims: { sub: 'user-1' } },
    session: {},
    ...overrides,
  };
}
function res(): any {
  const r: any = {};
  r.status = vi.fn().mockReturnValue(r);
  r.json = vi.fn().mockReturnValue(r);
  return r;
}

const DEMO_PRACTICE = { id: 42, isDemo: true };
const REAL_PRACTICE = { id: 7, isDemo: false };

beforeEach(() => {
  vi.clearAllMocks();
  clearDemoPracticeCache();
  delete process.env.SKIP_MFA_ENFORCEMENT;
});

describe('isMfaExemptDemoUser', () => {
  it('is true for a user of the demo practice', async () => {
    mockStorage.getPractice.mockResolvedValue(DEMO_PRACTICE);
    expect(await isMfaExemptDemoUser({ practiceId: 42, email: 'demo@therapybill.com' })).toBe(true);
  });

  it('is false for a real practice, a missing practice, and no practiceId', async () => {
    mockStorage.getPractice.mockResolvedValue(REAL_PRACTICE);
    expect(await isMfaExemptDemoUser({ practiceId: 7, email: 'x@example.com' })).toBe(false);
    mockStorage.getPractice.mockResolvedValue(undefined);
    expect(await isMfaExemptDemoUser({ practiceId: 99, email: 'x@example.com' })).toBe(false);
    expect(await isMfaExemptDemoUser({ practiceId: null, email: 'x@example.com' })).toBe(false);
  });

  it('never exempts a platform admin, even on the demo practice', async () => {
    mockStorage.getPractice.mockResolvedValue(DEMO_PRACTICE);
    expect(await isMfaExemptDemoUser({ practiceId: 42, email: 'platform@therapybill.com' })).toBe(false);
  });

  it('fails closed when the practice lookup throws', async () => {
    mockStorage.getPractice.mockRejectedValue(new Error('db down'));
    expect(await isMfaExemptDemoUser({ practiceId: 42, email: 'demo@therapybill.com' })).toBe(false);
  });

  it('caches the practice flag so repeated checks do not hit the database', async () => {
    mockStorage.getPractice.mockResolvedValue(DEMO_PRACTICE);
    await isMfaExemptDemoUser({ practiceId: 42, email: 'demo@therapybill.com' });
    await isMfaExemptDemoUser({ practiceId: 42, email: 'demo@therapybill.com' });
    expect(mockStorage.getPractice).toHaveBeenCalledTimes(1);
  });
});

describe('mfaSetupRequired with the demo practice', () => {
  it('lets an un-enrolled demo-practice user through (the Try Free Demo path)', async () => {
    mockStorage.getUser.mockResolvedValue({ id: 'user-1', email: 'demo@therapybill.com', practiceId: 42, mfaEnabled: false, role: 'admin' });
    mockStorage.getPractice.mockResolvedValue(DEMO_PRACTICE);
    const next = vi.fn();
    const r = res();

    await mfaSetupRequired(req(), r, next);

    expect(next).toHaveBeenCalled();
    expect(r.status).not.toHaveBeenCalled();
  });

  it('still blocks an un-enrolled real-practice user', async () => {
    mockStorage.getUser.mockResolvedValue({ id: 'user-1', email: 'therapist@clinic.com', practiceId: 7, mfaEnabled: false, role: 'therapist' });
    mockStorage.getPractice.mockResolvedValue(REAL_PRACTICE);
    const next = vi.fn();
    const r = res();

    await mfaSetupRequired(req(), r, next);

    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MFA_SETUP_REQUIRED' }));
  });
});

describe('mfaRequired with the demo practice', () => {
  it('skips the session challenge for a demo-practice user whose MFA window lapsed', async () => {
    mockStorage.getUser.mockResolvedValue({ id: 'user-1', email: 'demo@therapybill.com', practiceId: 42, mfaEnabled: true, role: 'admin' });
    mockStorage.getPractice.mockResolvedValue(DEMO_PRACTICE);
    const next = vi.fn();
    const r = res();

    await mfaRequired(req({ session: {} }), r, next); // no mfaVerifiedAt at all

    expect(next).toHaveBeenCalled();
    expect(r.status).not.toHaveBeenCalled();
  });

  it('still challenges a real-practice user whose MFA window lapsed', async () => {
    mockStorage.getUser.mockResolvedValue({ id: 'user-1', email: 'therapist@clinic.com', practiceId: 7, mfaEnabled: true, role: 'therapist' });
    mockStorage.getPractice.mockResolvedValue(REAL_PRACTICE);
    const next = vi.fn();
    const r = res();

    await mfaRequired(req({ session: {} }), r, next);

    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(403);
  });

  it('still challenges a platform admin attached to the demo practice', async () => {
    mockStorage.getUser.mockResolvedValue({ id: 'user-1', email: 'platform@therapybill.com', practiceId: 42, mfaEnabled: true, role: 'admin' });
    mockStorage.getPractice.mockResolvedValue(DEMO_PRACTICE);
    const next = vi.fn();
    const r = res();

    await mfaRequired(req({ session: {} }), r, next);

    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(403);
  });
});
