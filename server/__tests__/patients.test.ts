import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

// Create mock functions - these must be defined before vi.mock calls
const getAllPatients = vi.fn();
const createPatient = vi.fn();
const getPatient = vi.fn();
const hasRequiredTreatmentConsents = vi.fn();
const getUser = vi.fn();

// Mock storage module
vi.mock('../storage', () => ({
  storage: {
    getAllPatients: () => getAllPatients(),
    createPatient: (data: any) => createPatient(data),
    getPatient: (id: number) => getPatient(id),
    hasRequiredTreatmentConsents: (id: number) => hasRequiredTreatmentConsents(id),
    getUser: (id: string) => getUser(id),
  },
}));

// Mock auth middleware
vi.mock('../replitAuth', () => ({
  setupAuth: vi.fn(),
  isAuthenticated: (req: any, res: any, next: any) => {
    // Simulate authenticated user
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

// Import after mocks
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';

// Create a reference to mock functions for use in tests
const mockStorage = {
  getAllPatients,
  createPatient,
  getPatient,
  hasRequiredTreatmentConsents,
  getUser,
};

describe('Patients API', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());

    // Set up patients routes
    app.get('/api/patients', isAuthenticated, async (req: any, res) => {
      try {
        const patients = await storage.getAllPatients();
        const patientsWithConsent = await Promise.all(
          patients.map(async (patient: any) => {
            const consentStatus = await storage.hasRequiredTreatmentConsents(patient.id);
            return {
              ...patient,
              consentStatus: {
                hasRequired: consentStatus,
                needsReview: !consentStatus,
              },
            };
          })
        );
        res.json(patientsWithConsent);
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch patients' });
      }
    });

    app.post('/api/patients', isAuthenticated, async (req: any, res) => {
      try {
        if (!req.body.firstName || !req.body.lastName) {
          return res.status(400).json({ error: 'First name and last name are required' });
        }
        const patient = await storage.createPatient(req.body);
        res.status(201).json(patient);
      } catch (error) {
        res.status(500).json({ error: 'Failed to create patient' });
      }
    });

    app.get('/api/patients/:id', isAuthenticated, async (req: any, res) => {
      try {
        const patientId = parseInt(req.params.id);
        if (isNaN(patientId)) {
          return res.status(400).json({ error: 'Invalid patient ID' });
        }
        const patient = await storage.getPatient(patientId);
        if (!patient) {
          return res.status(404).json({ error: 'Patient not found' });
        }
        res.json(patient);
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch patient' });
      }
    });
  });

  describe('GET /api/patients', () => {
    it('should return patient list with consent status', async () => {
      const mockPatients = [
        { id: 1, firstName: 'John', lastName: 'Doe', practiceId: 1 },
        { id: 2, firstName: 'Jane', lastName: 'Smith', practiceId: 1 },
      ];

      mockStorage.getAllPatients.mockResolvedValue(mockPatients);
      mockStorage.hasRequiredTreatmentConsents.mockResolvedValue(true);

      const response = await request(app)
        .get('/api/patients')
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toMatchObject({
        id: 1,
        firstName: 'John',
        lastName: 'Doe',
        consentStatus: { hasRequired: true, needsReview: false },
      });
      expect(mockStorage.getAllPatients).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no patients exist', async () => {
      mockStorage.getAllPatients.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/patients')
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('should return 500 when storage fails', async () => {
      mockStorage.getAllPatients.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/patients')
        .expect(500);

      expect(response.body).toEqual({ error: 'Failed to fetch patients' });
    });
  });

  describe('POST /api/patients', () => {
    it('should create a new patient successfully', async () => {
      const newPatient = {
        practiceId: 1,
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        phone: '5551234567',
      };

      const createdPatient = { id: 1, ...newPatient };
      mockStorage.createPatient.mockResolvedValue(createdPatient);

      const response = await request(app)
        .post('/api/patients')
        .send(newPatient)
        .expect(201);

      expect(response.body).toMatchObject(createdPatient);
      expect(mockStorage.createPatient).toHaveBeenCalledWith(newPatient);
    });

    it('should return 400 when firstName is missing', async () => {
      const invalidPatient = {
        practiceId: 1,
        lastName: 'Doe',
      };

      const response = await request(app)
        .post('/api/patients')
        .send(invalidPatient)
        .expect(400);

      expect(response.body).toEqual({ error: 'First name and last name are required' });
      expect(mockStorage.createPatient).not.toHaveBeenCalled();
    });

    it('should return 400 when lastName is missing', async () => {
      const invalidPatient = {
        practiceId: 1,
        firstName: 'John',
      };

      const response = await request(app)
        .post('/api/patients')
        .send(invalidPatient)
        .expect(400);

      expect(response.body).toEqual({ error: 'First name and last name are required' });
    });

    it('should return 500 when storage fails', async () => {
      const newPatient = {
        practiceId: 1,
        firstName: 'John',
        lastName: 'Doe',
      };

      mockStorage.createPatient.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/patients')
        .send(newPatient)
        .expect(500);

      expect(response.body).toEqual({ error: 'Failed to create patient' });
    });
  });

  describe('GET /api/patients/:id', () => {
    it('should return a patient by ID', async () => {
      const mockPatient = {
        id: 1,
        firstName: 'John',
        lastName: 'Doe',
        practiceId: 1,
      };

      mockStorage.getPatient.mockResolvedValue(mockPatient);

      const response = await request(app)
        .get('/api/patients/1')
        .expect(200);

      expect(response.body).toMatchObject(mockPatient);
      expect(mockStorage.getPatient).toHaveBeenCalledWith(1);
    });

    it('should return 404 when patient not found', async () => {
      mockStorage.getPatient.mockResolvedValue(undefined);

      const response = await request(app)
        .get('/api/patients/999')
        .expect(404);

      expect(response.body).toEqual({ error: 'Patient not found' });
    });

    it('should return 400 for invalid patient ID', async () => {
      const response = await request(app)
        .get('/api/patients/invalid')
        .expect(400);

      expect(response.body).toEqual({ error: 'Invalid patient ID' });
    });
  });
});
