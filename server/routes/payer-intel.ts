/**
 * Payer-intel routes — Stedi-backed transactions that replace common
 * payer phone calls. Currently:
 *
 *   POST /api/payer-intel/cob         Coordination of Benefits Check
 *   POST /api/payer-intel/discovery   Insurance Discovery (scaffold)
 *
 * Both endpoints are scoped to the user's practice and look up the
 * patient + insurance there before calling Stedi.
 */

import { Router, type Response } from 'express';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import logger from '../services/logger';
import { getStediApiKeyForPractice, isStediConfigured } from '../services/stediService';
import { StediAdapter } from '../payer-integrations/adapters/payers/StediAdapter';

const router = Router();

const getPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  if (!userPracticeId) throw new Error('User not assigned to a practice. Contact administrator.');
  return userPracticeId;
};

// ------------------------------------------------------------
// Coordination of Benefits Check
// ------------------------------------------------------------
router.post('/cob', isAuthenticated, async (req: any, res: Response) => {
  try {
    if (!isStediConfigured()) {
      return res.status(503).json({ message: 'Stedi is not configured for this environment.' });
    }
    const practiceId = getPracticeId(req);
    const { patientId } = req.body as { patientId?: number };
    if (!patientId) return res.status(400).json({ message: 'patientId is required' });

    const patient = await storage.getPatient(patientId);
    if (!patient || patient.practiceId !== practiceId) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    const practice = await storage.getPractice(practiceId);
    if (!practice) return res.status(404).json({ message: 'Practice not found' });

    if (!patient.firstName || !patient.lastName || !patient.dateOfBirth || !patient.insuranceId) {
      return res.status(400).json({
        message: 'Patient is missing required fields (name, DOB, insurance member ID).',
      });
    }

    const { apiKey } = await getStediApiKeyForPractice(practiceId);
    const adapter = new StediAdapter(apiKey);

    const dob = typeof patient.dateOfBirth === 'string'
      ? patient.dateOfBirth
      : new Date(patient.dateOfBirth).toISOString().split('T')[0];

    const result = await adapter.checkCoordinationOfBenefits({
      providerNpi: practice.npi || '',
      providerName: practice.name,
      memberFirstName: patient.firstName,
      memberLastName: patient.lastName,
      memberDob: dob,
      memberId: patient.insuranceId,
      payerName: patient.insuranceProvider || '',
    });

    res.json(result);
  } catch (error: any) {
    logger.error('COB check failed', { error: error?.message });
    res.status(500).json({ message: error?.message || 'COB check failed' });
  }
});

// ------------------------------------------------------------
// Insurance Discovery (scaffold — disabled until prod Stedi key)
// ------------------------------------------------------------
router.post('/discovery', isAuthenticated, async (req: any, res: Response) => {
  try {
    if (process.env.STEDI_DISCOVERY_ENABLED !== 'true') {
      return res.status(501).json({
        message: 'Insurance Discovery is not yet enabled for this environment.',
        hint: 'Requires a Stedi production API key with Discovery API access.',
      });
    }
    // Real implementation will follow once enrollment lands.
    return res.status(501).json({ message: 'Not implemented' });
  } catch (error: any) {
    logger.error('Discovery check failed', { error: error?.message });
    res.status(500).json({ message: error?.message || 'Discovery failed' });
  }
});

export default router;
