/**
 * Eligibility Routes
 *
 * Handles batch eligibility verification:
 * - POST /api/eligibility/queue - Queue an eligibility check
 * - POST /api/eligibility/process - Process queued checks for a practice
 * - GET  /api/eligibility/queue/status - Get queue status
 * - GET  /api/eligibility/history/:patientId - Get eligibility history for a patient
 * - GET  /api/eligibility/expiring - Get patients with expiring eligibility
 * - DELETE /api/eligibility/queue - Clear the queue
 */

import { Router, type Response, type NextFunction } from 'express';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import logger from '../services/logger';
import {
  queueEligibilityCheck,
  getQueueStatus,
  processBatchEligibility,
  getEligibilityHistory,
  getExpiringEligibility,
  clearQueue,
} from '../services/batchEligibilityService';
import { checkEligibility, isStediConfigured, PAYER_IDS } from '../services/stediService';

const router = Router();

// Helper to get authorized practiceId
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
  if (userRole === 'admin') return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice. Contact administrator.');
  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    return userPracticeId;
  }
  return requestedPracticeId || userPracticeId;
};

// Queue an eligibility check
router.post('/queue', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { patientId, insuranceId } = req.body;

    if (!patientId || !insuranceId) {
      return res.status(400).json({
        message: 'patientId and insuranceId are required',
      });
    }

    const result = queueEligibilityCheck(
      parseInt(patientId),
      practiceId,
      parseInt(insuranceId)
    );

    res.json({
      success: true,
      queued: result.queued,
      position: result.position,
      message: result.queued
        ? `Eligibility check queued at position ${result.position}`
        : `Already queued at position ${result.position}`,
    });
  } catch (error) {
    logger.error('Error queuing eligibility check', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to queue eligibility check' });
  }
});

// Get queue status for a practice
router.get('/queue/status', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const status = getQueueStatus(practiceId);
    res.json(status);
  } catch (error) {
    logger.error('Error getting queue status', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to get queue status' });
  }
});

// Process all queued eligibility checks for a practice
router.post('/process', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const result = await processBatchEligibility(practiceId);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('already running')) {
      return res.status(409).json({ message: errorMessage });
    }

    logger.error('Error processing batch eligibility', { error: errorMessage });
    res.status(500).json({ message: 'Failed to process batch eligibility' });
  }
});

// Get eligibility check history for a patient
router.get('/history/:patientId', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const patientId = parseInt(req.params.patientId);

    if (isNaN(patientId)) {
      return res.status(400).json({ message: 'Invalid patientId' });
    }

    const history = await getEligibilityHistory(patientId, practiceId);
    res.json(history);
  } catch (error) {
    logger.error('Error getting eligibility history', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to get eligibility history' });
  }
});

// Get patients with expiring eligibility
router.get('/expiring', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const daysAhead = req.query.daysAhead ? parseInt(req.query.daysAhead as string) : 30;

    const expiring = await getExpiringEligibility(practiceId, daysAhead);
    res.json(expiring);
  } catch (error) {
    logger.error('Error getting expiring eligibility', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to get expiring eligibility' });
  }
});

// Clear the queue for a practice
router.delete('/queue', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const cleared = clearQueue(practiceId);
    res.json({
      success: true,
      cleared,
      message: `Cleared ${cleared} items from the queue`,
    });
  } catch (error) {
    logger.error('Error clearing eligibility queue', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to clear queue' });
  }
});

// Batch check all patients with upcoming appointments (next 7 days)
router.post('/batch-check', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);

    if (!isStediConfigured()) {
      return res.status(400).json({
        message: 'Clearinghouse is not configured. Please contact support.',
      });
    }

    const practice = await storage.getPractice(practiceId);

    // Get appointments for the next 7 days
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcomingAppointments = await storage.getAppointmentsByDateRange(
      practiceId,
      now,
      sevenDaysFromNow
    );

    // Get unique patient IDs from non-cancelled appointments
    const patientIds = Array.from(new Set(
      upcomingAppointments
        .filter((a) => a.status !== 'cancelled' && a.patientId)
        .map((a) => a.patientId!)
    ));

    if (patientIds.length === 0) {
      return res.json({
        checked: 0,
        eligible: 0,
        ineligible: 0,
        errors: 0,
        results: [],
        message: 'No upcoming appointments found in the next 7 days.',
      });
    }

    // For each unique patient, check eligibility
    const results: Array<{
      patientId: number;
      patientName: string;
      insurance: string | null;
      status: string;
      eligible: boolean | null;
      planName?: string;
      copay?: unknown;
      deductible?: unknown;
      error?: string;
    }> = [];
    let eligibleCount = 0;
    let ineligibleCount = 0;
    let errorCount = 0;

    for (let i = 0; i < patientIds.length; i++) {
      // Rate limiting: 200ms delay between checks
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      const patientId = patientIds[i];
      try {
        const patient = await storage.getPatient(patientId);
        if (!patient) {
          results.push({
            patientId,
            patientName: 'Unknown',
            insurance: null,
            status: 'error',
            eligible: null,
            error: 'Patient not found',
          });
          errorCount++;
          continue;
        }

        // Skip patients without insurance info
        if (!patient.insuranceProvider && !patient.insuranceId && !patient.policyNumber) {
          results.push({
            patientId,
            patientName: `${patient.firstName} ${patient.lastName}`,
            insurance: null,
            status: 'skipped',
            eligible: null,
            error: 'No insurance information on file',
          });
          errorCount++;
          continue;
        }

        // Resolve payer ID
        const insuranceName = (patient.insuranceProvider || '').toLowerCase();
        const payerId = PAYER_IDS[insuranceName] || patient.insuranceId || '60054';

        const eligResult = await checkEligibility(
          {
            payer: { id: payerId, name: patient.insuranceProvider || 'Unknown' },
            provider: {
              npi: practice?.npi || '',
              organizationName: practice?.name || undefined,
            },
            subscriber: {
              memberId: patient.insuranceId || patient.policyNumber || '',
              firstName: patient.firstName,
              lastName: patient.lastName,
              dateOfBirth: patient.dateOfBirth || '',
            },
            // serviceTypeCodes omitted — resolved from practice.specialty by stediService.checkEligibility
          },
          practiceId
        );

        const isEligible = eligResult.status === 'active';
        if (isEligible) {
          eligibleCount++;
        } else if (eligResult.status === 'inactive') {
          ineligibleCount++;
        } else {
          // unknown status counts as error
          errorCount++;
        }

        // Store result in eligibility_checks table
        try {
          await storage.createEligibilityCheck({
            patientId,
            practiceId,
            eligible: isEligible,
            status: eligResult.status,
            processingStatus: 'completed',
            copay: eligResult.copay?.primary?.toString() || null,
            deductible: eligResult.deductible?.individual?.toString() || null,
            coinsurance: eligResult.coinsurance != null ? Math.round(eligResult.coinsurance) : null,
            rawResponse: eligResult.raw,
            serviceTypeCodes: eligResult.sentServiceTypeCodes ?? null,
            returnedServiceTypeCodes: eligResult.returnedServiceTypeCodes ?? null,
            stcDowngraded: eligResult.stcDowngraded ?? false,
          } as any);
        } catch (storeErr) {
          logger.warn('Failed to store eligibility check result', {
            patientId,
            error: storeErr instanceof Error ? storeErr.message : String(storeErr),
          });
        }

        results.push({
          patientId,
          patientName: `${patient.firstName} ${patient.lastName}`,
          insurance: patient.insuranceProvider || null,
          status: eligResult.status,
          eligible: isEligible,
          planName: eligResult.planName,
          copay: eligResult.copay,
          deductible: eligResult.deductible,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error('Batch eligibility check error for patient', {
          patientId,
          error: errMsg,
        });
        results.push({
          patientId,
          patientName: 'Unknown',
          insurance: null,
          status: 'error',
          eligible: null,
          error: errMsg,
        });
        errorCount++;
      }
    }

    logger.info('Batch eligibility check completed', {
      practiceId,
      checked: patientIds.length,
      eligible: eligibleCount,
      ineligible: ineligibleCount,
      errors: errorCount,
    });

    res.json({
      checked: patientIds.length,
      eligible: eligibleCount,
      ineligible: ineligibleCount,
      errors: errorCount,
      results,
    });
  } catch (error) {
    logger.error('Error in batch eligibility check', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to run batch eligibility check' });
  }
});

export default router;
