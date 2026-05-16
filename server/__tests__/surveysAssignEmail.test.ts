/**
 * Tests for POST /api/surveys/assign — verifies that assigning a survey to a
 * patient triggers a transactional notification email when the patient has an
 * email on file, and gracefully no-ops (without breaking the assign) when they
 * do not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// ---- Mocks ----

vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: 'test-user-1', claims: { sub: 'test-user-1' } };
    req.userId = 'test-user-1';
    req.userPracticeId = 1;
    req.userRole = 'admin';
    req.authorizedPracticeId = 1;
    next();
  },
}));

const mockGetPatient = vi.fn();
const mockGetPractice = vi.fn();
vi.mock('../storage', () => ({
  storage: {
    getPatient: (...args: any[]) => mockGetPatient(...args),
    getPractice: (...args: any[]) => mockGetPractice(...args),
  },
}));

const mockSendEmail = vi.fn();
vi.mock('../services/emailService', () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
}));

vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock the drizzle db. The surveys route uses two shapes:
//  - select().from(table).where(...)  → thenable resolving to row arrays
//  - insert(table).values([...]).returning() → resolving to inserted rows
//  - update(table).set({...}).where(...) → no-op
const selectQueueByTable = new Map<string, any[][]>();
const insertReturnByTable = new Map<string, any[]>();

function thenable(rows: any[]) {
  // Drizzle queries are PromiseLike — `await q` resolves to rows; chained
  // .where(...) returns the same thenable to keep tests simple.
  const obj: any = {
    where: () => obj,
    leftJoin: () => obj,
    orderBy: () => obj,
    then: (resolve: any, reject: any) =>
      Promise.resolve(rows).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(rows).catch(reject),
  };
  return obj;
}

function selectBuilder() {
  return {
    from: (table: any) => {
      const key = table?._key || table?.[Symbol.for('drizzle:Name')] || 'unknown';
      const queue = selectQueueByTable.get(key);
      const rows = queue && queue.length ? queue.shift()! : [];
      return thenable(rows);
    },
  };
}

function insertBuilder(table: any) {
  const key = table?._key || 'unknown';
  const rows = insertReturnByTable.get(key) || [];
  return {
    values: (_v: any) => {
      const builder: any = {
        returning: () => Promise.resolve(rows),
        then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
        catch: (reject: any) => Promise.resolve(rows).catch(reject),
      };
      return builder;
    },
  };
}

function updateBuilder(_table: any) {
  return {
    set: (_v: any) => ({ where: (_w: any) => Promise.resolve() }),
  };
}

vi.mock('../db', () => ({
  db: {
    select: () => selectBuilder(),
    insert: (table: any) => insertBuilder(table),
    update: (table: any) => updateBuilder(table),
  },
}));

// Tag the survey schema tables so our mock can route queries by name.
vi.mock('@shared/schema', () => {
  const tag = (key: string) => ({ _key: key });
  return {
    surveyTemplates: tag('surveyTemplates'),
    surveyAssignments: tag('surveyAssignments'),
    surveyResponses: tag('surveyResponses'),
    patients: tag('patients'),
  };
});

// drizzle-orm helpers are no-ops in this test — the mock ignores predicates.
vi.mock('drizzle-orm', () => ({
  eq: (..._a: any[]) => ({}),
  and: (..._a: any[]) => ({}),
  desc: (..._a: any[]) => ({}),
  inArray: (..._a: any[]) => ({}),
  isNull: (..._a: any[]) => ({}),
}));

// ---- Import the route AFTER mocks ----
import surveysRouter from '../routes/surveys';

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/surveys', surveysRouter);
  return app;
}

describe('POST /api/surveys/assign — email notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectQueueByTable.clear();
    insertReturnByTable.clear();

    // POST /assign performs a single SELECT against surveyTemplates to look up
    // the template by id (ensureBuiltInTemplates is only called by GET).
    selectQueueByTable.set('surveyTemplates', [
      [{ id: 42, practiceId: 1, name: 'PHQ-9', type: 'phq9' }],
    ]);
    insertReturnByTable.set('surveyAssignments', [
      {
        id: 1001,
        surveyTemplateId: 42,
        patientId: 7,
        practiceId: 1,
        assignedBy: 'test-user-1',
        dueDate: null,
        status: 'pending',
      },
    ]);

    mockGetPractice.mockResolvedValue({ id: 1, name: 'Acme Therapy' });
  });

  it('sends a notification email when the patient has an email on file', async () => {
    mockGetPatient.mockResolvedValue({
      id: 7,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
    });
    mockSendEmail.mockResolvedValue({ success: true });

    const res = await request(makeApp())
      .post('/api/surveys/assign')
      .send({ surveyTemplateId: 42, patientIds: [7] });

    expect(res.status).toBe(201);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const args = mockSendEmail.mock.calls[0][0];
    expect(args.to).toBe('jane@example.com');
    expect(args.subject).toContain('PHQ-9');
    expect(args.html).toContain('/portal/surveys');
    expect(args.text).toContain('PHQ-9');

    expect(res.body.notifications).toEqual([
      { patientId: 7, emailSent: true, reason: undefined },
    ]);
  });

  it('skips email and reports no_email when the patient has no email', async () => {
    mockGetPatient.mockResolvedValue({
      id: 7,
      firstName: 'Jane',
      lastName: 'Doe',
      email: null,
    });

    const res = await request(makeApp())
      .post('/api/surveys/assign')
      .send({ surveyTemplateId: 42, patientIds: [7] });

    expect(res.status).toBe(201);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(res.body.notifications).toEqual([
      { patientId: 7, emailSent: false, reason: 'no_email' },
    ]);
    // Assign itself still succeeded.
    expect(res.body.assignments).toHaveLength(1);
  });

  it('does not fail the assign when email delivery fails', async () => {
    mockGetPatient.mockResolvedValue({
      id: 7,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
    });
    mockSendEmail.mockResolvedValue({ success: false, error: 'SMTP not configured' });

    const res = await request(makeApp())
      .post('/api/surveys/assign')
      .send({ surveyTemplateId: 42, patientIds: [7] });

    expect(res.status).toBe(201);
    expect(res.body.assignments).toHaveLength(1);
    expect(res.body.notifications[0]).toMatchObject({
      patientId: 7,
      emailSent: false,
      reason: 'SMTP not configured',
    });
  });
});
