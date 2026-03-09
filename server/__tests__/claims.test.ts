import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// Create mock functions - these must be defined before vi.mock calls
const getClaims = vi.fn();
const createClaim = vi.fn();
const getClaim = vi.fn();
const updateClaim = vi.fn();
const getPatient = vi.fn();

// Mock storage module
vi.mock('../storage', () => ({
  storage: {
    getClaims: (practiceId: number) => getClaims(practiceId),
    createClaim: (data: any) => createClaim(data),
    getClaim: (id: number) => getClaim(id),
    updateClaim: (id: number, data: any) => updateClaim(id, data),
    getPatient: (id: number) => getPatient(id),
  },
}));

// Mock auth middleware
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, res: any, next: any) => {
    req.user = { claims: { sub: 'test-user-123' } };
    req.userPracticeId = 1;
    req.userRole = 'admin';
    next();
  },
}));

// Mock validate middleware
vi.mock('../middleware/validate', () => ({
  validate: () => (req: any, res: any, next: any) => next(),
}));

// Mock logger
vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';

// Create a reference to mock functions for use in tests
const mockStorage = {
  getClaims,
  createClaim,
  getClaim,
  updateClaim,
  getPatient,
};

describe('Claims API', () => {
  let app: Express;

  const getAuthorizedPracticeId = (req: any) => {
    if (req.authorizedPracticeId) return req.authorizedPracticeId;
    return req.userPracticeId || 1;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());

    // Set up claims routes
    app.get('/api/claims', isAuthenticated, async (req: any, res) => {
      try {
        const practiceId = getAuthorizedPracticeId(req);
        const claims = await storage.getClaims(practiceId);
        res.json(claims);
      } catch (error) {
        res.status(500).json({ message: 'Failed to fetch claims' });
      }
    });

    app.post('/api/claims', isAuthenticated, async (req: any, res) => {
      try {
        const { patientId, insuranceId, totalAmount, submittedAmount, sessionId } = req.body;
        const practiceId = getAuthorizedPracticeId(req);

        if (!patientId || !totalAmount) {
          return res.status(400).json({ message: 'Patient ID and total amount are required' });
        }

        // Verify patient exists
        const patient = await storage.getPatient(patientId);
        if (!patient) {
          return res.status(404).json({ message: 'Patient not found' });
        }

        const claim = await storage.createClaim({
          practiceId,
          patientId,
          insuranceId,
          totalAmount: String(totalAmount),
          submittedAmount: submittedAmount ? String(submittedAmount) : null,
          sessionId,
          status: 'draft',
          dateSubmitted: new Date(),
        });

        res.status(201).json(claim);
      } catch (error) {
        res.status(500).json({ message: 'Failed to create claim' });
      }
    });

    app.get('/api/claims/:id', isAuthenticated, async (req: any, res) => {
      try {
        const claimId = parseInt(req.params.id);
        if (isNaN(claimId)) {
          return res.status(400).json({ message: 'Invalid claim ID' });
        }

        const claim = await storage.getClaim(claimId);
        if (!claim) {
          return res.status(404).json({ message: 'Claim not found' });
        }

        res.json(claim);
      } catch (error) {
        res.status(500).json({ message: 'Failed to fetch claim' });
      }
    });

    // Claim status transitions
    app.post('/api/claims/:id/submit', isAuthenticated, async (req: any, res) => {
      try {
        const claimId = parseInt(req.params.id);
        const claim = await storage.getClaim(claimId);

        if (!claim) {
          return res.status(404).json({ message: 'Claim not found' });
        }

        if (claim.status !== 'draft') {
          return res.status(400).json({ message: 'Only draft claims can be submitted' });
        }

        const updatedClaim = await storage.updateClaim(claimId, {
          status: 'submitted',
          dateSubmitted: new Date(),
        });

        res.json(updatedClaim);
      } catch (error) {
        res.status(500).json({ message: 'Failed to submit claim' });
      }
    });

    app.post('/api/claims/:id/paid', isAuthenticated, async (req: any, res) => {
      try {
        const claimId = parseInt(req.params.id);
        const { paidAmount } = req.body;

        const claim = await storage.getClaim(claimId);
        if (!claim) {
          return res.status(404).json({ message: 'Claim not found' });
        }

        if (claim.status !== 'submitted') {
          return res.status(400).json({ message: 'Only submitted claims can be marked as paid' });
        }

        const updatedClaim = await storage.updateClaim(claimId, {
          status: 'paid',
          paidAmount: paidAmount ? String(paidAmount) : claim.submittedAmount,
        });

        res.json(updatedClaim);
      } catch (error) {
        res.status(500).json({ message: 'Failed to mark claim as paid' });
      }
    });

    app.post('/api/claims/:id/deny', isAuthenticated, async (req: any, res) => {
      try {
        const claimId = parseInt(req.params.id);
        const { denialReason } = req.body;

        const claim = await storage.getClaim(claimId);
        if (!claim) {
          return res.status(404).json({ message: 'Claim not found' });
        }

        if (claim.status !== 'submitted') {
          return res.status(400).json({ message: 'Only submitted claims can be denied' });
        }

        const updatedClaim = await storage.updateClaim(claimId, {
          status: 'denied',
          denialReason,
        });

        res.json(updatedClaim);
      } catch (error) {
        res.status(500).json({ message: 'Failed to deny claim' });
      }
    });
  });

  describe('GET /api/claims', () => {
    it('should return claims for the practice', async () => {
      const mockClaims = [
        { id: 1, patientId: 1, practiceId: 1, status: 'draft', totalAmount: '150.00' },
        { id: 2, patientId: 2, practiceId: 1, status: 'submitted', totalAmount: '200.00' },
      ];

      mockStorage.getClaims.mockResolvedValue(mockClaims);

      const response = await request(app)
        .get('/api/claims')
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toMatchObject({ id: 1, status: 'draft' });
      expect(mockStorage.getClaims).toHaveBeenCalledWith(1);
    });

    it('should return empty array when no claims exist', async () => {
      mockStorage.getClaims.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/claims')
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('should return 500 when storage fails', async () => {
      mockStorage.getClaims.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/claims')
        .expect(500);

      expect(response.body).toEqual({ message: 'Failed to fetch claims' });
    });
  });

  describe('POST /api/claims', () => {
    it('should create a new claim', async () => {
      const mockPatient = { id: 1, firstName: 'John', lastName: 'Doe', practiceId: 1 };
      const newClaim = {
        patientId: 1,
        totalAmount: 150.00,
        insuranceId: 1,
      };

      const createdClaim = {
        id: 1,
        ...newClaim,
        practiceId: 1,
        status: 'draft',
        totalAmount: '150.00',
      };

      mockStorage.getPatient.mockResolvedValue(mockPatient);
      mockStorage.createClaim.mockResolvedValue(createdClaim);

      const response = await request(app)
        .post('/api/claims')
        .send(newClaim)
        .expect(201);

      expect(response.body).toMatchObject({ id: 1, status: 'draft' });
      expect(mockStorage.createClaim).toHaveBeenCalled();
    });

    it('should return 400 when patientId is missing', async () => {
      const response = await request(app)
        .post('/api/claims')
        .send({ totalAmount: 150.00 })
        .expect(400);

      expect(response.body).toEqual({ message: 'Patient ID and total amount are required' });
    });

    it('should return 400 when totalAmount is missing', async () => {
      const response = await request(app)
        .post('/api/claims')
        .send({ patientId: 1 })
        .expect(400);

      expect(response.body).toEqual({ message: 'Patient ID and total amount are required' });
    });

    it('should return 404 when patient not found', async () => {
      mockStorage.getPatient.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/claims')
        .send({ patientId: 999, totalAmount: 150.00 })
        .expect(404);

      expect(response.body).toEqual({ message: 'Patient not found' });
    });
  });

  describe('GET /api/claims/:id', () => {
    it('should return a claim by ID', async () => {
      const mockClaim = {
        id: 1,
        patientId: 1,
        practiceId: 1,
        status: 'draft',
        totalAmount: '150.00',
      };

      mockStorage.getClaim.mockResolvedValue(mockClaim);

      const response = await request(app)
        .get('/api/claims/1')
        .expect(200);

      expect(response.body).toMatchObject(mockClaim);
    });

    it('should return 404 when claim not found', async () => {
      mockStorage.getClaim.mockResolvedValue(undefined);

      const response = await request(app)
        .get('/api/claims/999')
        .expect(404);

      expect(response.body).toEqual({ message: 'Claim not found' });
    });

    it('should return 400 for invalid claim ID', async () => {
      const response = await request(app)
        .get('/api/claims/invalid')
        .expect(400);

      expect(response.body).toEqual({ message: 'Invalid claim ID' });
    });
  });

  describe('Claim Status Transitions', () => {
    describe('POST /api/claims/:id/submit', () => {
      it('should submit a draft claim', async () => {
        const draftClaim = { id: 1, status: 'draft', totalAmount: '150.00' };
        const submittedClaim = { ...draftClaim, status: 'submitted' };

        mockStorage.getClaim.mockResolvedValue(draftClaim);
        mockStorage.updateClaim.mockResolvedValue(submittedClaim);

        const response = await request(app)
          .post('/api/claims/1/submit')
          .expect(200);

        expect(response.body.status).toBe('submitted');
        expect(mockStorage.updateClaim).toHaveBeenCalledWith(1, expect.objectContaining({
          status: 'submitted',
        }));
      });

      it('should return 400 when claim is not draft', async () => {
        mockStorage.getClaim.mockResolvedValue({ id: 1, status: 'submitted' });

        const response = await request(app)
          .post('/api/claims/1/submit')
          .expect(400);

        expect(response.body).toEqual({ message: 'Only draft claims can be submitted' });
      });

      it('should return 404 when claim not found', async () => {
        mockStorage.getClaim.mockResolvedValue(undefined);

        const response = await request(app)
          .post('/api/claims/999/submit')
          .expect(404);

        expect(response.body).toEqual({ message: 'Claim not found' });
      });
    });

    describe('POST /api/claims/:id/paid', () => {
      it('should mark a submitted claim as paid', async () => {
        const submittedClaim = { id: 1, status: 'submitted', totalAmount: '150.00', submittedAmount: '150.00' };
        const paidClaim = { ...submittedClaim, status: 'paid', paidAmount: '140.00' };

        mockStorage.getClaim.mockResolvedValue(submittedClaim);
        mockStorage.updateClaim.mockResolvedValue(paidClaim);

        const response = await request(app)
          .post('/api/claims/1/paid')
          .send({ paidAmount: 140.00 })
          .expect(200);

        expect(response.body.status).toBe('paid');
        expect(response.body.paidAmount).toBe('140.00');
      });

      it('should return 400 when claim is not submitted', async () => {
        mockStorage.getClaim.mockResolvedValue({ id: 1, status: 'draft' });

        const response = await request(app)
          .post('/api/claims/1/paid')
          .send({ paidAmount: 140.00 })
          .expect(400);

        expect(response.body).toEqual({ message: 'Only submitted claims can be marked as paid' });
      });
    });

    describe('POST /api/claims/:id/deny', () => {
      it('should deny a submitted claim', async () => {
        const submittedClaim = { id: 1, status: 'submitted', totalAmount: '150.00' };
        const deniedClaim = { ...submittedClaim, status: 'denied', denialReason: 'Invalid CPT code' };

        mockStorage.getClaim.mockResolvedValue(submittedClaim);
        mockStorage.updateClaim.mockResolvedValue(deniedClaim);

        const response = await request(app)
          .post('/api/claims/1/deny')
          .send({ denialReason: 'Invalid CPT code' })
          .expect(200);

        expect(response.body.status).toBe('denied');
        expect(response.body.denialReason).toBe('Invalid CPT code');
      });

      it('should return 400 when claim is not submitted', async () => {
        mockStorage.getClaim.mockResolvedValue({ id: 1, status: 'paid' });

        const response = await request(app)
          .post('/api/claims/1/deny')
          .send({ denialReason: 'Invalid CPT code' })
          .expect(400);

        expect(response.body).toEqual({ message: 'Only submitted claims can be denied' });
      });
    });
  });
});
