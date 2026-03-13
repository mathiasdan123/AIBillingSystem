import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// Track all db operations
let selectResults: any[][] = [];
let selectCallIndex = 0;
let insertResult: any[] = [];
let updateResult: any[] = [];

function makeSelectChain() {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(function (this: any) {
      const results = selectResults[selectCallIndex] || [];
      selectCallIndex++;
      return {
        orderBy: vi.fn().mockReturnValue(results),
        groupBy: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue(results),
        }),
        // Also return as array for destructuring [first] = await db.select()...where()
        then: (resolve: any) => resolve(results),
        [Symbol.iterator]: function* () { yield* results; },
      };
    }),
    innerJoin: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        const results = selectResults[selectCallIndex] || [];
        selectCallIndex++;
        return {
          groupBy: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue(results),
          }),
        };
      }),
    }),
  };
}

vi.mock('../db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockImplementation(() => insertResult),
      }),
    })),
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockImplementation(() => updateResult),
        }),
      }),
    })),
  },
}));

// Mock auth middleware
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { claims: { sub: 'test-user-123' } };
    req.userPracticeId = 1;
    req.userRole = 'admin';
    next();
  },
}));

// Mock logger
vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import patientStatementsRouter from '../routes/patient-statements';

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/patient-statements', patientStatementsRouter);
  return app;
}

const sampleStatement = {
  id: 1,
  practiceId: 1,
  patientId: 10,
  statementNumber: 'STMT-TEST-001',
  statementDate: '2026-03-01',
  dueDate: '2026-03-31',
  totalCharges: '500.00',
  insurancePaid: '350.00',
  adjustments: '0.00',
  patientBalance: '150.00',
  previousBalance: '0.00',
  lineItems: [
    {
      dateOfService: '2026-02-15',
      description: 'Claim #1001',
      charges: '500.00',
      insurancePaid: '350.00',
      patientOwes: '150.00',
    },
  ],
  status: 'draft',
  sentAt: null,
  sentMethod: null,
  paidAt: null,
  paidAmount: null,
  notes: null,
  createdAt: new Date('2026-03-01'),
  updatedAt: new Date('2026-03-01'),
};

describe('Patient Statements API', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    selectResults = [];
    selectCallIndex = 0;
    insertResult = [];
    updateResult = [];
  });

  describe('POST /api/patient-statements/generate', () => {
    it('should return 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/patient-statements/generate')
        .send({ patientId: 10 });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('required');
    });

    it('should generate a statement from claims data', async () => {
      // First select: claims query
      selectResults.push([
        {
          id: 1,
          practiceId: 1,
          patientId: 10,
          claimNumber: 'CLM-1001',
          totalAmount: '500.00',
          paidAmount: '350.00',
          createdAt: new Date('2026-02-15'),
        },
      ]);
      // Second select: previous statements query
      selectResults.push([]);

      insertResult = [sampleStatement];

      const res = await request(app)
        .post('/api/patient-statements/generate')
        .send({ patientId: 10, startDate: '2026-02-01', endDate: '2026-02-28' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(1);
    });

    it('should return 400 when patientId is missing', async () => {
      const res = await request(app)
        .post('/api/patient-statements/generate')
        .send({ startDate: '2026-02-01', endDate: '2026-02-28' });

      expect(res.status).toBe(400);
    });

    it('should return 400 when startDate is missing', async () => {
      const res = await request(app)
        .post('/api/patient-statements/generate')
        .send({ patientId: 10, endDate: '2026-02-28' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/patient-statements', () => {
    it('should return list of statements', async () => {
      selectResults.push([sampleStatement]);

      const res = await request(app).get('/api/patient-statements');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
    });

    it('should pass filters through query params', async () => {
      selectResults.push([sampleStatement]);

      const res = await request(app)
        .get('/api/patient-statements?patientId=10&status=draft');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/patient-statements/:id', () => {
    it('should return a single statement', async () => {
      selectResults.push([sampleStatement]);

      const res = await request(app).get('/api/patient-statements/1');

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(1);
    });

    it('should return 400 for invalid ID', async () => {
      const res = await request(app).get('/api/patient-statements/abc');

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid statement ID');
    });

    it('should return 404 when statement not found', async () => {
      selectResults.push([]);

      const res = await request(app).get('/api/patient-statements/999');

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('not found');
    });
  });

  describe('POST /api/patient-statements/:id/send', () => {
    it('should return 400 for invalid method', async () => {
      const res = await request(app)
        .post('/api/patient-statements/1/send')
        .send({ method: 'fax' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('method');
    });

    it('should return 400 when method is missing', async () => {
      const res = await request(app)
        .post('/api/patient-statements/1/send')
        .send({});

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid statement ID', async () => {
      const res = await request(app)
        .post('/api/patient-statements/xyz/send')
        .send({ method: 'email' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid statement ID');
    });
  });

  describe('POST /api/patient-statements/:id/payment', () => {
    it('should return 400 when amount is missing', async () => {
      const res = await request(app)
        .post('/api/patient-statements/1/payment')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('amount');
    });

    it('should return 400 for zero amount', async () => {
      const res = await request(app)
        .post('/api/patient-statements/1/payment')
        .send({ amount: 0 });

      expect(res.status).toBe(400);
    });

    it('should return 400 for negative amount', async () => {
      const res = await request(app)
        .post('/api/patient-statements/1/payment')
        .send({ amount: -50 });

      expect(res.status).toBe(400);
    });

    it('should return 400 for invalid statement ID', async () => {
      const res = await request(app)
        .post('/api/patient-statements/abc/payment')
        .send({ amount: 50 });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Invalid statement ID');
    });
  });

  describe('GET /api/patient-statements/outstanding', () => {
    it('should return outstanding balances', async () => {
      selectResults.push([
        {
          patientId: 10,
          patientFirstName: 'John',
          patientLastName: 'Doe',
          totalBalance: '150.00',
          statementCount: 2,
          oldestDueDate: '2026-02-01',
        },
      ]);

      const res = await request(app).get('/api/patient-statements/outstanding');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /api/patient-statements/aging', () => {
    it('should return aging summary buckets', async () => {
      selectResults.push([]);

      const res = await request(app).get('/api/patient-statements/aging');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('current');
      expect(res.body).toHaveProperty('thirtyDays');
      expect(res.body).toHaveProperty('sixtyDays');
      expect(res.body).toHaveProperty('ninetyPlusDays');
      expect(res.body).toHaveProperty('totalOutstanding');
      expect(res.body.totalOutstanding).toBe('0.00');
    });

    it('should categorize statements by age', async () => {
      const now = new Date();
      const fortyFiveDaysAgo = new Date(now);
      fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45);

      selectResults.push([
        {
          ...sampleStatement,
          status: 'sent',
          dueDate: fortyFiveDaysAgo.toISOString().split('T')[0],
          patientBalance: '200.00',
          paidAmount: null,
        },
      ]);

      const res = await request(app).get('/api/patient-statements/aging');

      expect(res.status).toBe(200);
      expect(res.body.totalOutstanding).toBe('200.00');
    });
  });
});
