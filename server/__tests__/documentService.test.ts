import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing the service
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockGroupBy = vi.fn();

vi.mock('../db', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
    select: (...args: any[]) => mockSelect(...args),
    delete: (...args: any[]) => mockDelete(...args),
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
  uploadDocument,
  getDocuments,
  getDocument,
  deleteDocument,
  getDocumentStats,
} from '../services/documentService';

describe('DocumentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default chain setup for insert: db.insert().values().returning()
    mockReturning.mockResolvedValue([]);
    mockValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockValues });

    // Default chain setup for select: db.select().from().where().groupBy()
    mockGroupBy.mockResolvedValue([]);
    mockWhere.mockResolvedValue([]);
    mockWhere.mockReturnValue({ groupBy: mockGroupBy });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    // Default chain setup for delete: db.delete().where().returning()
    mockDelete.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: mockReturning }) });
  });

  describe('uploadDocument', () => {
    it('should insert document metadata and return the created document', async () => {
      const mockDoc = {
        id: 1,
        patientId: 10,
        practiceId: 1,
        fileName: 'insurance_front.jpg',
        fileType: 'insurance_card',
        fileSize: 204800,
        mimeType: 'image/jpeg',
        storagePath: '/uploads/1/10/insurance_front.jpg',
        uploadedBy: 'user-123',
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockReturning.mockResolvedValue([mockDoc]);

      const result = await uploadDocument(1, 10, 'user-123', {
        fileName: 'insurance_front.jpg',
        fileType: 'insurance_card',
        fileSize: 204800,
        mimeType: 'image/jpeg',
        storagePath: '/uploads/1/10/insurance_front.jpg',
      });

      expect(result).toEqual(mockDoc);
      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
        patientId: 10,
        practiceId: 1,
        uploadedBy: 'user-123',
        fileName: 'insurance_front.jpg',
        fileType: 'insurance_card',
        fileSize: 204800,
        mimeType: 'image/jpeg',
        storagePath: '/uploads/1/10/insurance_front.jpg',
        notes: null,
      }));
    });

    it('should store notes when provided', async () => {
      const mockDoc = {
        id: 2,
        patientId: 10,
        practiceId: 1,
        fileName: 'referral.pdf',
        fileType: 'referral',
        fileSize: 102400,
        mimeType: 'application/pdf',
        storagePath: '/uploads/1/10/referral.pdf',
        uploadedBy: 'user-123',
        notes: 'From Dr. Smith',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockReturning.mockResolvedValue([mockDoc]);

      const result = await uploadDocument(1, 10, 'user-123', {
        fileName: 'referral.pdf',
        fileType: 'referral',
        fileSize: 102400,
        mimeType: 'application/pdf',
        storagePath: '/uploads/1/10/referral.pdf',
        notes: 'From Dr. Smith',
      });

      expect(result.notes).toBe('From Dr. Smith');
      expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
        notes: 'From Dr. Smith',
      }));
    });
  });

  describe('getDocuments', () => {
    it('should return documents for a patient in a practice', async () => {
      const mockDocs = [
        { id: 1, patientId: 10, practiceId: 1, fileName: 'doc1.pdf', fileType: 'referral' },
        { id: 2, patientId: 10, practiceId: 1, fileName: 'doc2.jpg', fileType: 'insurance_card' },
      ];
      mockWhere.mockResolvedValue(mockDocs);

      const result = await getDocuments(1, 10);

      expect(result).toEqual(mockDocs);
      expect(mockSelect).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalled();
      expect(mockWhere).toHaveBeenCalled();
    });

    it('should apply fileType filter when provided', async () => {
      const mockDocs = [
        { id: 2, patientId: 10, practiceId: 1, fileName: 'card.jpg', fileType: 'insurance_card' },
      ];
      mockWhere.mockResolvedValue(mockDocs);

      const result = await getDocuments(1, 10, { fileType: 'insurance_card' });

      expect(result).toEqual(mockDocs);
      expect(mockWhere).toHaveBeenCalled();
    });

    it('should return empty array when no documents exist', async () => {
      mockWhere.mockResolvedValue([]);

      const result = await getDocuments(1, 99);

      expect(result).toEqual([]);
    });
  });

  describe('getDocument', () => {
    it('should return a document when found', async () => {
      const mockDoc = {
        id: 1,
        patientId: 10,
        practiceId: 1,
        fileName: 'consent.pdf',
        fileType: 'consent_form',
      };
      mockWhere.mockResolvedValue([mockDoc]);

      const result = await getDocument(1, 1);

      expect(result).toEqual(mockDoc);
    });

    it('should return undefined when document is not found', async () => {
      mockWhere.mockResolvedValue([]);

      const result = await getDocument(999, 1);

      expect(result).toBeUndefined();
    });
  });

  describe('deleteDocument', () => {
    it('should delete and return the document when found', async () => {
      const mockDeleted = {
        id: 1,
        patientId: 10,
        practiceId: 1,
        fileName: 'old_doc.pdf',
      };
      const mockDeleteWhere = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([mockDeleted]),
      });
      mockDelete.mockReturnValue({ where: mockDeleteWhere });

      const result = await deleteDocument(1, 1);

      expect(result).toEqual(mockDeleted);
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should return undefined when document does not exist', async () => {
      const mockDeleteWhere = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      });
      mockDelete.mockReturnValue({ where: mockDeleteWhere });

      const result = await deleteDocument(999, 1);

      expect(result).toBeUndefined();
    });
  });

  describe('getDocumentStats', () => {
    it('should aggregate counts and sizes by file type', async () => {
      const mockRows = [
        { fileType: 'insurance_card', count: 5, totalSize: 1024000 },
        { fileType: 'referral', count: 3, totalSize: 512000 },
        { fileType: 'consent_form', count: 10, totalSize: 2048000 },
      ];
      mockGroupBy.mockResolvedValue(mockRows);

      const result = await getDocumentStats(1);

      expect(result.countByType).toEqual({
        insurance_card: 5,
        referral: 3,
        consent_form: 10,
      });
      expect(result.totalSize).toBe(1024000 + 512000 + 2048000);
      expect(result.totalCount).toBe(18);
    });

    it('should return zeros when no documents exist', async () => {
      mockGroupBy.mockResolvedValue([]);

      const result = await getDocumentStats(1);

      expect(result.countByType).toEqual({});
      expect(result.totalSize).toBe(0);
      expect(result.totalCount).toBe(0);
    });

    it('should handle a single file type', async () => {
      const mockRows = [
        { fileType: 'lab_results', count: 2, totalSize: 300000 },
      ];
      mockGroupBy.mockResolvedValue(mockRows);

      const result = await getDocumentStats(1);

      expect(result.countByType).toEqual({ lab_results: 2 });
      expect(result.totalSize).toBe(300000);
      expect(result.totalCount).toBe(2);
    });
  });
});
