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
 * TODO: Remaining routes to split from server/routes.ts
 *
 * High Priority (large route groups):
 * - patients.ts - Patient CRUD and related endpoints (/api/patients/*)
 *   ~30 routes including consents, eligibility, documents, statements,
 *   treatment plans, assessments, referrals, payment methods, transactions
 *
 * - claims.ts - Claims management (/api/claims/*)
 *   ~15 routes including line items, submission, status checks, appeals
 *
 * - appointments.ts - Appointment routes (/api/appointments/*)
 *   ~7 routes including eligibility checks, alerts, CRUD operations
 *
 * Medium Priority:
 * - practices.ts - Practice management (/api/practices/*)
 *
 * - billing.ts - Billing and reimbursement (/api/estimate-reimbursement, etc.)
 *
 * - admin.ts - Admin endpoints (/api/admin/*)
 *
 * Lower Priority:
 * - insurance.ts - Insurance-related endpoints (/api/insurance/*)
 * - ai.ts - AI endpoints (/api/ai/*)
 * - reports.ts - Report generation (/api/reports/*)
 * - payments.ts - Payment processing (/api/payments/*)
 * - stripe.ts - Stripe integration (/api/stripe/*)
 *
 * MIGRATION NOTES:
 * - The legacy routes in server/routes.ts are kept temporarily for backward compatibility
 * - Once the modular versions are verified working, remove the duplicates from routes.ts
 * - When splitting, ensure middleware (isAuthenticated, isAdmin, isAdminOrBilling) are imported
 * - Helper functions (getAuthorizedPracticeId, verifyPatientAccess, etc.) should be
 *   moved to a shared utilities file: server/routes/utils.ts
 * - Each module should follow the pattern established in auth.ts and analytics.ts
 */
