/**
 * Consent Enforcement Middleware
 *
 * HIPAA P0: Verifies that a patient has the required consents (treatment, hipaa_release)
 * before allowing access to PHI-containing routes.
 *
 * Graceful degradation: If no consent records exist at all for a patient (legacy data),
 * a warning is logged but access is NOT blocked. This prevents breaking existing workflows
 * while surfacing patients that need consent collection.
 *
 * If consent records exist but required ones are missing or revoked, access is denied (403).
 * If consent verification fails due to a system error, access is denied (fail-closed).
 */

import type { Request, Response, NextFunction } from 'express';
import { storage } from '../storage';
import logger from '../services/logger';

const REQUIRED_CONSENT_TYPES = ['treatment', 'hipaa_release'];

/**
 * Extract patient ID from various request locations.
 * Returns undefined if no patient context is found.
 */
function extractPatientId(req: any): number | undefined {
  // Check route params first (most common for patient-specific routes)
  const paramId = req.params?.id || req.params?.patientId;
  if (paramId) {
    const parsed = parseInt(paramId, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  // Check request body
  const bodyId = req.body?.patientId;
  if (bodyId) {
    const parsed = typeof bodyId === 'number' ? bodyId : parseInt(bodyId, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  return undefined;
}

/**
 * Middleware that enforces patient consent before allowing PHI access.
 *
 * Apply AFTER authentication middleware on patient-specific PHI routes.
 * Skips the check if no patient ID is present in the request.
 */
export function requirePatientConsent(req: Request, res: Response, next: NextFunction) {
  const patientId = extractPatientId(req);

  // No patient context — skip consent check (e.g., list endpoints)
  if (!patientId) {
    return next();
  }

  // Run the async consent check
  checkConsent(patientId, req, res, next);
}

async function checkConsent(patientId: number, req: Request, res: Response, next: NextFunction) {
  try {
    // First, check if the patient has ANY consent records at all
    const allConsents = await storage.getPatientConsents(patientId);

    if (allConsents.length === 0) {
      // Legacy patient with no consent records — warn but allow access
      logger.warn('HIPAA: Patient has no consent records (legacy data) — allowing access with warning', {
        patientId,
        route: req.originalUrl,
        method: req.method,
        userId: (req as any).user?.claims?.sub,
        timestamp: new Date().toISOString(),
      });
      return next();
    }

    // Patient has consent records — enforce required consents
    const consentStatus = await storage.hasRequiredTreatmentConsents(patientId);

    if (!consentStatus.hasConsent) {
      logger.warn('HIPAA: PHI access denied — missing required consents', {
        patientId,
        missingConsents: consentStatus.missingConsents,
        route: req.originalUrl,
        method: req.method,
        userId: (req as any).user?.claims?.sub,
        timestamp: new Date().toISOString(),
      });

      return res.status(403).json({
        error: {
          code: 'CONSENT_REQUIRED',
          message: 'Patient has not provided required consents for this operation.',
          missingConsents: consentStatus.missingConsents,
        },
      });
    }

    // All required consents are active
    next();
  } catch (error) {
    // SECURITY: Fail-closed — deny access when consent cannot be verified
    logger.error('HIPAA: Consent verification failed — ACCESS DENIED (fail-closed)', {
      patientId,
      route: req.originalUrl,
      method: req.method,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });

    return res.status(403).json({
      error: {
        code: 'CONSENT_REQUIRED',
        message: 'Patient has not provided required consents for this operation.',
      },
    });
  }
}
