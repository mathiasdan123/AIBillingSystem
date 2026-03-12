/**
 * Swagger/OpenAPI Configuration
 *
 * Auto-generates OpenAPI 3.0 documentation from JSDoc annotations on route handlers.
 * Replaces the manually maintained server/openapi.yaml which drifted from actual routes.
 *
 * Usage:
 *   - Add @openapi JSDoc blocks to route handlers (see examples in routes/patients.ts)
 *   - Swagger UI is served at /api-docs (non-production only)
 *   - Static openapi.json can be generated via `npm run docs:api`
 */

import swaggerJsdoc from 'swagger-jsdoc';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read version from package.json without requiring resolveJsonModule
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf-8'));
const version: string = pkg.version;

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'TherapyBill AI API',
      version,
      description: [
        'API for TherapyBill AI — a comprehensive medical billing and practice management system for therapy practices.',
        '',
        '## Authentication',
        'Most endpoints require session-based authentication. Protected endpoints return `401 Unauthorized` if not authenticated.',
        '',
        '## Multi-Tenancy',
        'The system supports multiple practices. Users can only access data within their authorized practice (admins may have cross-practice access).',
        '',
        '## HIPAA Compliance',
        'This API handles Protected Health Information (PHI). All access is logged for audit purposes.',
      ].join('\n'),
      contact: {
        name: 'TherapyBill AI Support',
      },
      license: {
        name: 'Proprietary',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Local development',
      },
      {
        url: 'http://localhost:5000',
        description: 'Default dev port',
      },
    ],
    components: {
      securitySchemes: {
        sessionAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'connect.sid',
          description: 'Session cookie set after login via /api/login',
        },
      },
      schemas: {
        // ---- Common response wrappers ----
        PaginatedResponse: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {},
              description: 'Array of result items for the current page',
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer', example: 1 },
                limit: { type: 'integer', example: 20 },
                total: { type: 'integer', example: 142 },
                totalPages: { type: 'integer', example: 8 },
              },
            },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Something went wrong' },
            error: { type: 'string', example: 'Detailed error info (dev only)' },
          },
          required: ['message'],
        },

        // ---- Domain models (derived from shared/schema.ts Drizzle tables) ----
        Patient: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            practiceId: { type: 'integer', example: 1 },
            firstName: { type: 'string', example: 'Jane' },
            lastName: { type: 'string', example: 'Doe' },
            dateOfBirth: { type: 'string', format: 'date', example: '1990-05-15' },
            email: { type: 'string', format: 'email', example: 'jane@example.com' },
            phone: { type: 'string', example: '555-0100' },
            address: { type: 'string', example: '123 Main St, City, ST 12345' },
            insuranceProvider: { type: 'string', example: 'Blue Cross' },
            insuranceId: { type: 'string', example: 'INS-12345' },
            policyNumber: { type: 'string', example: 'POL-67890' },
            groupNumber: { type: 'string', example: 'GRP-111' },
            phoneType: { type: 'string', enum: ['mobile', 'landline', 'work'], default: 'mobile' },
            preferredContactMethod: { type: 'string', enum: ['email', 'sms', 'both'], default: 'email' },
            smsConsentGiven: { type: 'boolean', default: false },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'practiceId', 'firstName', 'lastName'],
        },
        InsertPatient: {
          type: 'object',
          properties: {
            practiceId: { type: 'integer' },
            firstName: { type: 'string', example: 'Jane' },
            lastName: { type: 'string', example: 'Doe' },
            dateOfBirth: { type: 'string', format: 'date' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            address: { type: 'string' },
            insuranceProvider: { type: 'string' },
            insuranceId: { type: 'string' },
            policyNumber: { type: 'string' },
            groupNumber: { type: 'string' },
          },
          required: ['firstName', 'lastName'],
        },

        Claim: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            practiceId: { type: 'integer' },
            patientId: { type: 'integer' },
            sessionId: { type: 'integer', nullable: true },
            claimNumber: { type: 'string', example: 'CLM-ABC123' },
            insuranceId: { type: 'integer', nullable: true },
            totalAmount: { type: 'string', example: '150.00' },
            submittedAmount: { type: 'string', nullable: true },
            paidAmount: { type: 'string', nullable: true },
            status: {
              type: 'string',
              enum: ['draft', 'submitted', 'paid', 'denied', 'appeal', 'optimized'],
              default: 'draft',
            },
            submittedAt: { type: 'string', format: 'date-time', nullable: true },
            paidAt: { type: 'string', format: 'date-time', nullable: true },
            denialReason: { type: 'string', nullable: true },
            aiReviewScore: { type: 'string', nullable: true, example: '0.92' },
            aiReviewNotes: { type: 'string', nullable: true },
            billingOrder: { type: 'string', enum: ['primary', 'secondary'], default: 'primary' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'practiceId', 'patientId', 'totalAmount'],
        },
        InsertClaim: {
          type: 'object',
          properties: {
            patientId: { type: 'integer' },
            insuranceId: { type: 'integer' },
            totalAmount: { type: 'string', example: '150.00' },
            submittedAmount: { type: 'string' },
            sessionId: { type: 'integer' },
            billingOrder: { type: 'string', enum: ['primary', 'secondary'] },
            primaryClaimId: { type: 'integer' },
          },
          required: ['patientId', 'totalAmount'],
        },

        Appointment: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            practiceId: { type: 'integer' },
            patientId: { type: 'integer' },
            therapistId: { type: 'string' },
            title: { type: 'string', example: 'OT Session' },
            startTime: { type: 'string', format: 'date-time' },
            endTime: { type: 'string', format: 'date-time' },
            status: {
              type: 'string',
              enum: ['scheduled', 'completed', 'cancelled', 'no_show'],
              default: 'scheduled',
            },
            notes: { type: 'string', nullable: true },
            isRecurring: { type: 'boolean', default: false },
            seriesId: { type: 'string', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'startTime', 'endTime'],
        },
        InsertAppointment: {
          type: 'object',
          properties: {
            practiceId: { type: 'integer' },
            patientId: { type: 'integer' },
            therapistId: { type: 'string' },
            title: { type: 'string' },
            startTime: { type: 'string', format: 'date-time' },
            endTime: { type: 'string', format: 'date-time' },
            notes: { type: 'string' },
            recurrencePattern: {
              type: 'string',
              enum: ['none', 'weekly', 'biweekly', 'monthly'],
              description: 'Optional recurrence pattern',
            },
            recurrenceEndDate: { type: 'string', format: 'date-time' },
            numberOfOccurrences: { type: 'integer', minimum: 2, maximum: 52 },
          },
          required: ['startTime', 'endTime'],
        },

        Practice: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            name: { type: 'string', example: 'Sunshine Therapy' },
            npi: { type: 'string', example: '1234567890' },
            taxId: { type: 'string' },
            address: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string', format: 'email' },
            billingPlan: { type: 'string', enum: ['solo', 'growing', 'enterprise'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'name'],
        },
      },
    },
    security: [
      { sessionAuth: [] },
    ],
    tags: [
      { name: 'Patients', description: 'Patient CRUD and related resources' },
      { name: 'Claims', description: 'Insurance claims management' },
      { name: 'Appointments', description: 'Appointment scheduling and management' },
      { name: 'Authentication', description: 'Login, logout, and session management' },
      { name: 'Analytics', description: 'Dashboard and reporting analytics' },
    ],
  },
  // Scan route files for @openapi JSDoc annotations
  apis: [
    './server/routes/patients.ts',
    './server/routes/claims.ts',
    './server/routes/appointments.ts',
    './server/routes/auth.ts',
    './server/routes/analytics.ts',
    './server/routes/soap-notes.ts',
    './server/routes/payerContracts.ts',
    './server/routes/remittance.ts',
    './server/routes.ts',
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
