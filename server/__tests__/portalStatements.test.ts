/**
 * What a patient sees on their statements screen.
 *
 * 1. Draft statements were returned to the portal. A draft is the practice's
 *    work in progress — a bill they have not decided to send — so unfinished
 *    figures were presented to the patient as an amount owed.
 *
 * 2. Opening a draft silently flipped it to 'sent'. The act of a patient
 *    LOOKING at unfinished figures turned them into an issued statement,
 *    which then drives aging and dunning. The practice decides when a
 *    statement is sent, not the patient.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatientPortalByToken: vi.fn(),
    getPatient: vi.fn(),
    getPatientStatements: vi.fn(),
    getPatientStatement: vi.fn(),
    markStatementSent: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../middleware/auditMiddleware', () => ({ logAuditEvent: vi.fn() }));
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));
vi.mock('../email', () => ({ isEmailConfigured: () => false }));

import publicPortalRouter from '../routes/public-portal';

const TOKEN = 'c'.repeat(64);
let app: Express;

beforeEach(() => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  app.use('/api', publicPortalRouter);
  mockStorage.getPatientPortalByToken.mockResolvedValue({
    id: 1, patientId: 10, practiceId: 1, canViewStatements: true,
  });
  mockStorage.getPatient.mockResolvedValue({ id: 10, practiceId: 1 });
});

describe('GET /public/portal/:token/statements', () => {
  it('hides drafts — a bill the practice has not decided to send', async () => {
    mockStorage.getPatientStatements.mockResolvedValue([
      { id: 1, status: 'sent', patientBalance: '30.00' },
      { id: 2, status: 'draft', patientBalance: '999.00' },
      { id: 3, status: 'paid', patientBalance: '0.00' },
    ]);

    const res = await request(app).get(`/api/public/portal/${TOKEN}/statements`);

    expect(res.status).toBe(200);
    expect(res.body.map((s: any) => s.id)).toEqual([1, 3]);
  });
});

describe('GET /public/portal/:token/statements/:id', () => {
  it('does not let a patient turn a draft into a sent bill by opening it', async () => {
    mockStorage.getPatientStatement.mockResolvedValue({
      id: 2, patientId: 10, status: 'draft', patientBalance: '999.00',
    });

    const res = await request(app).get(`/api/public/portal/${TOKEN}/statements/2`);

    expect(res.status).toBe(404);
    expect(mockStorage.markStatementSent).not.toHaveBeenCalled();
  });

  it('still shows a real, issued statement', async () => {
    mockStorage.getPatientStatement.mockResolvedValue({
      id: 1, patientId: 10, status: 'sent', patientBalance: '30.00',
    });

    const res = await request(app).get(`/api/public/portal/${TOKEN}/statements/1`);

    expect(res.status).toBe(200);
    expect(res.body.patientBalance).toBe('30.00');
  });

  it("refuses another patient's statement", async () => {
    mockStorage.getPatientStatement.mockResolvedValue({
      id: 9, patientId: 999, status: 'sent',
    });

    const res = await request(app).get(`/api/public/portal/${TOKEN}/statements/9`);
    expect(res.status).toBe(404);
  });
});
