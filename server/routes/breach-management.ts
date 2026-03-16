import type { Express, Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { logAuditEvent } from '../middleware/auditMiddleware';
import { isAuthenticated } from '../replitAuth';
import {
  sendPatientBreachNotification,
  generateStateAgNotificationLetter,
  generateHhsReportData,
} from '../email';

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

const VALID_STATUSES = ['detected', 'investigating', 'contained', 'notifying', 'resolved'];
const VALID_BREACH_TYPES = ['unauthorized_access', 'theft', 'loss', 'improper_disposal', 'hacking', 'other'];
const PHI_TYPE_LABELS: Record<string, string> = {
  names: 'Names',
  ssn: 'Social Security Numbers',
  dob: 'Dates of Birth',
  diagnosis: 'Diagnosis/Condition Information',
  treatment: 'Treatment Information',
  insurance: 'Health Insurance Information',
  financial: 'Financial/Billing Information',
  contact: 'Contact Information (address, phone, email)',
  medical_record: 'Medical Record Numbers',
  medications: 'Medication Information',
};

/**
 * Calculate the 60-day notification deadline from discovery date per HIPAA.
 */
function calculateNotificationDeadline(discoveredAt: Date): Date {
  const deadline = new Date(discoveredAt);
  deadline.setDate(deadline.getDate() + 60);
  return deadline;
}

/**
 * Determine if media notification is required (500+ individuals in a single state).
 */
function requiresMediaNotice(affectedCount: number): boolean {
  return affectedCount >= 500;
}

export function registerBreachManagementRoutes(app: Express) {

  // GET /api/breach-management/dashboard — notification deadlines and compliance overview
  app.get('/api/breach-management/dashboard', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const user = await storage.getUser(userId);
      if (!user?.practiceId) {
        return res.status(400).json({ error: 'User has no associated practice' });
      }

      const incidents = await storage.getBreachIncidentsByPractice(user.practiceId);
      const now = new Date();

      // Calculate dashboard metrics
      const totalIncidents = incidents.length;
      const activeIncidents = incidents.filter(i => i.status !== 'resolved').length;
      const pendingNotifications = incidents.filter(
        i => i.notificationStatus !== 'complete' && i.status !== 'resolved'
      ).length;

      // Find overdue notifications (past 60-day deadline)
      const overdueNotifications = incidents.filter(i => {
        if (i.notificationStatus === 'complete' || i.status === 'resolved') return false;
        const deadline = i.notificationDeadline
          ? new Date(i.notificationDeadline)
          : calculateNotificationDeadline(new Date(i.discoveredAt));
        return now > deadline;
      });

      // Find upcoming deadlines (within 14 days)
      const upcomingDeadlines = incidents
        .filter(i => {
          if (i.notificationStatus === 'complete' || i.status === 'resolved') return false;
          const deadline = i.notificationDeadline
            ? new Date(i.notificationDeadline)
            : calculateNotificationDeadline(new Date(i.discoveredAt));
          const daysUntil = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
          return daysUntil > 0 && daysUntil <= 14;
        })
        .map(i => {
          const deadline = i.notificationDeadline
            ? new Date(i.notificationDeadline)
            : calculateNotificationDeadline(new Date(i.discoveredAt));
          const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          return { incidentId: i.id, deadline: deadline.toISOString(), daysRemaining };
        });

      // Large breaches requiring HHS immediate notification
      const largeBreaches = incidents.filter(
        i => (i.affectedIndividualsCount || 0) >= 500 && i.notificationStatus !== 'complete'
      );

      // Breaches requiring media notification
      const mediaRequired = incidents.filter(i => i.requiresMediaNotification && !i.notifiedMediaAt);

      // State AG notifications pending
      const stateAgPending = incidents.filter(
        i => i.notificationStatus !== 'complete' && !i.notifiedStateAgAt && i.status !== 'resolved'
      );

      // Annual log items (breaches < 500 individuals, not yet reported to HHS)
      const annualLogItems = incidents.filter(
        i => (i.affectedIndividualsCount || 0) < 500 && !i.notifiedHhsAt
      );

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'read',
        resourceType: 'breach_dashboard',
        userId,
        practiceId: user.practiceId,
        details: { action: 'view_breach_dashboard' },
      });

      return res.json({
        totalIncidents,
        activeIncidents,
        pendingNotifications,
        overdueCount: overdueNotifications.length,
        overdueNotifications: overdueNotifications.map(i => ({
          id: i.id,
          description: i.description,
          discoveredAt: i.discoveredAt,
          affectedCount: i.affectedIndividualsCount,
          notificationStatus: i.notificationStatus,
        })),
        upcomingDeadlines,
        largeBreachCount: largeBreaches.length,
        mediaNotificationRequired: mediaRequired.length,
        stateAgPending: stateAgPending.length,
        annualLogItems: annualLogItems.length,
        complianceStatus: overdueNotifications.length > 0 ? 'non_compliant' : pendingNotifications > 0 ? 'action_required' : 'compliant',
      });
    } catch (err) {
      console.error('Failed to load breach management dashboard:', err);
      return res.status(500).json({ error: 'Failed to load breach dashboard' });
    }
  });

  // POST /api/breach-management/incidents — create a new breach incident with full fields
  app.post('/api/breach-management/incidents', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const user = await storage.getUser(userId);
      if (!user?.practiceId) {
        return res.status(400).json({ error: 'User has no associated practice' });
      }

      const {
        discoveredAt,
        breachDate,
        description,
        breachType,
        affectedIndividualsCount,
        phiTypesInvolved,
        riskAssessment,
        remediationSteps,
        mitigationSteps,
        stateJurisdictions,
      } = req.body;

      if (!discoveredAt || !description || !breachType) {
        return res.status(400).json({ error: 'discoveredAt, description, and breachType are required' });
      }
      if (!VALID_BREACH_TYPES.includes(breachType)) {
        return res.status(400).json({ error: 'Invalid breach type' });
      }

      const discoveredDate = new Date(discoveredAt);
      const count = affectedIndividualsCount || 0;
      const needsMedia = requiresMediaNotice(count);
      const deadline = calculateNotificationDeadline(discoveredDate);

      const incident = await storage.createBreachIncident({
        practiceId: user.practiceId,
        discoveredAt: discoveredDate,
        breachDate: breachDate ? new Date(breachDate) : null,
        description,
        breachType,
        affectedIndividualsCount: count,
        phiTypesInvolved: phiTypesInvolved ? JSON.stringify(phiTypesInvolved) : null,
        riskAssessment: riskAssessment || 'low',
        remediationSteps: remediationSteps || null,
        mitigationSteps: mitigationSteps || null,
        stateJurisdictions: stateJurisdictions ? JSON.stringify(stateJurisdictions) : null,
        requiresMediaNotification: needsMedia,
        notificationDeadline: deadline,
        status: 'detected',
        notificationStatus: 'pending',
        createdBy: userId,
      });

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'create',
        resourceType: 'breach_incident',
        resourceId: String(incident.id),
        userId,
        practiceId: user.practiceId,
        details: { breachType, affectedCount: count, requiresMedia: needsMedia },
      });

      return res.status(201).json(incident);
    } catch (err) {
      console.error('Failed to create breach incident:', err);
      return res.status(500).json({ error: 'Failed to create breach incident' });
    }
  });

  // GET /api/breach-management/incidents — list all incidents for the practice
  app.get('/api/breach-management/incidents', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const user = await storage.getUser(userId);
      if (!user?.practiceId) {
        return res.status(400).json({ error: 'User has no associated practice' });
      }

      const incidents = await storage.getBreachIncidentsByPractice(user.practiceId);

      // Enrich with computed deadline info
      const now = new Date();
      const enriched = incidents.map(i => {
        const deadline = i.notificationDeadline
          ? new Date(i.notificationDeadline)
          : calculateNotificationDeadline(new Date(i.discoveredAt));
        const daysRemaining = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return {
          ...i,
          notificationDeadline: deadline.toISOString(),
          daysUntilDeadline: daysRemaining,
          isOverdue: daysRemaining < 0 && i.notificationStatus !== 'complete',
          requiresHhsImmediate: (i.affectedIndividualsCount || 0) >= 500,
        };
      });

      return res.json(enriched);
    } catch (err) {
      console.error('Failed to list breach incidents:', err);
      return res.status(500).json({ error: 'Failed to list breach incidents' });
    }
  });

  // GET /api/breach-management/incidents/:id — get single incident
  app.get('/api/breach-management/incidents/:id', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const incident = await storage.getBreachIncident(id);
      if (!incident) return res.status(404).json({ error: 'Breach incident not found' });

      return res.json(incident);
    } catch (err) {
      console.error('Failed to get breach incident:', err);
      return res.status(500).json({ error: 'Failed to get breach incident' });
    }
  });

  // PATCH /api/breach-management/incidents/:id — update incident (status transitions, fields)
  app.patch('/api/breach-management/incidents/:id', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const existing = await storage.getBreachIncident(id);
      if (!existing) return res.status(404).json({ error: 'Breach incident not found' });

      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const updateData = { ...req.body };

      // Validate status transitions
      if (updateData.status && !VALID_STATUSES.includes(updateData.status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      }

      // Serialize JSON arrays
      if (updateData.phiTypesInvolved && Array.isArray(updateData.phiTypesInvolved)) {
        updateData.phiTypesInvolved = JSON.stringify(updateData.phiTypesInvolved);
      }
      if (updateData.stateJurisdictions && Array.isArray(updateData.stateJurisdictions)) {
        updateData.stateJurisdictions = JSON.stringify(updateData.stateJurisdictions);
      }

      // Recalculate media notification requirement
      if (updateData.affectedIndividualsCount !== undefined) {
        updateData.requiresMediaNotification = requiresMediaNotice(updateData.affectedIndividualsCount);
      }

      const updated = await storage.updateBreachIncident(id, updateData);

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'update',
        resourceType: 'breach_incident',
        resourceId: String(id),
        userId,
        practiceId: updated.practiceId,
        details: { updatedFields: Object.keys(req.body) },
      });

      return res.json(updated);
    } catch (err) {
      console.error('Failed to update breach incident:', err);
      return res.status(500).json({ error: 'Failed to update breach incident' });
    }
  });

  // POST /api/breach-management/incidents/:id/notify-individuals — send patient notifications
  app.post('/api/breach-management/incidents/:id/notify-individuals', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const incident = await storage.getBreachIncident(id);
      if (!incident) return res.status(404).json({ error: 'Breach incident not found' });

      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const user = await storage.getUser(userId);
      const practice = await storage.getPractice(incident.practiceId);

      // In a full implementation, we would iterate over affected patient records.
      // For now, generate the template data so the admin can review it.
      const phiTypes = incident.phiTypesInvolved
        ? (JSON.parse(incident.phiTypesInvolved) as string[]).map(t => PHI_TYPE_LABELS[t] || t)
        : ['Protected health information'];

      const notificationTemplate = {
        practiceName: practice?.name || 'Practice',
        practicePhone: practice?.phone || '',
        practiceAddress: practice?.address || '',
        breachDate: incident.breachDate
          ? new Date(incident.breachDate).toLocaleDateString('en-US')
          : 'Under investigation',
        discoveredDate: new Date(incident.discoveredAt).toLocaleDateString('en-US'),
        breachDescription: incident.description,
        phiTypesInvolved: phiTypes,
        mitigationSteps: incident.mitigationSteps || incident.remediationSteps || 'Investigation and remediation are ongoing.',
        protectiveSteps: [
          'Monitor your health insurance statements and explanation of benefits (EOBs) for any unfamiliar activity.',
          'Review your medical records for any unfamiliar entries by requesting a copy from our office.',
          'Consider placing a fraud alert or credit freeze with the major credit bureaus if financial information was involved.',
          'Report any suspected identity theft to the Federal Trade Commission at www.identitytheft.gov.',
        ],
        contactEmail: practice?.email || user?.email || '',
      };

      const now = new Date();
      await storage.updateBreachIncident(id, {
        notifiedIndividualsAt: now,
        notificationStatus: incident.notifiedHhsAt ? 'complete' : 'individuals_notified',
        status: incident.status === 'contained' ? 'notifying' : incident.status,
      });

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'notify',
        resourceType: 'breach_incident',
        resourceId: String(id),
        userId,
        practiceId: incident.practiceId,
        details: { notifyType: 'individuals', notifiedAt: now.toISOString() },
      });

      return res.json({
        message: 'Individual notification workflow initiated',
        template: notificationTemplate,
        notifiedAt: now.toISOString(),
      });
    } catch (err) {
      console.error('Failed to send individual notifications:', err);
      return res.status(500).json({ error: 'Failed to send individual notifications' });
    }
  });

  // POST /api/breach-management/incidents/:id/notify-hhs — generate HHS report data
  app.post('/api/breach-management/incidents/:id/notify-hhs', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const incident = await storage.getBreachIncident(id);
      if (!incident) return res.status(404).json({ error: 'Breach incident not found' });

      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const user = await storage.getUser(userId);
      const practice = await storage.getPractice(incident.practiceId);

      const phiTypes = incident.phiTypesInvolved
        ? (JSON.parse(incident.phiTypesInvolved) as string[]).map(t => PHI_TYPE_LABELS[t] || t)
        : ['Protected health information'];

      const hhsReport = generateHhsReportData({
        practiceName: practice?.name || 'Practice',
        practiceAddress: practice?.address || '',
        practicePhone: practice?.phone || '',
        contactName: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Privacy Officer',
        contactEmail: practice?.email || user?.email || '',
        breachDate: incident.breachDate
          ? new Date(incident.breachDate).toLocaleDateString('en-US')
          : 'Under investigation',
        discoveredDate: new Date(incident.discoveredAt).toLocaleDateString('en-US'),
        breachDescription: incident.description,
        breachType: incident.breachType,
        affectedCount: incident.affectedIndividualsCount || 0,
        phiTypesInvolved: phiTypes,
        mitigationSteps: incident.mitigationSteps || incident.remediationSteps || '',
        locationOfBreachedInfo: req.body.locationOfBreachedInfo || 'Electronic health records',
        safeguardsInPlace: req.body.safeguardsInPlace || 'AES-256 encryption, MFA, role-based access controls, audit logging',
        individualNotificationDate: incident.notifiedIndividualsAt?.toISOString().split('T')[0] || null,
        individualNotificationMethod: 'Written notice via email and/or first-class mail',
      });

      const now = new Date();
      await storage.updateBreachIncident(id, {
        notifiedHhsAt: now,
        notificationStatus: incident.notifiedIndividualsAt ? 'complete' : 'hhs_notified',
        hhsReportData: JSON.stringify(hhsReport),
      });

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'notify',
        resourceType: 'breach_incident',
        resourceId: String(id),
        userId,
        practiceId: incident.practiceId,
        details: { notifyType: 'hhs', isLargeBreach: (incident.affectedIndividualsCount || 0) >= 500 },
      });

      return res.json({
        message: 'HHS breach report data generated',
        hhsReport,
        notifiedAt: now.toISOString(),
        portalUrl: 'https://ocrportal.hhs.gov/ocr/breach/wizard_breach.jsf',
        note: (incident.affectedIndividualsCount || 0) >= 500
          ? 'This breach affects 500+ individuals. Submit to HHS within 60 days of discovery.'
          : 'This breach affects fewer than 500 individuals. Include in annual breach log submission to HHS.',
      });
    } catch (err) {
      console.error('Failed to generate HHS report:', err);
      return res.status(500).json({ error: 'Failed to generate HHS report' });
    }
  });

  // POST /api/breach-management/incidents/:id/notify-state-ag — generate state AG letter
  app.post('/api/breach-management/incidents/:id/notify-state-ag', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const incident = await storage.getBreachIncident(id);
      if (!incident) return res.status(404).json({ error: 'Breach incident not found' });

      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const user = await storage.getUser(userId);
      const practice = await storage.getPractice(incident.practiceId);

      const phiTypes = incident.phiTypesInvolved
        ? (JSON.parse(incident.phiTypesInvolved) as string[]).map(t => PHI_TYPE_LABELS[t] || t)
        : ['Protected health information'];

      const states: string[] = incident.stateJurisdictions
        ? JSON.parse(incident.stateJurisdictions)
        : [req.body.stateName || 'the applicable state'];

      const letters = states.map(stateName => {
        return generateStateAgNotificationLetter({
          practiceName: practice?.name || 'Practice',
          practiceAddress: practice?.address || '',
          practicePhone: practice?.phone || '',
          contactName: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Privacy Officer',
          contactEmail: practice?.email || user?.email || '',
          stateName,
          breachDate: incident.breachDate
            ? new Date(incident.breachDate).toLocaleDateString('en-US')
            : 'Under investigation',
          discoveredDate: new Date(incident.discoveredAt).toLocaleDateString('en-US'),
          breachDescription: incident.description,
          breachType: incident.breachType,
          affectedCount: incident.affectedIndividualsCount || 0,
          phiTypesInvolved: phiTypes,
          mitigationSteps: incident.mitigationSteps || 'Investigation and remediation are ongoing.',
          remediationSteps: incident.remediationSteps || '',
        });
      });

      const now = new Date();
      await storage.updateBreachIncident(id, {
        notifiedStateAgAt: now,
      });

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'notify',
        resourceType: 'breach_incident',
        resourceId: String(id),
        userId,
        practiceId: incident.practiceId,
        details: { notifyType: 'state_ag', states },
      });

      return res.json({
        message: 'State Attorney General notification letters generated',
        letters,
        states,
        notifiedAt: now.toISOString(),
      });
    } catch (err) {
      console.error('Failed to generate state AG notification:', err);
      return res.status(500).json({ error: 'Failed to generate state AG notification' });
    }
  });

  // POST /api/breach-management/incidents/:id/notify-media — flag media notification
  app.post('/api/breach-management/incidents/:id/notify-media', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const incident = await storage.getBreachIncident(id);
      if (!incident) return res.status(404).json({ error: 'Breach incident not found' });

      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const now = new Date();

      await storage.updateBreachIncident(id, { notifiedMediaAt: now });

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'notify',
        resourceType: 'breach_incident',
        resourceId: String(id),
        userId,
        practiceId: incident.practiceId,
        details: { notifyType: 'media', notifiedAt: now.toISOString() },
      });

      return res.json({
        message: 'Media notification recorded',
        notifiedAt: now.toISOString(),
        note: 'Per 45 CFR 164.406, prominent media outlets in the state/jurisdiction must be notified when 500+ individuals in a state are affected.',
      });
    } catch (err) {
      console.error('Failed to record media notification:', err);
      return res.status(500).json({ error: 'Failed to record media notification' });
    }
  });

  // GET /api/breach-management/phi-types — list available PHI types for the form
  app.get('/api/breach-management/phi-types', isAuthenticated, isAdmin, (_req: Request, res: Response) => {
    return res.json(
      Object.entries(PHI_TYPE_LABELS).map(([value, label]) => ({ value, label }))
    );
  });
}
