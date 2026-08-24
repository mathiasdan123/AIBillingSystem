/**
 * Multi-tenant isolation (P0). A practice's own admin must NOT read or write
 * another practice by passing ?practiceId=. Only a platform (founder) admin
 * may. Tests the fixed resolver + verifyPatientAccess from patients.ts, the
 * canonical copy of the pattern replicated across the route layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: { getPatient: vi.fn() },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({ db: {}, getDb: () => ({}) }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getAuthorizedPracticeId, verifyPatientAccess } from '../routes/patients';

function req(opts: {
  role?: string;
  practice?: number;
  platform?: boolean;
  requested?: number;
}): any {
  return {
    userRole: opts.role ?? 'therapist',
    userPracticeId: opts.practice,
    isPlatformAdmin: !!opts.platform,
    query: opts.requested ? { practiceId: String(opts.requested) } : {},
    user: { claims: { sub: 'u1' } },
  };
}

describe('getAuthorizedPracticeId — tenant isolation', () => {
  it('clamps a practice admin to their own practice, ignoring a foreign ?practiceId', () => {
    expect(getAuthorizedPracticeId(req({ role: 'admin', practice: 2, requested: 1 }))).toBe(2);
  });

  it('clamps a demo admin (non-platform) to the demo practice', () => {
    // Demo login is role=admin bound to the demo practice; ?practiceId=1 must not leak practice 1.
    expect(getAuthorizedPracticeId(req({ role: 'admin', practice: 2, requested: 1 }))).toBe(2);
  });

  it('lets a platform (founder) admin resolve a foreign practice', () => {
    expect(getAuthorizedPracticeId(req({ role: 'admin', practice: 1, platform: true, requested: 5 }))).toBe(5);
  });

  it('clamps a therapist to their own practice', () => {
    expect(getAuthorizedPracticeId(req({ role: 'therapist', practice: 3, requested: 9 }))).toBe(3);
  });

  it('honors ?practiceId when it equals the admin\'s own practice', () => {
    expect(getAuthorizedPracticeId(req({ role: 'admin', practice: 4, requested: 4 }))).toBe(4);
  });
});

describe('verifyPatientAccess — IDOR', () => {
  beforeEach(() => vi.clearAllMocks());

  it('denies a practice admin access to a patient in another practice', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 10, practiceId: 1, firstName: 'Real' });
    const r = await verifyPatientAccess(req({ role: 'admin', practice: 2 }), 10);
    expect(r.authorized).toBe(false);
    expect(r.patient).toBeNull();
  });

  it('allows a platform admin to reach any patient', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 10, practiceId: 1, firstName: 'Real' });
    const r = await verifyPatientAccess(req({ role: 'admin', practice: 2, platform: true }), 10);
    expect(r.authorized).toBe(true);
  });

  it('allows an admin to reach a patient in their own practice', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 11, practiceId: 2, firstName: 'Mine' });
    const r = await verifyPatientAccess(req({ role: 'admin', practice: 2 }), 11);
    expect(r.authorized).toBe(true);
  });
});
