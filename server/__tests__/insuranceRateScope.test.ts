/**
 * Role-gating audit F1 — insurance_rates tenant scoping.
 *
 * insurance_rates predates multi-tenancy: it had no practice_id column, so
 * every practice read and wrote one global rate table. The fix adds a
 * nullable practice_id, and insuranceRateScope() is the single condition
 * every scoped read/write/delete uses. The cross-tenant contract:
 *
 *   - practice 1 sees its own rows AND the legacy NULL rows (every NULL row
 *     was created when practice 1 was the only real practice)
 *   - every other practice sees ONLY rows stamped with its own id —
 *     never NULL legacy rows, never another practice's rows
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, getDb: async () => ({}), dbReady: Promise.resolve() }));
vi.mock('../services/cacheService', () => ({
  cache: { get: async () => null, set: async () => {}, del: async () => {} },
  CacheKeys: new Proxy({}, { get: () => () => 'k' }),
  CacheTTL: new Proxy({}, { get: () => 60 }),
}));

import { eq, or, isNull } from 'drizzle-orm';
import { insuranceRates } from '@shared/schema';
import {
  insuranceRateScope,
  LEGACY_INSURANCE_RATES_PRACTICE_ID,
} from '../storage/claims';

describe('insuranceRateScope (F1 cross-tenant read)', () => {
  it('legacy practice (1) sees its own rows plus NULL legacy rows', () => {
    expect(LEGACY_INSURANCE_RATES_PRACTICE_ID).toBe(1);
    const scope = insuranceRateScope(1);
    const expected = or(eq(insuranceRates.practiceId, 1), isNull(insuranceRates.practiceId))!;
    expect(scope).toEqual(expected);
  });

  it('every other practice sees ONLY rows stamped with its own id — NULL legacy rows are excluded', () => {
    const scope = insuranceRateScope(2);
    const expected = eq(insuranceRates.practiceId, 2);
    expect(scope).toEqual(expected);

    // And it is NOT the legacy-inclusive condition: practice 2 must never
    // match practice 1's legacy NULL rows.
    const legacyInclusive = or(eq(insuranceRates.practiceId, 2), isNull(insuranceRates.practiceId))!;
    expect(scope).not.toEqual(legacyInclusive);
  });

  it('two different practices produce disjoint scopes (no shared rows possible)', () => {
    expect(insuranceRateScope(2)).not.toEqual(insuranceRateScope(3));
  });
});
