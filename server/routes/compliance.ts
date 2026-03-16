import type { Express, Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import { logAuditEvent } from '../middleware/auditMiddleware';
import { isAuthenticated } from '../replitAuth';

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

// Check types for HIPAA compliance self-assessment
const COMPLIANCE_CHECK_TYPES = [
  'mfa_enforcement',
  'encryption_enabled',
  'baa_signed',
  'audit_logging',
  'data_retention',
  'access_controls',
  'breach_notification_plan',
  'risk_assessment',
  'training_completed',
  'backup_verified',
] as const;

const CHECK_LABELS: Record<string, string> = {
  mfa_enforcement: 'Multi-Factor Authentication',
  encryption_enabled: 'PHI Encryption',
  baa_signed: 'Business Associate Agreements',
  audit_logging: 'Audit Logging',
  data_retention: 'Data Retention Policy',
  access_controls: 'Role-Based Access Controls',
  breach_notification_plan: 'Breach Notification Plan',
  risk_assessment: 'Risk Assessment',
  training_completed: 'Staff Training',
  backup_verified: 'Data Backup Verification',
};

// Expected security headers and their acceptable values for self-test
const EXPECTED_SECURITY_HEADERS: Array<{
  header: string;
  expected: string | RegExp | null; // null = just check presence
  description: string;
  required: boolean;
}> = [
  { header: 'x-frame-options', expected: 'DENY', description: 'Clickjacking protection', required: true },
  { header: 'x-content-type-options', expected: 'nosniff', description: 'MIME sniffing prevention', required: true },
  { header: 'x-xss-protection', expected: '0', description: 'Legacy XSS filter disabled (CSP preferred)', required: true },
  { header: 'referrer-policy', expected: 'strict-origin-when-cross-origin', description: 'Referrer policy for PHI protection', required: true },
  { header: 'permissions-policy', expected: null, description: 'Browser feature permissions', required: true },
  { header: 'cross-origin-opener-policy', expected: 'same-origin', description: 'Cross-origin isolation', required: true },
  { header: 'cross-origin-resource-policy', expected: 'same-origin', description: 'Cross-origin resource protection', required: true },
  { header: 'content-security-policy', expected: null, description: 'Content Security Policy (enforced)', required: true },
  { header: 'strict-transport-security', expected: /max-age=\d+/, description: 'HSTS (production only)', required: false },
  { header: 'x-request-id', expected: null, description: 'Request tracing ID', required: true },
];

export function registerComplianceRoutes(app: Express) {
  // GET /api/compliance/security-headers — self-test security headers and report findings
  app.get('/api/compliance/security-headers', isAuthenticated, isAdmin, (req: Request, res: Response) => {
    // Read the headers that were set on THIS response (by earlier middleware)
    const results: Array<{
      header: string;
      description: string;
      status: 'pass' | 'fail' | 'warning';
      currentValue: string | null;
      expectedValue: string | null;
    }> = [];

    for (const check of EXPECTED_SECURITY_HEADERS) {
      const currentValue = res.getHeader(check.header) as string | undefined;
      let status: 'pass' | 'fail' | 'warning' = 'fail';

      if (currentValue) {
        if (check.expected === null) {
          // Just checking presence
          status = 'pass';
        } else if (check.expected instanceof RegExp) {
          status = check.expected.test(currentValue) ? 'pass' : 'warning';
        } else {
          status = currentValue === check.expected ? 'pass' : 'warning';
        }
      } else {
        // Missing header
        status = check.required ? 'fail' : 'warning';
      }

      results.push({
        header: check.header,
        description: check.description,
        status,
        currentValue: currentValue || null,
        expectedValue: check.expected instanceof RegExp ? check.expected.source : check.expected,
      });
    }

    // Also check CSP-Report-Only (dev mode uses this instead of enforced CSP)
    const cspReportOnly = res.getHeader('content-security-policy-report-only') as string | undefined;
    if (cspReportOnly) {
      // In dev mode, report-only is used instead of enforced; mark CSP as warning
      const cspResult = results.find(r => r.header === 'content-security-policy');
      if (cspResult && cspResult.status === 'fail') {
        cspResult.status = 'warning';
        cspResult.currentValue = `[report-only] ${cspReportOnly}`;
      }
    }

    const passCount = results.filter(r => r.status === 'pass').length;
    const warnCount = results.filter(r => r.status === 'warning').length;
    const failCount = results.filter(r => r.status === 'fail').length;
    const score = Math.round(((passCount + warnCount * 0.5) / results.length) * 100);

    return res.json({
      score,
      total: results.length,
      pass: passCount,
      warning: warnCount,
      fail: failCount,
      environment: process.env.NODE_ENV || 'development',
      headers: results,
    });
  });

  // GET /api/compliance/dashboard — run automated checks and return posture
  app.get('/api/compliance/dashboard', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const user = await storage.getUser(userId);
      if (!user?.practiceId) {
        return res.status(400).json({ error: 'User has no associated practice' });
      }
      const practiceId = user.practiceId;

      const checkResults: Array<{
        checkType: string;
        label: string;
        status: string;
        details: any;
        lastCheckedAt: string;
      }> = [];

      // 1. MFA Enforcement — check if all practice users have MFA enabled
      const allUsers = await storage.getAllUsers();
      const practiceUsers = allUsers.filter((u: any) => u.practiceId === practiceId);
      const mfaEnabledUsers = practiceUsers.filter((u: any) => u.mfaEnabled);
      const mfaRatio = practiceUsers.length > 0 ? mfaEnabledUsers.length / practiceUsers.length : 0;
      const mfaStatus = mfaRatio === 1 ? 'pass' : mfaRatio >= 0.5 ? 'warning' : 'fail';
      const mfaCheck = await storage.upsertComplianceCheck({
        practiceId,
        checkType: 'mfa_enforcement',
        status: mfaStatus,
        lastCheckedAt: new Date(),
        details: {
          totalUsers: practiceUsers.length,
          mfaEnabled: mfaEnabledUsers.length,
          ratio: Math.round(mfaRatio * 100),
        },
      });
      checkResults.push({
        checkType: 'mfa_enforcement',
        label: CHECK_LABELS.mfa_enforcement,
        status: mfaStatus,
        details: mfaCheck.details,
        lastCheckedAt: mfaCheck.lastCheckedAt?.toISOString() || new Date().toISOString(),
      });

      // 2. Encryption — check if PHI_ENCRYPTION_KEY env var is set
      const encryptionEnabled = !!process.env.PHI_ENCRYPTION_KEY;
      const encStatus = encryptionEnabled ? 'pass' : 'fail';
      const encCheck = await storage.upsertComplianceCheck({
        practiceId,
        checkType: 'encryption_enabled',
        status: encStatus,
        lastCheckedAt: new Date(),
        details: { encryptionKeyConfigured: encryptionEnabled },
      });
      checkResults.push({
        checkType: 'encryption_enabled',
        label: CHECK_LABELS.encryption_enabled,
        status: encStatus,
        details: encCheck.details,
        lastCheckedAt: encCheck.lastCheckedAt?.toISOString() || new Date().toISOString(),
      });

      // 3. Audit Logging — check if there are recent audit log entries (last 24h)
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      const recentLogs = await storage.getAuditLogsPaginated({
        practiceId,
        startDate: oneDayAgo,
        page: 1,
        limit: 1,
      });
      const auditStatus = recentLogs.total > 0 ? 'pass' : 'warning';
      const auditCheck = await storage.upsertComplianceCheck({
        practiceId,
        checkType: 'audit_logging',
        status: auditStatus,
        lastCheckedAt: new Date(),
        details: { recentEntries: recentLogs.total, lastCheckedPeriod: '24h' },
      });
      checkResults.push({
        checkType: 'audit_logging',
        label: CHECK_LABELS.audit_logging,
        status: auditStatus,
        details: auditCheck.details,
        lastCheckedAt: auditCheck.lastCheckedAt?.toISOString() || new Date().toISOString(),
      });

      // 4. BAA Tracking — check if vendors have signed active BAAs
      const baaRecords = await storage.getBaaRecords(practiceId);
      const activeBaas = baaRecords.filter((b: any) => b.status === 'active');
      const expiredBaas = baaRecords.filter((b: any) => b.status === 'expired');
      const baaStatus = baaRecords.length === 0 ? 'warning' : expiredBaas.length > 0 ? 'warning' : 'pass';
      const baaCheck = await storage.upsertComplianceCheck({
        practiceId,
        checkType: 'baa_signed',
        status: baaStatus,
        lastCheckedAt: new Date(),
        details: { total: baaRecords.length, active: activeBaas.length, expired: expiredBaas.length },
      });
      checkResults.push({
        checkType: 'baa_signed',
        label: CHECK_LABELS.baa_signed,
        status: baaStatus,
        details: baaCheck.details,
        lastCheckedAt: baaCheck.lastCheckedAt?.toISOString() || new Date().toISOString(),
      });

      // 5. Access Controls — check if role-based access is active (multiple roles present)
      const roleSet = new Set(practiceUsers.map((u: any) => u.role).filter(Boolean));
      const roles = Array.from(roleSet);
      const accessStatus = roles.length >= 2 ? 'pass' : roles.length === 1 ? 'warning' : 'fail';
      const accessCheck = await storage.upsertComplianceCheck({
        practiceId,
        checkType: 'access_controls',
        status: accessStatus,
        lastCheckedAt: new Date(),
        details: { rolesInUse: roles, userCount: practiceUsers.length },
      });
      checkResults.push({
        checkType: 'access_controls',
        label: CHECK_LABELS.access_controls,
        status: accessStatus,
        details: accessCheck.details,
        lastCheckedAt: accessCheck.lastCheckedAt?.toISOString() || new Date().toISOString(),
      });

      // 6. Data Retention — check if retention policy is configured (practice has retention settings)
      const practice = await storage.getPractice(practiceId);
      // For now, this is a manual check — default to not_checked unless previously set
      const existingRetentionCheck = (await storage.getComplianceChecks(practiceId))
        .find((c: any) => c.checkType === 'data_retention');
      const retentionStatus = existingRetentionCheck?.status === 'pass' ? 'pass'
        : existingRetentionCheck?.status === 'warning' ? 'warning' : 'not_checked';
      const retentionCheck = await storage.upsertComplianceCheck({
        practiceId,
        checkType: 'data_retention',
        status: retentionStatus,
        lastCheckedAt: new Date(),
        details: existingRetentionCheck?.details || { note: 'Manual verification required' },
        notes: existingRetentionCheck?.notes || null,
      });
      checkResults.push({
        checkType: 'data_retention',
        label: CHECK_LABELS.data_retention,
        status: retentionStatus,
        details: retentionCheck.details,
        lastCheckedAt: retentionCheck.lastCheckedAt?.toISOString() || new Date().toISOString(),
      });

      // 7. Breach Notification Plan — check if any breach incidents exist (indicating plan awareness)
      const breachIncidents = await storage.getBreachIncidentsByPractice(practiceId);
      const existingBreachPlanCheck = (await storage.getComplianceChecks(practiceId))
        .find((c: any) => c.checkType === 'breach_notification_plan');
      const breachPlanStatus = existingBreachPlanCheck?.status === 'pass' ? 'pass' : 'not_checked';
      const breachPlanCheck = await storage.upsertComplianceCheck({
        practiceId,
        checkType: 'breach_notification_plan',
        status: breachPlanStatus,
        lastCheckedAt: new Date(),
        details: existingBreachPlanCheck?.details || {
          note: 'Manual verification required — confirm breach notification plan is documented',
          incidentsRecorded: breachIncidents.length,
        },
        notes: existingBreachPlanCheck?.notes || null,
      });
      checkResults.push({
        checkType: 'breach_notification_plan',
        label: CHECK_LABELS.breach_notification_plan,
        status: breachPlanStatus,
        details: breachPlanCheck.details,
        lastCheckedAt: breachPlanCheck.lastCheckedAt?.toISOString() || new Date().toISOString(),
      });

      // 8-10. Manual checks: risk_assessment, training_completed, backup_verified
      for (const manualType of ['risk_assessment', 'training_completed', 'backup_verified'] as const) {
        const existingCheck = (await storage.getComplianceChecks(practiceId))
          .find((c: any) => c.checkType === manualType);
        const manualStatus = existingCheck?.status || 'not_checked';
        const manualCheck = await storage.upsertComplianceCheck({
          practiceId,
          checkType: manualType,
          status: manualStatus,
          lastCheckedAt: new Date(),
          details: existingCheck?.details || { note: 'Manual verification required' },
          notes: existingCheck?.notes || null,
        });
        checkResults.push({
          checkType: manualType,
          label: CHECK_LABELS[manualType],
          status: manualStatus,
          details: manualCheck.details,
          lastCheckedAt: manualCheck.lastCheckedAt?.toISOString() || new Date().toISOString(),
        });
      }

      // Calculate overall score
      const passCount = checkResults.filter(c => c.status === 'pass').length;
      const warningCount = checkResults.filter(c => c.status === 'warning').length;
      const totalChecks = checkResults.length;
      // Pass = 1 point, warning = 0.5 points, fail/not_checked = 0
      const score = Math.round(((passCount + warningCount * 0.5) / totalChecks) * 100);

      await logAuditEvent({
        eventCategory: 'admin',
        eventType: 'read',
        resourceType: 'compliance_dashboard',
        userId,
        practiceId,
        details: { score, passCount, warningCount },
      });

      return res.json({
        score,
        totalChecks,
        passCount,
        warningCount,
        failCount: checkResults.filter(c => c.status === 'fail').length,
        notCheckedCount: checkResults.filter(c => c.status === 'not_checked').length,
        checks: checkResults,
        lastAssessedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to run compliance dashboard:', err);
      return res.status(500).json({ error: 'Failed to run compliance assessment' });
    }
  });

  // PUT /api/compliance/checks/:checkType — manually update a compliance check status
  app.put('/api/compliance/checks/:checkType', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const user = await storage.getUser(userId);
      if (!user?.practiceId) {
        return res.status(400).json({ error: 'User has no associated practice' });
      }
      const { checkType } = req.params;
      const { status, notes } = req.body;

      if (!COMPLIANCE_CHECK_TYPES.includes(checkType as any)) {
        return res.status(400).json({ error: 'Invalid check type' });
      }
      if (!['pass', 'fail', 'warning', 'not_checked'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const check = await storage.upsertComplianceCheck({
        practiceId: user.practiceId,
        checkType,
        status,
        lastCheckedAt: new Date(),
        details: { manuallyUpdatedBy: userId, updatedAt: new Date().toISOString() },
        notes: notes || null,
      });

      await logAuditEvent({
        eventCategory: 'admin',
        eventType: 'update',
        resourceType: 'compliance_check',
        resourceId: checkType,
        userId,
        practiceId: user.practiceId,
        details: { status, checkType },
      });

      return res.json(check);
    } catch (err) {
      console.error('Failed to update compliance check:', err);
      return res.status(500).json({ error: 'Failed to update compliance check' });
    }
  });

  // GET /api/compliance/audit-log — paginated audit log viewer
  app.get('/api/compliance/audit-log', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const user = await storage.getUser(userId);
      if (!user?.practiceId) {
        return res.status(400).json({ error: 'User has no associated practice' });
      }

      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
      const filterUserId = req.query.userId as string | undefined;
      const eventCategory = req.query.eventCategory as string | undefined;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

      const result = await storage.getAuditLogsPaginated({
        practiceId: user.practiceId,
        userId: filterUserId,
        eventCategory,
        startDate,
        endDate,
        page,
        limit,
      });

      return res.json({
        logs: result.logs,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
      });
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
      return res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  });

  // POST /api/compliance/breach-incidents — report a breach incident
  app.post('/api/compliance/breach-incidents', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const user = await storage.getUser(userId);
      if (!user?.practiceId) {
        return res.status(400).json({ error: 'User has no associated practice' });
      }

      const incident = await storage.createBreachIncident({
        ...req.body,
        practiceId: user.practiceId,
        createdBy: userId,
        discoveredAt: new Date(req.body.discoveredAt),
      });

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'create',
        resourceType: 'breach_incident',
        resourceId: String(incident.id),
        userId,
        practiceId: user.practiceId,
        details: { breachType: incident.breachType, affectedCount: incident.affectedIndividualsCount },
      });

      return res.status(201).json(incident);
    } catch (err) {
      console.error('Failed to create breach incident:', err);
      return res.status(500).json({ error: 'Failed to create breach incident' });
    }
  });

  // GET /api/compliance/breach-incidents — list incidents for practice
  app.get('/api/compliance/breach-incidents', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const user = await storage.getUser(userId);
      if (!user?.practiceId) {
        return res.status(400).json({ error: 'User has no associated practice' });
      }

      const incidents = await storage.getBreachIncidentsByPractice(user.practiceId);

      await logAuditEvent({
        eventCategory: 'breach',
        eventType: 'read',
        resourceType: 'breach_incident',
        userId,
        practiceId: user.practiceId,
        details: { action: 'list_compliance_breach_incidents' },
      });

      return res.json(incidents);
    } catch (err) {
      console.error('Failed to list breach incidents:', err);
      return res.status(500).json({ error: 'Failed to list breach incidents' });
    }
  });

  // PUT /api/compliance/breach-incidents/:id — update incident
  app.put('/api/compliance/breach-incidents/:id', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const existing = await storage.getBreachIncident(id);
      if (!existing) return res.status(404).json({ error: 'Breach incident not found' });

      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const updated = await storage.updateBreachIncident(id, req.body);

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

  // POST /api/compliance/breach-incidents/:id/notify — trigger notification workflow
  app.post('/api/compliance/breach-incidents/:id/notify', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

      const incident = await storage.getBreachIncident(id);
      if (!incident) return res.status(404).json({ error: 'Breach incident not found' });

      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const now = new Date();
      const { notifyType } = req.body; // individuals, hhs, state_ag

      const updateData: any = {};
      if (notifyType === 'individuals' || !notifyType) {
        updateData.notifiedIndividualsAt = now;
        updateData.notificationStatus = 'individuals_notified';
      }
      if (notifyType === 'hhs') {
        updateData.notifiedHhsAt = now;
        updateData.notificationStatus = 'hhs_notified';
      }

      // Check if all notifications have been sent
      const current = await storage.getBreachIncident(id);
      if (current?.notifiedIndividualsAt && current?.notifiedHhsAt) {
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

      return res.json({
        message: `Notification workflow triggered for ${notifyType || 'individuals'}`,
        incident: result,
      });
    } catch (err) {
      console.error('Failed to trigger breach notification:', err);
      return res.status(500).json({ error: 'Failed to trigger notification' });
    }
  });

  // GET /api/compliance/hipaa-assessment — categorized HIPAA self-assessment with next steps
  app.get('/api/compliance/hipaa-assessment', isAuthenticated, isAdmin, async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.claims?.sub || (req as any).user?.id;
      const user = await storage.getUser(userId);
      if (!user?.practiceId) {
        return res.status(400).json({ error: 'User has no associated practice' });
      }
      const practiceId = user.practiceId;

      // Gather data
      const allUsers = await storage.getAllUsers();
      const practiceUsers = allUsers.filter((u: any) => u.practiceId === practiceId);
      const baaRecordsList = await storage.getBaaRecords(practiceId);
      const breachIncidentsList = await storage.getBreachIncidentsByPractice(practiceId);
      const existingChecks = await storage.getComplianceChecks(practiceId);

      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      const recentLogs = await storage.getAuditLogsPaginated({
        practiceId,
        startDate: oneDayAgo,
        page: 1,
        limit: 1,
      });

      const encryptionEnabled = !!process.env.PHI_ENCRYPTION_KEY;
      const sessionTimeoutConfigured = process.env.NODE_ENV === 'production' || !!process.env.SESSION_SECRET;

      // MFA stats
      const mfaEnabledUsers = practiceUsers.filter((u: any) => u.mfaEnabled);
      const mfaRatio = practiceUsers.length > 0 ? mfaEnabledUsers.length / practiceUsers.length : 0;

      // Roles
      const roleSet = new Set(practiceUsers.map((u: any) => u.role).filter(Boolean));
      const roles = Array.from(roleSet);

      // BAA stats
      const activeBaas = baaRecordsList.filter((b: any) => b.status === 'active');
      const expiredBaas = baaRecordsList.filter((b: any) => b.status === 'expired');

      // Breach stats
      const openBreaches = breachIncidentsList.filter((b: any) => b.status === 'open' || b.status === 'under_review');
      const unresolvedNotifications = breachIncidentsList.filter(
        (b: any) => b.notificationStatus !== 'complete' && b.status !== 'closed'
      );

      // Helper to get existing manual check status
      const getManualStatus = (checkType: string) => {
        const existing = existingChecks.find((c: any) => c.checkType === checkType);
        return existing?.status || 'not_checked';
      };
      const getManualDetails = (checkType: string) => {
        const existing = existingChecks.find((c: any) => c.checkType === checkType);
        return existing?.details || null;
      };

      const toSafeguardStatus = (status: string): 'compliant' | 'non_compliant' | 'partially_compliant' | 'not_assessed' => {
        if (status === 'pass') return 'compliant';
        if (status === 'warning') return 'partially_compliant';
        if (status === 'fail') return 'non_compliant';
        return 'not_assessed';
      };

      // === ADMINISTRATIVE SAFEGUARDS ===
      const adminSafeguards: any[] = [
        {
          id: 'workforce_training',
          name: 'Workforce Training',
          description: 'Track employee HIPAA awareness and security training completion',
          status: toSafeguardStatus(getManualStatus('training_completed')),
          details: getManualDetails('training_completed') || { note: 'Manual verification required' },
          nextSteps: getManualStatus('training_completed') === 'pass'
            ? ['Schedule annual refresher training']
            : ['Conduct HIPAA awareness training for all staff', 'Document training dates and attendance', 'Mark as compliant once all staff are trained'],
          regulation: '45 CFR 164.308(a)(5)',
        },
        {
          id: 'security_officer',
          name: 'Security Officer Designation',
          description: 'A designated security officer responsible for HIPAA security policies',
          status: toSafeguardStatus(getManualStatus('risk_assessment')),
          details: getManualDetails('risk_assessment') || { note: 'Manual verification required' },
          nextSteps: getManualStatus('risk_assessment') === 'pass'
            ? ['Review security officer responsibilities annually']
            : ['Designate a HIPAA Security Officer', 'Document the designation and responsibilities', 'Complete an initial risk assessment'],
          regulation: '45 CFR 164.308(a)(2)',
        },
        {
          id: 'contingency_plan',
          name: 'Contingency Plan',
          description: 'Data backup plan, disaster recovery plan, and emergency mode operations',
          status: toSafeguardStatus(getManualStatus('backup_verified')),
          details: getManualDetails('backup_verified') || { note: 'Manual verification required' },
          nextSteps: getManualStatus('backup_verified') === 'pass'
            ? ['Test backup restoration quarterly']
            : ['Document data backup procedures', 'Create a disaster recovery plan', 'Test backup restoration and verify data integrity'],
          regulation: '45 CFR 164.308(a)(7)',
        },
        {
          id: 'baa_status',
          name: 'Business Associate Agreements',
          description: 'BAAs signed with all vendors that handle PHI',
          status: baaRecordsList.length === 0 ? 'not_assessed' : expiredBaas.length > 0 ? 'partially_compliant' : 'compliant',
          details: { total: baaRecordsList.length, active: activeBaas.length, expired: expiredBaas.length },
          nextSteps: baaRecordsList.length === 0
            ? ['Identify all vendors that handle PHI', 'Execute BAAs with each vendor', 'Record BAAs in the system']
            : expiredBaas.length > 0
              ? [`Renew ${expiredBaas.length} expired BAA(s)`, 'Review all vendor agreements annually']
              : ['Review vendor agreements at next renewal date'],
          regulation: '45 CFR 164.308(b)(1)',
        },
      ];

      // === PHYSICAL SAFEGUARDS ===
      const physicalSafeguards: any[] = [
        {
          id: 'workstation_security',
          name: 'Workstation Security',
          description: 'Staff acknowledgment of workstation use policies and physical access controls',
          status: toSafeguardStatus(getManualStatus('data_retention')),
          details: getManualDetails('data_retention') || { note: 'Manual verification required — workstation policy acknowledgment' },
          nextSteps: getManualStatus('data_retention') === 'pass'
            ? ['Ensure new employees sign workstation policy']
            : ['Create a workstation use policy', 'Have all staff sign acknowledgment', 'Implement automatic screen locks on all workstations'],
          regulation: '45 CFR 164.310(b)',
        },
      ];

      // === TECHNICAL SAFEGUARDS ===
      const technicalSafeguards: any[] = [
        {
          id: 'mfa_adoption',
          name: 'Multi-Factor Authentication',
          description: `MFA adoption rate across practice users`,
          status: mfaRatio === 1 ? 'compliant' : mfaRatio >= 0.5 ? 'partially_compliant' : 'non_compliant',
          details: {
            totalUsers: practiceUsers.length,
            mfaEnabled: mfaEnabledUsers.length,
            adoptionRate: Math.round(mfaRatio * 100),
          },
          nextSteps: mfaRatio === 1
            ? ['MFA fully adopted — continue to require for new users']
            : [
                `Enable MFA for remaining ${practiceUsers.length - mfaEnabledUsers.length} user(s)`,
                'Consider enforcing mandatory MFA policy',
                'Provide MFA setup instructions to non-compliant users',
              ],
          regulation: '45 CFR 164.312(d)',
        },
        {
          id: 'phi_encryption',
          name: 'PHI Encryption at Rest',
          description: 'AES-256-GCM encryption for protected health information',
          status: encryptionEnabled ? 'compliant' : 'non_compliant',
          details: { encryptionKeyConfigured: encryptionEnabled },
          nextSteps: encryptionEnabled
            ? ['Rotate encryption keys per organizational policy']
            : ['Configure PHI_ENCRYPTION_KEY environment variable', 'Ensure key is 64-character hex (32 bytes)'],
          regulation: '45 CFR 164.312(a)(2)(iv)',
        },
        {
          id: 'audit_logging',
          name: 'Audit Log Controls',
          description: 'Record and examine activity in systems containing PHI',
          status: recentLogs.total > 0 ? 'compliant' : 'partially_compliant',
          details: { recentEntries: recentLogs.total, period: '24h' },
          nextSteps: recentLogs.total > 0
            ? ['Review audit logs regularly for anomalies', 'Archive logs per retention policy']
            : ['Verify audit middleware is active', 'Check for system activity in the last 24 hours'],
          regulation: '45 CFR 164.312(b)',
        },
        {
          id: 'access_controls',
          name: 'Role-Based Access Controls',
          description: 'Unique user identification and role-based access to PHI',
          status: roles.length >= 2 ? 'compliant' : roles.length === 1 ? 'partially_compliant' : 'non_compliant',
          details: { rolesInUse: roles, userCount: practiceUsers.length },
          nextSteps: roles.length >= 2
            ? ['Review user role assignments quarterly']
            : ['Assign appropriate roles (admin, therapist, billing) to users', 'Ensure least-privilege access for each role'],
          regulation: '45 CFR 164.312(a)(1)',
        },
        {
          id: 'session_timeout',
          name: 'Session Timeout Configuration',
          description: 'Automatic logoff after inactivity to prevent unauthorized access',
          status: sessionTimeoutConfigured ? 'compliant' : 'partially_compliant',
          details: {
            sessionSecretConfigured: !!process.env.SESSION_SECRET,
            environment: process.env.NODE_ENV || 'development',
            idleTimeout: '30 minutes (production)',
          },
          nextSteps: sessionTimeoutConfigured
            ? ['Ensure idle timeout warning is enabled for all users']
            : ['Configure SESSION_SECRET for secure sessions', 'Verify 30-minute idle timeout in production'],
          regulation: '45 CFR 164.312(a)(2)(iii)',
        },
      ];

      // === BREACH MANAGEMENT ===
      const breachManagement: any[] = [
        {
          id: 'breach_log',
          name: 'Breach Incident Log',
          description: 'Documented process for identifying, reporting, and responding to breaches',
          status: toSafeguardStatus(getManualStatus('breach_notification_plan')),
          details: {
            totalIncidents: breachIncidentsList.length,
            openIncidents: openBreaches.length,
            ...(getManualDetails('breach_notification_plan') || {}),
          },
          nextSteps: getManualStatus('breach_notification_plan') === 'pass'
            ? ['Maintain breach log and review procedures annually']
            : ['Document breach identification and response procedures', 'Train staff on breach reporting workflow', 'Mark as compliant once procedures are documented'],
          regulation: '45 CFR 164.408',
        },
        {
          id: 'breach_notifications',
          name: 'Breach Notification Tracking',
          description: 'Track required notifications to individuals, HHS, and media',
          status: unresolvedNotifications.length > 0
            ? 'non_compliant'
            : breachIncidentsList.length > 0
              ? 'compliant'
              : 'not_assessed',
          details: {
            totalIncidents: breachIncidentsList.length,
            pendingNotifications: unresolvedNotifications.length,
            openBreaches: openBreaches.length,
          },
          nextSteps: unresolvedNotifications.length > 0
            ? [
                `Complete notifications for ${unresolvedNotifications.length} pending incident(s)`,
                'Notify affected individuals without unreasonable delay',
                'Notify HHS within 60 days of discovery (for breaches affecting 500+ individuals)',
              ]
            : breachIncidentsList.length === 0
              ? ['No breach incidents recorded — continue monitoring']
              : ['All breach notifications are up to date'],
          regulation: '45 CFR 164.404-408',
        },
      ];

      // Calculate overall score
      const allItems = [...adminSafeguards, ...physicalSafeguards, ...technicalSafeguards, ...breachManagement];
      const scoreMap: Record<string, number> = {
        compliant: 1,
        partially_compliant: 0.5,
        non_compliant: 0,
        not_assessed: 0,
      };
      const totalPoints = allItems.reduce((sum, item) => sum + scoreMap[item.status], 0);
      const overallScore = Math.round((totalPoints / allItems.length) * 100);

      const categoryCounts = {
        compliant: allItems.filter(i => i.status === 'compliant').length,
        partiallyCompliant: allItems.filter(i => i.status === 'partially_compliant').length,
        nonCompliant: allItems.filter(i => i.status === 'non_compliant').length,
        notAssessed: allItems.filter(i => i.status === 'not_assessed').length,
      };

      await logAuditEvent({
        eventCategory: 'admin',
        eventType: 'read',
        resourceType: 'hipaa_assessment',
        userId,
        practiceId,
        details: { overallScore, ...categoryCounts },
      });

      return res.json({
        overallScore,
        totalItems: allItems.length,
        ...categoryCounts,
        lastAssessedAt: new Date().toISOString(),
        categories: {
          administrativeSafeguards: {
            label: 'Administrative Safeguards',
            description: 'Policies, procedures, and workforce management',
            items: adminSafeguards,
          },
          physicalSafeguards: {
            label: 'Physical Safeguards',
            description: 'Workstation and facility access controls',
            items: physicalSafeguards,
          },
          technicalSafeguards: {
            label: 'Technical Safeguards',
            description: 'Technology-based access controls, encryption, and audit',
            items: technicalSafeguards,
          },
          breachManagement: {
            label: 'Breach Management',
            description: 'Breach detection, reporting, and notification',
            items: breachManagement,
          },
        },
      });
    } catch (err) {
      console.error('Failed to run HIPAA assessment:', err);
      return res.status(500).json({ error: 'Failed to run HIPAA assessment' });
    }
  });
}
