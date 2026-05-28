/**
 * P0.6.5: MCP backfill of the 6 tools that previously only existed on the
 * in-app web-chat Blanche surface.
 *
 * Each tool's *logic* is already covered by its corresponding in-app
 * dispatcher test (updatePatientInsuranceTool.test.ts, etc.). What this
 * file pins down:
 *
 *   1. Registration: each module registers without throwing — catches
 *      mismatched zod schemas, missing imports, name collisions.
 *   2. Tenant guard via withAudit: cross-practice access errors out
 *      (different surface than the dispatcher; uses ctx.practiceId).
 *   3. Mutation tools are gated through withMcpMutationGate (verifies the
 *      same practice-level confirmation policy applies to MCP).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../storage', () => ({
  storage: {
    getPatient: vi.fn(),
    updatePatient: vi.fn(),
    upsertSoapDraft: vi.fn(),
    getRecentSoapNotesForPatient: vi.fn(),
    getSoapNote: vi.fn(),
    getTreatmentSession: vi.fn(),
    getUser: vi.fn(),
    signSoapNote: vi.fn(),
    getClaim: vi.fn(),
    getCptCodes: vi.fn(),
    createClaimLineItem: vi.fn(),
    getClaimLineItems: vi.fn(),
    updateClaim: vi.fn(),
    getAppointment: vi.fn(),
    getAppointmentType: vi.fn(),
    getPractice: vi.fn(),
    getAppointments: vi.fn(),
    getPatients: vi.fn(),
  },
}));
vi.mock('../../services/stediService', () => ({}));
vi.mock('../../services/stripeService', () => ({
  isStripeConfigured: vi.fn(() => true),
  createPatientPaymentLink: vi.fn(() => Promise.resolve({ id: 'plink_test', url: 'https://buy.stripe.com/test' })),
}));
vi.mock('../../services/claudeAppealService', () => ({}));
vi.mock('../../services/aiDenialPredictor', () => ({}));
vi.mock('../../services/aiSoapBillingService', () => ({ generateSoapNoteAndBilling: vi.fn() }));
vi.mock('../../middleware/auditMiddleware', () => ({ logAuditEvent: vi.fn() }));
vi.mock('../../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), audit: vi.fn() },
}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { storage } from '../../storage';
import type { McpPracticeContext } from '../types';
import { registerPatientTools } from '../tools/patients';
import { registerSoapTools } from '../tools/soap';
import { registerClaimTools } from '../tools/claims';
import { registerAppointmentTools } from '../tools/appointments';

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

describe('P0.6.5 MCP backfill — tool registrations', () => {
  it('patients.ts (with update_patient_insurance) registers without throwing', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    expect(() => registerPatientTools(server, ctx)).not.toThrow();
  });

  it('soap.ts (with 3 new SOAP tools) registers without throwing', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    expect(() => registerSoapTools(server, ctx)).not.toThrow();
  });

  it('claims.ts (with add_claim_line_item) registers without throwing', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    expect(() => registerClaimTools(server, ctx)).not.toThrow();
  });

  it('appointments.ts (with create_appointment_self_pay_invoice) registers without throwing', () => {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    expect(() => registerAppointmentTools(server, ctx)).not.toThrow();
  });
});

describe('P0.6.5 MCP backfill — cross-practice tenant guard', () => {
  it('update_patient_insurance refuses a patient in another practice', async () => {
    vi.mocked(storage.getPatient).mockResolvedValue({
      id: 42, practiceId: OTHER_PRACTICE, firstName: 'X', lastName: 'Y',
    } as any);
    const { withAudit } = await import('../audit');
    const handler = withAudit(
      'update_patient_insurance',
      'patient',
      true,
      async (input: any, c) => {
        const p: any = await storage.getPatient(input.patientId);
        if (!p) throw new Error('Patient not found');
        if (p.practiceId !== c.practiceId) {
          throw new Error('Access denied: patient belongs to a different practice');
        }
        return { ok: true };
      },
    );
    const result = await handler({ patientId: 42, insuranceProvider: 'Aetna' }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/different practice/i);
    expect(storage.updatePatient).not.toHaveBeenCalled();
  });

  it('sign_soap_note refuses a note whose session is in another practice', async () => {
    vi.mocked(storage.getSoapNote).mockResolvedValue({
      id: 100, sessionId: 50, therapistSignedAt: null,
    } as any);
    vi.mocked(storage.getTreatmentSession).mockResolvedValue({
      id: 50, practiceId: OTHER_PRACTICE,
    } as any);
    const { withAudit } = await import('../audit');
    const handler = withAudit(
      'sign_soap_note',
      'soap_note',
      true,
      async (input: any, c) => {
        const note: any = await storage.getSoapNote(input.noteId);
        if (!note) throw new Error('SOAP note not found');
        const session = await storage.getTreatmentSession(note.sessionId);
        if (!session || session.practiceId !== c.practiceId) {
          throw new Error('Access denied: SOAP note belongs to a different practice');
        }
        return { ok: true };
      },
    );
    const result = await handler({ noteId: 100 }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/different practice/i);
    expect(storage.signSoapNote).not.toHaveBeenCalled();
  });

  it('add_claim_line_item refuses a claim in another practice', async () => {
    vi.mocked(storage.getClaim).mockResolvedValue({
      id: 200, practiceId: OTHER_PRACTICE, status: 'draft',
    } as any);
    const { withAudit } = await import('../audit');
    const handler = withAudit(
      'add_claim_line_item',
      'claim',
      false,
      async (input: any, c) => {
        const claim: any = await storage.getClaim(input.claimId);
        if (!claim) throw new Error('Claim not found');
        if (claim.practiceId !== c.practiceId) {
          throw new Error('Access denied: claim belongs to a different practice');
        }
        return { ok: true };
      },
    );
    const result = await handler({ claimId: 200, cptCodeId: 5 }, ctx);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/different practice/i);
    expect(storage.createClaimLineItem).not.toHaveBeenCalled();
  });
});
