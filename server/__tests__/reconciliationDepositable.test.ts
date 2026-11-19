/**
 * Deposits statement (demo billing test 2026-11-19, item 7): a $0
 * remittance carries nothing to deposit and must not sit in "awaiting
 * deposit" or be offered to the matching engine.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { isDepositable } from '../services/reconciliation/reconciliationService';

describe('isDepositable', () => {
  it('is true only for a positive remitted amount', () => {
    expect(isDepositable({ totalPaymentAmount: '246.65' } as any)).toBe(true);
    expect(isDepositable({ totalPaymentAmount: '0.01' } as any)).toBe(true);
    expect(isDepositable({ totalPaymentAmount: '0.00' } as any)).toBe(false);
    expect(isDepositable({ totalPaymentAmount: '0' } as any)).toBe(false);
    expect(isDepositable({ totalPaymentAmount: '-5.00' } as any)).toBe(false);
    expect(isDepositable({ totalPaymentAmount: null } as any)).toBe(false);
  });
});
