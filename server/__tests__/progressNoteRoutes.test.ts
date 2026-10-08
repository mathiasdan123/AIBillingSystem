import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * Progress Notes routes — practice scoping (fails closed), the
 * therapist-judgment progress %, extension-requires-rationale, and the
 * draft → finalized lock.
 */

const { storageStub, contextHolder, serviceStub } = vi.hoisted(() => ({
  storageStub: {
    getPatient: vi.fn(),
    getProgressNote: vi.fn(),
    getProgressNotesForPatient: vi.fn(async () => []),
    createProgressNote: vi.fn(async (data: any) => ({ id: 50, ...data })),
    updateProgressNote: vi.fn(async (id: number, _practiceId: number, updates: any) => ({ id, ...updates })),
    getActiveTreatmentPlan: vi.fn(),
    getTreatmentGoals: vi.fn(async () => []),
    getTreatmentPlan: vi.fn(),
    updateTreatmentPlan: vi.fn(async (id: number, updates: any) => ({ id, ...updates })),
    updateTreatmentGoal: vi.fn(async (id: number, updates: any) => ({ id, ...updates })),
  },
  contextHolder: { current: { userId: 'user-1', practiceId: 7, role: 'therapist', isDemoUser: false } as any },
  serviceStub: {
    generateProgressNoteDraft: vi.fn(),
    getProgressNoteCadence: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../db', () => ({ db: {} }));
vi.mock('../replitAuth', () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'user-1' } };
    next();
  },
}));
vi.mock('../services/practiceContext', () => ({
  getUserPracticeContext: vi.fn(async () => contextHolder.current),
}));
vi.mock('../services/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('../services/progressNoteService', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    generateProgressNoteDraft: serviceStub.generateProgressNoteDraft,
    getProgressNoteCadence: serviceStub.getProgressNoteCadence,
  };
});

import progressNotesRouter from '../routes/progress-notes';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', progressNotesRouter);
  return app;
}

const goalEntries = [
  {
    goalId: 1, goalText: 'Fine motor goal', goalTerm: 'short_term', durationWeeks: 12,
    startDate: '2026-07-01', endDate: '2026-09-23', progressPercent: 60,
    interventions: 'documented', assistanceLevels: 'documented', currentAbility: 'documented',
  },
  {
    goalId: 2, goalText: 'Legacy goal', goalTerm: null, durationWeeks: null,
    startDate: null, endDate: null, progressPercent: 40,
    interventions: 'documented', assistanceLevels: 'documented', currentAbility: 'documented',
  },
];

const baseNote = {
  id: 50, practiceId: 7, patientId: 42, treatmentPlanId: 3, therapistId: 'user-1',
  status: 'draft', windowStart: '2026-07-01', windowEnd: '2026-10-08', sessionsReviewed: 10,
  goalEntries, presentLevel: 'Present level text', annualGoals: '1. Goal', recommendations: 'Continue 2x weekly',
  extensionRequested: false, extensionNewEndDate: null, extensionRationale: null,
};

beforeEach(() => {
  Object.values(storageStub).forEach((fn) => (fn as any).mockClear?.());
  Object.values(serviceStub).forEach((fn) => (fn as any).mockReset?.());
  contextHolder.current = { userId: 'user-1', practiceId: 7, role: 'therapist', isDemoUser: false };
  storageStub.getPatient.mockResolvedValue({ id: 42, practiceId: 7, firstName: 'A', lastName: 'B' });
  storageStub.getProgressNote.mockImplementation(async (id: number, practiceId: number) =>
    id === 50 && practiceId === 7 ? JSON.parse(JSON.stringify(baseNote)) : undefined,
  );
  serviceStub.getProgressNoteCadence.mockResolvedValue({
    due: true, reason: 'sessions', anchorDate: '2026-07-01',
    completedSessionsSinceAnchor: 10, daysSinceAnchor: 99, sessionsUntilDue: 0, daysUntilDue: 0,
  });
});

describe('practice scoping (fails closed)', () => {
  it('403s when the user has no practice context', async () => {
    contextHolder.current = null;
    const res = await request(makeApp()).get('/api/progress-notes/50');
    expect(res.status).toBe(403);
    expect(storageStub.getProgressNote).not.toHaveBeenCalled();
  });

  it('404s a note belonging to another practice (no existence oracle)', async () => {
    contextHolder.current = { userId: 'user-2', practiceId: 99, role: 'therapist', isDemoUser: false };
    const res = await request(makeApp()).get('/api/progress-notes/50');
    expect(res.status).toBe(404);
  });

  it('404s list/cadence/create for a cross-practice patient', async () => {
    storageStub.getPatient.mockResolvedValue({ id: 42, practiceId: 99 });
    const app = makeApp();
    expect((await request(app).get('/api/progress-notes/patient/42')).status).toBe(404);
    expect((await request(app).get('/api/progress-notes/patient/42/cadence')).status).toBe(404);
    expect((await request(app).post('/api/progress-notes/patient/42').send({})).status).toBe(404);
    expect(storageStub.createProgressNote).not.toHaveBeenCalled();
  });
});

describe('creating a draft', () => {
  it('seeds the goal table from EVERY goal on the active plan, legacy nulls intact', async () => {
    storageStub.getActiveTreatmentPlan.mockResolvedValue({ id: 3, startDate: '2026-07-01' });
    storageStub.getTreatmentGoals.mockResolvedValue([
      { id: 1, description: 'Fine motor goal', goalTerm: 'short_term', durationWeeks: 12, startDate: '2026-07-01', targetDate: '2026-09-23' },
      { id: 2, description: 'Legacy goal', goalTerm: null, durationWeeks: null, startDate: null, targetDate: null },
    ]);
    const res = await request(makeApp()).post('/api/progress-notes/patient/42').send({});
    expect(res.status).toBe(201);
    const entries = storageStub.createProgressNote.mock.calls[0][0].goalEntries;
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ goalId: 2, goalTerm: null, durationWeeks: null, startDate: null });
    // Progress % is therapist judgment — seeded null, never computed.
    expect(entries.every((e: any) => e.progressPercent === null)).toBe(true);
    // Window anchors on the cadence anchor.
    expect(storageStub.createProgressNote.mock.calls[0][0].windowStart).toBe('2026-07-01');
  });

  it('409s without an active treatment plan', async () => {
    storageStub.getActiveTreatmentPlan.mockResolvedValue(undefined);
    const res = await request(makeApp()).post('/api/progress-notes/patient/42').send({});
    expect(res.status).toBe(409);
  });
});

describe('generate (AI draft)', () => {
  it('writes commentary and narratives but NEVER touches the therapist progress %', async () => {
    serviceStub.generateProgressNoteDraft.mockResolvedValue({
      draft: {
        goalCommentary: [
          { goalId: 1, interventions: 'i1', assistanceLevels: 'a1', currentAbility: 'c1' },
          { goalId: 2, interventions: 'i2', assistanceLevels: 'a2', currentAbility: 'c2' },
        ],
        presentLevel: 'PL', annualGoals: 'AG', recommendations: 'R',
      },
      meta: { sessionsReviewed: 10, from: '2026-07-01', to: '2026-10-08' },
    });
    const res = await request(makeApp()).post('/api/progress-notes/50/generate').send({});
    expect(res.status).toBe(200);
    const updates = storageStub.updateProgressNote.mock.calls[0][2];
    expect(updates.presentLevel).toBe('PL');
    // Therapist-entered percentages survive generation untouched.
    expect(updates.goalEntries.map((e: any) => e.progressPercent)).toEqual([60, 40]);
    expect(updates.goalEntries[0].interventions).toBe('i1');
  });

  it('409s on a finalized note', async () => {
    storageStub.getProgressNote.mockResolvedValue({ ...baseNote, status: 'finalized' });
    const res = await request(makeApp()).post('/api/progress-notes/50/generate').send({});
    expect(res.status).toBe(409);
    expect(serviceStub.generateProgressNoteDraft).not.toHaveBeenCalled();
  });
});

describe('editing', () => {
  it('accepts therapist-entered % (0-100 int) and rejects anything else', async () => {
    const app = makeApp();
    const ok = await app && await request(app).patch('/api/progress-notes/50')
      .send({ goalEntries: [{ goalId: 1, progressPercent: 75 }] });
    expect(ok.status).toBe(200);
    const bad = await request(app).patch('/api/progress-notes/50')
      .send({ goalEntries: [{ goalId: 1, progressPercent: 140 }] });
    expect(bad.status).toBe(400);
    const nonInt = await request(app).patch('/api/progress-notes/50')
      .send({ goalEntries: [{ goalId: 1, progressPercent: 'most of the way' }] });
    expect(nonInt.status).toBe(400);
  });

  it('409s edits to a finalized note (finalized notes lock)', async () => {
    storageStub.getProgressNote.mockResolvedValue({ ...baseNote, status: 'finalized' });
    const res = await request(makeApp()).patch('/api/progress-notes/50').send({ presentLevel: 'rewrite' });
    expect(res.status).toBe(409);
    expect(storageStub.updateProgressNote).not.toHaveBeenCalled();
  });
});

describe('finalize', () => {
  it('requires a therapist-entered % on EVERY goal', async () => {
    storageStub.getProgressNote.mockResolvedValue({
      ...baseNote,
      goalEntries: [goalEntries[0], { ...goalEntries[1], progressPercent: null }],
    });
    const res = await request(makeApp()).post('/api/progress-notes/50/finalize').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/never auto-computed/);
  });

  it('REQUIRES a written rationale when the plan extension was selected', async () => {
    storageStub.getProgressNote.mockResolvedValue({
      ...baseNote, extensionRequested: true, extensionNewEndDate: '2027-01-15', extensionRationale: '   ',
    });
    const res = await request(makeApp()).post('/api/progress-notes/50/finalize').send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/rationale/i);
    expect(storageStub.updateTreatmentPlan).not.toHaveBeenCalled();
  });

  it('applies the extension (new end date + rationale documented on the plan) and locks the note', async () => {
    storageStub.getProgressNote.mockResolvedValue({
      ...baseNote, extensionRequested: true, extensionNewEndDate: '2027-01-15',
      extensionRationale: 'Goals progressing; continued treatment remains medically necessary for grasp endurance.',
    });
    storageStub.getTreatmentPlan.mockResolvedValue({ id: 3, notes: 'Original plan notes' });
    const res = await request(makeApp()).post('/api/progress-notes/50/finalize').send({});
    expect(res.status).toBe(200);
    const [planId, planUpdates] = storageStub.updateTreatmentPlan.mock.calls[0];
    expect(planId).toBe(3);
    expect(planUpdates.targetEndDate).toBe('2027-01-15');
    expect(planUpdates.notes).toContain('medically necessary');
    const noteUpdates = storageStub.updateProgressNote.mock.calls[0][2];
    expect(noteUpdates.status).toBe('finalized');
    expect(noteUpdates.extensionAppliedAt).toBeInstanceOf(Date);
  });

  it('optionally writes the therapist % back to treatment_goals (explicit opt-in)', async () => {
    const app = makeApp();
    const without = await request(app).post('/api/progress-notes/50/finalize').send({});
    expect(without.status).toBe(200);
    expect(storageStub.updateTreatmentGoal).not.toHaveBeenCalled();

    storageStub.updateProgressNote.mockClear();
    const withSync = await request(app).post('/api/progress-notes/50/finalize').send({ updateGoalProgress: true });
    expect(withSync.status).toBe(200);
    expect(storageStub.updateTreatmentGoal).toHaveBeenCalledWith(1, { progressPercentage: 60 });
    expect(storageStub.updateTreatmentGoal).toHaveBeenCalledWith(2, { progressPercentage: 40 });
  });

  it('409s re-finalizing', async () => {
    storageStub.getProgressNote.mockResolvedValue({ ...baseNote, status: 'finalized' });
    const res = await request(makeApp()).post('/api/progress-notes/50/finalize').send({});
    expect(res.status).toBe(409);
  });
});
