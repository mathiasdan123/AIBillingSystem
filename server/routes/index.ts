/**
 * Route Index - Combines all sub-routers
 *
 * This module exports all route routers for use in the main routes.ts file.
 * Each router handles a specific domain of the API.
 *
 * Usage in routes.ts:
 *   import { authRouter, analyticsRouter, soapNotesRouter } from './routes';
 *   app.use('/api', authRouter);
 *   app.use('/api/analytics', analyticsRouter);
 *   app.use('/api/soap-notes', soapNotesRouter);
 */

// Modular route exports (newly created)
export { default as authRouter } from './auth';
export { default as analyticsRouter } from './analytics';
export { default as soapNotesRouter } from './soap-notes';
export { default as patientsRouter } from './patients';
export { default as claimsRouter } from './claims';
export { default as appointmentsRouter } from './appointments';

export { default as payerContractsRouter } from './payerContracts';
export { default as remittanceRouter } from './remittance';
export { default as ssoRouter } from './sso';
export { default as treatmentPlansRouter } from './treatment-plans';
export { default as locationsRouter } from './locations';
export { default as aiInsightsRouter } from './ai-insights';
export { default as customReportsRouter } from './reports';
export { default as exportRouter } from './export';
export { default as onboardingRouter } from './onboarding';

export { default as practicesRouter } from './practices';
export { default as billingRouter } from './billing';
export { default as telehealthRouter } from './telehealth';
export { default as messagesRouter } from './messages';
export { default as surveysRouter } from './surveys';
export { default as waitlistRouter } from './waitlist';

export { default as appealsRouter } from './appeals';
export { default as adminRouter } from './admin';
export { default as reviewsRouter } from './reviews';
export { default as publicPortalRouter } from './public-portal';
export { default as patientIntakeRouter } from './patient-intake';
// notification-preferences and scheduling routes removed (unused - never registered)
export { default as benchmarkingRouter } from './benchmarking';

// Final extraction pass - all remaining route groups from legacy routes.ts
export { default as aiRouter } from './ai';
export { default as aiAssistantRouter } from './ai-assistant';
export { default as insuranceRouter } from './insurance';
export { default as bookingRouter } from './booking';
export { default as clinicalRouter } from './clinical';
export { default as referralsRouter } from './referrals';
export { default as paymentsRouter } from './payments';
export { default as notificationsRouter } from './notifications';
export { default as sessionsRouter } from './sessions';

export { default as webhooksRouter } from './webhooks';
export { default as documentsRouter } from './documents';
export { default as followUpsRouter } from './follow-ups';
export { default as eligibilityRouter } from './eligibility';
export { default as practiceAnalyticsRouter } from './practice-analytics';
export { default as auditReportsRouter } from './audit-reports';
export { default as timeTrackingRouter } from './time-tracking';
export { default as superbillsRouter } from './superbills';

export { default as intakeFormsRouter } from './intake-forms';
export { default as paymentPostingsRouter } from './payment-postings';
export { default as feeSchedulesRouter } from './fee-schedules';
export { default as treatmentAuthorizationsRouter } from './authorizations';
export { default as patientStatementsRouter } from './patient-statements';
export { default as dataImportRouter } from './data-import';
export { default as dailyReportRouter } from './daily-report';
export { default as billingTasksRouter } from './billing-tasks';
export { default as billingDocumentsRouter } from './billing-documents';
export { default as claimCorrectionsRouter } from './claim-corrections';
export { default as mcpApiKeysRouter } from './mcp-api-keys';
export { default as mcpTransportRouter, getMcpAuthRouter, oauthProvider as mcpOAuthProvider } from './mcp-transport';
export { default as contactRouter } from './contact';
export { default as credentialingRouter } from './credentialing';
export { default as payerCrosswalkRouter } from './payer-crosswalk';

// Existing routes (already modularized before this refactor)
export { default as insuranceAuthorizationRoutes } from './insuranceAuthorizationRoutes';
export { default as insuranceDataRoutes } from './insuranceDataRoutes';

/**
 * MIGRATION STATUS: COMPLETE
 *
 * All route groups have been extracted from server/routes.ts into modular files.
 * The legacy routes.ts now only contains:
 * - registerRoutes function (health check, middleware setup, router mounting)
 * - HTTP server creation
 */
