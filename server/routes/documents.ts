/**
 * Document Routes
 *
 * Handles:
 * - GET    /api/documents/patient/:patientId       - List documents for a patient
 * - GET    /api/documents/:id                      - Get single document metadata
 * - POST   /api/documents/patient/:patientId       - Upload document metadata
 * - DELETE /api/documents/:id                      - Delete a document
 * - GET    /api/documents/stats                    - Get document stats for practice
 */

import { Router } from 'express';
import { isAuthenticated } from '../replitAuth';
import { DOCUMENT_FILE_TYPES } from '@shared/schema';
import * as documentService from '../services/documentService';
import logger from '../services/logger';

const router = Router();

// Helper to get authorized practiceId from request
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) {
    return req.authorizedPracticeId;
  }

  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;

  if (userRole === 'admin') {
    return requestedPracticeId || userPracticeId || 1;
  }

  if (!userPracticeId) {
    throw new Error('User not assigned to a practice. Contact administrator.');
  }

  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    return userPracticeId;
  }

  return requestedPracticeId || userPracticeId;
};

/**
 * GET /api/documents/stats
 * Get document statistics for the practice.
 */
router.get('/stats', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const stats = await documentService.getDocumentStats(practiceId);
    res.json(stats);
  } catch (error) {
    logger.error('Failed to get document stats', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to get document statistics' });
  }
});

/**
 * GET /api/documents/patient/:patientId
 * List documents for a patient, with optional fileType filter.
 */
router.get('/patient/:patientId', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const patientId = parseInt(req.params.patientId);

    if (isNaN(patientId)) {
      return res.status(400).json({ message: 'Invalid patient ID' });
    }

    const filters: { fileType?: string } = {};
    if (req.query.fileType && typeof req.query.fileType === 'string') {
      filters.fileType = req.query.fileType;
    }

    const documents = await documentService.getDocuments(practiceId, patientId, filters);
    res.json(documents);
  } catch (error) {
    logger.error('Failed to list documents', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to list documents' });
  }
});

/**
 * GET /api/documents/:id
 * Get a single document's metadata.
 */
router.get('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid document ID' });
    }

    const document = await documentService.getDocument(id, practiceId);
    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    res.json(document);
  } catch (error) {
    logger.error('Failed to get document', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to get document' });
  }
});

/**
 * POST /api/documents/patient/:patientId
 * Upload document metadata.
 */
router.post('/patient/:patientId', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const patientId = parseInt(req.params.patientId);

    if (isNaN(patientId)) {
      return res.status(400).json({ message: 'Invalid patient ID' });
    }

    const { fileName, fileType, fileSize, mimeType, storagePath, notes } = req.body;

    // Validate required fields
    if (!fileName || !fileType || !fileSize || !mimeType || !storagePath) {
      return res.status(400).json({
        message: 'Missing required fields: fileName, fileType, fileSize, mimeType, storagePath',
      });
    }

    // Validate fileType
    const validTypes: readonly string[] = DOCUMENT_FILE_TYPES;
    if (!validTypes.includes(fileType)) {
      return res.status(400).json({
        message: `Invalid fileType. Must be one of: ${DOCUMENT_FILE_TYPES.join(', ')}`,
      });
    }

    const uploadedBy = req.user?.claims?.sub;
    if (!uploadedBy) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const document = await documentService.uploadDocument(practiceId, patientId, uploadedBy, {
      fileName,
      fileType,
      fileSize,
      mimeType,
      storagePath,
      notes,
    });

    res.status(201).json(document);
  } catch (error) {
    logger.error('Failed to upload document', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to upload document' });
  }
});

/**
 * DELETE /api/documents/:id
 * Delete a document.
 */
router.delete('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid document ID' });
    }

    const deleted = await documentService.deleteDocument(id, practiceId);
    if (!deleted) {
      return res.status(404).json({ message: 'Document not found' });
    }

    res.json({ message: 'Document deleted', document: deleted });
  } catch (error) {
    logger.error('Failed to delete document', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete document' });
  }
});

export default router;
