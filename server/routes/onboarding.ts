/**
 * Onboarding Routes
 *
 * Handles:
 * - GET /api/onboarding/status - Current onboarding state
 * - PUT /api/onboarding/step - Update current step
 * - POST /api/onboarding/complete - Mark onboarding as complete
 * - GET /api/onboarding/checklist - Setup checklist with completion status
 */

import { Router, type Response } from 'express';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import { db } from '../db';
import { practices, users, patients, claims } from '../../shared/schema';
import { eq, and, count, isNull } from 'drizzle-orm';
import logger from '../services/logger';

const router = Router();

/**
 * Helper to get the practice ID for the authenticated user.
 * Falls back to 1 in demo mode.
 */
function getPracticeId(req: any): number {
  return req.userPracticeId || 1;
}

/**
 * GET /status
 * Returns the current onboarding state for the user's practice.
 */
router.get('/status', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    const practice = await storage.getPractice(practiceId);

    if (!practice) {
      return res.status(404).json({ message: 'Practice not found' });
    }

    return res.json({
      step: practice.onboardingStep ?? 0,
      completed: practice.onboardingCompleted ?? false,
    });
  } catch (error) {
    logger.error('Failed to get onboarding status', { error });
    return res.status(500).json({ message: 'Failed to get onboarding status' });
  }
});

/**
 * PUT /step
 * Update the current onboarding step for the user's practice.
 */
router.put('/step', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    const { step } = req.body;

    if (typeof step !== 'number' || step < 0 || step > 5) {
      return res.status(400).json({ message: 'Step must be a number between 0 and 5' });
    }

    const updated = await storage.updatePractice(practiceId, {
      onboardingStep: step,
    } as any);

    return res.json({
      step: updated.onboardingStep ?? step,
      completed: updated.onboardingCompleted ?? false,
    });
  } catch (error) {
    logger.error('Failed to update onboarding step', { error });
    return res.status(500).json({ message: 'Failed to update onboarding step' });
  }
});

/**
 * POST /complete
 * Mark onboarding as complete for the user's practice.
 */
router.post('/complete', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getPracticeId(req);

    const updated = await storage.updatePractice(practiceId, {
      onboardingCompleted: true,
      onboardingStep: 5,
    } as any);

    return res.json({
      step: updated.onboardingStep ?? 5,
      completed: updated.onboardingCompleted ?? true,
    });
  } catch (error) {
    logger.error('Failed to complete onboarding', { error });
    return res.status(500).json({ message: 'Failed to complete onboarding' });
  }
});

/**
 * GET /checklist
 * Returns a checklist of setup items with completion status.
 */
router.get('/checklist', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    const practice = await storage.getPractice(practiceId);

    if (!practice) {
      return res.status(404).json({ message: 'Practice not found' });
    }

    // Check practice info filled
    const practiceInfoComplete = Boolean(
      practice.name &&
      practice.address &&
      practice.phone &&
      practice.npi &&
      practice.taxId
    );

    // Check if at least one therapist exists (users with role therapist in this practice)
    const [therapistResult] = await db
      .select({ total: count() })
      .from(users)
      .where(
        and(
          eq(users.practiceId, practiceId),
          eq(users.role, 'therapist')
        )
      );
    const hasTherapist = (therapistResult?.total ?? 0) > 0;

    // Check if at least one patient exists
    const [patientResult] = await db
      .select({ total: count() })
      .from(patients)
      .where(
        and(
          eq(patients.practiceId, practiceId),
          isNull(patients.deletedAt)
        )
      );
    const hasPatient = (patientResult?.total ?? 0) > 0;

    // Check if insurance/payer configured (patient with insurance info)
    const hasInsurance = Boolean(practice.npi); // Has NPI means payer-ready; more granular check below
    let hasPatientInsurance = false;
    if (hasPatient) {
      const patientsData = await storage.getPatients(practiceId);
      hasPatientInsurance = patientsData.some(
        (p: any) => p.insuranceProvider || p.insuranceId || p.policyNumber
      );
    }

    // Check if first claim created
    const [claimResult] = await db
      .select({ total: count() })
      .from(claims)
      .where(eq(claims.practiceId, practiceId));
    const hasClaim = (claimResult?.total ?? 0) > 0;

    // Check payment settings (optional) - has Stripe configured
    const hasPaymentSettings = Boolean(practice.stripeCustomerId || practice.stripePaymentMethodId);

    // Check Stedi API key (optional)
    const hasStediKey = Boolean(practice.stediApiKey);

    const checklist = [
      {
        id: 'practice_info',
        label: 'Practice information filled',
        description: 'Name, address, phone, NPI, and tax ID',
        completed: practiceInfoComplete,
        required: true,
      },
      {
        id: 'therapist',
        label: 'At least one therapist added',
        description: 'Add a therapist to your practice',
        completed: hasTherapist,
        required: true,
      },
      {
        id: 'patient',
        label: 'At least one patient added',
        description: 'Add your first patient',
        completed: hasPatient,
        required: true,
      },
      {
        id: 'insurance',
        label: 'Insurance/payer configured',
        description: 'Add insurance information to a patient',
        completed: hasPatientInsurance,
        required: true,
      },
      {
        id: 'claim',
        label: 'First claim created',
        description: 'Create your first insurance claim',
        completed: hasClaim,
        required: true,
      },
      {
        id: 'payment_settings',
        label: 'Payment settings configured',
        description: 'Set up Stripe for patient billing',
        completed: hasPaymentSettings,
        required: false,
      },
      {
        id: 'stedi',
        label: 'Clearinghouse connected',
        description: 'Electronic claim submission is ready',
        completed: hasStediKey,
        required: false,
      },
    ];

    const requiredItems = checklist.filter(item => item.required);
    const completedRequired = requiredItems.filter(item => item.completed).length;
    const totalRequired = requiredItems.length;
    const progress = totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;

    return res.json({
      checklist,
      progress,
      completedRequired,
      totalRequired,
      allRequiredComplete: completedRequired === totalRequired,
    });
  } catch (error) {
    logger.error('Failed to get onboarding checklist', { error });
    return res.status(500).json({ message: 'Failed to get onboarding checklist' });
  }
});

export default router;
