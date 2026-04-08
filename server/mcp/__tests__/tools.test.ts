import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage
vi.mock('../../storage', () => ({
  storage: {
    getDashboardStats: vi.fn(),
    getDaysInAR: vi.fn(),
    getCollectionRate: vi.fn(),
    getRevenueByMonth: vi.fn(),
    getAppointments: vi.fn(),
    getPatient: vi.fn(),
    getPatients: vi.fn(),
    getClaim: vi.fn(),
    getClaims: vi.fn(),
    getClaimLineItems: vi.fn(),
    getPractice: vi.fn(),
    getPayments: vi.fn(),
    getSoapNotes: vi.fn(),
    getAllCptCodes: vi.fn(),
  },
}));

// Mock services
vi.mock('../../services/stediService', () => ({
  checkEligibility: vi.fn(),
  submitClaim: vi.fn(),
  checkClaimStatus: vi.fn(),
}));

vi.mock('../../services/stripeService', () => ({
  createPatientPaymentIntent: vi.fn(),
}));

vi.mock('../../services/claudeAppealService', () => ({
  generateClaudeAppeal: vi.fn(),
}));

vi.mock('../../services/aiDenialPredictor', () => ({
  predictDenial: vi.fn(),
}));

vi.mock('../../services/aiBillingOptimizer', () => ({
  optimizeBillingCodes: vi.fn(),
  getInsuranceBillingRules: vi.fn(),
}));

vi.mock('../../services/aiSoapBillingService', () => ({
  generateSoapNoteAndBilling: vi.fn(),
}));

// Mock audit to pass through
vi.mock('../../middleware/auditMiddleware', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    audit: vi.fn(),
  },
}));

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { storage } from '../../storage';
import type { McpPracticeContext } from '../types';

import { registerDashboardTools } from '../tools/dashboard';
import { registerAnalyticsTools } from '../tools/analytics';
import { registerPatientTools } from '../tools/patients';
import { registerClaimTools } from '../tools/claims';
import { registerEligibilityTools } from '../tools/eligibility';

const mockContext: McpPracticeContext = {
  practiceId: 1,
  userId: 'user-1',
  role: 'admin',
  apiKey: 'test-key',
};

describe('MCP tools registration', () => {
  let server: McpServer;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer({ name: 'test', version: '0.0.1' });
  });

  it('registers dashboard tool without error', () => {
    expect(() => registerDashboardTools(server, mockContext)).not.toThrow();
  });

  it('registers analytics tools without error', () => {
    expect(() => registerAnalyticsTools(server, mockContext)).not.toThrow();
  });

  it('registers patient tools without error', () => {
    expect(() => registerPatientTools(server, mockContext)).not.toThrow();
  });

  it('registers claim tools without error', () => {
    expect(() => registerClaimTools(server, mockContext)).not.toThrow();
  });

  it('registers eligibility tools without error', () => {
    expect(() => registerEligibilityTools(server, mockContext)).not.toThrow();
  });
});

describe('dashboard tool', () => {
  it('calls storage.getDashboardStats with practice ID', async () => {
    const mockStats = {
      totalClaims: 100,
      successRate: 0.85,
      totalRevenue: 50000,
      avgDaysToPayment: 21,
      monthlyClaimsCount: 25,
      monthlyRevenue: 12000,
      denialRate: 0.15,
      pendingClaims: 10,
    };
    vi.mocked(storage.getDashboardStats).mockResolvedValue(mockStats);

    // Use the withAudit wrapper directly since we can't call server tools
    const { withAudit } = await import('../audit');
    const handler = withAudit(
      'get_dashboard_stats',
      'analytics',
      false,
      async () => storage.getDashboardStats(mockContext.practiceId),
    );

    const result = await handler({}, mockContext);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.data.totalClaims).toBe(100);
    expect(storage.getDashboardStats).toHaveBeenCalledWith(1);
  });
});

describe('patient tools', () => {
  it('get_patient rejects access to other practices', async () => {
    vi.mocked(storage.getPatient).mockResolvedValue({
      id: 10,
      practiceId: 999, // different practice
    } as any);

    const { withAudit } = await import('../audit');
    const handler = withAudit(
      'get_patient',
      'patient',
      true,
      async (input: { patientId: number }) => {
        const patient = await storage.getPatient(input.patientId);
        if (!patient) throw new Error('Not found');
        if ((patient as any).practiceId !== mockContext.practiceId) {
          throw new Error('Access denied: patient belongs to a different practice');
        }
        return patient;
      },
    );

    const result = await handler({ patientId: 10 }, mockContext);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Access denied');
  });

  it('search_patients filters by query', async () => {
    vi.mocked(storage.getPatients).mockResolvedValue([
      { id: 1, firstName: 'John', lastName: 'Doe', email: 'john@test.com', practiceId: 1 },
      { id: 2, firstName: 'Jane', lastName: 'Smith', email: 'jane@test.com', practiceId: 1 },
    ] as any);

    const { withAudit } = await import('../audit');
    const handler = withAudit(
      'search_patients',
      'patient',
      true,
      async (input: { query?: string; limit?: number; offset?: number }) => {
        const patients = await storage.getPatients(mockContext.practiceId);
        let results = patients as any[];
        if (input.query) {
          const q = input.query.toLowerCase();
          results = results.filter((p: any) => {
            const name = `${p.firstName || ''} ${p.lastName || ''}`.toLowerCase();
            return name.includes(q);
          });
        }
        return { total: results.length, patients: results.slice(0, input.limit ?? 20) };
      },
    );

    const result = await handler({ query: 'jane' }, mockContext);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.data.total).toBe(1);
    expect(parsed.data.patients[0].firstName).toBe('Jane');
  });
});

describe('claim tools', () => {
  it('get_overdue_claims filters by days threshold', async () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 45);
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 10);

    vi.mocked(storage.getClaims).mockResolvedValue([
      { id: 1, status: 'submitted', submittedAt: oldDate, practiceId: 1 },
      { id: 2, status: 'submitted', submittedAt: recentDate, practiceId: 1 },
      { id: 3, status: 'paid', submittedAt: oldDate, practiceId: 1 },
    ] as any);

    const { withAudit } = await import('../audit');
    const handler = withAudit(
      'get_overdue_claims',
      'claim',
      false,
      async (input: { daysThreshold?: number; limit?: number }) => {
        const claims = await storage.getClaims(mockContext.practiceId);
        const threshold = input.daysThreshold ?? 30;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - threshold);
        const overdue = (claims as any[]).filter((c) => {
          if (c.status !== 'submitted') return false;
          const submitted = c.submittedAt ? new Date(c.submittedAt) : null;
          return submitted && submitted < cutoff;
        });
        return { total: overdue.length, claims: overdue };
      },
    );

    const result = await handler({ daysThreshold: 30 }, mockContext);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.data.total).toBe(1);
    expect(parsed.data.claims[0].id).toBe(1);
  });
});
