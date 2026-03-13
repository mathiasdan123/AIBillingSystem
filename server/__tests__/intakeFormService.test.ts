import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing the service
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockSet = vi.fn();

vi.mock('../db', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    select: (...args: any[]) => mockSelect(...args),
    update: (...args: any[]) => mockUpdate(...args),
  },
}));

vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Import after mocks are set up
import {
  createTemplate,
  getTemplates,
  getTemplate,
  updateTemplate,
  submitForm,
  getSubmissions,
  getSubmission,
  markReviewed,
  getPendingSubmissions,
} from '../services/intakeFormService';

const sampleFields = [
  { type: 'text', label: 'Full Name', required: true },
  { type: 'date', label: 'Date of Birth', required: true },
  { type: 'textarea', label: 'Medical History', required: false },
  { type: 'select', label: 'Gender', required: true, options: ['Male', 'Female', 'Other'] },
];

const makeMockTemplate = (overrides: Record<string, any> = {}) => ({
  id: 1,
  practiceId: 1,
  name: 'New Patient Intake',
  description: 'Standard intake form',
  fields: sampleFields,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeMockSubmission = (overrides: Record<string, any> = {}) => ({
  id: 1,
  templateId: 1,
  practiceId: 1,
  patientId: 10,
  responses: { 'Full Name': 'Jane Doe', 'Date of Birth': '1990-01-15', 'Gender': 'Female' },
  status: 'submitted',
  submittedAt: new Date(),
  reviewedBy: null,
  reviewedAt: null,
  createdAt: new Date(),
  ...overrides,
});

describe('IntakeFormService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default chain for insert: db.insert(table).values(data).returning()
    mockReturning.mockResolvedValue([makeMockTemplate()]);
    mockValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues });

    // Default chain for select: db.select().from(table).where(cond).orderBy(col)
    mockOrderBy.mockResolvedValue([]);
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockWhere.mockResolvedValue([makeMockTemplate()]);
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    // Default chain for update: db.update(table).set(data).where(cond).returning()
    mockReturning.mockResolvedValue([makeMockTemplate({ updatedAt: new Date() })]);
    mockSet.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
    mockUpdate.mockReturnValue({ set: mockSet });
  });

  describe('createTemplate', () => {
    it('should create a template with valid data', async () => {
      const mockResult = makeMockTemplate();
      mockReturning.mockResolvedValue([mockResult]);

      const result = await createTemplate(1, {
        name: 'New Patient Intake',
        description: 'Standard intake form',
        fields: sampleFields,
      });

      expect(result).toEqual(mockResult);
      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalled();
    });

    it('should throw if name is missing', async () => {
      await expect(
        createTemplate(1, { name: '', fields: sampleFields }),
      ).rejects.toThrow('Template name and at least one field are required');
    });

    it('should throw if fields array is empty', async () => {
      await expect(
        createTemplate(1, { name: 'Test', fields: [] }),
      ).rejects.toThrow('Template name and at least one field are required');
    });

    it('should default isActive to true', async () => {
      const mockResult = makeMockTemplate({ isActive: true });
      mockReturning.mockResolvedValue([mockResult]);

      const result = await createTemplate(1, {
        name: 'Test Template',
        fields: sampleFields,
      });

      expect(result.isActive).toBe(true);
    });
  });

  describe('getTemplates', () => {
    it('should return active templates for a practice', async () => {
      const mockResults = [makeMockTemplate(), makeMockTemplate({ id: 2, name: 'Follow-Up Form' })];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getTemplates(1);
      expect(results).toEqual(mockResults);
      expect(mockSelect).toHaveBeenCalled();
    });
  });

  describe('getTemplate', () => {
    it('should return a template when found', async () => {
      const mockResult = makeMockTemplate();
      mockWhere.mockResolvedValue([mockResult]);

      const result = await getTemplate(1, 1);
      expect(result).toEqual(mockResult);
    });

    it('should return null when not found', async () => {
      mockWhere.mockResolvedValue([]);

      const result = await getTemplate(999, 1);
      expect(result).toBeNull();
    });
  });

  describe('updateTemplate', () => {
    it('should update a template when it exists', async () => {
      // getTemplate returns existing
      const existing = makeMockTemplate();
      mockWhere.mockResolvedValue([existing]);

      // update returns updated
      const updatedTemplate = makeMockTemplate({ name: 'Updated Name' });
      mockReturning.mockResolvedValue([updatedTemplate]);

      const result = await updateTemplate(1, 1, { name: 'Updated Name' });
      expect(result.name).toBe('Updated Name');
    });

    it('should throw if template not found', async () => {
      mockWhere.mockResolvedValue([]);

      await expect(
        updateTemplate(999, 1, { name: 'Updated' }),
      ).rejects.toThrow('Intake form template 999 not found for practice 1');
    });
  });

  describe('submitForm', () => {
    it('should validate and save a submission', async () => {
      // getTemplate returns template with required fields
      const template = makeMockTemplate();
      mockWhere.mockResolvedValue([template]);

      const mockSubmission = makeMockSubmission();
      mockReturning.mockResolvedValue([mockSubmission]);

      const result = await submitForm(1, 1, 10, {
        'Full Name': 'Jane Doe',
        'Date of Birth': '1990-01-15',
        'Gender': 'Female',
      });

      expect(result).toEqual(mockSubmission);
      expect(result.status).toBe('submitted');
    });

    it('should throw if template not found', async () => {
      mockWhere.mockResolvedValue([]);

      await expect(
        submitForm(999, 1, 10, { 'Full Name': 'Jane' }),
      ).rejects.toThrow('Intake form template 999 not found for practice 1');
    });

    it('should throw if required fields are missing', async () => {
      const template = makeMockTemplate();
      mockWhere.mockResolvedValue([template]);

      await expect(
        submitForm(1, 1, 10, { 'Medical History': 'None' }),
      ).rejects.toThrow('Missing required fields: Full Name, Date of Birth, Gender');
    });
  });

  describe('getSubmissions', () => {
    it('should return submissions for a practice', async () => {
      const mockResults = [makeMockSubmission(), makeMockSubmission({ id: 2 })];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getSubmissions(1);
      expect(results).toEqual(mockResults);
    });

    it('should apply filters when provided', async () => {
      const mockResults = [makeMockSubmission()];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getSubmissions(1, { patientId: 10, status: 'submitted' });
      expect(results).toEqual(mockResults);
      expect(mockWhere).toHaveBeenCalled();
    });
  });

  describe('getSubmission', () => {
    it('should return a submission when found', async () => {
      const mockResult = makeMockSubmission();
      mockWhere.mockResolvedValue([mockResult]);

      const result = await getSubmission(1, 1);
      expect(result).toEqual(mockResult);
    });

    it('should return null when not found', async () => {
      mockWhere.mockResolvedValue([]);

      const result = await getSubmission(999, 1);
      expect(result).toBeNull();
    });
  });

  describe('markReviewed', () => {
    it('should mark a submitted submission as reviewed', async () => {
      // getSubmission returns submitted
      const submitted = makeMockSubmission({ status: 'submitted' });
      mockWhere.mockResolvedValue([submitted]);

      // update returns reviewed
      const reviewed = makeMockSubmission({ status: 'reviewed', reviewedBy: 'user-1', reviewedAt: new Date() });
      mockReturning.mockResolvedValue([reviewed]);

      const result = await markReviewed(1, 1, 'user-1');
      expect(result.status).toBe('reviewed');
      expect(result.reviewedBy).toBe('user-1');
    });

    it('should throw if submission not found', async () => {
      mockWhere.mockResolvedValue([]);

      await expect(
        markReviewed(999, 1, 'user-1'),
      ).rejects.toThrow('Intake form submission 999 not found for practice 1');
    });

    it('should throw if already reviewed', async () => {
      mockWhere.mockResolvedValue([makeMockSubmission({ status: 'reviewed' })]);

      await expect(
        markReviewed(1, 1, 'user-1'),
      ).rejects.toThrow('Intake form submission 1 is already reviewed');
    });
  });

  describe('getPendingSubmissions', () => {
    it('should return only submitted (unreviewed) submissions', async () => {
      const mockResults = [makeMockSubmission({ status: 'submitted' })];
      mockOrderBy.mockResolvedValue(mockResults);
      mockWhere.mockReturnValue({ orderBy: mockOrderBy });

      const results = await getPendingSubmissions(1);
      expect(results).toEqual(mockResults);
      expect(mockSelect).toHaveBeenCalled();
    });
  });
});
