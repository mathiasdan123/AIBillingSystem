import { describe, it, expect, vi, beforeEach } from 'vitest';

// Test the generate_soap_note MCP tool's tenant guard directly by mocking the
// audit/confirmation wrappers to pass-through, and capturing the registered
// handler from a fake McpServer.
const { mockStorage, mockGenerate } = vi.hoisted(() => ({
  mockStorage: { getPatient: vi.fn() },
  mockGenerate: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../storage', () => ({ storage: mockStorage }));
vi.mock('../../services/aiSoapBillingService', () => ({ generateSoapNoteAndBilling: mockGenerate }));
vi.mock('../audit', () => ({ withAudit: (_n: any, _t: any, _p: any, fn: any) => fn }));
vi.mock('../confirmation', () => ({ withMcpMutationGate: (fn: any) => fn }));

import { registerSoapTools } from '../tools/soap';

function captureTool(name: string, context: any) {
  let handler: any;
  const server: any = {
    tool: (n: string, _d: string, _s: any, fn: any) => {
      if (n === name) handler = fn;
    },
  };
  registerSoapTools(server, context);
  return handler;
}

const CONTEXT = { practiceId: 1, userId: 'u1', role: 'admin', apiKey: 'k' };
const baseInput = {
  patientId: 42,
  activities: ['obstacle course'],
  mood: 'cooperative',
  duration: 45,
  location: 'clinic',
  assessment: { performance: 'fair', assistance: 'mod', strength: 'ok', motorPlanning: 'ok', sensoryRegulation: 'ok' },
  planNextSteps: 'continue',
};

describe('generate_soap_note MCP tool — tenant isolation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a patient from another practice and never generates a note', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 42, practiceId: 99 }); // other practice
    const handler = captureTool('generate_soap_note', CONTEXT);
    await expect(handler(baseInput)).rejects.toThrow(/not found/i);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('forwards the caller practiceId when the patient belongs to it', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: 42, practiceId: 1 });
    const handler = captureTool('generate_soap_note', CONTEXT);
    await handler(baseInput);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate.mock.calls[0][0].practiceId).toBe(1);
  });
});
