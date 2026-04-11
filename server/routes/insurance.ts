/**
 * Insurance Routes
 *
 * Handles:
 * - /api/insurances - List all insurances
 * - /api/insurance-rates/* - Fee schedules CRUD
 * - /api/insurance/eligibility - Check eligibility
 * - /api/eligibility-alerts/* - Eligibility alerts CRUD
 * - /api/eligibility/batch-verify - Batch eligibility verification
 * - /api/patients/:patientId/plan-documents/* - Plan document upload/parse
 * - /api/patients/:patientId/plan-benefits/* - Plan benefits CRUD
 * - /api/patients/:patientId/oon-predict - Patient-specific OON prediction
 * - /api/test-plan-parser - Dev test endpoint
 * - /api/reimbursement/* - Reimbursement optimization
 * - /api/cost-estimate - Patient cost estimation
 * - /api/patient-consents - Consent CRUD
 */

import { Router, type Response, type NextFunction } from 'express';
import multer from 'multer';
// pdf-parse imported dynamically to avoid pdfjs-dist DOMMatrix crash at startup in Node.js
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import { StediAdapter } from '../payer-integrations/adapters/payers/StediAdapter';
import { parsePlanDocument, parsePlanDocumentFromPDF, benefitsToInsertFormat } from '../services/planDocumentParser';
import { parseInsuranceContract, saveContractRates } from '../services/insuranceCostEstimator';
import { estimatePatientCost, getQuickEstimate } from '../services/insuranceCostEstimator';
import { predictOONReimbursement, type OONPredictionInput } from '../services/oonReimbursementPredictor';
import { uploadLimiter } from '../middleware/rate-limiter';
import { createFileValidator, FileValidationContexts } from '../middleware/file-validator';
import { cache, CacheKeys, CacheTTL } from '../services/cacheService';

const router = Router();

// Middleware to check if user has admin or billing role
const isAdminOrBilling = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || (user.role !== 'admin' && user.role !== 'billing')) {
      return res.status(403).json({ message: "Access denied. Admin or billing role required." });
    }
    next();
  } catch (error) {
    logger.error("Error checking user role", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to verify permissions" });
  }
};

const isAdmin = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: "Access denied. Admin role required." });
    }
    next();
  } catch (error) {
    logger.error("Error checking user role", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to verify permissions" });
  }
};

// Helper to get authorized practiceId
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
  if (userRole === 'admin') return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) throw new Error('User not assigned to a practice. Contact administrator.');
  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    logger.warn(`Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`);
    return userPracticeId;
  }
  return requestedPracticeId || userPracticeId;
};

// Generate mock eligibility data for testing
function generateMockEligibility(patient: any, insurance: any) {
  const patientSeed = patient?.id || 1;
  const consistentRandom = (patientSeed * 9301 + 49297) % 233280 / 233280;

  let status: 'active' | 'inactive' | 'unknown';
  if (consistentRandom < 0.95) {
    status = 'active';
  } else if (consistentRandom < 0.98) {
    status = 'inactive';
  } else {
    status = 'unknown';
  }

  if (status !== 'active') {
    return {
      status,
      coverageType: null,
      effectiveDate: null,
      terminationDate: status === 'inactive' ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null,
      copay: null, deductible: null, deductibleMet: null,
      outOfPocketMax: null, outOfPocketMet: null, coinsurance: null,
      visitsAllowed: null, visitsUsed: null, authRequired: null,
      message: status === 'inactive' ? 'Coverage terminated' : 'Unable to verify eligibility',
    };
  }

  const coverageTypes = ['PPO', 'HMO', 'POS', 'EPO'];
  const copayOptions = [20, 25, 30, 35, 40, 50];
  const deductibleOptions = [500, 1000, 1500, 2000, 2500, 3000];
  const outOfPocketOptions = [3000, 4000, 5000, 6000, 7500, 8000];
  const visitLimits = [30, 40, 50, 60];

  const coverageType = coverageTypes[Math.floor(Math.random() * coverageTypes.length)];
  const copay = copayOptions[Math.floor(Math.random() * copayOptions.length)];
  const deductible = deductibleOptions[Math.floor(Math.random() * deductibleOptions.length)];
  const deductibleMet = Math.round(deductible * Math.random() * 100) / 100;
  const outOfPocketMax = outOfPocketOptions[Math.floor(Math.random() * outOfPocketOptions.length)];
  const outOfPocketMet = Math.round(outOfPocketMax * Math.random() * 0.5 * 100) / 100;
  const coinsurance = [10, 20, 30][Math.floor(Math.random() * 3)];
  const visitsAllowed = visitLimits[Math.floor(Math.random() * visitLimits.length)];
  const visitsUsed = Math.floor(Math.random() * visitsAllowed * 0.6);
  const authRequired = Math.random() < 0.3;

  const effectiveDate = new Date(Date.now() - (365 + Math.random() * 365) * 24 * 60 * 60 * 1000);
  const currentYear = new Date().getFullYear();
  const terminationDate = new Date(currentYear + (Math.random() < 0.5 ? 0 : 1), 11, 31);

  return {
    status, coverageType,
    effectiveDate: effectiveDate.toISOString().split('T')[0],
    terminationDate: terminationDate.toISOString().split('T')[0],
    copay, deductible, deductibleMet, outOfPocketMax, outOfPocketMet,
    coinsurance, visitsAllowed, visitsUsed, authRequired,
    message: 'Coverage verified successfully',
  };
}

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'text/plain', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, TXT, DOC, DOCX allowed.'));
    }
  }
});

const planDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and images are allowed.'));
    }
  }
});

// ==================== INSURANCES ====================

router.get('/insurances', isAuthenticated, async (req: any, res) => {
  try {
    const insurances = await cache.wrap(
      CacheKeys.payers(),
      CacheTTL.CODE_LOOKUPS,
      () => storage.getInsurances()
    );
    res.json(insurances);
  } catch (error) {
    logger.error('Error fetching insurances', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch insurances' });
  }
});

// ==================== INSURANCE RATES / FEE SCHEDULES ====================

router.get('/insurance-rates', isAuthenticated, async (req: any, res) => {
  try {
    const { provider } = req.query;
    const rates = await storage.getInsuranceRates(provider);
    res.json(rates);
  } catch (error) {
    logger.error('Error fetching insurance rates', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch insurance rates' });
  }
});

router.get('/insurance-rates/providers', isAuthenticated, async (req: any, res) => {
  try {
    const providers = await storage.getUniqueInsuranceProviders();
    res.json(providers);
  } catch (error) {
    logger.error('Error fetching providers', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch providers' });
  }
});

router.post('/insurance-rates', isAuthenticated, async (req: any, res) => {
  try {
    const rate = await storage.upsertInsuranceRate(req.body);
    res.json(rate);
  } catch (error) {
    logger.error('Error saving insurance rate', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to save insurance rate' });
  }
});

router.delete('/insurance-rates/:id', isAuthenticated, async (req: any, res) => {
  try {
    await storage.deleteInsuranceRate(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting insurance rate', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to delete insurance rate' });
  }
});

router.post('/insurance-rates/extract-text', uploadLimiter, isAuthenticated, upload.single('file'), createFileValidator(FileValidationContexts.INSURANCE_CONTRACT), async (req: any, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    let text = '';
    const mimeType = req.file.mimetype;

    if (mimeType === 'application/pdf') {
      const pdfParse = await import('pdf-parse');
      const pdfData = await (pdfParse as any).default(req.file.buffer);
      text = pdfData.text;
    } else if (mimeType === 'text/plain') {
      text = req.file.buffer.toString('utf-8');
    } else if (mimeType === 'application/msword' ||
               mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      text = req.file.buffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
    }

    text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

    if (!text || text.length < 50) {
      return res.status(400).json({
        message: 'Could not extract sufficient text from the file. Try pasting the text directly.'
      });
    }

    res.json({ text, filename: req.file.originalname, size: req.file.size, type: mimeType });
  } catch (error) {
    logger.error('Error extracting text from file', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to extract text from file' });
  }
});

router.post('/insurance-rates/parse-contract', isAuthenticated, async (req: any, res) => {
  try {
    const { contractText, insuranceProvider } = req.body;
    if (!contractText || !insuranceProvider) {
      return res.status(400).json({ message: 'Contract text and insurance provider are required' });
    }
    const parseResult = await parseInsuranceContract(contractText, insuranceProvider);
    res.json(parseResult);
  } catch (error) {
    logger.error('Error parsing contract', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to parse contract' });
  }
});

router.post('/insurance-rates/save-parsed', isAuthenticated, async (req: any, res) => {
  try {
    const result = await saveContractRates(req.body);
    res.json(result);
  } catch (error) {
    logger.error('Error saving parsed rates', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to save parsed rates' });
  }
});

// ==================== REIMBURSEMENT OPTIMIZATION ====================

router.get('/reimbursement/payer-summary/:provider', isAuthenticated, async (req: any, res) => {
  try {
    const { getPayerRatesSummary } = await import('../services/reimbursementOptimizer');
    const summary = await getPayerRatesSummary(req.params.provider);
    res.json(summary);
  } catch (error) {
    logger.error('Error getting payer summary', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to get payer summary' });
  }
});

router.get('/reimbursement/optimal-code', isAuthenticated, async (req: any, res) => {
  try {
    const { interventionCategory, insuranceProvider } = req.query;
    if (!interventionCategory || !insuranceProvider) {
      return res.status(400).json({ message: 'interventionCategory and insuranceProvider are required' });
    }
    const { getOptimalCodeForIntervention } = await import('../services/reimbursementOptimizer');
    const result = await getOptimalCodeForIntervention(interventionCategory as string, insuranceProvider as string);
    res.json(result);
  } catch (error) {
    logger.error('Error getting optimal code', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to get optimal code' });
  }
});

router.post('/reimbursement/optimize-session', isAuthenticated, async (req: any, res) => {
  try {
    const { sessionDurationMinutes, interventions, insuranceProvider } = req.body;
    if (!sessionDurationMinutes || !interventions || !insuranceProvider) {
      return res.status(400).json({
        message: 'sessionDurationMinutes, interventions, and insuranceProvider are required'
      });
    }
    const { optimizeSessionCodes } = await import('../services/reimbursementOptimizer');
    const result = await optimizeSessionCodes(sessionDurationMinutes, interventions, insuranceProvider);
    res.json(result);
  } catch (error) {
    logger.error('Error optimizing session codes', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to optimize session codes' });
  }
});

router.post('/reimbursement/analyze-fee-schedule', isAuthenticated, async (req: any, res) => {
  try {
    const { feeScheduleData, insuranceProvider } = req.body;
    if (!feeScheduleData || !insuranceProvider) {
      return res.status(400).json({ message: 'feeScheduleData and insuranceProvider are required' });
    }
    const { analyzeFeeSchedule } = await import('../services/reimbursementOptimizer');
    const result = await analyzeFeeSchedule(feeScheduleData, insuranceProvider);
    res.json(result);
  } catch (error) {
    logger.error('Error analyzing fee schedule', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to analyze fee schedule' });
  }
});

router.get('/reimbursement/intervention-categories', isAuthenticated, async (req: any, res) => {
  try {
    const { OT_INTERVENTION_CATEGORIES, PAYERS_REQUIRING_DIFFERENT_CODES } = await import('../services/reimbursementOptimizer');
    res.json({
      categories: OT_INTERVENTION_CATEGORIES,
      payersRequiringDifferentCodes: PAYERS_REQUIRING_DIFFERENT_CODES
    });
  } catch (error) {
    logger.error('Error getting intervention categories', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to get intervention categories' });
  }
});

// ==================== ELIGIBILITY VERIFICATION ====================

router.post('/insurance/eligibility', isAuthenticated, async (req: any, res) => {
  try {
    const { patientId, insuranceId } = req.body;

    if (!patientId) {
      return res.status(400).json({ message: 'Patient ID is required' });
    }

    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    let insurance = null;
    if (insuranceId) {
      const insurances = await storage.getInsurances();
      insurance = insurances.find((i: any) => i.id === insuranceId);
    }

    const { getStediApiKeyForPractice } = await import('../services/stediService');
    const stediKeyInfo = await getStediApiKeyForPractice(getAuthorizedPracticeId(req)).catch(() => null);
    const stediApiKey = stediKeyInfo?.apiKey || process.env.STEDI_API_KEY;
    const hasRealApi = !!stediApiKey || (insurance?.eligibilityApiConfig &&
                       Object.keys(insurance.eligibilityApiConfig as object).length > 0);

    let eligibilityResult;

    if (hasRealApi && stediApiKey) {
      try {
        if (!patient.practiceId) {
          throw new Error('Patient has no assigned practice');
        }
        const practice = await storage.getPractice(patient.practiceId);
        const adapter = new StediAdapter(stediApiKey);

        const result = await adapter.checkEligibility({
          providerNpi: practice?.npi || '1234567890',
          providerName: practice?.name || 'Practice',
          memberFirstName: patient.firstName,
          memberLastName: patient.lastName,
          memberDob: patient.dateOfBirth || '',
          memberId: patient.insuranceId || '',
          groupNumber: patient.groupNumber || undefined,
          payerName: insurance?.name || 'Unknown',
        });

        eligibilityResult = {
          status: result.eligibility.isEligible ? 'active' : 'inactive',
          coverageType: result.eligibility.planType || 'Commercial',
          effectiveDate: result.eligibility.effectiveDate,
          terminationDate: result.eligibility.terminationDate,
          copay: result.benefits.copay,
          deductible: result.benefits.deductible?.individual,
          deductibleMet: result.benefits.deductible?.individualMet,
          outOfPocketMax: result.benefits.outOfPocketMax?.individual,
          outOfPocketMet: result.benefits.outOfPocketMax?.individualMet,
          coinsurance: result.benefits.coinsurance,
          visitsAllowed: result.benefits.visitsAllowed,
          visitsUsed: result.benefits.visitsUsed,
          authRequired: result.benefits.priorAuthRequired,
          planName: result.eligibility.planName,
          groupNumber: result.eligibility.groupNumber,
          source: 'stedi',
          raw: result.raw,
        };
      } catch (stediError: any) {
        logger.error('Stedi eligibility check failed, falling back to mock', { error: stediError.message });
        eligibilityResult = generateMockEligibility(patient, insurance);
        (eligibilityResult as any).source = 'mock_fallback';
        (eligibilityResult as any).stediError = stediError.message;
      }
    } else {
      eligibilityResult = generateMockEligibility(patient, insurance);
      (eligibilityResult as any).source = 'mock';
    }

    const savedCheck = await storage.createEligibilityCheck({
      patientId,
      insuranceId: insuranceId || null,
      status: eligibilityResult.status,
      coverageType: eligibilityResult.coverageType,
      effectiveDate: eligibilityResult.effectiveDate,
      terminationDate: eligibilityResult.terminationDate,
      copay: eligibilityResult.copay?.toString(),
      deductible: eligibilityResult.deductible?.toString(),
      deductibleMet: eligibilityResult.deductibleMet?.toString(),
      outOfPocketMax: eligibilityResult.outOfPocketMax?.toString(),
      outOfPocketMet: eligibilityResult.outOfPocketMet?.toString(),
      coinsurance: eligibilityResult.coinsurance,
      visitsAllowed: eligibilityResult.visitsAllowed,
      visitsUsed: eligibilityResult.visitsUsed,
      authRequired: eligibilityResult.authRequired,
      rawResponse: eligibilityResult,
    });

    res.json({
      success: true,
      eligibility: savedCheck,
      patient: {
        id: patient.id,
        name: `${patient.firstName} ${patient.lastName}`,
        memberId: patient.insuranceId,
        groupNumber: patient.groupNumber,
      },
      insurance: insurance ? { id: insurance.id, name: insurance.name } : null,
    });
  } catch (error: any) {
    logger.error('Error checking eligibility', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to check eligibility' });
  }
});

// ==================== ELIGIBILITY ALERTS ====================

router.get('/eligibility-alerts', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      status: req.query.status as string | undefined,
      severity: req.query.severity as string | undefined,
      alertType: req.query.alertType as string | undefined,
      patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
    };
    const alerts = await storage.getEligibilityAlerts(practiceId, filters);
    res.json(alerts);
  } catch (error) {
    logger.error('Error fetching eligibility alerts', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch eligibility alerts' });
  }
});

router.get('/eligibility-alerts/stats', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const stats = await storage.getEligibilityAlertStats(practiceId);
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching eligibility alert stats', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch eligibility alert stats' });
  }
});

router.get('/eligibility-alerts/:id', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const alert = await storage.getEligibilityAlert(id);
    if (!alert) return res.status(404).json({ message: 'Alert not found' });
    res.json(alert);
  } catch (error) {
    logger.error('Error fetching eligibility alert', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch eligibility alert' });
  }
});

router.post('/eligibility-alerts', isAuthenticated, async (req: any, res) => {
  try {
    const alert = await storage.createEligibilityAlert(req.body);
    res.status(201).json(alert);
  } catch (error) {
    logger.error('Error creating eligibility alert', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create eligibility alert' });
  }
});

router.patch('/eligibility-alerts/:id', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const alert = await storage.updateEligibilityAlert(id, req.body);
    if (!alert) return res.status(404).json({ message: 'Alert not found' });
    res.json(alert);
  } catch (error) {
    logger.error('Error updating eligibility alert', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update eligibility alert' });
  }
});

router.post('/eligibility-alerts/:id/acknowledge', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user?.id || 'system';
    const alert = await storage.acknowledgeEligibilityAlert(id, userId);
    if (!alert) return res.status(404).json({ message: 'Alert not found' });
    res.json(alert);
  } catch (error) {
    logger.error('Error acknowledging eligibility alert', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to acknowledge eligibility alert' });
  }
});

router.post('/eligibility-alerts/:id/resolve', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user?.id || 'system';
    const { notes } = req.body;
    const alert = await storage.resolveEligibilityAlert(id, userId, notes);
    if (!alert) return res.status(404).json({ message: 'Alert not found' });
    res.json(alert);
  } catch (error) {
    logger.error('Error resolving eligibility alert', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to resolve eligibility alert' });
  }
});

router.post('/eligibility-alerts/:id/dismiss', isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user?.id || 'system';
    const { notes } = req.body;
    const alert = await storage.dismissEligibilityAlert(id, userId, notes);
    if (!alert) return res.status(404).json({ message: 'Alert not found' });
    res.json(alert);
  } catch (error) {
    logger.error('Error dismissing eligibility alert', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to dismiss eligibility alert' });
  }
});

// Batch eligibility verification for upcoming appointments
router.post('/eligibility/batch-verify', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const hoursAhead = parseInt(req.body.hoursAhead) || 24;

    const appointmentsToCheck = await storage.getAppointmentsNeedingEligibilityCheck(practiceId, hoursAhead);
    const results = [];
    const alertsToCreate = [];
    const allInsurances = await storage.getInsurances();

    for (const appointment of appointmentsToCheck) {
      if (!appointment.patientId) continue;

      const patient = await storage.getPatient(appointment.patientId);
      if (!patient?.insuranceId && !patient?.insuranceProvider) continue;

      const insurance = patient.insuranceProvider
        ? allInsurances.find((i: any) => i.name.toLowerCase() === patient.insuranceProvider?.toLowerCase())
        : null;

      const eligibilityResult = generateMockEligibility(patient, insurance);

      const savedCheck = await storage.createEligibilityCheck({
        patientId: patient.id,
        insuranceId: insurance?.id || null,
        status: eligibilityResult.status,
        coverageType: eligibilityResult.coverageType,
        effectiveDate: eligibilityResult.effectiveDate,
        terminationDate: eligibilityResult.terminationDate,
        copay: eligibilityResult.copay?.toString(),
        deductible: eligibilityResult.deductible?.toString(),
        deductibleMet: eligibilityResult.deductibleMet?.toString(),
        outOfPocketMax: eligibilityResult.outOfPocketMax?.toString(),
        outOfPocketMet: eligibilityResult.outOfPocketMet?.toString(),
        coinsurance: eligibilityResult.coinsurance,
        visitsAllowed: eligibilityResult.visitsAllowed,
        visitsUsed: eligibilityResult.visitsUsed,
        authRequired: eligibilityResult.authRequired,
        rawResponse: eligibilityResult,
      });

      if (eligibilityResult.status === 'inactive') {
        alertsToCreate.push({
          patientId: patient.id, practiceId,
          appointmentId: appointment.id,
          alertType: 'coverage_inactive', severity: 'critical',
          title: 'Coverage Inactive',
          message: `${patient.firstName} ${patient.lastName}'s insurance coverage is inactive. Appointment on ${new Date(appointment.startTime).toLocaleDateString()}.`,
          currentStatus: eligibilityResult,
        });
      } else if (eligibilityResult.authRequired) {
        alertsToCreate.push({
          patientId: patient.id, practiceId,
          appointmentId: appointment.id,
          alertType: 'auth_required', severity: 'warning',
          title: 'Authorization Required',
          message: `Prior authorization may be required for ${patient.firstName} ${patient.lastName}'s appointment on ${new Date(appointment.startTime).toLocaleDateString()}.`,
          currentStatus: eligibilityResult,
        });
      } else if (eligibilityResult.deductibleMet === 0) {
        alertsToCreate.push({
          patientId: patient.id, practiceId,
          appointmentId: appointment.id,
          alertType: 'deductible_not_met', severity: 'info',
          title: 'Deductible Not Met',
          message: `${patient.firstName} ${patient.lastName} has not met their deductible ($${eligibilityResult.deductible}). Patient responsibility may be higher.`,
          currentStatus: eligibilityResult,
        });
      } else if (eligibilityResult.copay && eligibilityResult.copay >= 50) {
        alertsToCreate.push({
          patientId: patient.id, practiceId,
          appointmentId: appointment.id,
          alertType: 'high_copay', severity: 'info',
          title: 'High Copay',
          message: `${patient.firstName} ${patient.lastName} has a $${eligibilityResult.copay} copay for this visit.`,
          currentStatus: eligibilityResult,
        });
      }

      results.push({
        appointmentId: appointment.id, patientId: patient.id,
        patientName: `${patient.firstName} ${patient.lastName}`,
        eligibility: savedCheck, status: eligibilityResult.status,
      });
    }

    if (alertsToCreate.length > 0) {
      await storage.createEligibilityAlertsBatch(alertsToCreate);
    }

    res.json({ verified: results.length, alertsCreated: alertsToCreate.length, results });
  } catch (error) {
    logger.error('Error in batch eligibility verification', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to perform batch eligibility verification' });
  }
});

// ==================== PLAN DOCUMENTS & BENEFITS ====================

router.post('/test-plan-parser', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    const { documentText } = req.body;
    if (!documentText) return res.status(400).json({ error: 'documentText required' });
    const result = await parsePlanDocument(documentText, 'sbc');
    res.json(result);
  } catch (error) {
    logger.error('Test parser error', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Parser test failed' });
  }
});

router.post('/patients/:patientId/plan-documents/public', uploadLimiter, planDocUpload.single('document'), createFileValidator(FileValidationContexts.PLAN_DOCUMENT), async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.patientId);
    const portalToken = req.headers['x-portal-token'] || req.body.portalToken;

    if (!portalToken) return res.status(401).json({ error: 'Portal token required' });

    const patient = await storage.getPatient(patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const portalAccess = await storage.getPatientPortalByToken(portalToken);
    if (!portalAccess || portalAccess.patientId !== patientId) {
      logger.warn('Invalid portal token for plan document upload', {
        patientId,
        providedToken: typeof portalToken === 'string' ? portalToken.substring(0, 8) + '...' : 'invalid',
      });
      return res.status(403).json({ error: 'Invalid portal token' });
    }

    if (new Date(portalAccess.portalTokenExpiresAt) < new Date()) {
      return res.status(403).json({ error: 'Portal token expired' });
    }

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { documentType = 'sbc', consentGiven = 'false' } = req.body;
    if (consentGiven !== 'true') {
      return res.status(400).json({ error: 'Patient consent is required to process document' });
    }

    const document = await storage.createPlanDocument({
      patientId, practiceId: patient.practiceId, documentType,
      fileName: req.file.originalname, fileUrl: 'patient-upload',
      fileSize: req.file.size, mimeType: req.file.mimetype,
      status: 'processing', patientConsentGiven: true,
      consentDate: new Date(), consentMethod: 'portal',
      uploadedBy: null
    });

    let parseResult;
    if (req.file.mimetype === 'application/pdf') {
      const base64Content = req.file.buffer.toString('base64');
      parseResult = await parsePlanDocumentFromPDF(base64Content, documentType as any);
    } else {
      parseResult = { success: false, error: 'Image documents require manual review', documentType, processingTimeMs: 0 };
    }

    if (parseResult.success && parseResult.benefits) {
      await storage.deactivatePlanBenefits(patientId);
      const benefitsData = benefitsToInsertFormat(parseResult.benefits, patientId, patient.practiceId, document.id);
      await storage.createPlanBenefits(benefitsData as any);
      await storage.updatePlanDocument(document.id, { status: 'completed', parsedAt: new Date() });
      res.json({ success: true, message: 'Document uploaded and benefits extracted successfully', documentId: document.id, extractionConfidence: parseResult.benefits.extractionConfidence });
    } else {
      await storage.updatePlanDocument(document.id, { status: 'pending', parseError: parseResult.error || 'Needs manual review' });
      res.json({ success: true, message: 'Document uploaded. Benefits will be reviewed by staff.', documentId: document.id, needsReview: true });
    }
  } catch (error) {
    logger.error('Error in public document upload', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to process document' });
  }
});

router.post('/patients/:patientId/plan-documents', uploadLimiter, isAuthenticated, planDocUpload.single('document'), createFileValidator(FileValidationContexts.PLAN_DOCUMENT), async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    const user = await storage.getUser(userId);
    const patientId = parseInt(req.params.patientId);

    if (!user?.practiceId) return res.status(400).json({ error: 'User not associated with a practice' });
    if (!['admin', 'billing', 'therapist'].includes(user.role || '')) {
      return res.status(403).json({ error: 'Staff members can upload plan documents' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { documentType = 'sbc', consentGiven = 'false' } = req.body;

    const document = await storage.createPlanDocument({
      patientId, practiceId: user.practiceId, documentType,
      fileName: req.file.originalname, fileUrl: 'processing',
      fileSize: req.file.size, mimeType: req.file.mimetype,
      status: 'processing', patientConsentGiven: consentGiven === 'true',
      consentDate: consentGiven === 'true' ? new Date() : null,
      consentMethod: 'portal', uploadedBy: userId
    });

    let parseResult;
    if (req.file.mimetype === 'application/pdf') {
      const base64Content = req.file.buffer.toString('base64');
      parseResult = await parsePlanDocumentFromPDF(base64Content, documentType as any);
    } else {
      const textContent = `Image document: ${req.file.originalname}`;
      parseResult = await parsePlanDocument(textContent, documentType as any);
    }

    if (parseResult.success && parseResult.benefits) {
      await storage.deactivatePlanBenefits(patientId);
      const benefitsData = benefitsToInsertFormat(parseResult.benefits, patientId, user.practiceId, document.id);
      const benefits = await storage.createPlanBenefits(benefitsData as any);
      await storage.updatePlanDocument(document.id, { status: 'completed', parsedAt: new Date() });
      res.json({ success: true, document, benefits, parseResult: { extractionConfidence: parseResult.benefits.extractionConfidence, processingTimeMs: parseResult.processingTimeMs } });
    } else {
      await storage.updatePlanDocument(document.id, { status: 'failed', parseError: parseResult.error });
      res.status(422).json({ success: false, error: parseResult.error || 'Failed to parse document', document });
    }
  } catch (error) {
    logger.error('Error uploading plan document', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to upload and parse document' });
  }
});

router.get('/patients/:patientId/plan-documents', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    const user = await storage.getUser(userId);
    const patientId = parseInt(req.params.patientId);
    if (!user?.practiceId) return res.status(400).json({ error: 'User not associated with a practice' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can view plan documents' });
    const documents = await storage.getPlanDocuments(patientId);
    res.json({ success: true, documents });
  } catch (error) {
    logger.error('Error fetching plan documents', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to fetch plan documents' });
  }
});

router.get('/patients/:patientId/plan-benefits', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    const user = await storage.getUser(userId);
    const patientId = parseInt(req.params.patientId);
    if (!user?.practiceId) return res.status(400).json({ error: 'User not associated with a practice' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can view plan benefits' });
    const benefits = await storage.getPatientPlanBenefits(patientId);
    if (!benefits) {
      return res.json({ success: true, benefits: null, message: 'No plan benefits found. Upload a plan document to extract benefits.' });
    }
    res.json({ success: true, benefits });
  } catch (error) {
    logger.error('Error fetching plan benefits', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to fetch plan benefits' });
  }
});

router.post('/patients/:patientId/plan-benefits/:benefitsId/verify', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    const user = await storage.getUser(userId);
    const benefitsId = parseInt(req.params.benefitsId);
    if (!user?.practiceId) return res.status(400).json({ error: 'User not associated with a practice' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can verify benefits' });
    const verified = await storage.verifyPlanBenefits(benefitsId, userId);
    res.json({ success: true, benefits: verified });
  } catch (error) {
    logger.error('Error verifying plan benefits', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to verify plan benefits' });
  }
});

router.patch('/patients/:patientId/plan-benefits/:benefitsId', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    const user = await storage.getUser(userId);
    const benefitsId = parseInt(req.params.benefitsId);
    if (!user?.practiceId) return res.status(400).json({ error: 'User not associated with a practice' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can update benefits' });
    const updated = await storage.updatePlanBenefits(benefitsId, req.body);
    res.json({ success: true, benefits: updated });
  } catch (error) {
    logger.error('Error updating plan benefits', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to update plan benefits' });
  }
});

router.post('/patients/:patientId/oon-predict', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    const user = await storage.getUser(userId);
    const patientId = parseInt(req.params.patientId);
    if (!user?.practiceId) return res.status(400).json({ error: 'User not associated with a practice' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Only administrators can access OON predictions' });

    const { cptCode, billedAmount } = req.body;
    if (!cptCode || !billedAmount) return res.status(400).json({ error: 'cptCode and billedAmount are required' });

    const benefits = await storage.getPatientPlanBenefits(patientId);
    const patient = await storage.getPatient(patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const predictionInput: OONPredictionInput = {
      cptCode,
      insuranceProvider: benefits?.insuranceProvider || patient.insuranceProvider || 'Unknown',
      zipCode: patient.address?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || '00000',
      billedAmount: parseFloat(billedAmount),
      planType: (benefits?.planType as "unknown" | "PPO" | "HMO" | "POS" | "EPO" | "HDHP" | undefined) || undefined,
      deductibleMet: benefits?.oonDeductibleMet ? parseFloat(benefits.oonDeductibleMet) > 0 : undefined,
      deductibleRemaining: benefits?.oonDeductibleMet && benefits?.oonDeductibleIndividual
        ? parseFloat(benefits.oonDeductibleIndividual) - parseFloat(benefits.oonDeductibleMet)
        : undefined,
      coinsuranceOverride: benefits?.oonCoinsurancePercent ? parseFloat(benefits.oonCoinsurancePercent) : undefined
    };

    const prediction = predictOONReimbursement(predictionInput);

    const enhancedPrediction = {
      ...prediction,
      dataSource: benefits ? 'patient_plan' : 'estimate',
      planBenefits: benefits ? {
        oonDeductible: benefits.oonDeductibleIndividual,
        oonDeductibleMet: benefits.oonDeductibleMet,
        oonCoinsurance: benefits.oonCoinsurancePercent,
        oonOutOfPocketMax: benefits.oonOutOfPocketMax,
        allowedAmountMethod: benefits.allowedAmountMethod,
        allowedAmountPercent: benefits.allowedAmountPercent,
        mentalHealthVisitLimit: benefits.mentalHealthVisitLimit,
        verified: !!benefits.verifiedAt
      } : null
    };

    res.json({ success: true, prediction: enhancedPrediction, hasPatientPlanData: !!benefits, timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Error predicting OON with patient data', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to generate prediction' });
  }
});

// ==================== PATIENT CONSENTS ====================

router.post('/patient-consents', isAuthenticated, async (req: any, res) => {
  try {
    const consent = await storage.createPatientConsent({
      ...req.body,
      signatureDate: new Date(),
      effectiveDate: new Date().toISOString().split('T')[0],
      signatureIpAddress: req.ip || req.connection.remoteAddress,
    });
    res.json(consent);
  } catch (error) {
    logger.error('Error creating consent', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create consent' });
  }
});

router.post('/patient-consents/:id/revoke', isAuthenticated, async (req: any, res) => {
  try {
    const { reason } = req.body;
    const userId = req.user?.claims?.sub || 'unknown';
    const consent = await storage.revokeConsent(parseInt(req.params.id), userId, reason);
    res.json(consent);
  } catch (error) {
    logger.error('Error revoking consent', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to revoke consent' });
  }
});

// ==================== PATIENT COST ESTIMATION ====================

router.post('/cost-estimate', isAuthenticated, async (req: any, res) => {
  try {
    const { patientId, cptCodes, sessionRate } = req.body;
    if (!patientId || !cptCodes || cptCodes.length === 0) {
      return res.status(400).json({ message: 'Patient ID and CPT codes are required' });
    }
    const estimate = await estimatePatientCost(patientId, cptCodes, sessionRate || 300);
    res.json(estimate);
  } catch (error) {
    logger.error('Error estimating cost', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to estimate cost' });
  }
});

router.get('/cost-estimate/quick', isAuthenticated, async (req: any, res) => {
  try {
    const { insurance, duration, sessionRate } = req.query;
    if (!insurance) return res.status(400).json({ message: 'Insurance provider name is required' });
    const estimate = await getQuickEstimate(insurance, parseInt(duration) || 45, parseInt(sessionRate) || 300);
    res.json(estimate);
  } catch (error) {
    logger.error('Error getting quick estimate', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to get estimate' });
  }
});

export default router;
