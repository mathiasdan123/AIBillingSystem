import type { Express, Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { logAuditEvent } from '../middleware/auditMiddleware';
import { isAuthenticated } from '../replitAuth';
import { sendBreachNotificationAlert } from '../email';

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

export function registerBreachNotificationRoutes(app: Express) {
  // POST /api/admin/breach-incidents — create
  app.post('/api/admin/breach-incidents', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const incident = await storage.createBreachIncident({
        ...req.body,
        createdBy: userId,
        discoveredAt: new Date(req.body.discoveredAt),
      });

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'create',
        resourceType: 'breach_incident',
        resourceId: String(incident.id),
        userId,
        practiceId: incident.practiceId,
        details: { breachType: incident.breachType, affectedCount: incident.affectedIndividualsCount },
      });

      return res.status(201).json(incident);
    } catch (err) {
      console.error('Failed to create breach incident:', err);
      return res.status(500).json({ error: 'Failed to create breach incident' });
    }
  });

  // GET /api/admin/breach-incidents — list by practice
  app.get('/api/admin/breach-incidents', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string, 10);
      if (isNaN(practiceId)) {
        return res.status(400).json({ error: 'practiceId query parameter required' });
      }

      const incidents = await storage.getBreachIncidentsByPractice(practiceId);

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'read',
        resourceType: 'breach_incident',
        userId: (req as any).user?.claims?.sub || (req as any).user?.id,
        practiceId,
        details: { action: 'list_breach_incidents' },
      });

      return res.json(incidents);
    } catch (err) {
      console.error('Failed to list breach incidents:', err);
      return res.status(500).json({ error: 'Failed to list breach incidents' });
    }
  });

  // GET /api/admin/breach-incidents/:id — get single
  app.get('/api/admin/breach-incidents/:id', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const incident = await storage.getBreachIncident(id);
      if (!incident) return res.status(404).json({ error: 'Breach incident not found' });

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'read',
        resourceType: 'breach_incident',
        resourceId: String(id),
        userId: (req as any).user?.claims?.sub || (req as any).user?.id,
        practiceId: incident.practiceId,
      });

      return res.json(incident);
    } catch (err) {
      console.error('Failed to get breach incident:', err);
      return res.status(500).json({ error: 'Failed to get breach incident' });
    }
  });

  // PATCH /api/admin/breach-incidents/:id — update/transition status
  app.patch('/api/admin/breach-incidents/:id', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const existing = await storage.getBreachIncident(id);
      if (!existing) return res.status(404).json({ error: 'Breach incident not found' });

      const updated = await storage.updateBreachIncident(id, req.body);

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'update',
        resourceType: 'breach_incident',
        resourceId: String(id),
        userId: (req as any).user?.claims?.sub || (req as any).user?.id,
        practiceId: updated.practiceId,
        details: { updatedFields: Object.keys(req.body) },
      });

      return res.json(updated);
    } catch (err) {
      console.error('Failed to update breach incident:', err);
      return res.status(500).json({ error: 'Failed to update breach incident' });
    }
  });

  // POST /api/admin/breach-incidents/:id/notify — trigger notifications
  app.post('/api/admin/breach-incidents/:id/notify', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const incident = await storage.getBreachIncident(id);
      if (!incident) return res.status(404).json({ error: 'Breach incident not found' });

      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const user = await storage.getUser(userId);
      const practice = await storage.getPractice(incident.practiceId);
      const now = new Date();

      // Send notification email to admins
      const adminEmail = practice?.email || user?.email;
      if (adminEmail) {
        await sendBreachNotificationAlert(adminEmail, {
          practiceName: practice?.name || 'Practice',
          breachDescription: incident.description,
          discoveredAt: incident.discoveredAt,
          phiInvolved: incident.phiInvolved || 'Not specified',
          remediationSteps: incident.remediationSteps || 'Not specified',
          affectedCount: incident.affectedIndividualsCount || 0,
          breachType: incident.breachType,
        });
      }

      // Update notification timestamps based on what's being notified
      const updateData: any = {};
      const { notifyType } = req.body; // individuals, hhs, media
      if (notifyType === 'individuals' || !notifyType) {
        updateData.notifiedIndividualsAt = now;
        updateData.notificationStatus = 'individuals_notified';
      }
      if (notifyType === 'hhs') {
        updateData.notifiedHhsAt = now;
        updateData.notificationStatus = 'hhs_notified';
      }
      if (notifyType === 'media') {
        updateData.notifiedMediaAt = now;
      }
      // If all notified, mark complete
      const updated = await storage.getBreachIncident(id);
      if (updated?.notifiedIndividualsAt && updated?.notifiedHhsAt) {
        updateData.notificationStatus = 'complete';
      }

      const result = await storage.updateBreachIncident(id, updateData);

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'notify',
        resourceType: 'breach_incident',
        resourceId: String(id),
        userId,
        practiceId: incident.practiceId,
        details: { notifyType: notifyType || 'individuals', notifiedAt: now.toISOString() },
      });

      return res.json({ message: 'Notification triggered', incident: result });
    } catch (err) {
      console.error('Failed to trigger breach notification:', err);
      return res.status(500).json({ error: 'Failed to trigger notification' });
    }
  });
}
