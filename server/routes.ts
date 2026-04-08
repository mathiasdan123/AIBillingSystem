import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./replitAuth";
import { storage } from "./storage";
import insuranceAuthorizationRoutes from "./routes/insuranceAuthorizationRoutes";
import insuranceDataRoutes from "./routes/insuranceDataRoutes";
import {
  authRouter, analyticsRouter, soapNotesRouter, patientsRouter, claimsRouter,
  appointmentsRouter, payerContractsRouter, remittanceRouter, ssoRouter,
  treatmentPlansRouter, locationsRouter, aiInsightsRouter, customReportsRouter,
  exportRouter, onboardingRouter, practicesRouter, billingRouter, telehealthRouter,
  messagesRouter, surveysRouter, waitlistRouter, appealsRouter, adminRouter,
  reviewsRouter, publicPortalRouter, patientIntakeRouter,
  aiAssistantRouter,
  aiRouter, insuranceRouter, bookingRouter, clinicalRouter, referralsRouter,
  paymentsRouter, notificationsRouter, sessionsRouter, webhooksRouter,
  documentsRouter, followUpsRouter, eligibilityRouter,
  practiceAnalyticsRouter, auditReportsRouter, timeTrackingRouter,
  superbillsRouter,
  intakeFormsRouter,
  paymentPostingsRouter,
  feeSchedulesRouter,
  treatmentAuthorizationsRouter,
  patientStatementsRouter,
  benchmarkingRouter,
  dataImportRouter,
  dailyReportRouter,
  billingTasksRouter,
  billingDocumentsRouter,
  claimCorrectionsRouter,
  mcpApiKeysRouter,
  mcpTransportRouter,
} from "./routes/index";
import { auditMiddleware } from "./middleware/auditMiddleware";
import { conditionalMfaRequired, conditionalRequireMfaSetup } from "./middleware/mfa-required";
import { mfaSetupRequired } from "./middleware/mfa-setup-required";
import { authLimiter } from "./middleware/rate-limiter";
import logger from "./services/logger";
import { cache } from "./services/cacheService";
import { getRedisClient, isRedisReady } from "./services/redisClient";
import { registerPatientRightsRoutes } from "./routes/patientRightsRoutes";
import { registerBaaRoutes } from "./routes/baaRoutes";
import { registerBreachNotificationRoutes } from "./routes/breachNotificationRoutes";
import { registerComplianceRoutes } from "./routes/compliance";
import { registerBreachManagementRoutes } from "./routes/breach-management";

/**
 * Register all API routes for the application.
 */
export async function registerRoutes(app: Express): Promise<Server> {
  // Health check endpoint (no auth required for monitoring)
  app.get('/api/health', async (req, res) => {
    const startTime = Date.now();
    const checks: Record<string, { status: string; latency?: number }> = {};

    try {
      const dbStart = Date.now();
      await storage.getAllPracticeIds();
      checks.database = { status: 'healthy', latency: Date.now() - dbStart };
    } catch (error) {
      checks.database = { status: 'unhealthy' };
    }

    // Check Redis connectivity
    const redisClient = getRedisClient();
    if (redisClient === null) {
      // Redis not configured - this is acceptable (falls back to in-memory)
      checks.redis = { status: 'not_configured' };
      checks.rateLimiting = { status: 'per_instance' };
    } else if (isRedisReady()) {
      // Redis is connected and ready - measure latency with PING
      try {
        const redisStart = Date.now();
        await redisClient.ping();
        checks.redis = { status: 'healthy', latency: Date.now() - redisStart };
        checks.rateLimiting = { status: 'distributed' };
      } catch (error) {
        // PING failed even though isRedisReady was true
        checks.redis = { status: 'unhealthy' };
        checks.rateLimiting = { status: 'per_instance' };
      }
    } else {
      // Redis is configured but not ready (connection failed or lost)
      checks.redis = { status: 'unhealthy' };
      checks.rateLimiting = { status: 'per_instance' };
    }

    checks.server = { status: 'healthy' };

    // Health check is degraded if any critical service (database, redis when configured) is unhealthy
    const allHealthy = Object.values(checks).every(c =>
      c.status === 'healthy' || c.status === 'not_configured' || c.status === 'distributed' || c.status === 'per_instance'
    );

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
      responseTime: Date.now() - startTime
    });
  });

  // Auth middleware
  await setupAuth(app);

  // Set Sentry user context after authentication (ID only — no PHI)
  app.use((req, _res, next) => {
    const user = (req as any).user;
    if (user?.id) {
      Sentry.setUser({ id: String(user.id) });
    }
    next();
  });

  // HIPAA audit middleware
  app.use('/api', auditMiddleware);

  // HIPAA MFA enforcement: setup check (production only) -> existing setup check -> session verification
  app.use('/api', mfaSetupRequired);
  app.use('/api', conditionalRequireMfaSetup);
  app.use('/api', conditionalMfaRequired);

  // Register HIPAA compliance routes
  registerPatientRightsRoutes(app);
  registerBaaRoutes(app);
  registerBreachNotificationRoutes(app);
  registerBreachManagementRoutes(app);
  registerComplianceRoutes(app);

  // ==================== MODULAR ROUTERS ====================

  // Auth routes: /api/auth/*, /api/users/*, /api/mfa/*, /api/invites/*, /api/therapists/*
  app.use('/api', authRouter);
  // Analytics routes: /api/analytics/*
  app.use('/api/analytics', analyticsRouter);
  // Practice Analytics routes: /api/practice-analytics/*
  app.use('/api/practice-analytics', practiceAnalyticsRouter);
  // Benchmarking routes: /api/benchmarking/*
  app.use('/api/benchmarking', benchmarkingRouter);
  // SOAP Notes routes: /api/soap-notes/*
  app.use('/api/soap-notes', soapNotesRouter);
  // Backward compatibility for therapy-bank
  app.use('/api', soapNotesRouter);
  // Patient routes: /api/patients/*
  app.use('/api/patients', patientsRouter);
  // Claims routes: /api/claims/*
  app.use('/api/claims', claimsRouter);
  // Appointment routes: /api/appointments/*
  app.use('/api/appointments', appointmentsRouter);
  // Payer Contracts routes: /api/payer-contracts/*
  app.use('/api/payer-contracts', payerContractsRouter);
  // Remittance (ERA/835) routes: /api/remittance/*
  app.use('/api/remittance', remittanceRouter);
  // SSO (SAML/OIDC) routes: /api/sso/*
  app.use('/api/sso', ssoRouter);
  // Treatment Plans routes (patient-scoped): /api/patients/:id/treatment-plans
  app.use('/api', treatmentPlansRouter);
  // Locations routes: /api/locations/*
  app.use('/api/locations', locationsRouter);
  // AI Insights routes: /api/ai-insights/*
  app.use('/api/ai-insights', aiInsightsRouter);
  // Custom Reports routes: /api/reports/custom/*
  app.use('/api/reports/custom', customReportsRouter);
  // Onboarding routes: /api/onboarding/*
  app.use('/api/onboarding', onboardingRouter);
  // Data Export routes: /api/export/*
  app.use('/api/export', exportRouter);
  // Practice management routes: /api/practices/*
  app.use('/api/practices', practicesRouter);
  // Billing routes: /api/billing/*, /api/webhooks/stripe
  app.use('/api', billingRouter);
  // Telehealth routes: /api/telehealth/*, /api/public/telehealth/*
  app.use('/api', telehealthRouter);
  // Messages routes: /api/messages/*, /api/public/messages/*
  app.use('/api', messagesRouter);
  // Survey routes: /api/surveys/*, /api/patient-portal/surveys/*
  app.use('/api/surveys', surveysRouter);
  app.use('/api', surveysRouter);
  // Waitlist routes: /api/waitlist/*
  app.use('/api', waitlistRouter);
  // Appeals routes: /api/appeals/*
  app.use('/api', appealsRouter);
  // Admin routes: /api/admin/*
  app.use('/api', adminRouter);
  // Reviews & feedback routes: /api/reviews/*, /api/feedback/*, /api/public/feedback/*
  app.use('/api', reviewsRouter);
  // Public portal routes: /api/public/book/*, /api/public/portal/*, /api/patient-portal/*
  app.use('/api', publicPortalRouter);
  // Patient intake routes: /api/patient-portal/intake/*
  app.use('/api', patientIntakeRouter);

  // ==================== NEWLY EXTRACTED ROUTERS ====================

  // AI routes: /api/estimate-reimbursement, /api/oon-predict/*, /api/ai/*, /api/voice/*, /api/tts/*, /api/session-recorder/*
  app.use('/api', aiRouter);
  // AI Assistant chat routes: /api/ai/assistant, /api/ai/assistant/status
  app.use('/api/ai', aiAssistantRouter);
  // Insurance routes: /api/insurances, /api/insurance-rates/*, /api/insurance/*, /api/eligibility-alerts/*,
  //   /api/patients/:id/plan-documents/*, /api/patients/:id/plan-benefits/*, /api/reimbursement/*,
  //   /api/cost-estimate/*, /api/patient-consents/*
  app.use('/api', insuranceRouter);
  // Booking routes: /api/booking/*, /api/appointment-requests/*
  app.use('/api', bookingRouter);
  // Clinical routes: /api/treatment-plans/*, /api/goals/*, /api/objectives/*, /api/interventions/*,
  //   /api/outcome-measures/*, /api/assessment-schedules/*, /api/patients/:id/progress-notes/*
  app.use('/api', clinicalRouter);
  // Referral routes: /api/referral-sources/*, /api/referrals/*
  app.use('/api', referralsRouter);
  // Payment routes: /api/payment-settings, /api/payment-methods/*, /api/payment-transactions/*,
  //   /api/payment-plans/*, /api/installments/*
  app.use('/api', paymentsRouter);
  // Notification routes: /api/reminders/*, /api/reports/denied-claims*, /api/reports/email-settings,
  //   /api/reports/send-*, /api/reports/weekly-cancellation
  app.use('/api', notificationsRouter);
  // Session routes: /api/cpt-codes, /api/exercise-bank/*, /api/sessions/*, /api/superbills,
  //   /api/users/:id/supervisees, /api/users/:id/supervision
  app.use('/api', sessionsRouter);
  // Webhook routes: /api/webhooks
  app.use('/api', webhooksRouter);
  // Document management routes: /api/documents
  app.use('/api/documents', documentsRouter);
  // Claim Follow-Up routes: /api/follow-ups/*
  app.use('/api/follow-ups', followUpsRouter);
  // Time Tracking routes: /api/time-tracking/*
  app.use('/api/time-tracking', timeTrackingRouter);
  // Eligibility batch verification routes: /api/eligibility/*
  app.use('/api/eligibility', eligibilityRouter);
  // Audit report routes: /api/audit-reports/*
  app.use('/api/audit-reports', auditReportsRouter);
  // Superbill routes: /api/superbills/*
  app.use('/api/superbills', superbillsRouter);
  // Intake Forms routes: /api/intake-forms/*
  app.use('/api/intake-forms', intakeFormsRouter);
  // Payment Postings (ERA) routes: /api/payment-postings/*
  app.use('/api/payment-postings', paymentPostingsRouter);
  // Fee Schedule routes: /api/fee-schedules/*
  app.use('/api/fee-schedules', feeSchedulesRouter);
  // Treatment Authorization routes: /api/treatment-authorizations/*
  app.use('/api/treatment-authorizations', treatmentAuthorizationsRouter);
  // Patient Statement routes: /api/patient-statements/*
  app.use('/api/patient-statements', patientStatementsRouter);
  // Data Import routes: /api/data-import/*
  app.use('/api/data-import', dataImportRouter);
  // Daily Report routes: /api/daily-report/*
  app.use('/api/daily-report', dailyReportRouter);
  // Billing Tasks (Option C): /api/billing-tasks/*, /api/billing-documents/*, /api/claim-corrections/*
  app.use('/api', billingTasksRouter);
  app.use('/api', billingDocumentsRouter);
  app.use('/api', claimCorrectionsRouter);

  // MCP API key management routes (admin only)
  app.use('/api/mcp-api-keys', mcpApiKeysRouter);

  // MCP streamable HTTP transport (no /api prefix — MCP clients connect directly)
  // Note: mounted BEFORE auth middleware section, uses its own Bearer token auth
  app.use('/mcp', mcpTransportRouter);

  // Insurance Authorization and Data routes
  app.use('/api/insurance-authorizations', insuranceAuthorizationRoutes);
  app.use('/api', insuranceDataRoutes);

  const httpServer = createServer(app);
  return httpServer;
}
