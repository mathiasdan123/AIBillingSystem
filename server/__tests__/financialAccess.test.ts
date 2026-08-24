/**
 * requireFinancialRole — practice financials (fee schedules, claim charges,
 * ERAs, revenue analytics) are admin/billing only. Therapist-role users
 * review and approve codes but must not see what the practice bills per
 * CPT code/session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: { getUser: vi.fn() },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requireFinancialRole, FINANCIAL_ROLES } from '../middleware/financial-access';

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function makeReq(sub: string | undefined) {
  return { user: sub ? { claims: { sub } } : undefined } as any;
}

describe('requireFinancialRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = makeRes();
    const next = vi.fn();
    await requireFinancialRole(makeReq(undefined), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects therapist role with 403', async () => {
    mockStorage.getUser.mockResolvedValue({ id: 'u1', role: 'therapist' });
    const res = makeRes();
    const next = vi.fn();
    await requireFinancialRole(makeReq('u1'), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an unknown/missing role with 403 (fail closed)', async () => {
    mockStorage.getUser.mockResolvedValue({ id: 'u1', role: 'front-desk' });
    const res = makeRes();
    const next = vi.fn();
    await requireFinancialRole(makeReq('u1'), res, next);
    expect(res.status).toHaveBeenCalledWith(403);

    mockStorage.getUser.mockResolvedValue(null);
    const res2 = makeRes();
    await requireFinancialRole(makeReq('u1'), res2, vi.fn());
    expect(res2.status).toHaveBeenCalledWith(403);
  });

  it.each(FINANCIAL_ROLES)('allows %s role through', async (role) => {
    mockStorage.getUser.mockResolvedValue({ id: 'u1', role });
    const res = makeRes();
    const next = vi.fn();
    await requireFinancialRole(makeReq('u1'), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 500, not next(), when the role lookup throws', async () => {
    mockStorage.getUser.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    const next = vi.fn();
    await requireFinancialRole(makeReq('u1'), res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
  });
});
