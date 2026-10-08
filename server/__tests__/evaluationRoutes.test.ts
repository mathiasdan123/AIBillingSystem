import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * Initial Evaluation routes — practice scoping and the accept paths that
 * write into the EXISTING treatment plan/goal model.
 */

const { storageStub, contextHolder } = vi.hoisted(() => ({
  storageStub: {
    getInitialEvaluation: vi.fn(),
    getPatientInitialEvaluations: vi.fn(async () => []),
    createInitialEvaluation: vi.fn(async (data: any) => ({ id: 10, ...data })),
    updateInitialEvaluation: vi.fn(async (id: number, _practiceId: number, updates: any) => ({ id, ...updates })),
    getPatient: vi.fn(),
    createTreatmentPlan: vi.fn(async (data: any) => ({ id: 300, ...data })),
    getTreatmentGoals: vi.fn(async () => [{ id: 1 }, { id: 2 }]),
    createTreatmentGoal: vi.fn(async (data: any) => ({ id: 400, ...data })),
  },
  contextHolder: { current: { userId: 'user-1', practiceId: 7, role: 'therapist', isDemoUser: false } as any },
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
vi.mock('../services/initialEvaluationService', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, composeEvaluationWriteUp: vi.fn(), proposePlanAndGoals: vi.fn() };
});

import evaluationsRouter from '../routes/evaluations';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', evaluationsRouter);
  return app;
}

const proposedPlan = {
  sessionsPerWeek: 2,
  durationWeeks: 24,
  startDate: '2026-10-08',
  endDate: '2027-03-25',
  rationale: 'Documented deficits support twice-weekly OT.',
  status: 'proposed',
};

const proposedGoal = {
  skillArea: 'fine motor control',
  goalText: 'Patient will improve fine motor control as evidenced by ... in 3/4 trials to improve independence with pre-writing skills.',
  term: 'short_term',
  durationWeeks: 12,
  startDate: '2026-10-08',
  endDate: '2026-12-31',
  rationale: 'Grounded in observed grasp and parent concerns.',
  status: 'proposed',
};

const baseEvaluation = {
  id: 10,
  practiceId: 7,
  patientId: 42,
  therapistId: 'user-1',
  status: 'composed',
  evaluationDate: '2026-10-01',
  personalInfo: { childName: 'Avery T.', primaryDiagnosis: 'DCD' },
  aiWriteUp: { patientHistory: 'x' },
  proposedPlan,
  proposedGoals: [proposedGoal],
  treatmentPlanId: null,
};

beforeEach(() => {
  Object.values(storageStub).forEach((fn) => (fn as any).mockClear?.());
  contextHolder.current = { userId: 'user-1', practiceId: 7, role: 'therapist', isDemoUser: false };
  // Practice-scoped read, mirroring the storage layer's AND(practiceId) filter.
  storageStub.getInitialEvaluation.mockImplementation(async (id: number, practiceId: number) =>
    id === 10 && practiceId === 7 ? JSON.parse(JSON.stringify(baseEvaluation)) : undefined,
  );
});

describe('practice scoping (fails closed)', () => {
  it('403s every evaluation route when the user has no practice context', async () => {
    contextHolder.current = null;
    const res = await request(makeApp()).get('/api/evaluations/10');
    expect(res.status).toBe(403);
    expect(storageStub.getInitialEvaluation).not.toHaveBeenCalled();
  });

  it('404s an evaluation belonging to another practice (no existence oracle)', async () => {
    contextHolder.current = { userId: 'user-2', practiceId: 99, role: 'therapist', isDemoUser: false };
    const res = await request(makeApp()).get('/api/evaluations/10');
    expect(res.status).toBe(404);
  });

  it('refuses to create an evaluation for a cross-practice patient', async () => {
    storageStub.getPatient.mockResolvedValue({ id: 42, practiceId: 99, firstName: 'A', lastName: 'B' });
    const res = await request(makeApp()).post('/api/patients/42/evaluations').send({});
    expect(res.status).toBe(404);
    expect(storageStub.createInitialEvaluation).not.toHaveBeenCalled();
  });
});

describe('accepting proposals writes into the EXISTING plan/goal model', () => {
  it('accepting the plan creates a treatment_plans row (1:1, dated) and links it', async () => {
    const res = await request(makeApp())
      .post('/api/evaluations/10/plan/decision')
      .send({ action: 'accept' });
    expect(res.status).toBe(200);
    expect(storageStub.createTreatmentPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 42,
        practiceId: 7,
        treatmentModality: 'Individual (1:1)',
        frequency: '2x/week',
        startDate: '2026-10-08',
        targetEndDate: '2027-03-25',
        status: 'active',
      }),
    );
    expect(storageStub.updateInitialEvaluation).toHaveBeenCalledWith(
      10,
      7,
      expect.objectContaining({ treatmentPlanId: 300 }),
    );
  });

  it('accepting a goal requires the plan to be accepted first', async () => {
    const res = await request(makeApp())
      .post('/api/evaluations/10/goals/0/decision')
      .send({ action: 'accept' });
    expect(res.status).toBe(409);
    expect(storageStub.createTreatmentGoal).not.toHaveBeenCalled();
  });

  it('accepting a goal creates a treatment_goals row with 0% progress and term/duration metadata', async () => {
    storageStub.getInitialEvaluation.mockImplementation(async (id: number, practiceId: number) =>
      id === 10 && practiceId === 7
        ? { ...JSON.parse(JSON.stringify(baseEvaluation)), treatmentPlanId: 300 }
        : undefined,
    );
    const res = await request(makeApp())
      .post('/api/evaluations/10/goals/0/decision')
      .send({ action: 'accept', edits: { durationWeeks: 10 } });
    expect(res.status).toBe(200);
    expect(storageStub.createTreatmentGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        treatmentPlanId: 300,
        patientId: 42,
        practiceId: 7,
        goalNumber: 3, // two existing goals on the plan
        category: 'fine motor control',
        description: proposedGoal.goalText,
        progressPercentage: 0,
        goalTerm: 'short_term',
        durationWeeks: 10, // therapist's edit wins
        startDate: '2026-10-08',
        targetDate: '2026-12-31',
      }),
    );
    // The proposal is marked accepted and linked to the created goal.
    const updateCall = storageStub.updateInitialEvaluation.mock.calls.at(-1)!;
    expect(updateCall[2].proposedGoals[0]).toMatchObject({ status: 'accepted', acceptedGoalId: 400 });
  });

  it('rejecting a goal records the decision and writes nothing to the goal model', async () => {
    const res = await request(makeApp())
      .post('/api/evaluations/10/goals/0/decision')
      .send({ action: 'reject' });
    expect(res.status).toBe(200);
    expect(storageStub.createTreatmentGoal).not.toHaveBeenCalled();
    const updateCall = storageStub.updateInitialEvaluation.mock.calls.at(-1)!;
    expect(updateCall[2].proposedGoals[0].status).toBe('rejected');
  });

  it('rejects invalid therapist edits on accept (validation reused)', async () => {
    storageStub.getInitialEvaluation.mockImplementation(async () => ({
      ...JSON.parse(JSON.stringify(baseEvaluation)),
      treatmentPlanId: 300,
    }));
    const res = await request(makeApp())
      .post('/api/evaluations/10/goals/0/decision')
      .send({ action: 'accept', edits: { term: 'whenever' } });
    expect(res.status).toBe(400);
    expect(storageStub.createTreatmentGoal).not.toHaveBeenCalled();
  });
});

describe('lifecycle guards', () => {
  it('blocks section edits after finalize', async () => {
    storageStub.getInitialEvaluation.mockImplementation(async () => ({
      ...JSON.parse(JSON.stringify(baseEvaluation)),
      status: 'finalized',
    }));
    const res = await request(makeApp())
      .patch('/api/evaluations/10')
      .send({ subjectiveComments: 'late edit' });
    expect(res.status).toBe(409);
    expect(storageStub.updateInitialEvaluation).not.toHaveBeenCalled();
  });

  it('refuses to finalize before a write-up exists', async () => {
    storageStub.getInitialEvaluation.mockImplementation(async () => ({
      ...JSON.parse(JSON.stringify(baseEvaluation)),
      aiWriteUp: null,
    }));
    const res = await request(makeApp()).post('/api/evaluations/10/finalize').send({});
    expect(res.status).toBe(409);
  });
});
