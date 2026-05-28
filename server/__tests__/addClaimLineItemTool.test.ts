/**
 * Tests for the add_claim_line_item Blanche tool.
 *
 * Mirrors POST /api/claims/:id/line-items with conversational-surface
 * adjustments:
 *   - Tenant guard on the claim (claims have practiceId directly).
 *   - Status guard: only `draft` claims accept new line items — adding
 *     to a submitted/paid/denied claim is wrong and would corrupt audit
 *     history. Tool returns an actionable error instead.
 *   - Rate/amount computation matches the HTTP route (rate × units).
 *   - Claim total recomputed from all line items after the add, so
 *     subsequent claim queries reflect the new total.
 *
 * Per-line-item update/delete is NOT covered yet — flagged in tool
 * description as a known gap to be addressed separately.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getClaim: vi.fn(),
    getCptCodes: vi.fn(),
    createClaimLineItem: vi.fn(),
    getClaimLineItems: vi.fn(),
    updateClaim: vi.fn(),
    getPatient: vi.fn(),
    getPatients: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));

import { executeTool } from '../routes/ai-assistant';

const PRACTICE_ID = 1;
const OTHER_PRACTICE = 99;
const USER_ID = 'user-1';
const CLAIM_ID = 200;
const CPT_ID = 5;

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getCptCodes.mockResolvedValue([
    { id: CPT_ID, code: '97530', baseRate: '58.50' },
    { id: 6, code: '97110', baseRate: '48.00' },
  ]);
  mockStorage.createClaimLineItem.mockImplementation(async (data: any) => ({
    id: 1000, ...data,
  }));
  mockStorage.updateClaim.mockResolvedValue(undefined);
});

const draftClaim = () => ({ id: CLAIM_ID, practiceId: PRACTICE_ID, status: 'draft' });

describe('add_claim_line_item tool', () => {
  it('adds a line item with rate × units math and recomputes claim total', async () => {
    mockStorage.getClaim.mockResolvedValue(draftClaim());
    mockStorage.getClaimLineItems.mockResolvedValue([
      { amount: '117.00' }, // existing line item
      { amount: '234.00' }, // the new one we're adding (58.50 × 4)
    ]);
    const out = JSON.parse(
      await executeTool(
        'add_claim_line_item',
        { claimId: CLAIM_ID, cptCodeId: CPT_ID, units: 4, dateOfService: '2026-05-29' },
        PRACTICE_ID, USER_ID,
      ),
    );
    expect(out.success).toBe(true);
    expect(out.lineItem).toMatchObject({ cptCode: '97530', units: 4, rate: '58.50', amount: '234.00' });
    expect(out.claim).toMatchObject({ id: CLAIM_ID, newTotalAmount: '351.00', lineItemCount: 2 });
    const created = mockStorage.createClaimLineItem.mock.calls[0][0];
    expect(created.claimId).toBe(CLAIM_ID);
    expect(created.cptCodeId).toBe(CPT_ID);
    expect(created.units).toBe(4);
    expect(created.rate).toBe('58.50');
    expect(created.amount).toBe('234.00');
    expect(created.dateOfService).toBe('2026-05-29');
    expect(mockStorage.updateClaim).toHaveBeenCalledWith(CLAIM_ID, { totalAmount: '351.00' });
  });

  it('rejects when claim is not in draft status', async () => {
    mockStorage.getClaim.mockResolvedValue({ id: CLAIM_ID, practiceId: PRACTICE_ID, status: 'submitted' });
    const out = JSON.parse(
      await executeTool(
        'add_claim_line_item',
        { claimId: CLAIM_ID, cptCodeId: CPT_ID },
        PRACTICE_ID, USER_ID,
      ),
    );
    expect(out.error).toMatch(/cannot add line items.*submitted/i);
    expect(out.error).toMatch(/corrected claim/i);
    expect(mockStorage.createClaimLineItem).not.toHaveBeenCalled();
  });

  it('rejects cross-practice claim (tenant guard)', async () => {
    mockStorage.getClaim.mockResolvedValue({ id: CLAIM_ID, practiceId: OTHER_PRACTICE, status: 'draft' });
    const out = JSON.parse(
      await executeTool(
        'add_claim_line_item',
        { claimId: CLAIM_ID, cptCodeId: CPT_ID },
        PRACTICE_ID, USER_ID,
      ),
    );
    expect(out.error).toMatch(/not in this practice/i);
    expect(mockStorage.createClaimLineItem).not.toHaveBeenCalled();
  });

  it('rejects unknown claim id', async () => {
    mockStorage.getClaim.mockResolvedValue(undefined);
    const out = JSON.parse(
      await executeTool(
        'add_claim_line_item',
        { claimId: 999999, cptCodeId: CPT_ID },
        PRACTICE_ID, USER_ID,
      ),
    );
    expect(out.error).toMatch(/not found/i);
    expect(mockStorage.createClaimLineItem).not.toHaveBeenCalled();
  });

  it('rejects unknown CPT code id with actionable error', async () => {
    mockStorage.getClaim.mockResolvedValue(draftClaim());
    const out = JSON.parse(
      await executeTool(
        'add_claim_line_item',
        { claimId: CLAIM_ID, cptCodeId: 99999 },
        PRACTICE_ID, USER_ID,
      ),
    );
    expect(out.error).toMatch(/cpt code id.*not found/i);
    expect(mockStorage.createClaimLineItem).not.toHaveBeenCalled();
  });

  it('defaults units to 1 and dateOfService to today when not provided', async () => {
    mockStorage.getClaim.mockResolvedValue(draftClaim());
    mockStorage.getClaimLineItems.mockResolvedValue([{ amount: '58.50' }]);
    await executeTool(
      'add_claim_line_item',
      { claimId: CLAIM_ID, cptCodeId: CPT_ID },
      PRACTICE_ID, USER_ID,
    );
    const created = mockStorage.createClaimLineItem.mock.calls[0][0];
    expect(created.units).toBe(1);
    expect(created.amount).toBe('58.50');
    expect(created.dateOfService).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects missing or non-numeric claimId / cptCodeId', async () => {
    const a = JSON.parse(await executeTool('add_claim_line_item', { cptCodeId: CPT_ID }, PRACTICE_ID, USER_ID));
    expect(a.error).toMatch(/claimId is required/i);
    const b = JSON.parse(await executeTool('add_claim_line_item', { claimId: CLAIM_ID }, PRACTICE_ID, USER_ID));
    expect(b.error).toMatch(/cptCodeId is required/i);
    expect(mockStorage.getClaim).not.toHaveBeenCalled();
  });
});
