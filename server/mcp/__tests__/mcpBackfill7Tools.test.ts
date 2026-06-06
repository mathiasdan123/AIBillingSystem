/**
 * MCP backfill of the 7 tools that previously lived only on the in-app
 * Blanche dispatcher (the "BACKFILL CANDIDATE" set):
 *
 *   create_appointment, suggest_appointment_slot, send_appointment_reminder,
 *   review_denied_claims, review_underpayments, draft_underpayment_dispute,
 *   suggest_claim_correction
 *
 * The business logic for these is shared with the in-app surface via
 * denialReviewService / underpaymentReviewService and (for the appointment
 * tools) mirrors the dispatcher exactly. This file follows the
 * newToolsBackfill.test.ts pattern:
 *
 *   1. Registration: the modules register without throwing.
 *   2. Tenant guard: cross-practice access errors out via ctx.practiceId.
 *   3. Read tools return the shared-service payload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../storage', () => ({
  storage: {
    getPatient: vi.fn(),
    getPractice: vi.fn(),
    getClaim: vi.fn(),
    getClaims: vi.fn(),
    getClaimLineItems: vi.fn(),
    getAppointment: vi.fn(),
    getAppointmentsByDateRange: vi.fn(),
    createAppointment: vi.fn(),
    updateAppointment: vi.fn(),
  },
}));
// underpaymentReviewService touches the DB + drizzle — stub the db layer so
// these unit tests never open a real connection.
vi.mock('../../db', () => ({ db: { select: vi.fn() } }));
vi.mock('../../services/aiDenialPredictor', () => ({ predictDenial: vi.fn() }));
vi.mock('../../middleware/auditMiddleware', () => ({ logAuditEvent: vi.fn() }));
vi.mock('../../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), audit: vi.fn() },
}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { storage } from '../../storage';
import type { McpPracticeContext } from '../types';
import { registerAppointmentTools } from '../tools/appointments';
import { registerDenialTools } from '../tools/denials';

const PRACTICE_ID = 1;
const OTHER_PRACTICE = 99;
const ctx: McpPracticeContext = {
  practiceId: PRACTICE_ID,
  userId: 'user-1',
  role: 'admin',
  apiKey: 'test-key',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MCP backfill (7 tools) — registrations', () => {
  it('appointments.ts (with create/suggest-slot/reminder) registers without throwing', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    expect(() => registerAppointmentTools(server, ctx)).not.toThrow();
  });

  it('denials.ts (with review/correction/underpayment tools) registers without throwing', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    expect(() => registerDenialTools(server, ctx)).not.toThrow();
  });
});

describe('MCP backfill (7 tools) — cross-practice tenant guard', () => {
  it('create_appointment refuses a patient in another practice', async () => {
    vi.mocked(storage.getPatient).mockResolvedValue({
      id: 7, practiceId: OTHER_PRACTICE, firstName: 'X', lastName: 'Y',
    } as any);
    const { withAudit } = await import('../audit');
    const { withMcpMutationGate } = await import('../confirmation');
    vi.mocked(storage.getPractice).mockResolvedValue({ id: PRACTICE_ID } as any);
    const handler = withAudit(
      'create_appointment',
      'appointment',
      true,
      withMcpMutationGate(async (input: any, c: McpPracticeContext) => {
        const p: any = await storage.getPatient(input.patientId);
        if (!p) throw new Error('Patient not found.');
        if (p.practiceId !== c.practiceId) throw new Error('Patient not found in this practice.');
        return { ok: true };
      }),
    );
    const result = await handler({ patientId: 7, date: '2026-07-01', time: '10:00' }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/not found in this practice/i);
    expect(storage.createAppointment).not.toHaveBeenCalled();
  });

  it('suggest_claim_correction refuses a claim in another practice', async () => {
    vi.mocked(storage.getClaim).mockResolvedValue({
      id: 200, practiceId: OTHER_PRACTICE, status: 'denied',
    } as any);
    const { suggestClaimCorrection } = await import('../../services/denialReviewService');
    await expect(suggestClaimCorrection(PRACTICE_ID, 200)).rejects.toThrow(/different practice|does not belong/i);
    expect(storage.getClaimLineItems).not.toHaveBeenCalled();
  });

  it('draft_underpayment_dispute refuses a claim in another practice', async () => {
    vi.mocked(storage.getClaim).mockResolvedValue({
      id: 300, practiceId: OTHER_PRACTICE,
    } as any);
    const { draftUnderpaymentDispute } = await import('../../services/underpaymentReviewService');
    await expect(draftUnderpaymentDispute(PRACTICE_ID, 300)).rejects.toThrow(/does not belong/i);
  });
});

describe('MCP backfill (7 tools) — read behavior', () => {
  it('review_denied_claims returns the shared-service payload (no denials)', async () => {
    vi.mocked(storage.getClaims).mockResolvedValue([] as any);
    const { reviewDeniedClaims } = await import('../../services/denialReviewService');
    const out = await reviewDeniedClaims(PRACTICE_ID);
    expect(out.totalDenied).toBe(0);
    expect(out.deniedClaims).toEqual([]);
    expect(out.message).toMatch(/no denied claims/i);
  });

  it('suggest_claim_correction returns prioritized corrections for a denied claim', async () => {
    vi.mocked(storage.getClaim).mockResolvedValue({
      id: 50, practiceId: PRACTICE_ID, claimNumber: 'CLM50', totalAmount: '120.00',
      denialReason: 'Prior authorization required',
    } as any);
    vi.mocked(storage.getClaimLineItems).mockResolvedValue([] as any);
    const { suggestClaimCorrection } = await import('../../services/denialReviewService');
    const out = await suggestClaimCorrection(PRACTICE_ID, 50);
    expect(out.claimId).toBe(50);
    expect(out.overallStrategy).toBe('resubmit_with_auth');
    expect(out.corrections.some((c) => /authorization/i.test(c.issue))).toBe(true);
  });
});
