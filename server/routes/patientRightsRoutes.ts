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
}
