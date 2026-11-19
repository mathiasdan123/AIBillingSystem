/**
 * Work-queue actions on claim follow-ups (QA sweep 2026-11-18): complete,
 * snooze and due-date edit over PATCH/POST /api/follow-ups/:id*. Routes are
 * exercised with the service mocked, so these pin the contract: validation,
 * what the service is asked to store, and that the practice scope always
 * comes from the session.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockService } = vi.hoisted(() => ({
  mockService: {
    generateFollowUps: vi.fn(),
    getFollowUps: vi.fn(),
    updateFollowUp: vi.fn(),
    getFollowUpSummary: vi.fn(),
    dismissFollowUp: vi.fn(),
    completeFollowUp: vi.fn(),
    snoozeFollowUp: vi.fn(),
  },
}));

vi.mock('../services/claimFollowUpService', () => mockService);
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// Session: practice 7, user "biller-a". A body/query practiceId must never win.
let sessionPracticeId = 7;
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'biller-a' } };
    req.userPracticeId = sessionPracticeId;
    req.userRole = 'billing';
    next();
  },
}));

import followUpsRouter from '../routes/follow-ups';

let app: Express;
beforeEach(() => {
  vi.clearAllMocks();
  sessionPracticeId = 7;
  app = express();
  app.use(express.json());
  app.use('/api/follow-ups', followUpsRouter);
  mockService.updateFollowUp.mockImplementation(async (id: number, practiceId: number, updates: any) => ({ id, practiceId, ...updates }));
  mockService.completeFollowUp.mockImplementation(async (id: number, practiceId: number, by: string) => ({ id, practiceId, status: 'completed', completedBy: by }));
  mockService.snoozeFollowUp.mockImplementation(async (id: number, practiceId: number, until: Date) => ({ id, practiceId, snoozedUntil: until.toISOString() }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PATCH /api/follow-ups/:id due date', () => {
  it('stores a YYYY-MM-DD due date as UTC midnight of that day (date-only semantics)', async () => {
    const res = await request(app).patch('/api/follow-ups/12').send({ dueDate: '2027-01-17' });
    expect(res.status).toBe(200);
    const [id, practiceId, updates] = mockService.updateFollowUp.mock.calls[0];
    expect(id).toBe(12);
    expect(practiceId).toBe(7);
    expect(updates.dueDate).toBeInstanceOf(Date);
    expect(updates.dueDate.toISOString()).toBe('2027-01-17T00:00:00.000Z');
  });

  it('clears the due date on null or empty string', async () => {
    await request(app).patch('/api/follow-ups/12').send({ dueDate: null });
    expect(mockService.updateFollowUp.mock.calls[0][2].dueDate).toBeNull();
    await request(app).patch('/api/follow-ups/12').send({ dueDate: '' });
    expect(mockService.updateFollowUp.mock.calls[1][2].dueDate).toBeNull();
  });

  it('leaves the due date alone when the field is absent', async () => {
    await request(app).patch('/api/follow-ups/12').send({ notes: 'called payer' });
    const updates = mockService.updateFollowUp.mock.calls[0][2];
    expect('dueDate' in updates).toBe(false);
    expect(updates.notes).toBe('called payer');
  });

  it('rejects malformed, impossible, timestamp-shaped and non-string due dates with 400', async () => {
    for (const bad of ['17/01/2027', '2027-02-31', '2027-01-17T00:00:00Z', 20270117, true, 'tomorrow']) {
      mockService.updateFollowUp.mockClear();
      const res = await request(app).patch('/api/follow-ups/12').send({ dueDate: bad });
      expect(res.status, String(bad)).toBe(400);
      expect(mockService.updateFollowUp).not.toHaveBeenCalled();
    }
  });

  it('rejects an unknown status or priority', async () => {
    expect((await request(app).patch('/api/follow-ups/12').send({ status: 'done' })).status).toBe(400);
    expect((await request(app).patch('/api/follow-ups/12').send({ priority: 'critical' })).status).toBe(400);
    expect(mockService.updateFollowUp).not.toHaveBeenCalled();
  });

  it('status: completed over PATCH records the signed-in user as completedBy', async () => {
    await request(app).patch('/api/follow-ups/12').send({ status: 'completed' });
    expect(mockService.updateFollowUp.mock.calls[0][2]).toMatchObject({ status: 'completed', completedBy: 'biller-a' });
  });

  it('un-snoozes with snoozedUntil: null but refuses a snooze value (that goes through /snooze)', async () => {
    const ok = await request(app).patch('/api/follow-ups/12').send({ snoozedUntil: null });
    expect(ok.status).toBe(200);
    expect(mockService.updateFollowUp.mock.calls[0][2].snoozedUntil).toBeNull();
    const bad = await request(app).patch('/api/follow-ups/12').send({ snoozedUntil: '2027-01-20' });
    expect(bad.status).toBe(400);
  });

  it('404s when the service finds nothing in the caller practice', async () => {
    mockService.updateFollowUp.mockResolvedValueOnce(undefined);
    const res = await request(app).patch('/api/follow-ups/999').send({ notes: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/follow-ups/:id/complete', () => {
  it('completes in the session practice and records who did it', async () => {
    const res = await request(app).post('/api/follow-ups/12/complete');
    expect(res.status).toBe(200);
    expect(mockService.completeFollowUp).toHaveBeenCalledWith(12, 7, 'biller-a');
    expect(res.body.completedBy).toBe('biller-a');
  });

  it('ignores a practiceId in the query that is not the caller practice (tenant scope)', async () => {
    await request(app).post('/api/follow-ups/12/complete?practiceId=99');
    expect(mockService.completeFollowUp.mock.calls[0][1]).toBe(7);
  });

  it('404s for an id the service does not find in the caller practice', async () => {
    mockService.completeFollowUp.mockResolvedValueOnce(undefined);
    expect((await request(app).post('/api/follow-ups/12/complete')).status).toBe(404);
  });
});

describe('POST /api/follow-ups/:id/snooze', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 2026-11-18 15:00 UTC = 10:00 AM Eastern.
    vi.setSystemTime(new Date('2026-11-18T15:00:00.000Z'));
  });

  it('until: YYYY-MM-DD snoozes to the start of that day in the practice timezone', async () => {
    const res = await request(app).post('/api/follow-ups/12/snooze').send({ until: '2026-11-21' });
    expect(res.status).toBe(200);
    const [id, practiceId, until] = mockService.snoozeFollowUp.mock.calls[0];
    expect(id).toBe(12);
    expect(practiceId).toBe(7);
    // Midnight Eastern (EST, UTC-5) on the 21st.
    expect(until.toISOString()).toBe('2026-11-21T05:00:00.000Z');
  });

  it('days: N snoozes to the start of the Nth day from now, practice time', async () => {
    await request(app).post('/api/follow-ups/12/snooze').send({ days: 3 });
    const until = mockService.snoozeFollowUp.mock.calls[0][2];
    expect(until.toISOString()).toBe('2026-11-21T05:00:00.000Z');
  });

  it('rejects today or the past, malformed dates, and missing/invalid days', async () => {
    for (const body of [{ until: '2026-11-18' }, { until: '2026-11-01' }, { until: '11/21/2026' }, { until: '2026-13-40' }, { days: 0 }, { days: 400 }, {}]) {
      mockService.snoozeFollowUp.mockClear();
      const res = await request(app).post('/api/follow-ups/12/snooze').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(mockService.snoozeFollowUp).not.toHaveBeenCalled();
    }
  });

  it('404s when the follow-up is not in the caller practice', async () => {
    mockService.snoozeFollowUp.mockResolvedValueOnce(undefined);
    expect((await request(app).post('/api/follow-ups/12/snooze').send({ days: 1 })).status).toBe(404);
  });
});
