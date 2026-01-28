import type { Express, Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { db } from '../db';
import { auditLog, patients } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import { logAuditEvent } from '../middleware/auditMiddleware';
import { isAuthenticated } from '../supabaseAuth';

async function isAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const sub = (req as any).user?.claims?.sub || (req as any).user?.id;
    if (!sub) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await storage.getUser(sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify admin status' });
  }
}

export function registerPatientRightsRoutes(app: Express) {
  // GET /api/patients/:id/export - Full data export (decrypted)
  app.get('/api/patients/:id/export', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const patientId = parseInt(req.params.id, 10);
      if (isNaN(patientId)) {
        return res.status(400).json({ error: 'Invalid patient ID' });
      }

      const patient = await storage.getPatient(patientId);
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      // Gather all related data
      const eligibility = await storage.getEligibilityHistory(patientId);
      const cachedInsurance = await storage.getCachedInsuranceData(patientId);

      await logAuditEvent({
        eventCategory: 'data_export',
        eventType: 'export',
        resourceType: 'patient',
        resourceId: String(patientId),
        userId: (req as any).user?.claims?.sub || (req as any).user?.id,
        details: { type: 'full_patient_export' },
      });

      return res.json({
        patient,
        eligibilityHistory: eligibility,
        insuranceData: cachedInsurance,
        exportedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Patient data export failed:', err);
      return res.status(500).json({ error: 'Failed to export patient data' });
    }
  });

  // POST /api/patients/:id/delete-request - Soft delete (anonymize PHI, retain audit trail)
  app.post('/api/patients/:id/delete-request', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const patientId = parseInt(req.params.id, 10);
      if (isNaN(patientId)) {
        return res.status(400).json({ error: 'Invalid patient ID' });
      }

      const patient = await storage.getPatient(patientId);
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      await storage.softDeletePatient(patientId);

      await logAuditEvent({
        eventCategory: 'data_delete',
        eventType: 'delete',
        resourceType: 'patient',
        resourceId: String(patientId),
        userId: (req as any).user?.claims?.sub || (req as any).user?.id,
        details: { type: 'patient_delete_request', reason: req.body.reason || 'Patient request' },
      });

      return res.json({
        message: 'Patient record deleted and PHI anonymized',
        patientId,
        deletedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Patient delete request failed:', err);
      return res.status(500).json({ error: 'Failed to process delete request' });
    }
  });

  // GET /api/patients/:id/disclosures - Accounting of all data access events
  app.get('/api/patients/:id/disclosures', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const patientId = parseInt(req.params.id, 10);
      if (isNaN(patientId)) {
        return res.status(400).json({ error: 'Invalid patient ID' });
      }

      const patient = await storage.getPatient(patientId);
      if (!patient) {
        return res.status(404).json({ error: 'Patient not found' });
      }

      const disclosures = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.resourceType, 'patient'),
            eq(auditLog.resourceId, String(patientId))
          )
        )
        .orderBy(desc(auditLog.createdAt));

      await logAuditEvent({
        eventCategory: 'phi_access',
        eventType: 'view',
        resourceType: 'patient',
        resourceId: String(patientId),
        userId: (req as any).user?.claims?.sub || (req as any).user?.id,
        details: { type: 'accounting_of_disclosures' },
      });

      return res.json({
        patientId,
        disclosures,
        total: disclosures.length,
      });
    } catch (err) {
      console.error('Disclosures query failed:', err);
      return res.status(500).json({ error: 'Failed to retrieve disclosures' });
    }
  });

  // ==================== AMENDMENT REQUESTS ====================

  // POST /api/patients/:id/amendment-request — create
  app.post('/api/patients/:id/amendment-request', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const patientId = parseInt(req.params.id, 10);
      if (isNaN(patientId)) return res.status(400).json({ error: 'Invalid patient ID' });

      const patient = await storage.getPatient(patientId);
      if (!patient) return res.status(404).json({ error: 'Patient not found' });

      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const now = new Date();
      const deadline = new Date(now);
      deadline.setDate(deadline.getDate() + 60);

      const request = await storage.createAmendmentRequest({
        patientId,
        practiceId: patient.practiceId,
        requestedBy: userId,
        requestDate: now,
        fieldToAmend: req.body.fieldToAmend,
        currentValue: req.body.currentValue,
        requestedValue: req.body.requestedValue,
        reason: req.body.reason,
        responseDeadline: deadline,
      });

      await logAuditEvent({
        eventCategory: 'phi_access',
        eventType: 'create',
        resourceType: 'amendment_request',
        resourceId: String(request.id),
        userId,
        practiceId: patient.practiceId,
        details: { fieldToAmend: req.body.fieldToAmend, patientId },
      });

      return res.status(201).json(request);
    } catch (err) {
      console.error('Failed to create amendment request:', err);
      return res.status(500).json({ error: 'Failed to create amendment request' });
    }
  });

  // GET /api/patients/:id/amendments — list for patient
  app.get('/api/patients/:id/amendments', isAuthenticated, async (req: Request, res: Response) => {
    try {
      const patientId = parseInt(req.params.id, 10);
      if (isNaN(patientId)) return res.status(400).json({ error: 'Invalid patient ID' });

      const amendments = await storage.getAmendmentRequestsByPatient(patientId);
      return res.json(amendments);
    } catch (err) {
      console.error('Failed to list amendment requests:', err);
      return res.status(500).json({ error: 'Failed to list amendment requests' });
    }
  });

  // PATCH /api/amendment-requests/:id — admin approve/deny/extend
  app.patch('/api/amendment-requests/:id', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const existing = await storage.getAmendmentRequest(id);
      if (!existing) return res.status(404).json({ error: 'Amendment request not found' });

      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const { status, denialReason } = req.body;

      if (status === 'denied' && !denialReason) {
        return res.status(400).json({ error: 'denialReason is required when denying an amendment' });
      }

      const updateData: any = {
        status,
        reviewedBy: userId,
        reviewDate: new Date(),
      };

      if (status === 'denied') {
        updateData.denialReason = denialReason;
      }

      if (status === 'extended') {
        // Add 30 days to current deadline
        const newDeadline = new Date(existing.responseDeadline);
        newDeadline.setDate(newDeadline.getDate() + 30);
        updateData.responseDeadline = newDeadline;
      }

      const updated = await storage.updateAmendmentRequest(id, updateData);

      await logAuditEvent({
        eventCategory: 'phi_access',
        eventType: 'update',
        resourceType: 'amendment_request',
        resourceId: String(id),
        userId,
        practiceId: existing.practiceId,
        details: { newStatus: status, patientId: existing.patientId },
      });

      return res.json(updated);
    } catch (err) {
      console.error('Failed to update amendment request:', err);
      return res.status(500).json({ error: 'Failed to update amendment request' });
    }
  });

  // ==================== AUDIT LOG INTEGRITY ====================

  // GET /api/admin/audit-integrity-check — verify hash chain
  app.get('/api/admin/audit-integrity-check', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      const result = await storage.verifyAuditLogIntegrity(limit);

      await logAuditEvent({
        eventCategory: 'admin',
        eventType: 'integrity_check',
        resourceType: 'audit_log',
        userId: (req as any).user?.claims?.sub || (req as any).user?.id,
        details: { result },
      });

      return res.json(result);
    } catch (err) {
      console.error('Audit integrity check failed:', err);
      return res.status(500).json({ error: 'Failed to verify audit log integrity' });
    }
  });
}
