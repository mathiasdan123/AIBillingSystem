import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Blanche's line-item edit/delete tools.
 *
 * These close the gap the add tool has advertised since it shipped ("use the
 * claim UI directly"). The safety story matters more than the feature:
 *
 *   - A lineItemId is an opaque database key. A wrong one points at a REAL
 *     line and silently edits or deletes a different procedure, and a claim
 *     can carry the same CPT on more than one line — so the code alone is not
 *     an identifier. get_claim_line_items exists so the id is looked up, and
 *     the optional cptCode is cross-checked so a wrong id is refused.
 *   - Draft claims only: a submitted claim is one the payer already holds.
 */
const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getClaim: vi.fn(),
    getClaimLineItem: vi.fn(),
    getClaimLineItems: vi.fn(),
    getCptCodes: vi.fn(),
    updateClaimLineItem: vi.fn(),
    deleteClaimLineItem: vi.fn(),
    recalculateClaimTotal: vi.fn(),
    resolvePracticeCptRate: vi.fn(),
    getPatient: vi.fn(),
    getPatients: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));

import { executeTool, summarizeProposal } from '../routes/ai-assistant';

const PRACTICE_ID = 1;
const USER_ID = 'user-1';
const CLAIM_ID = 300;
const LINE_ID = 11;

const draftClaim = (over: any = {}) => ({
  id: CLAIM_ID, practiceId: PRACTICE_ID, status: 'draft',
  claimNumber: 'CLM-1', totalAmount: '578.00', ...over,
});
const lineRow = (over: any = {}) => ({
  id: LINE_ID, claimId: CLAIM_ID, cptCodeId: 5, units: 2,
  rate: '289.00', amount: '578.00', standardRate: '289.00',
  rateOverrideReason: null, modifier: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getClaim.mockResolvedValue(draftClaim());
  mockStorage.getClaimLineItem.mockResolvedValue(lineRow());
  mockStorage.getCptCodes.mockResolvedValue([
    { id: 5, code: '97530', description: 'Therapeutic activities' },
    { id: 6, code: '97110', description: 'Therapeutic exercises' },
  ]);
  mockStorage.updateClaimLineItem.mockImplementation(async (_id: number, patch: any) => ({
    ...lineRow(), ...patch, amount: '867.00',
  }));
  mockStorage.recalculateClaimTotal.mockResolvedValue('867.00');
  mockStorage.resolvePracticeCptRate.mockResolvedValue('289.00');
});

describe('get_claim_line_items', () => {
  it('returns each line with its id so it can be targeted', async () => {
    mockStorage.getClaimLineItems.mockResolvedValue([lineRow()]);
    const out = JSON.parse(
      await executeTool('get_claim_line_items', { claimId: CLAIM_ID }, PRACTICE_ID, USER_ID, 'billing'),
    );
    expect(out.lineItems).toHaveLength(1);
    expect(out.lineItems[0]).toMatchObject({ lineItemId: LINE_ID, cptCode: '97530', units: 2 });
    expect(out.editable).toBe(true);
  });

  it('flags a line billed off the fee schedule', async () => {
    mockStorage.getClaimLineItems.mockResolvedValue([
      lineRow({ rate: '325.00', standardRate: '289.00', rateOverrideReason: 'Extended' }),
    ]);
    const out = JSON.parse(
      await executeTool('get_claim_line_items', { claimId: CLAIM_ID }, PRACTICE_ID, USER_ID, 'billing'),
    );
    expect(out.lineItems[0].billedOffFeeSchedule).toBe(true);
    expect(out.lineItems[0].standardRate).toBe('289.00');
  });

  it('reports a submitted claim as not editable', async () => {
    mockStorage.getClaim.mockResolvedValue(draftClaim({ status: 'submitted' }));
    mockStorage.getClaimLineItems.mockResolvedValue([lineRow()]);
    const out = JSON.parse(
      await executeTool('get_claim_line_items', { claimId: CLAIM_ID }, PRACTICE_ID, USER_ID, 'billing'),
    );
    expect(out.editable).toBe(false);
  });

  it('refuses a cross-practice claim', async () => {
    mockStorage.getClaim.mockResolvedValue(draftClaim({ practiceId: 99 }));
    const out = JSON.parse(
      await executeTool('get_claim_line_items', { claimId: CLAIM_ID }, PRACTICE_ID, USER_ID, 'billing'),
    );
    expect(out.error).toMatch(/not in this practice/i);
  });
});

describe('update_claim_line_item', () => {
  it('updates units and recomputes the claim total', async () => {
    const out = JSON.parse(
      await executeTool(
        'update_claim_line_item',
        { claimId: CLAIM_ID, lineItemId: LINE_ID, cptCode: '97530', units: 3 },
        PRACTICE_ID, USER_ID, 'billing',
      ),
    );
    expect(out.success).toBe(true);
    expect(mockStorage.updateClaimLineItem).toHaveBeenCalledWith(
      LINE_ID, expect.objectContaining({ units: 3 }),
    );
    expect(mockStorage.recalculateClaimTotal).toHaveBeenCalledWith(CLAIM_ID);
  });

  it('refuses when the stated CPT does not match the line', async () => {
    const out = JSON.parse(
      await executeTool(
        'update_claim_line_item',
        { claimId: CLAIM_ID, lineItemId: LINE_ID, cptCode: '97110', units: 3 },
        PRACTICE_ID, USER_ID, 'billing',
      ),
    );
    expect(out.error).toMatch(/is CPT 97530, but you said 97110/i);
    expect(out.error).toMatch(/do not guess/i);
    expect(mockStorage.updateClaimLineItem).not.toHaveBeenCalled();
  });

  it('accepts a one-off charge with a reason', async () => {
    await executeTool(
      'update_claim_line_item',
      { claimId: CLAIM_ID, lineItemId: LINE_ID, rate: 325.5, rateOverrideReason: 'Extended session' },
      PRACTICE_ID, USER_ID, 'billing',
    );
    expect(mockStorage.updateClaimLineItem).toHaveBeenCalledWith(
      LINE_ID,
      expect.objectContaining({ rate: '325.50', rateOverrideReason: 'Extended session' }),
    );
  });

  it('reverts to the fee schedule when rate is null', async () => {
    mockStorage.getClaimLineItem.mockResolvedValue(
      lineRow({ rate: '400.00', rateOverrideReason: 'one-off' }),
    );
    await executeTool(
      'update_claim_line_item',
      { claimId: CLAIM_ID, lineItemId: LINE_ID, rate: null },
      PRACTICE_ID, USER_ID, 'billing',
    );
    expect(mockStorage.updateClaimLineItem).toHaveBeenCalledWith(
      LINE_ID,
      expect.objectContaining({ rate: '289.00', rateOverrideReason: null }),
    );
  });

  it.each([
    ['fractional', 1.5],
    ['zero', 0],
    ['over the cap', 1000],
  ])('rejects %s units', async (_label, units) => {
    const out = JSON.parse(
      await executeTool(
        'update_claim_line_item',
        { claimId: CLAIM_ID, lineItemId: LINE_ID, units },
        PRACTICE_ID, USER_ID, 'billing',
      ),
    );
    expect(out.error).toMatch(/whole number/i);
    expect(mockStorage.updateClaimLineItem).not.toHaveBeenCalled();
  });

  it('refuses to edit a submitted claim', async () => {
    mockStorage.getClaim.mockResolvedValue(draftClaim({ status: 'submitted' }));
    const out = JSON.parse(
      await executeTool(
        'update_claim_line_item',
        { claimId: CLAIM_ID, lineItemId: LINE_ID, units: 3 },
        PRACTICE_ID, USER_ID, 'billing',
      ),
    );
    expect(out.error).toMatch(/only draft claims/i);
    expect(out.error).toMatch(/corrected claim/i);
    expect(mockStorage.updateClaimLineItem).not.toHaveBeenCalled();
  });

  it('refuses a line item that is not on the given claim', async () => {
    mockStorage.getClaimLineItem.mockResolvedValue(lineRow({ claimId: 999 }));
    const out = JSON.parse(
      await executeTool(
        'update_claim_line_item',
        { claimId: CLAIM_ID, lineItemId: LINE_ID, units: 3 },
        PRACTICE_ID, USER_ID, 'billing',
      ),
    );
    expect(out.error).toMatch(/is not on claim/i);
  });

  it('requires a numeric lineItemId and says where to get one', async () => {
    const out = JSON.parse(
      await executeTool(
        'update_claim_line_item', { claimId: CLAIM_ID }, PRACTICE_ID, USER_ID, 'billing',
      ),
    );
    expect(out.error).toMatch(/get_claim_line_items/);
    expect(mockStorage.getClaim).not.toHaveBeenCalled();
  });
});

describe('delete_claim_line_item', () => {
  it('removes the line and recomputes the total', async () => {
    mockStorage.recalculateClaimTotal.mockResolvedValue('0.00');
    const out = JSON.parse(
      await executeTool(
        'delete_claim_line_item',
        { claimId: CLAIM_ID, lineItemId: LINE_ID, cptCode: '97530' },
        PRACTICE_ID, USER_ID, 'billing',
      ),
    );
    expect(out.success).toBe(true);
    expect(out.removed).toMatchObject({ lineItemId: LINE_ID, cptCode: '97530' });
    expect(mockStorage.deleteClaimLineItem).toHaveBeenCalledWith(LINE_ID);
  });

  it('refuses when the stated CPT does not match the line', async () => {
    const out = JSON.parse(
      await executeTool(
        'delete_claim_line_item',
        { claimId: CLAIM_ID, lineItemId: LINE_ID, cptCode: '97110' },
        PRACTICE_ID, USER_ID, 'billing',
      ),
    );
    expect(out.error).toMatch(/is CPT 97530, but you said 97110/i);
    expect(mockStorage.deleteClaimLineItem).not.toHaveBeenCalled();
  });

  it('refuses to delete from a submitted claim', async () => {
    mockStorage.getClaim.mockResolvedValue(draftClaim({ status: 'paid' }));
    const out = JSON.parse(
      await executeTool(
        'delete_claim_line_item',
        { claimId: CLAIM_ID, lineItemId: LINE_ID },
        PRACTICE_ID, USER_ID, 'billing',
      ),
    );
    expect(out.error).toMatch(/only draft claims/i);
    expect(mockStorage.deleteClaimLineItem).not.toHaveBeenCalled();
  });
});

// The confirmation card is the last human check before a claim changes.
// "Update line item 11" is unreviewable; it must name the code and the change.
describe('confirmation card copy', () => {
  it('names the code and every field being changed', () => {
    const summary = summarizeProposal('update_claim_line_item', {
      claimId: CLAIM_ID, lineItemId: LINE_ID, cptCode: '97530', units: 3, modifier: '59',
    });
    expect(summary).toContain('97530');
    expect(summary).toContain('3 units');
    expect(summary).toContain('modifier 59');
    expect(summary).not.toContain('11');
  });

  it('spells out a custom charge', () => {
    expect(
      summarizeProposal('update_claim_line_item', {
        claimId: CLAIM_ID, lineItemId: LINE_ID, cptCode: '97530', rate: 325.5,
      }),
    ).toContain('custom charge $325.50');
  });

  it('describes clearing an override in plain words', () => {
    expect(
      summarizeProposal('update_claim_line_item', {
        claimId: CLAIM_ID, lineItemId: LINE_ID, cptCode: '97530', rate: null,
      }),
    ).toMatch(/back to your fee schedule/i);
  });

  it('warns that the claim total drops on delete', () => {
    const summary = summarizeProposal('delete_claim_line_item', {
      claimId: CLAIM_ID, lineItemId: LINE_ID, cptCode: '97110',
    });
    expect(summary).toContain('97110');
    expect(summary).toMatch(/total will drop/i);
  });
});
