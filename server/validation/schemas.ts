/**
 * Zod Validation Schemas for API Routes
 *
 * Centralized validation schemas for common API endpoints.
 * These schemas validate and sanitize input data before it reaches handlers.
 */

import { z } from 'zod';

// ============================================================
// Patient Schemas
// ============================================================

/**
 * Schema for creating a new patient
 * Validates required fields and sanitizes input
 */
export const createPatientSchema = z.object({
  practiceId: z.number().int().positive('Practice ID must be a positive integer'),
  firstName: z.string()
    .min(1, 'First name is required')
    .max(100, 'First name must be 100 characters or less')
    .transform((s) => s.trim()),
  lastName: z.string()
    .min(1, 'Last name is required')
    .max(100, 'Last name must be 100 characters or less')
    .transform((s) => s.trim()),
  dateOfBirth: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format')
    .refine((date) => {
      const parsed = new Date(date);
      const now = new Date();
      return parsed <= now && parsed >= new Date('1900-01-01');
    }, 'Date of birth must be a valid past date')
    .optional()
    .nullable(),
  email: z.string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.string().email('Invalid email address'))
    .optional()
    .nullable()
    .or(z.literal('')),
  phone: z.string()
    .transform((s) => s.replace(/\D/g, ''))
    .refine((s) => s.length === 0 || s.length === 10 || s.length === 11, {
      message: 'Phone number must be 10 or 11 digits',
    })
    .optional()
    .nullable()
    .or(z.literal('')),
  address: z.string()
    .max(500, 'Address must be 500 characters or less')
    .transform((s) => s.trim())
    .optional()
    .nullable(),
  insuranceProvider: z.string()
    .max(200, 'Insurance provider name must be 200 characters or less')
    .transform((s) => s.trim())
    .optional()
    .nullable(),
  insuranceId: z.string()
    .max(100, 'Insurance ID must be 100 characters or less')
    .transform((s) => s.trim())
    .optional()
    .nullable(),
  policyNumber: z.string()
    .max(100, 'Policy number must be 100 characters or less')
    .transform((s) => s.trim())
    .optional()
    .nullable(),
  groupNumber: z.string()
    .max(100, 'Group number must be 100 characters or less')
    .transform((s) => s.trim())
    .optional()
    .nullable(),
  phoneType: z.enum(['mobile', 'landline', 'work'])
    .optional()
    .default('mobile'),
  preferredContactMethod: z.enum(['email', 'sms', 'both'])
    .optional()
    .default('email'),
  smsConsentGiven: z.boolean().optional().default(false),
  intakeData: z.record(z.unknown()).optional().nullable(),
});

export type CreatePatientInput = z.infer<typeof createPatientSchema>;

/**
 * Schema for updating an existing patient
 * All fields are optional except the ones being updated
 */
export const updatePatientSchema = createPatientSchema.partial().omit({ practiceId: true });

export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

// ============================================================
// Claim Schemas
// ============================================================

/**
 * Schema for creating a new claim
 */
export const createClaimSchema = z.object({
  patientId: z.number().int().positive('Patient ID must be a positive integer'),
  insuranceId: z.number().int().positive('Insurance ID must be a positive integer')
    .optional()
    .nullable(),
  sessionId: z.number().int().positive('Session ID must be a positive integer')
    .optional()
    .nullable(),
  totalAmount: z.union([
    z.number().positive('Total amount must be greater than 0'),
    z.string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Total amount must be a valid decimal number')
      .transform(Number)
      .refine((n) => n > 0, 'Total amount must be greater than 0'),
  ]),
  submittedAmount: z.union([
    z.number().nonnegative('Submitted amount cannot be negative'),
    z.string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Submitted amount must be a valid decimal number')
      .transform(Number),
  ])
    .optional()
    .nullable(),
  status: z.enum(['draft', 'submitted', 'paid', 'denied', 'appeal', 'optimized'])
    .optional()
    .default('draft'),
});

export type CreateClaimInput = z.infer<typeof createClaimSchema>;

/**
 * Schema for updating an existing claim
 */
export const updateClaimSchema = z.object({
  status: z.enum(['draft', 'submitted', 'paid', 'denied', 'appeal', 'optimized']).optional(),
  paidAmount: z.union([
    z.number().nonnegative('Paid amount cannot be negative'),
    z.string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Paid amount must be a valid decimal number')
      .transform(Number),
  ])
    .optional()
    .nullable(),
  denialReason: z.string()
    .max(1000, 'Denial reason must be 1000 characters or less')
    .optional()
    .nullable(),
  aiReviewScore: z.string()
    .regex(/^\d+(\.\d{1,2})?$/, 'AI review score must be a valid decimal')
    .optional()
    .nullable(),
  aiReviewNotes: z.string()
    .max(5000, 'AI review notes must be 5000 characters or less')
    .optional()
    .nullable(),
});

export type UpdateClaimInput = z.infer<typeof updateClaimSchema>;

// ============================================================
// Appointment Schemas
// ============================================================

/**
 * Schema for creating a new appointment
 */
export const createAppointmentSchema = z.object({
  practiceId: z.number().int().positive('Practice ID must be a positive integer')
    .optional(),
  patientId: z.number().int().positive('Patient ID must be a positive integer'),
  therapistId: z.string().min(1, 'Therapist ID is required').optional().nullable(),
  title: z.string()
    .max(200, 'Title must be 200 characters or less')
    .transform((s) => s.trim())
    .optional()
    .nullable(),
  startTime: z.string()
    .datetime({ message: 'Start time must be a valid ISO 8601 datetime' })
    .or(z.date())
    .transform((val) => typeof val === 'string' ? val : val.toISOString()),
  endTime: z.string()
    .datetime({ message: 'End time must be a valid ISO 8601 datetime' })
    .or(z.date())
    .transform((val) => typeof val === 'string' ? val : val.toISOString()),
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show'])
    .optional()
    .default('scheduled'),
  notes: z.string()
    .max(2000, 'Notes must be 2000 characters or less')
    .transform((s) => s.trim())
    .optional()
    .nullable(),
}).refine(
  (data) => new Date(data.startTime) < new Date(data.endTime),
  { message: 'End time must be after start time', path: ['endTime'] }
).refine(
  (data) => {
    const start = new Date(data.startTime);
    const end = new Date(data.endTime);
    const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    return durationHours <= 8;
  },
  { message: 'Appointment duration cannot exceed 8 hours', path: ['endTime'] }
);

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

/**
 * Schema for updating an existing appointment
 */
export const updateAppointmentSchema = z.object({
  patientId: z.number().int().positive('Patient ID must be a positive integer').optional(),
  therapistId: z.string().min(1).optional().nullable(),
  title: z.string()
    .max(200, 'Title must be 200 characters or less')
    .transform((s) => s.trim())
    .optional()
    .nullable(),
  startTime: z.string()
    .datetime({ message: 'Start time must be a valid ISO 8601 datetime' })
    .or(z.date())
    .transform((val) => typeof val === 'string' ? val : val.toISOString())
    .optional(),
  endTime: z.string()
    .datetime({ message: 'End time must be a valid ISO 8601 datetime' })
    .or(z.date())
    .transform((val) => typeof val === 'string' ? val : val.toISOString())
    .optional(),
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']).optional(),
  notes: z.string()
    .max(2000, 'Notes must be 2000 characters or less')
    .transform((s) => s.trim())
    .optional()
    .nullable(),
  cancellationReason: z.enum(['patient_request', 'sick', 'schedule_conflict', 'weather', 'no_show', 'other'])
    .optional()
    .nullable(),
  cancellationNotes: z.string()
    .max(500, 'Cancellation notes must be 500 characters or less')
    .optional()
    .nullable(),
});

export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

// ============================================================
// User Role Schemas
// ============================================================

/**
 * Valid user roles in the system
 */
export const userRoles = ['therapist', 'admin', 'billing'] as const;
export type UserRole = typeof userRoles[number];

/**
 * Schema for updating a user's role
 */
export const updateUserRoleSchema = z.object({
  role: z.enum(userRoles, {
    errorMap: () => ({ message: `Role must be one of: ${userRoles.join(', ')}` }),
  }),
});

export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;

/**
 * Schema for user ID in URL params
 */
export const userIdParamsSchema = z.object({
  id: z.string().min(1, 'User ID is required'),
});

// ============================================================
// Common ID Parameter Schemas
// ============================================================

/**
 * Numeric ID parameter (for patients, claims, appointments, etc.)
 */
export const numericIdParamsSchema = z.object({
  id: z.string()
    .regex(/^\d+$/, 'ID must be a positive integer')
    .transform(Number)
    .refine((n) => n > 0, 'ID must be greater than 0'),
});

export type NumericIdParams = z.infer<typeof numericIdParamsSchema>;
