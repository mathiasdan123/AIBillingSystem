/**
 * Document Service
 *
 * Handles patient document metadata management.
 * Actual file storage is abstracted - this service stores file paths/metadata.
 */

import { eq, and, sql } from 'drizzle-orm';
import { patientDocuments, type InsertPatientDocument, type PatientDocument } from '@shared/schema';
import { db } from '../db';
import logger from './logger';

export interface DocumentMetadata {
  fileName: string;
  fileType: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
  notes?: string;
}

export interface DocumentFilters {
  fileType?: string;
}

export interface DocumentStats {
  countByType: Record<string, number>;
  totalSize: number;
  totalCount: number;
}

/**
 * Upload a document (store metadata).
 * Actual file storage is handled externally; this stores the metadata record.
 */
export async function uploadDocument(
  practiceId: number,
  patientId: number,
  uploadedBy: string,
  metadata: DocumentMetadata,
): Promise<PatientDocument> {
  const insertData: InsertPatientDocument = {
    patientId,
    practiceId,
    uploadedBy,
    fileName: metadata.fileName,
    fileType: metadata.fileType,
    fileSize: metadata.fileSize,
    mimeType: metadata.mimeType,
    storagePath: metadata.storagePath,
    notes: metadata.notes || null,
  };

  const [document] = await db.insert(patientDocuments).values(insertData).returning();

  logger.info('Document uploaded', {
    documentId: document.id,
    patientId,
    practiceId,
    fileType: metadata.fileType,
    fileSize: metadata.fileSize,
  });

  return document;
}

/**
 * List documents for a patient, optionally filtered by file type.
 */
export async function getDocuments(
  practiceId: number,
  patientId: number,
  filters?: DocumentFilters,
): Promise<PatientDocument[]> {
  const conditions = [
    eq(patientDocuments.practiceId, practiceId),
    eq(patientDocuments.patientId, patientId),
  ];

  if (filters?.fileType) {
    conditions.push(eq(patientDocuments.fileType, filters.fileType));
  }

  const documents = await db
    .select()
    .from(patientDocuments)
    .where(and(...conditions));

  return documents;
}

/**
 * Get a single document by ID, scoped to a practice.
 */
export async function getDocument(
  id: number,
  practiceId: number,
): Promise<PatientDocument | undefined> {
  const [document] = await db
    .select()
    .from(patientDocuments)
    .where(and(
      eq(patientDocuments.id, id),
      eq(patientDocuments.practiceId, practiceId),
    ));

  return document;
}

/**
 * Delete a document by ID, scoped to a practice.
 * Returns the deleted document or undefined if not found.
 */
export async function deleteDocument(
  id: number,
  practiceId: number,
): Promise<PatientDocument | undefined> {
  const [deleted] = await db
    .delete(patientDocuments)
    .where(and(
      eq(patientDocuments.id, id),
      eq(patientDocuments.practiceId, practiceId),
    ))
    .returning();

  if (deleted) {
    logger.info('Document deleted', {
      documentId: id,
      practiceId,
      patientId: deleted.patientId,
    });
  }

  return deleted;
}

/**
 * Get document statistics for a practice: count by type and total size.
 */
export async function getDocumentStats(practiceId: number): Promise<DocumentStats> {
  const rows = await db
    .select({
      fileType: patientDocuments.fileType,
      count: sql<number>`count(*)::int`,
      totalSize: sql<number>`coalesce(sum(${patientDocuments.fileSize}), 0)::int`,
    })
    .from(patientDocuments)
    .where(eq(patientDocuments.practiceId, practiceId))
    .groupBy(patientDocuments.fileType);

  const countByType: Record<string, number> = {};
  let totalSize = 0;
  let totalCount = 0;

  for (const row of rows) {
    countByType[row.fileType] = row.count;
    totalSize += row.totalSize;
    totalCount += row.count;
  }

  return { countByType, totalSize, totalCount };
}
