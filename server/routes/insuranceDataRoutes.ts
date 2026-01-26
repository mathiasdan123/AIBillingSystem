import { Router, type Response } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { payerIntegrationService, type DataType } from '../payer-integrations/payerIntegrationService';

const router = Router();

// GET /api/patients/:id/insurance-data - Get all cached insurance data for a patient
router.get('/patients/:id/insurance-data', isAuthenticated, async (req: any, res: Response) => {
  try {
    const patientId = parseInt(req.params.id);
    const { types } = req.query; // Optional: comma-separated list of data types

    if (isNaN(patientId)) {
      return res.status(400).json({ message: 'Invalid patient ID' });
    }

    // Get patient
    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Check for active authorization
    const authorizations = await storage.getPatientAuthorizations(patientId);
    const activeAuth = authorizations.find((auth) => auth.status === 'authorized');

    if (!activeAuth) {
      return res.status(403).json({
        message: 'No active insurance authorization for this patient',
        requiresAuthorization: true,
      });
    }

    // Parse requested data types
    const dataTypes: DataType[] = types
      ? (types as string).split(',').filter((t): t is DataType =>
          ['eligibility', 'benefits', 'claims_history', 'prior_auth'].includes(t)
        )
      : ['eligibility', 'benefits', 'claims_history', 'prior_auth'];

    // Filter to only authorized scopes
    const authorizedScopes = activeAuth.scopes as string[];
    const filteredTypes = dataTypes.filter((t) => authorizedScopes.includes(t));

    // Get cached data
    const cachedData = await payerIntegrationService.getCachedDataForPatient(patientId, filteredTypes);

    // Build response
    const response: Record<string, any> = {
      patientId,
      authorization: {
        id: activeAuth.id,
        status: activeAuth.status,
        scopes: activeAuth.scopes,
        expiresAt: activeAuth.expiresAt,
        authorizedAt: activeAuth.consentGivenAt,
      },
      data: {},
    };

    for (const [type, data] of cachedData) {
      response.data[type] = data;
    }

    // Log the data access
    await storage.createAuditLogEntry({
      practiceId: patient.practiceId,
      patientId,
      authorizationId: activeAuth.id,
      actorType: 'user',
      actorId: req.user?.claims?.sub,
      eventType: 'data_accessed',
      dataType: filteredTypes.join(','),
      dataScope: { requestedTypes: filteredTypes, returnedTypes: Array.from(cachedData.keys()) },
      success: true,
    });

    res.json(response);
  } catch (error) {
    console.error('Error fetching insurance data:', error);
    res.status(500).json({ message: 'Failed to fetch insurance data' });
  }
});

// POST /api/patients/:id/insurance-data/refresh - Force refresh insurance data
router.post('/patients/:id/insurance-data/refresh', isAuthenticated, async (req: any, res: Response) => {
  try {
    const patientId = parseInt(req.params.id);
    const { types } = req.body; // Optional: array of data types to refresh

    if (isNaN(patientId)) {
      return res.status(400).json({ message: 'Invalid patient ID' });
    }

    // Get patient
    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Check for active authorization
    const authorizations = await storage.getPatientAuthorizations(patientId);
    const activeAuth = authorizations.find((auth) => auth.status === 'authorized');

    if (!activeAuth) {
      return res.status(403).json({
        message: 'No active insurance authorization for this patient',
        requiresAuthorization: true,
      });
    }

    // Determine which data types to refresh
    const authorizedScopes = activeAuth.scopes as string[];
    const requestedTypes: DataType[] = types || authorizedScopes;
    const filteredTypes = requestedTypes.filter((t): t is DataType =>
      authorizedScopes.includes(t) &&
      ['eligibility', 'benefits', 'claims_history', 'prior_auth'].includes(t)
    );

    // Fetch fresh data
    const results: Record<string, any> = {};

    for (const dataType of filteredTypes) {
      const result = await payerIntegrationService.fetchInsuranceData(
        activeAuth,
        dataType,
        { forceRefresh: true }
      );

      results[dataType] = {
        success: result.success,
        data: result.data,
        error: result.error,
        responseTimeMs: result.responseTimeMs,
      };
    }

    // Log the refresh
    await storage.createAuditLogEntry({
      practiceId: patient.practiceId,
      patientId,
      authorizationId: activeAuth.id,
      actorType: 'user',
      actorId: req.user?.claims?.sub,
      eventType: 'data_refreshed',
      dataType: filteredTypes.join(','),
      eventDetails: {
        refreshedTypes: filteredTypes,
        results: Object.fromEntries(
          Object.entries(results).map(([k, v]) => [k, { success: v.success, responseTimeMs: v.responseTimeMs }])
        ),
      },
      success: Object.values(results).some((r: any) => r.success),
    });

    res.json({
      patientId,
      refreshed: filteredTypes,
      results,
    });
  } catch (error) {
    console.error('Error refreshing insurance data:', error);
    res.status(500).json({ message: 'Failed to refresh insurance data' });
  }
});

// GET /api/patients/:id/insurance-data/:type - Get specific type of insurance data
router.get('/patients/:id/insurance-data/:type', isAuthenticated, async (req: any, res: Response) => {
  try {
    const patientId = parseInt(req.params.id);
    const dataType = req.params.type as DataType;

    if (isNaN(patientId)) {
      return res.status(400).json({ message: 'Invalid patient ID' });
    }

    if (!['eligibility', 'benefits', 'claims_history', 'prior_auth'].includes(dataType)) {
      return res.status(400).json({ message: 'Invalid data type' });
    }

    // Get patient
    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Check for active authorization
    const authorizations = await storage.getPatientAuthorizations(patientId);
    const activeAuth = authorizations.find((auth) => auth.status === 'authorized');

    if (!activeAuth) {
      return res.status(403).json({
        message: 'No active insurance authorization for this patient',
        requiresAuthorization: true,
      });
    }

    // Check if data type is authorized
    const authorizedScopes = activeAuth.scopes as string[];
    if (!authorizedScopes.includes(dataType)) {
      return res.status(403).json({
        message: `Data type '${dataType}' is not authorized for this patient`,
      });
    }

    // Try to get cached data first
    const cached = await storage.getCachedInsuranceData(patientId, dataType);

    if (cached && cached.status === 'success' && cached.normalizedData) {
      const expiresAt = cached.expiresAt ? new Date(cached.expiresAt) : null;
      const isExpired = expiresAt && expiresAt < new Date();

      // Log the data access
      await storage.createAuditLogEntry({
        practiceId: patient.practiceId,
        patientId,
        authorizationId: activeAuth.id,
        actorType: 'user',
        actorId: req.user?.claims?.sub,
        eventType: 'data_accessed',
        dataType,
        success: true,
      });

      return res.json({
        dataType,
        data: cached.normalizedData,
        cached: true,
        cachedAt: cached.fetchedAt,
        isStale: isExpired || cached.isStale,
        expiresAt: cached.expiresAt,
      });
    }

    // Fetch fresh data if not cached
    const result = await payerIntegrationService.fetchInsuranceData(activeAuth, dataType);

    // Log the data access
    await storage.createAuditLogEntry({
      practiceId: patient.practiceId,
      patientId,
      authorizationId: activeAuth.id,
      actorType: 'user',
      actorId: req.user?.claims?.sub,
      eventType: 'data_accessed',
      dataType,
      success: result.success,
      errorMessage: result.error,
    });

    if (result.success) {
      res.json({
        dataType,
        data: result.data,
        cached: result.cached,
        cachedAt: result.cachedAt,
        responseTimeMs: result.responseTimeMs,
      });
    } else {
      res.status(502).json({
        dataType,
        error: result.error,
        message: 'Failed to retrieve insurance data from payer',
      });
    }
  } catch (error) {
    console.error('Error fetching insurance data:', error);
    res.status(500).json({ message: 'Failed to fetch insurance data' });
  }
});

// GET /api/payer-integrations - List available payer integrations
router.get('/payer-integrations', isAuthenticated, async (req: any, res: Response) => {
  try {
    const integrations = await storage.getPayerIntegrations();

    res.json(
      integrations.map((integration) => ({
        id: integration.id,
        payerName: integration.payerName,
        payerCode: integration.payerCode,
        apiType: integration.apiType,
        supportsEligibility: integration.supportsEligibility,
        supportsBenefits: integration.supportsBenefits,
        supportsClaimsHistory: integration.supportsClaimsHistory,
        supportsPriorAuth: integration.supportsPriorAuth,
        healthStatus: integration.healthStatus,
        lastHealthCheck: integration.lastHealthCheck,
      }))
    );
  } catch (error) {
    console.error('Error fetching payer integrations:', error);
    res.status(500).json({ message: 'Failed to fetch payer integrations' });
  }
});

// GET /api/payer-integrations/health - Check health of all payer integrations
router.get('/payer-integrations/health', isAuthenticated, async (req: any, res: Response) => {
  try {
    const healthResults = await payerIntegrationService.checkAllPayerHealth();

    const response: Record<string, any> = {};
    for (const [payerCode, health] of healthResults) {
      response[payerCode] = health;
    }

    res.json(response);
  } catch (error) {
    console.error('Error checking payer health:', error);
    res.status(500).json({ message: 'Failed to check payer health' });
  }
});

// GET /api/audit-logs - Get audit logs (admin only)
router.get('/audit-logs', isAuthenticated, async (req: any, res: Response) => {
  try {
    const {
      practiceId,
      patientId,
      authorizationId,
      eventType,
      startDate,
      endDate,
    } = req.query;

    const filters: any = {};

    if (practiceId) filters.practiceId = parseInt(practiceId as string);
    if (patientId) filters.patientId = parseInt(patientId as string);
    if (authorizationId) filters.authorizationId = parseInt(authorizationId as string);
    if (eventType) filters.eventType = eventType as string;
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    const logs = await storage.getAuditLogs(filters);

    res.json(logs);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ message: 'Failed to fetch audit logs' });
  }
});

export default router;
