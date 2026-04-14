/**
 * Patient Routes
 *
 * Handles:
 * - /api/patients - Patient CRUD operations
 * - /api/patients/:id/consents - Patient consent management
 * - /api/patients/:id/eligibility - Eligibility verification
 * - /api/patients/:id/cost-estimate - Cost estimation
 * - /api/patients/:id/documents - Patient documents
 * - /api/patients/:id/statements - Patient statements
 * - /api/patients/:id/treatment-plans - Treatment plans
 * - /api/patients/:id/assessments - Patient assessments
 * - /api/patients/:id/referrals - Patient referrals
 * - /api/patients/:id/payment-methods - Payment methods
 * - /api/patients/:id/transactions - Payment transactions
 * - /api/patients/:id/balance - Patient balance
 * - /api/patients/:id/payment-plans - Payment plans
 * - /api/patients/:id/portal-access - Portal access management
 * - /api/patients/:id/insurance-data - Insurance data
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { validate } from '../middleware/validate';
import { requirePatientConsent } from '../middleware/consentCheck';
import { createPatientSchema } from '../validation/schemas';
import { parsePagination, paginatedResponse } from '../utils/pagination';
import logger from '../services/logger';
import { sendEmail } from '../services/emailService';
import { portalWelcome, intakeSubmissionNotification } from '../services/emailTemplates';

const router = Router();

// Helper to get authorized practiceId from request
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) {
    return req.authorizedPracticeId;
  }

  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;

  if (userRole === 'admin') {
    return requestedPracticeId || userPracticeId || 1;
  }

  if (!userPracticeId) {
    throw new Error('User not assigned to a practice. Contact administrator.');
  }

  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    logger.warn(`Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`);
    return userPracticeId;
  }

  return requestedPracticeId || userPracticeId;
};

/**
 * Security: Verify user has access to the specified patient
 * Prevents IDOR attacks by checking patient belongs to user's practice
 */
const verifyPatientAccess = async (req: any, patientId: number): Promise<{
  patient: any | null;
  authorized: boolean;
  error?: string;
}> => {
  try {
    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return { patient: null, authorized: false, error: 'Patient not found' };
    }

    const userPracticeId = req.userPracticeId;
    const userRole = req.userRole;

    if (userRole === 'admin') {
      return { patient, authorized: true };
    }

    if (!userPracticeId) {
      logger.warn('User has no practice assigned', { userId: req.user?.claims?.sub });
      return { patient: null, authorized: false, error: 'User not assigned to a practice' };
    }

    if (patient.practiceId !== userPracticeId) {
      logger.warn('Unauthorized patient access attempt', {
        userId: req.user?.claims?.sub,
        userPracticeId,
        patientPracticeId: patient.practiceId,
        patientId,
      });
      return { patient: null, authorized: false, error: 'Access denied' };
    }

    return { patient, authorized: true };
  } catch (error) {
    logger.error('Error verifying patient access', { patientId, error });
    return { patient: null, authorized: false, error: 'Failed to verify access' };
  }
};

// ==================== PATIENT CRUD ====================

/**
 * @openapi
 * /api/patients:
 *   get:
 *     tags: [Patients]
 *     summary: List all patients
 *     description: Returns a paginated list of patients for the authenticated user's practice. Includes consent status for each patient.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page
 *       - in: query
 *         name: practiceId
 *         schema:
 *           type: integer
 *         description: Practice ID (admin only — non-admins are scoped to their own practice)
 *     responses:
 *       200:
 *         description: Paginated patient list
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginatedResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         allOf:
 *                           - $ref: '#/components/schemas/Patient'
 *                           - type: object
 *                             properties:
 *                               consentStatus:
 *                                 type: object
 *                                 properties:
 *                                   hasRequiredConsents:
 *                                     type: boolean
 *                                   missingConsents:
 *                                     type: array
 *                                     items:
 *                                       type: string
 *       401:
 *         description: Not authenticated
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// Search patients by name, email, or phone
router.get('/search', isAuthenticated, async (req: any, res) => {
  try {
    const query = (req.query.q as string || '').trim();
    if (!query || query.length < 2) {
      return res.json([]);
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const results = await storage.searchPatients(query, limit);
    // Return minimal fields for the search results
    res.json(results.map((p: any) => ({
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email || null,
      phone: p.phone || null,
    })));
  } catch (error) {
    logger.error('Error searching patients', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to search patients' });
  }
});

router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const usePagination = !!(req.query.page || req.query.limit);

    const [patients, total] = await Promise.all([
      storage.getAllPatients(usePagination ? { limit, offset } : undefined),
      usePagination ? storage.countAllPatients() : Promise.resolve(0),
    ]);

    // HIPAA: Include consent status for each patient (batch query, not N+1)
    const patientIds = patients.map((p: any) => p.id);
    const consentStatusMap = await storage.batchGetConsentStatus(patientIds);
    const patientsWithConsent = patients.map((patient: any) => {
      const consentStatus = consentStatusMap.get(patient.id) || {
        hasConsent: false,
        missingConsents: ['hipaa_release', 'treatment'],
      };
      return {
        ...patient,
        consentStatus: {
          hasRequiredConsents: consentStatus.hasConsent,
          missingConsents: consentStatus.missingConsents,
        },
      };
    });

    // Return plain array for backwards compatibility when no pagination params specified
    if (!usePagination) {
      res.json(patientsWithConsent);
    } else {
      res.json(paginatedResponse(patientsWithConsent, total, page, limit));
    }
  } catch (error) {
    logger.error('Error fetching patients', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to fetch patients' });
  }
});

/**
 * @openapi
 * /api/patients:
 *   post:
 *     tags: [Patients]
 *     summary: Create a new patient
 *     description: Creates a patient record for the authenticated user's practice.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InsertPatient'
 *     responses:
 *       200:
 *         description: Created patient
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Patient'
 *       401:
 *         description: Not authenticated
 *       422:
 *         description: Validation error
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/', isAuthenticated, validate(createPatientSchema), async (req: any, res) => {
  try {
    const patient = await storage.createPatient(req.body);

    // Send front desk notification if this is an intake form submission
    if (req.body.intakeCompletedAt || req.body.intakeData) {
      try {
        const practice = await storage.getPractice(patient.practiceId);
        const practiceEmail = practice?.email;
        if (practiceEmail) {
          const intakeData = typeof req.body.intakeData === 'string'
            ? JSON.parse(req.body.intakeData)
            : req.body.intakeData;
          const emailData = intakeSubmissionNotification({
            patientFirstName: patient.firstName,
            patientLastName: patient.lastName,
            patientEmail: patient.email || undefined,
            patientPhone: patient.phone || undefined,
            practiceName: practice.name || 'Your Practice',
            hasInsuranceCard: !!(intakeData?.insuranceCardFront || intakeData?.insuranceCardBack),
            hasInsuranceInfo: !!(patient.insuranceProvider),
            reviewUrl: `${process.env.APP_URL || 'https://app.therapybillai.com'}/patients?id=${patient.id}`,
          });
          sendEmail({
            to: practiceEmail,
            ...emailData,
          }).catch(err => {
            logger.warn('Failed to send intake notification email', { error: err instanceof Error ? err.message : String(err) });
          });
        }
      } catch (emailError) {
        // Don't fail patient creation if email fails
        logger.warn('Error sending intake notification', { error: emailError instanceof Error ? emailError.message : String(emailError) });
      }
    }

    res.json(patient);
  } catch (error) {
    logger.error('Error creating patient', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to create patient' });
  }
});

// ==================== PATIENT CONSENTS ====================

// Get patient consents
router.get('/:id/consents', isAuthenticated, async (req: any, res) => {
  try {
    const consents = await storage.getPatientConsents(parseInt(req.params.id));
    res.json(consents);
  } catch (error) {
    logger.error('Error fetching consents', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch consents' });
  }
});

// Get active consent by type
router.get('/:id/consents/:type', isAuthenticated, async (req: any, res) => {
  try {
    const consent = await storage.getActiveConsent(parseInt(req.params.id), req.params.type);
    res.json(consent || null);
  } catch (error) {
    logger.error('Error fetching consent', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch consent' });
  }
});

// ==================== PATIENT ELIGIBILITY ====================

// Get most recent eligibility for a patient
router.get('/:id/eligibility', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const eligibility = await storage.getPatientEligibility(patientId);
    res.json(eligibility || null);
  } catch (error) {
    logger.error('Error fetching eligibility', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch eligibility' });
  }
});

// Get eligibility history for a patient
router.get('/:id/eligibility/history', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const history = await storage.getEligibilityHistory(patientId);
    res.json(history);
  } catch (error) {
    logger.error('Error fetching eligibility history', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch eligibility history' });
  }
});

// ==================== COST ESTIMATION ====================

// Get cost estimate for a specific patient
router.get('/:id/cost-estimate', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const { getQuickEstimate } = await import('../services/insuranceCostEstimator');
    const patientId = parseInt(req.params.id);
    const { sessionRate } = req.query;

    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const insurance = patient.insuranceProvider || 'Unknown';
    const estimate = await getQuickEstimate(insurance, 45, parseInt(sessionRate as string) || 300);

    res.json({
      patient: {
        id: patient.id,
        name: `${patient.firstName} ${patient.lastName}`,
        insurance,
      },
      ...estimate,
    });
  } catch (error) {
    logger.error('Error getting patient cost estimate', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to get estimate' });
  }
});

// ==================== PATIENT DOCUMENTS ====================

// Get patient documents
router.get('/:id/documents', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const documents = await storage.getPatientDocuments(patientId);
    res.json(documents);
  } catch (error) {
    logger.error('Error fetching documents', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch documents' });
  }
});

// Upload document for patient
router.post('/:id/documents', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const { fileName, fileType, fileSize, mimeType, storagePath, notes, visibleToPatient, requiresSignature } = req.body;

    if (!fileName || !storagePath || !fileType || !mimeType) {
      return res.status(400).json({ message: 'fileName, fileType, mimeType, and storagePath are required' });
    }

    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    if (!patient.practiceId) {
      return res.status(400).json({ message: 'Patient has no assigned practice' });
    }

    const document = await storage.createPatientDocument({
      patientId,
      practiceId: patient.practiceId,
      uploadedBy: req.user?.claims?.sub,
      fileName,
      fileType,
      fileSize: fileSize || 0,
      mimeType,
      storagePath,
      notes: notes || null,
      visibleToPatient: visibleToPatient !== false,
      requiresSignature: requiresSignature || false,
    });

    res.status(201).json(document);
  } catch (error) {
    logger.error('Error creating document', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create document' });
  }
});

// ==================== PATIENT STATEMENTS ====================

// Get patient statements
router.get('/:id/statements', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const statements = await storage.getPatientStatements(patientId);
    res.json(statements);
  } catch (error) {
    logger.error('Error fetching statements', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch statements' });
  }
});

// Create statement for patient (manual or from body data)
router.post('/:id/statements', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const { totalAmount, dueDate, lineItems } = req.body;

    if (!totalAmount) {
      return res.status(400).json({ message: 'Total amount is required' });
    }

    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    if (!patient.practiceId) {
      return res.status(400).json({ message: 'Patient has no assigned practice' });
    }

    const dueDateStr = dueDate
      ? new Date(dueDate).toISOString().split('T')[0]
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const statement = await storage.createPatientStatement({
      patientId,
      practiceId: patient.practiceId,
      statementDate: new Date().toISOString().split('T')[0],
      dueDate: dueDateStr,
      totalCharges: totalAmount,
      patientBalance: totalAmount,
      lineItems: lineItems || [],
    });

    res.status(201).json(statement);
  } catch (error) {
    logger.error('Error creating statement', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create statement' });
  }
});

// Generate statement from unpaid claim balances
router.post('/:id/statements/generate', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    if (!patient.practiceId) {
      return res.status(400).json({ message: 'Patient has no assigned practice' });
    }

    // Get all claims for this patient's practice, then filter to this patient
    const allClaims = await storage.getClaims(patient.practiceId);
    const patientClaims = allClaims.filter((c: any) => c.patientId === patientId);

    // Find claims that have been paid by insurance but have a remaining patient balance
    // or claims that are denied (patient responsible for full amount)
    const unpaidClaims = patientClaims.filter((c: any) => {
      if (c.status === 'paid') {
        const total = parseFloat(c.totalAmount || '0');
        const paid = parseFloat(c.paidAmount || '0');
        return total > paid; // insurance didn't cover the full amount
      }
      if (c.status === 'denied') {
        return true; // patient owes the full amount
      }
      return false;
    });

    if (unpaidClaims.length === 0) {
      return res.status(400).json({ message: 'No unpaid claim balances found for this patient' });
    }

    // Build line items from unpaid claims
    const lineItems: Array<{
      dateOfService: string;
      description: string;
      charges: string;
      insurancePaid: string;
      patientOwes: string;
    }> = [];
    let totalPatientResponsibility = 0;

    for (const claim of unpaidClaims) {
      const chargeAmount = parseFloat(claim.totalAmount || '0');
      const insurancePaid = claim.status === 'denied' ? 0 : parseFloat(claim.paidAmount || '0');
      const patientResp = chargeAmount - insurancePaid;

      // Try to get line item details
      const claimLineItems = await storage.getClaimLineItems(claim.id);
      if (claimLineItems.length > 0) {
        for (const li of claimLineItems) {
          const liAmount = parseFloat(li.amount || '0');
          const liInsurancePortion = claim.status === 'denied' ? 0 : (insurancePaid / chargeAmount) * liAmount;
          const liPatientResp = liAmount - liInsurancePortion;

          lineItems.push({
            description: `Claim #${claim.claimNumber || claim.id}`,
            dateOfService: li.dateOfService || '',
            charges: liAmount.toFixed(2),
            insurancePaid: liInsurancePortion.toFixed(2),
            patientOwes: liPatientResp.toFixed(2),
          });
          totalPatientResponsibility += liPatientResp;
        }
      } else {
        lineItems.push({
          description: `Claim #${claim.claimNumber || claim.id}${claim.status === 'denied' ? ' (Denied)' : ''}`,
          dateOfService: '',
          charges: chargeAmount.toFixed(2),
          insurancePaid: insurancePaid.toFixed(2),
          patientOwes: patientResp.toFixed(2),
        });
        totalPatientResponsibility += patientResp;
      }
    }

    // Create the statement with a due date 30 days from now
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const statement = await storage.createPatientStatement({
      patientId,
      practiceId: patient.practiceId,
      statementDate: new Date().toISOString().split('T')[0],
      dueDate: dueDate.toISOString().split('T')[0],
      totalCharges: totalPatientResponsibility.toFixed(2),
      patientBalance: totalPatientResponsibility.toFixed(2),
      lineItems,
      status: 'draft',
    });

    res.status(201).json(statement);
  } catch (error) {
    logger.error('Error generating statement', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to generate statement' });
  }
});

// Mark statement as sent
router.post('/:id/statements/:statementId/send', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const statementId = parseInt(req.params.statementId);
    const { method } = req.body; // email, mail, portal

    const statement = await storage.getPatientStatement(statementId);
    if (!statement) {
      return res.status(404).json({ message: 'Statement not found' });
    }

    // Verify statement belongs to this patient
    const patientId = parseInt(req.params.id);
    if (statement.patientId !== patientId) {
      return res.status(403).json({ message: 'Statement does not belong to this patient' });
    }

    const updated = await storage.updatePatientStatement(statementId, {
      status: 'sent',
      sentMethod: method || 'email',
      sentAt: new Date(),
    });

    // Placeholder: In production, this would trigger actual email/mail sending
    logger.info('Statement marked as sent', {
      statementId,
      patientId,
      method: method || 'email',
    });

    res.json(updated);
  } catch (error) {
    logger.error('Error sending statement', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to send statement' });
  }
});

// ==================== PATIENT PAYMENTS ====================

// Get patient payments
router.get('/:id/payments', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const payments = await storage.getPatientPayments(patientId);
    res.json(payments);
  } catch (error) {
    logger.error('Error fetching payments', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch payments' });
  }
});

// Record a patient payment
router.post('/:id/payments', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const { amount, paymentMethod, statementId, referenceNumber, notes } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ message: 'Valid payment amount is required' });
    }
    if (!paymentMethod) {
      return res.status(400).json({ message: 'Payment method is required (cash, check, card, ach)' });
    }

    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }
    if (!patient.practiceId) {
      return res.status(400).json({ message: 'Patient has no assigned practice' });
    }

    // If a statementId is provided, verify it belongs to this patient
    if (statementId) {
      const statement = await storage.getPatientStatement(statementId);
      if (!statement || statement.patientId !== patientId) {
        return res.status(400).json({ message: 'Invalid statement ID' });
      }
    }

    // Record the payment
    const payment = await storage.createPatientPayment({
      patientId,
      practiceId: patient.practiceId,
      statementId: statementId || null,
      amount: parseFloat(amount).toFixed(2),
      paymentMethod,
      paymentDate: new Date(),
      referenceNumber: referenceNumber || null,
      notes: notes || null,
    });

    // If linked to a statement, update the statement's paid amount and balance
    if (statementId) {
      await storage.markStatementPaid(statementId, {
        paidAmount: parseFloat(amount).toFixed(2),
        paidAt: new Date(),
      });
    }

    res.status(201).json(payment);
  } catch (error) {
    logger.error('Error recording payment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to record payment' });
  }
});

// ==================== TREATMENT PLANS ====================

// Get patient's treatment plans
router.get('/:id/treatment-plans', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const plans = await storage.getPatientTreatmentPlans(patientId);
    res.json(plans);
  } catch (error) {
    logger.error('Error fetching patient treatment plans', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch patient treatment plans' });
  }
});

// Get patient's active treatment plan
router.get('/:id/active-treatment-plan', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const plan = await storage.getActiveTreatmentPlan(patientId);
    if (!plan) {
      return res.json(null);
    }
    const planDetails = await storage.getTreatmentPlanWithDetails(plan.id);
    res.json(planDetails);
  } catch (error) {
    logger.error('Error fetching active treatment plan', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch active treatment plan' });
  }
});

// ==================== ASSESSMENTS ====================

// Get patient's assessments
router.get('/:id/assessments', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const templateId = req.query.templateId ? parseInt(req.query.templateId as string) : undefined;
    const assessments = await storage.getPatientAssessments(patientId, templateId);
    res.json(assessments);
  } catch (error) {
    logger.error('Error fetching patient assessments', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch assessments' });
  }
});

// Get patient's assessment history with trend analysis
router.get('/:id/assessments/:templateId/history', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const templateId = parseInt(req.params.templateId);
    const history = await storage.getPatientAssessmentHistory(patientId, templateId);
    res.json(history);
  } catch (error) {
    logger.error('Error fetching assessment history', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch assessment history' });
  }
});

// Get patient's latest assessment for a template
router.get('/:id/assessments/:templateId/latest', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const templateId = parseInt(req.params.templateId);
    const assessment = await storage.getLatestPatientAssessment(patientId, templateId);
    res.json(assessment || null);
  } catch (error) {
    logger.error('Error fetching latest assessment', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch latest assessment' });
  }
});

// Get patient's assessment schedules
router.get('/:id/assessment-schedules', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const schedules = await storage.getPatientAssessmentSchedules(patientId);
    res.json(schedules);
  } catch (error) {
    logger.error('Error fetching assessment schedules', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch assessment schedules' });
  }
});

// ==================== REFERRALS ====================

// Get patient's referrals
router.get('/:id/referrals', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const patientReferrals = await storage.getPatientReferrals(patientId);
    res.json(patientReferrals);
  } catch (error) {
    logger.error('Error fetching patient referrals', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch patient referrals' });
  }
});

// ==================== PAYMENT METHODS ====================

// Get patient's payment methods
router.get('/:id/payment-methods', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const methods = await storage.getPatientPaymentMethods(patientId);
    res.json(methods);
  } catch (error) {
    logger.error('Error fetching payment methods', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch payment methods' });
  }
});

// Get patient's default payment method
router.get('/:id/payment-methods/default', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const method = await storage.getDefaultPaymentMethod(patientId);
    res.json(method || null);
  } catch (error) {
    logger.error('Error fetching default payment method', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch default payment method' });
  }
});

// Add payment method
router.post('/:id/payment-methods', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const method = await storage.createPatientPaymentMethod({
      ...req.body,
      patientId,
    });
    res.status(201).json(method);
  } catch (error) {
    logger.error('Error creating payment method', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create payment method' });
  }
});

// ==================== TRANSACTIONS ====================

// Get patient's transactions
router.get('/:id/transactions', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const transactions = await storage.getPatientPaymentHistory(patientId);
    res.json(transactions);
  } catch (error) {
    logger.error('Error fetching patient transactions', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch patient transactions' });
  }
});

// Get patient's balance
router.get('/:id/balance', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const balance = await storage.getPatientBalance(patientId);
    res.json({ patientId, balance });
  } catch (error) {
    logger.error('Error fetching patient balance', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch patient balance' });
  }
});

// ==================== PAYMENT PLANS ====================

// Get patient's payment plans
router.get('/:id/payment-plans', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const plans = await storage.getPatientPaymentPlans(patientId);
    res.json(plans);
  } catch (error) {
    logger.error('Error fetching patient payment plans', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch patient payment plans' });
  }
});

// ==================== PORTAL ACCESS ====================

// Create or get portal access for a patient
router.post('/:id/portal-access', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    let access = await storage.getPatientPortalAccess(patientId);
    if (!access) {
      if (!patient.practiceId) {
        return res.status(400).json({ message: 'Patient has no assigned practice' });
      }
      access = await storage.createPatientPortalAccess(patientId, patient.practiceId);
    }

    res.json(access);
  } catch (error) {
    logger.error('Error creating portal access', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create portal access' });
  }
});

// Send magic link to patient
router.post('/:id/send-portal-link', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id);
    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Ensure portal access exists
    let access = await storage.getPatientPortalAccess(patientId);
    if (!access) {
      if (!patient.practiceId) {
        return res.status(400).json({ message: 'Patient has no assigned practice' });
      }
      access = await storage.createPatientPortalAccess(patientId, patient.practiceId);
    }

    // Create magic link
    const magicLink = await storage.createMagicLink(patientId);
    const portalUrl = `${req.protocol}://${req.get('host')}/portal/login/${magicLink.token}`;

    // Send email with magic link
    if (patient.email) {
      try {
        if (!patient.practiceId) {
          logger.warn('Patient has no assigned practice, using default name');
        }
        const practice = patient.practiceId ? await storage.getPractice(patient.practiceId) : null;
        const practiceName = practice?.name || 'Your Healthcare Provider';

        const { subject, html, text } = portalWelcome({
          patientName: patient.firstName,
          practiceName,
          portalUrl,
        });

        await sendEmail({
          to: patient.email,
          subject,
          html,
          text,
          fromName: practiceName,
        });

        res.json({ message: 'Portal access link sent', email: patient.email });
      } catch (emailError) {
        logger.error('Error sending portal email', { error: emailError instanceof Error ? emailError.message : String(emailError) });
        res.json({
          message: 'Portal link created but email failed',
          portalUrl,
          token: magicLink.token,
        });
      }
    } else {
      res.json({
        message: 'No email on file. Share this link with the patient:',
        portalUrl,
        token: magicLink.token,
      });
    }
  } catch (error) {
    logger.error('Error sending portal link', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to send portal link' });
  }
});

// ==================== BULK ELIGIBILITY ====================

// Run eligibility checks for multiple patients at once
router.post('/bulk-eligibility', isAuthenticated, async (req: any, res) => {
  try {
    const { patientIds } = req.body;

    if (!Array.isArray(patientIds) || patientIds.length === 0) {
      return res.status(400).json({ message: 'patientIds must be a non-empty array' });
    }

    if (patientIds.length > 50) {
      return res.status(400).json({ message: 'Maximum 50 patients per bulk check' });
    }

    const { StediAdapter } = await import('../payer-integrations/adapters/payers/StediAdapter');
    const { getStediApiKeyForPractice } = await import('../services/stediService');
    const stediKeyInfo = await getStediApiKeyForPractice(getAuthorizedPracticeId(req)).catch(() => null);
    const stediApiKey = stediKeyInfo?.apiKey || process.env.STEDI_API_KEY;

    const summary = {
      checked: 0,
      eligible: 0,
      ineligible: 0,
      errors: 0,
    };
    const results: Array<{
      patientId: number;
      patientName: string;
      status: string;
      eligibility: any;
      error?: string;
    }> = [];

    for (const patientId of patientIds) {
      const id = typeof patientId === 'string' ? parseInt(patientId, 10) : patientId;

      try {
        const patient = await storage.getPatient(id);
        if (!patient) {
          results.push({ patientId: id, patientName: 'Unknown', status: 'error', eligibility: null, error: 'Patient not found' });
          summary.errors++;
          summary.checked++;
          continue;
        }

        if (!patient.insuranceProvider) {
          results.push({ patientId: id, patientName: `${patient.firstName} ${patient.lastName}`, status: 'error', eligibility: null, error: 'No insurance on file' });
          summary.errors++;
          summary.checked++;
          continue;
        }

        let eligibilityResult: any;

        if (stediApiKey && patient.practiceId) {
          try {
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
              payerName: patient.insuranceProvider || 'Unknown',
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
              source: 'stedi',
            };
          } catch (stediError: any) {
            logger.warn('Stedi eligibility failed for bulk check, using mock', { patientId: id, error: stediError.message });
            eligibilityResult = generateBulkMockEligibility(patient);
            eligibilityResult.source = 'mock_fallback';
          }
        } else {
          eligibilityResult = generateBulkMockEligibility(patient);
          eligibilityResult.source = 'mock';
        }

        // Store the result
        const savedCheck = await storage.createEligibilityCheck({
          patientId: id,
          insuranceId: null,
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

        summary.checked++;
        if (eligibilityResult.status === 'active') {
          summary.eligible++;
        } else {
          summary.ineligible++;
        }

        results.push({
          patientId: id,
          patientName: `${patient.firstName} ${patient.lastName}`,
          status: eligibilityResult.status,
          eligibility: savedCheck,
        });

      } catch (patientError: any) {
        logger.error('Bulk eligibility check failed for patient', { patientId: id, error: patientError.message });
        results.push({ patientId: id, patientName: 'Unknown', status: 'error', eligibility: null, error: patientError.message });
        summary.errors++;
        summary.checked++;
      }

      // Small delay between checks to respect rate limits (200ms)
      if (patientIds.indexOf(patientId) < patientIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    res.json({ summary, results });
  } catch (error) {
    logger.error('Bulk eligibility check failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to run bulk eligibility checks' });
  }
});

// Helper: generate mock eligibility for bulk checks (deterministic per patient)
function generateBulkMockEligibility(patient: any) {
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
      copay: null,
      deductible: null,
      deductibleMet: null,
      outOfPocketMax: null,
      outOfPocketMet: null,
      coinsurance: null,
      visitsAllowed: null,
      visitsUsed: null,
      authRequired: null,
    };
  }

  const coverageTypes = ['PPO', 'HMO', 'POS', 'EPO'];
  const copayOptions = [20, 25, 30, 35, 40, 50];
  const deductibleOptions = [500, 1000, 1500, 2000, 2500, 3000];
  const outOfPocketOptions = [3000, 4000, 5000, 6000, 7500, 8000];
  const visitLimits = [30, 40, 50, 60];

  // Use deterministic values based on patient seed
  const idx = (n: number) => Math.floor(((patientSeed * 7 + n * 13) % 100) / 100 * n) % n;
  const coverageType = coverageTypes[idx(coverageTypes.length)];
  const copay = copayOptions[idx(copayOptions.length)];
  const deductible = deductibleOptions[idx(deductibleOptions.length)];
  const deductibleMet = Math.round(deductible * consistentRandom * 100) / 100;
  const outOfPocketMax = outOfPocketOptions[idx(outOfPocketOptions.length)];
  const outOfPocketMet = Math.round(outOfPocketMax * consistentRandom * 0.5 * 100) / 100;
  const coinsurance = [10, 20, 30][idx(3)];
  const visitsAllowed = visitLimits[idx(visitLimits.length)];
  const visitsUsed = Math.floor(consistentRandom * visitsAllowed * 0.6);
  const authRequired = consistentRandom < 0.3;

  const currentYear = new Date().getFullYear();

  return {
    status,
    coverageType,
    effectiveDate: new Date(currentYear - 1, 0, 1).toISOString().split('T')[0],
    terminationDate: new Date(currentYear, 11, 31).toISOString().split('T')[0],
    copay,
    deductible,
    deductibleMet,
    outOfPocketMax,
    outOfPocketMet,
    coinsurance,
    visitsAllowed,
    visitsUsed,
    authRequired,
  };
}

// ==================== INSURANCE DATA ====================

// Refresh patient insurance data via Stedi
router.post('/:id/insurance-data/refresh', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id, 10);
    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    const creds = await storage.getPayerCredentials(patient.practiceId, 'stedi');
    if (!creds) {
      return res.status(400).json({ message: 'Stedi not configured' });
    }

    const { StediAdapter } = await import('../payer-integrations/adapters/payers/StediAdapter');
    const adapter = new StediAdapter((creds.credentials as any).apiKey);
    const practice = await storage.getPractice(patient.practiceId);
    const result = await adapter.checkEligibility({
      providerNpi: practice?.npi || '',
      providerName: practice?.name || '',
      memberFirstName: patient.firstName,
      memberLastName: patient.lastName,
      memberDob: patient.dateOfBirth || '',
      memberId: patient.insuranceId || '',
      payerName: patient.insuranceProvider || '',
    });

    const auth = await storage.getPatientInsuranceAuth(patientId);
    await storage.cacheInsuranceData({
      patientId,
      practiceId: patient.practiceId,
      authorizationId: auth?.id || 0,
      dataType: 'eligibility',
      normalizedData: result.eligibility as any,
      rawResponse: result.raw || null,
      status: 'success',
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    res.json({ eligibility: result.eligibility, benefits: result.benefits, verifiedAt: new Date().toISOString() });
  } catch (error) {
    logger.error('Insurance data refresh failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Eligibility check failed' });
  }
});

// Get patient insurance data from cache
router.get('/:id/insurance-data', isAuthenticated, requirePatientConsent, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id, 10);
    const cached = await storage.getCachedInsuranceData(patientId);
    if (!cached) {
      return res.json({ eligibility: null, benefits: null, verifiedAt: null });
    }
    res.json(cached);
  } catch (error) {
    logger.error('Error fetching insurance data', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch insurance data' });
  }
});

// ==================== INSURANCE CARD IMAGES ====================

// Upload insurance card images (front and back) for a patient
router.post('/:id/insurance-cards', isAuthenticated, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id, 10);
    const { authorized, error } = await verifyPatientAccess(req, patientId);
    if (!authorized) {
      return res.status(error === 'Patient not found' ? 404 : 403).json({ message: error });
    }

    const { front, back } = req.body;

    if (!front && !back) {
      return res.status(400).json({ message: 'At least one card image (front or back) is required' });
    }

    // Validate base64 data URIs
    const dataUriPattern = /^data:image\/(jpeg|jpg|png|heic|heif|webp);base64,/;
    if (front && !dataUriPattern.test(front)) {
      return res.status(400).json({ message: 'Invalid front card image format. Must be a base64-encoded image.' });
    }
    if (back && !dataUriPattern.test(back)) {
      return res.status(400).json({ message: 'Invalid back card image format. Must be a base64-encoded image.' });
    }

    // Size check: ~5MB base64 is roughly 6.67MB string
    const MAX_BASE64_SIZE = 7 * 1024 * 1024;
    if (front && front.length > MAX_BASE64_SIZE) {
      return res.status(400).json({ message: 'Front card image is too large (max 5MB)' });
    }
    if (back && back.length > MAX_BASE64_SIZE) {
      return res.status(400).json({ message: 'Back card image is too large (max 5MB)' });
    }

    // Get existing patient data and merge insurance card images into intakeData
    const patient = await storage.getPatient(patientId);
    const existingIntakeData = (patient?.intakeData as Record<string, unknown>) || {};
    const updatedIntakeData = {
      ...existingIntakeData,
      ...(front !== undefined && { insuranceCardFront: front }),
      ...(back !== undefined && { insuranceCardBack: back }),
      insuranceCardUploadedAt: new Date().toISOString(),
    };

    await storage.updatePatient(patientId, { intakeData: updatedIntakeData });

    logger.info('Insurance card images uploaded', { patientId, hasFront: !!front, hasBack: !!back });
    res.json({ success: true, message: 'Insurance card images saved' });
  } catch (error) {
    logger.error('Error uploading insurance cards', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to upload insurance card images' });
  }
});

// Get insurance card images for a patient
router.get('/:id/insurance-cards', isAuthenticated, async (req: any, res) => {
  try {
    const patientId = parseInt(req.params.id, 10);
    const { authorized, patient, error } = await verifyPatientAccess(req, patientId);
    if (!authorized) {
      return res.status(error === 'Patient not found' ? 404 : 403).json({ message: error });
    }

    const intakeData = (patient?.intakeData as Record<string, unknown>) || {};

    res.json({
      front: intakeData.insuranceCardFront || null,
      back: intakeData.insuranceCardBack || null,
      uploadedAt: intakeData.insuranceCardUploadedAt || null,
    });
  } catch (error) {
    logger.error('Error fetching insurance cards', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch insurance card images' });
  }
});

export default router;
