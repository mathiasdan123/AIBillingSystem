/**
 * Data Export Routes
 *
 * Handles practice data export for compliance, migration, and backup:
 * - GET /api/export/patients — Export patients as CSV
 * - GET /api/export/claims — Export claims (with line items) as CSV
 * - GET /api/export/appointments — Export appointments as CSV
 * - GET /api/export/statements — Export patient statements as CSV
 * - GET /api/export/audit-log — Export audit log as CSV
 * - POST /api/export/full-backup — Full JSON backup (admin only)
 *
 * All exports filter by practiceId and support ?startDate=&endDate= date range filters.
 */

import { Router, type Response, type NextFunction } from 'express';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import { db } from '../db';
import {
  patients,
  claims,
  claimLineItems,
  appointments,
  patientStatements,
  auditLog,
  soapNotes,
  treatmentSessions,
  payments,
} from '../../shared/schema';
import { eq, and, gte, lte, desc } from 'drizzle-orm';
import logger from '../services/logger';

const router = Router();

// ==================== HELPERS ====================

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
    logger.warn(`Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`);
    return userPracticeId;
  }

  return requestedPracticeId || userPracticeId;
};

const isAdmin = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await storage.getUser(req.user.claims.sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }

    next();
  } catch (error) {
    logger.error('Error checking admin role', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to verify permissions' });
  }
};

const parseDateRange = (req: any): { startDate: Date | null; endDate: Date | null } => {
  const startStr = req.query.startDate as string | undefined;
  const endStr = req.query.endDate as string | undefined;

  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (startStr) {
    const d = new Date(startStr);
    if (!isNaN(d.getTime())) startDate = d;
  }
  if (endStr) {
    const d = new Date(endStr);
    if (!isNaN(d.getTime())) endDate = d;
  }

  return { startDate, endDate };
};

/**
 * Escape a value for CSV output. Wraps in quotes if it contains commas,
 * quotes, or newlines. Replaces internal quotes with double-quotes.
 */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const headerLine = headers.map(csvEscape).join(',');
  const dataLines = rows.map(row =>
    headers.map(h => csvEscape(row[h])).join(',')
  );
  return [headerLine, ...dataLines].join('\n');
}

function setDownloadHeaders(res: Response, filename: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

function setJsonDownloadHeaders(res: Response, filename: string) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
}

// ==================== PATIENTS EXPORT ====================

router.get('/patients', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { startDate, endDate } = parseDateRange(req);

    const conditions = [eq(patients.practiceId, practiceId)];
    if (startDate) conditions.push(gte(patients.createdAt, startDate));
    if (endDate) conditions.push(lte(patients.createdAt, endDate));

    const results = await db
      .select()
      .from(patients)
      .where(and(...conditions))
      .orderBy(desc(patients.createdAt));

    const headers = [
      'id', 'firstName', 'lastName', 'dateOfBirth', 'email', 'phone', 'address',
      'insuranceProvider', 'insuranceId', 'policyNumber', 'groupNumber',
      'secondaryInsuranceProvider', 'secondaryInsurancePolicyNumber',
      'secondaryInsuranceMemberId', 'secondaryInsuranceGroupNumber',
      'phoneType', 'preferredContactMethod', 'smsConsentGiven',
      'createdAt', 'updatedAt',
    ];

    const csv = toCsv(headers, results as any[]);
    const timestamp = new Date().toISOString().slice(0, 10);
    setDownloadHeaders(res, `patients-export-${timestamp}.csv`);

    logger.info('Data export: patients', { practiceId, count: results.length });
    res.send(csv);
  } catch (error) {
    logger.error('Error exporting patients', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to export patients' });
  }
});

// ==================== CLAIMS EXPORT ====================

router.get('/claims', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { startDate, endDate } = parseDateRange(req);

    const conditions = [eq(claims.practiceId, practiceId)];
    if (startDate) conditions.push(gte(claims.createdAt, startDate));
    if (endDate) conditions.push(lte(claims.createdAt, endDate));

    const claimResults = await db
      .select()
      .from(claims)
      .where(and(...conditions))
      .orderBy(desc(claims.createdAt));

    // Fetch line items for all claims
    const claimIds = claimResults.map((c: any) => c.id);
    const lineItemsMap = new Map<number, any[]>();

    for (const claimId of claimIds) {
      const items = await storage.getClaimLineItems(claimId);
      lineItemsMap.set(claimId, items);
    }

    // Flatten claims with line items
    const rows: Record<string, unknown>[] = [];
    for (const claim of claimResults) {
      const lineItems = lineItemsMap.get(claim.id) || [];
      if (lineItems.length === 0) {
        rows.push({
          claimId: claim.id,
          claimNumber: claim.claimNumber,
          patientId: claim.patientId,
          status: claim.status,
          totalAmount: claim.totalAmount,
          submittedAmount: claim.submittedAmount,
          paidAmount: claim.paidAmount,
          denialReason: claim.denialReason,
          billingOrder: claim.billingOrder,
          submittedAt: claim.submittedAt,
          paidAt: claim.paidAt,
          createdAt: claim.createdAt,
          lineItemId: '',
          cptCodeId: '',
          icd10CodeId: '',
          units: '',
          rate: '',
          lineAmount: '',
          dateOfService: '',
          modifier: '',
        });
      } else {
        for (const li of lineItems) {
          rows.push({
            claimId: claim.id,
            claimNumber: claim.claimNumber,
            patientId: claim.patientId,
            status: claim.status,
            totalAmount: claim.totalAmount,
            submittedAmount: claim.submittedAmount,
            paidAmount: claim.paidAmount,
            denialReason: claim.denialReason,
            billingOrder: claim.billingOrder,
            submittedAt: claim.submittedAt,
            paidAt: claim.paidAt,
            createdAt: claim.createdAt,
            lineItemId: li.id,
            cptCodeId: li.cptCodeId,
            icd10CodeId: li.icd10CodeId,
            units: li.units,
            rate: li.rate,
            lineAmount: li.amount,
            dateOfService: li.dateOfService,
            modifier: li.modifier,
          });
        }
      }
    }

    const headers = [
      'claimId', 'claimNumber', 'patientId', 'status', 'totalAmount',
      'submittedAmount', 'paidAmount', 'denialReason', 'billingOrder',
      'submittedAt', 'paidAt', 'createdAt',
      'lineItemId', 'cptCodeId', 'icd10CodeId', 'units', 'rate',
      'lineAmount', 'dateOfService', 'modifier',
    ];

    const csv = toCsv(headers, rows);
    const timestamp = new Date().toISOString().slice(0, 10);
    setDownloadHeaders(res, `claims-export-${timestamp}.csv`);

    logger.info('Data export: claims', { practiceId, claimCount: claimResults.length, rowCount: rows.length });
    res.send(csv);
  } catch (error) {
    logger.error('Error exporting claims', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to export claims' });
  }
});

// ==================== APPOINTMENTS EXPORT ====================

router.get('/appointments', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { startDate, endDate } = parseDateRange(req);

    const conditions = [eq(appointments.practiceId, practiceId)];
    if (startDate) conditions.push(gte(appointments.createdAt, startDate));
    if (endDate) conditions.push(lte(appointments.createdAt, endDate));

    const results = await db
      .select()
      .from(appointments)
      .where(and(...conditions))
      .orderBy(desc(appointments.startTime));

    const headers = [
      'id', 'patientId', 'therapistId', 'title', 'startTime', 'endTime',
      'status', 'notes', 'reminderSent', 'cancelledAt', 'cancelledBy',
      'cancellationReason', 'cancellationNotes', 'isRecurring', 'seriesId',
      'createdAt', 'updatedAt',
    ];

    const csv = toCsv(headers, results as any[]);
    const timestamp = new Date().toISOString().slice(0, 10);
    setDownloadHeaders(res, `appointments-export-${timestamp}.csv`);

    logger.info('Data export: appointments', { practiceId, count: results.length });
    res.send(csv);
  } catch (error) {
    logger.error('Error exporting appointments', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to export appointments' });
  }
});

// ==================== STATEMENTS EXPORT ====================

router.get('/statements', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { startDate, endDate } = parseDateRange(req);

    const conditions = [eq(patientStatements.practiceId, practiceId)];
    if (startDate) conditions.push(gte(patientStatements.createdAt, startDate));
    if (endDate) conditions.push(lte(patientStatements.createdAt, endDate));

    const results = await db
      .select()
      .from(patientStatements)
      .where(and(...conditions))
      .orderBy(desc(patientStatements.statementDate));

    const headers = [
      'id', 'patientId', 'statementNumber', 'statementDate', 'dueDate',
      'totalCharges', 'insurancePaid', 'adjustments', 'patientBalance',
      'previousBalance', 'paidAmount', 'lineItems',
      'status', 'sentMethod', 'sentAt', 'paidAt',
      'notes', 'createdAt', 'updatedAt',
    ];

    const csv = toCsv(headers, results as any[]);
    const timestamp = new Date().toISOString().slice(0, 10);
    setDownloadHeaders(res, `statements-export-${timestamp}.csv`);

    logger.info('Data export: statements', { practiceId, count: results.length });
    res.send(csv);
  } catch (error) {
    logger.error('Error exporting statements', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to export statements' });
  }
});

// ==================== AUDIT LOG EXPORT ====================

router.get('/audit-log', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { startDate, endDate } = parseDateRange(req);

    const conditions = [eq(auditLog.practiceId, practiceId)];
    if (startDate) conditions.push(gte(auditLog.createdAt, startDate));
    if (endDate) conditions.push(lte(auditLog.createdAt, endDate));

    const results = await db
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.createdAt));

    const headers = [
      'id', 'eventCategory', 'eventType', 'resourceType', 'resourceId',
      'userId', 'ipAddress', 'userAgent', 'details', 'success',
      'integrityHash', 'createdAt',
    ];

    const csv = toCsv(headers, results as any[]);
    const timestamp = new Date().toISOString().slice(0, 10);
    setDownloadHeaders(res, `audit-log-export-${timestamp}.csv`);

    logger.info('Data export: audit-log', { practiceId, count: results.length });
    res.send(csv);
  } catch (error) {
    logger.error('Error exporting audit log', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to export audit log' });
  }
});

// ==================== FULL BACKUP (ADMIN ONLY) ====================

router.post('/full-backup', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { startDate, endDate } = parseDateRange(req);

    // Build date conditions per table
    const buildConditions = (table: any) => {
      const conds = [eq(table.practiceId, practiceId)];
      if (startDate && table.createdAt) conds.push(gte(table.createdAt, startDate));
      if (endDate && table.createdAt) conds.push(lte(table.createdAt, endDate));
      return and(...conds);
    };

    // Fetch all practice data
    const [
      patientData,
      claimData,
      appointmentData,
      statementData,
      paymentData,
    ] = await Promise.all([
      db.select().from(patients).where(buildConditions(patients)),
      db.select().from(claims).where(buildConditions(claims)),
      db.select().from(appointments).where(buildConditions(appointments)),
      db.select().from(patientStatements).where(buildConditions(patientStatements)),
      db.select().from(payments).where(buildConditions(payments)),
    ]);

    // Fetch SOAP notes via treatment sessions (practiceId is on sessions, not notes)
    const sessionConditions = [eq(treatmentSessions.practiceId, practiceId)];
    if (startDate) sessionConditions.push(gte(treatmentSessions.createdAt, startDate));
    if (endDate) sessionConditions.push(lte(treatmentSessions.createdAt, endDate));

    const sessionData = await db
      .select()
      .from(treatmentSessions)
      .where(and(...sessionConditions));

    // Fetch SOAP notes for those sessions
    const sessionIds = sessionData.map((s: any) => s.id);
    let soapNoteData: any[] = [];
    if (sessionIds.length > 0) {
      // Batch fetch in chunks to avoid query size limits
      const chunkSize = 500;
      for (let i = 0; i < sessionIds.length; i += chunkSize) {
        const chunk = sessionIds.slice(i, i + chunkSize);
        const { inArray } = await import('drizzle-orm');
        const notes = await db
          .select()
          .from(soapNotes)
          .where(inArray(soapNotes.sessionId, chunk));
        soapNoteData = soapNoteData.concat(notes);
      }
    }

    // Fetch claim line items for all claims
    const claimLineItemData: any[] = [];
    for (const claim of claimData) {
      const items = await storage.getClaimLineItems(claim.id);
      claimLineItemData.push(...items);
    }

    const backup = {
      exportedAt: new Date().toISOString(),
      practiceId,
      dateRange: {
        startDate: startDate?.toISOString() || null,
        endDate: endDate?.toISOString() || null,
      },
      summary: {
        patients: patientData.length,
        claims: claimData.length,
        claimLineItems: claimLineItemData.length,
        appointments: appointmentData.length,
        treatmentSessions: sessionData.length,
        soapNotes: soapNoteData.length,
        statements: statementData.length,
        payments: paymentData.length,
      },
      data: {
        patients: patientData,
        claims: claimData,
        claimLineItems: claimLineItemData,
        appointments: appointmentData,
        treatmentSessions: sessionData,
        soapNotes: soapNoteData,
        statements: statementData,
        payments: paymentData,
      },
    };

    const timestamp = new Date().toISOString().slice(0, 10);
    setJsonDownloadHeaders(res, `full-backup-${timestamp}.json`);

    logger.info('Data export: full-backup', {
      practiceId,
      summary: backup.summary,
    });

    res.json(backup);
  } catch (error) {
    logger.error('Error generating full backup', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to generate full backup' });
  }
});

export default router;
