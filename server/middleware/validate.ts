/**
 * Zod Validation Middleware
 *
 * A generic validation middleware factory for Express routes using Zod schemas.
 * Provides type-safe request validation with detailed error messages.
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';
import { fromZodError } from 'zod-validation-error';

/**
 * Validation target - where to look for data to validate
 */
export type ValidationTarget = 'body' | 'query' | 'params';

/**
 * Options for the validation middleware
 */
interface ValidationOptions {
  /** Strip unknown keys from the validated data (default: true) */
  stripUnknown?: boolean;
}

/**
 * Format Zod validation errors into a user-friendly response
 */
function formatValidationErrors(error: ZodError): {
  message: string;
  errors: Array<{ path: string; message: string }>;
} {
  const validationError = fromZodError(error, {
    prefix: 'Validation error',
    prefixSeparator: ': ',
    issueSeparator: '; ',
    unionSeparator: ' or ',
  });

  return {
    message: validationError.message,
    errors: error.errors.map((err) => ({
      path: err.path.join('.'),
      message: err.message,
    })),
  };
}

/**
 * Creates a validation middleware for Express routes
 *
 * @param schema - Zod schema to validate against
 * @param target - Where to find the data to validate (body, query, params)
 * @param options - Additional validation options
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * app.post('/api/patients',
 *   validate(createPatientSchema, 'body'),
 *   async (req, res) => {
 *     // req.body is now typed and validated
 *   }
 * );
 * ```
 */
export function validate<T extends ZodSchema>(
  schema: T,
  target: ValidationTarget = 'body',
  options: ValidationOptions = {}
) {
  const { stripUnknown = true } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dataToValidate = req[target];

      // Parse and validate the data
      const result = await schema.safeParseAsync(dataToValidate);

      if (!result.success) {
        const formatted = formatValidationErrors(result.error);
        return res.status(400).json(formatted);
      }

      // Replace request data with validated (and potentially transformed) data
      if (stripUnknown) {
        (req as any)[target] = result.data;
      }

      next();
    } catch (error) {
      // Unexpected error during validation
      return res.status(500).json({
        message: 'Validation failed due to an internal error',
      });
    }
  };
}

/**
 * Validates multiple targets in a single middleware
 *
 * @example
 * ```typescript
 * app.get('/api/patients/:id',
 *   validateMultiple({
 *     params: patientIdParamsSchema,
 *     query: paginationQuerySchema,
 *   }),
 *   async (req, res) => { ... }
 * );
 * ```
 */
export function validateMultiple(
  schemas: Partial<Record<ValidationTarget, ZodSchema>>,
  options: ValidationOptions = {}
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const targets = Object.keys(schemas) as ValidationTarget[];
    const allErrors: Array<{ target: string; path: string; message: string }> = [];

    for (const target of targets) {
      const schema = schemas[target];
      if (!schema) continue;

      const result = await schema.safeParseAsync(req[target]);

      if (!result.success) {
        result.error.errors.forEach((err) => {
          allErrors.push({
            target,
            path: err.path.join('.'),
            message: err.message,
          });
        });
      } else if (options.stripUnknown !== false) {
        (req as any)[target] = result.data;
      }
    }

    if (allErrors.length > 0) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: allErrors,
      });
    }

    next();
  };
}

// ============================================================
// Common Validation Helpers & Schemas for Reuse
// ============================================================

/**
 * Common string transformations and validations
 */
export const sanitize = {
  /** Trim whitespace from string */
  trim: z.string().transform((s) => s.trim()),

  /** Trim and convert to lowercase */
  trimLower: z.string().transform((s) => s.trim().toLowerCase()),

  /** Trim and convert to uppercase */
  trimUpper: z.string().transform((s) => s.trim().toUpperCase()),

  /** Normalize email (trim, lowercase) */
  email: z.string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.string().email('Invalid email address')),

  /** Normalize phone number (remove non-digits, validate length) */
  phone: z.string()
    .transform((s) => s.replace(/\D/g, ''))
    .refine((s) => s.length === 10 || s.length === 11, {
      message: 'Phone number must be 10 or 11 digits',
    }),

  /** Optional phone that can be empty string or valid phone */
  optionalPhone: z.string()
    .transform((s) => s.replace(/\D/g, ''))
    .refine((s) => s.length === 0 || s.length === 10 || s.length === 11, {
      message: 'Phone number must be 10 or 11 digits',
    })
    .optional()
    .or(z.literal('')),
};

/**
 * Common ID parameter schemas
 */
export const idParams = {
  /** Numeric ID from URL params */
  id: z.object({
    id: z.string().regex(/^\d+$/, 'ID must be a positive integer').transform(Number),
  }),

  /** String ID (e.g., for user IDs) */
  stringId: z.object({
    id: z.string().min(1, 'ID is required'),
  }),
};

/**
 * Common pagination query parameters
 */
export const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default('50'),
  offset: z.string().regex(/^\d+$/).transform(Number).optional(),
}).transform((data) => ({
  page: data.page || 1,
  limit: Math.min(data.limit || 50, 100), // Cap at 100
  offset: data.offset ?? ((data.page || 1) - 1) * (data.limit || 50),
}));

/**
 * Date range query parameters
 */
export const dateRangeSchema = z.object({
  start: z.string().datetime().optional(),
  end: z.string().datetime().optional(),
}).refine(
  (data) => {
    if (data.start && data.end) {
      return new Date(data.start) <= new Date(data.end);
    }
    return true;
  },
  { message: 'Start date must be before or equal to end date' }
);

/**
 * Practice ID query parameter (for multi-tenancy)
 */
export const practiceIdQuery = z.object({
  practiceId: z.string().regex(/^\d+$/).transform(Number).optional(),
});
