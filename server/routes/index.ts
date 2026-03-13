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

// Existing routes (already modularized before this refactor)
export { default as insuranceAuthorizationRoutes } from './insuranceAuthorizationRoutes';
export { default as insuranceDataRoutes } from './insuranceDataRoutes';

/**
 * MIGRATION STATUS:
 *
 * COMPLETED:
 * - auth.ts - Authentication routes (/api/auth/*, /api/login, /api/logout, /api/mfa/*)
 *   Also includes: /api/users/*, /api/invites/*, /api/therapists/*, /api/setup/*
 *
 * - analytics.ts - Analytics endpoints (/api/analytics/*)
 *   Includes: dashboard, revenue, claims-by-status, denial-reasons, collection-rate,
 *   clean-claims-rate, capacity, ar-aging, revenue/forecast, referrals,
 *   revenue-by-location-therapist, cancellations/*
 *
 * - soap-notes.ts - SOAP notes (/api/soap-notes/*, /api/therapy-bank)
 *   Includes: CRUD, signing, co-signing (supervisor workflow), therapy bank
 *
 * - patients.ts - Patient CRUD and related endpoints (/api/patients/*)
 *   Includes: consents, eligibility, cost-estimate, documents, statements,
 *   treatment plans, assessments, referrals, payment methods, transactions,
 *   balance, payment plans, portal access, insurance data
 *
 * - claims.ts - Claims management (/api/claims/*)
 *   Includes: CRUD, line items, submission, status checks, paid/deny,
 *   appeals (get, sent, completed, failed), regenerate-appeal, analytics
 *
 * - appointments.ts - Appointment routes (/api/appointments/*)
 *   Includes: CRUD, cancel, check-eligibility, eligibility-alerts,
 *   recurring (create, get series, delete series, update series, cancel series)
 *
 * - practices.ts - Practice management (/api/practices/*)
 *   Includes: CRUD, public-info for consent forms
 *
 * - billing.ts - Billing routes (/api/billing/*)
 *   Includes: AR aging, Stripe setup-intent, payment-methods, set-default,
 *   billing info, history, patient-payment-link, Stripe webhook
 *
 * - telehealth.ts - Telehealth routes (/api/telehealth/*)
 *   Includes: settings, sessions CRUD, join, end, public patient endpoints
 *   (join by code, waiting room, status polling)
 *
 * - messages.ts - Secure messaging routes (/api/messages/*)
 *   Includes: conversations CRUD, send message, archive, unread count,
 *   delete message, public patient messaging endpoints
 *
 * - appeals.ts - Appeals management (/api/appeals/*)
 *   Includes: dashboard, deadlines, denied-claims, CRUD, submit, resolve,
 *   escalate, regenerate-letter
 *
 * - admin.ts - Admin endpoints (/api/admin/*)
 *   Includes: payer-integrations, payer-credentials, health-check, hard-delete-expired
 *
 * - waitlist.ts - Waitlist management (/api/waitlist/*)
 *   Includes: CRUD, stats, find-matches, notify, schedule, expire, auto-fill
 *
 * - reviews.ts - Reviews & feedback (/api/reviews/*, /api/feedback/*, /api/public/feedback/*)
 *   Includes: review requests, Google reviews, AI response generation,
 *   patient feedback CRUD, automated feedback workflow
 *
 * - public-portal.ts - Public portal (/api/public/book/*, /api/public/portal/*, /api/patient-portal/*)
 *   Includes: online booking, portal login, dashboard, profile, appointments,
 *   statements, documents, appointment requests, progress notes
 *
 * TODO: Remaining routes to split from server/routes.ts
 *
 * Lower Priority:
 * - insurance.ts - Insurance-related endpoints (/api/insurance/*)
 * - ai.ts - AI endpoints (/api/ai/*)
 * - reminders.ts - Appointment reminders (/api/reminders/*)
 * - booking.ts - Booking management (admin) (/api/booking/*)
 *
 * MIGRATION NOTES:
 * - The legacy routes in server/routes.ts are kept temporarily for backward compatibility
 * - Once the modular versions are verified working, remove the duplicates from routes.ts
 * - When splitting, ensure middleware (isAuthenticated, isAdmin, isAdminOrBilling) are imported
 * - Helper functions (getAuthorizedPracticeId, verifyPatientAccess, etc.) should be
 *   moved to a shared utilities file: server/routes/utils.ts
 * - Each module should follow the pattern established in auth.ts and analytics.ts
 */
