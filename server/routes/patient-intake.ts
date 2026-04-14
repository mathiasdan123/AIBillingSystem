/**
 * Patient Portal Intake Routes
 *
 * Handles intake form submission for patient portal:
 * - GET /api/patient-portal/intake/status - Get intake completion status
 * - GET /api/patient-portal/intake/data - Get saved intake data for resume
 * - PUT /api/patient-portal/intake/step/:stepId - Auto-save step data
 * - POST /api/patient-portal/intake/consent - Create consent record with signature
 * - POST /api/patient-portal/intake/setup-intent - Create Stripe SetupIntent for card
 * - POST /api/patient-portal/intake/save-payment-method - Save card to patientPaymentMethods
 * - POST /api/patient-portal/intake/submit - Finalize intake
 * - GET /api/patient-portal/intake/can-schedule - Check if patient can schedule appointments
 */

import { Router } from 'express';
import { storage } from '../storage';
import logger from '../services/logger';
import * as stripeService from '../services/stripeService';
import { sendEmail } from '../services/emailService';
import { intakeSubmissionNotification } from '../services/emailTemplates';

const router = Router();

// Helper to get patient from Bearer token (same as public-portal.ts)
const getPatientFromPortalToken = async (req: any): Promise<{ patient: any; access: any; practice: any } | null> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  const access = await storage.getPatientPortalByToken(token);
  if (!access) {
    return null;
  }
  const patient = await storage.getPatient(access.patientId);
  if (!patient) {
    return null;
  }
  const practice = await storage.getPractice(patient.practiceId);
  return { patient, access, practice };
};

// Get intake status - completion status, current step, practice branding
router.get('/patient-portal/intake/status', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient, practice } = auth;

    // Check which consents have been signed
    const consents = await storage.getPatientConsents(patient.id);
    const hipaaConsent = consents.find(c => c.consentType === 'hipaa_privacy_practices');
    const waiverConsent = consents.find(c => c.consentType === 'waiver_release');
    const cardAuthConsent = consents.find(c => c.consentType === 'card_authorization');

    // Check if patient has a payment method
    const paymentMethods = await storage.getPatientPaymentMethods(patient.id);
    const hasPaymentMethod = paymentMethods.length > 0;

    // Get intake data
    const intakeData = patient.intakeData || {};

    // Calculate completion status for each step
    const steps = {
      hipaaNotice: {
        completed: !!hipaaConsent,
        signedAt: hipaaConsent?.signatureDate || null,
      },
      parentQuestionnaire: {
        completed: !!intakeData.questionnaireCompleted,
        savedSections: intakeData.sections ? Object.keys(intakeData.sections) : [],
      },
      waiverRelease: {
        completed: !!waiverConsent,
        signedAt: waiverConsent?.signatureDate || null,
      },
      creditCardAuth: {
        completed: hasPaymentMethod && !!cardAuthConsent,
        required: practice?.requireCardOnFile !== false, // Default to required
        skipped: intakeData.cardAuthSkipped || false,
      },
      reviewSubmit: {
        completed: !!patient.intakeCompletedAt,
        submittedAt: patient.intakeCompletedAt || null,
      },
    };

    // Calculate current step
    let currentStep = 1;
    if (steps.hipaaNotice.completed) currentStep = 2;
    if (steps.hipaaNotice.completed && steps.parentQuestionnaire.completed) currentStep = 3;
    if (steps.hipaaNotice.completed && steps.parentQuestionnaire.completed && steps.waiverRelease.completed) currentStep = 4;
    if (steps.hipaaNotice.completed && steps.parentQuestionnaire.completed && steps.waiverRelease.completed &&
        (steps.creditCardAuth.completed || steps.creditCardAuth.skipped || !steps.creditCardAuth.required)) currentStep = 5;

    // Overall intake completed?
    const intakeCompleted = !!patient.intakeCompletedAt;

    res.json({
      intakeCompleted,
      intakeCompletedAt: patient.intakeCompletedAt,
      currentStep,
      steps,
      branding: {
        practiceId: practice?.id,
        practiceName: practice?.name,
        logoUrl: practice?.brandLogoUrl,
        primaryColor: practice?.brandPrimaryColor || '#2563eb',
        secondaryColor: practice?.brandSecondaryColor || '#1e40af',
      },
      requireCardOnFile: practice?.requireCardOnFile !== false,
    });
  } catch (error) {
    logger.error('Error fetching intake status', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch intake status' });
  }
});

// Get saved intake data for resume
router.get('/patient-portal/intake/data', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient } = auth;

    res.json({
      intakeData: patient.intakeData || {},
      intakeCompletedAt: patient.intakeCompletedAt,
    });
  } catch (error) {
    logger.error('Error fetching intake data', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch intake data' });
  }
});

// Auto-save step data
router.put('/patient-portal/intake/step/:stepId', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient } = auth;
    const { stepId } = req.params;
    const stepData = req.body;

    // Merge step data into existing intake data
    const currentIntakeData = patient.intakeData || {};
    const updatedIntakeData = {
      ...currentIntakeData,
      sections: {
        ...(currentIntakeData.sections || {}),
        [stepId]: {
          ...(currentIntakeData.sections?.[stepId] || {}),
          ...stepData,
          updatedAt: new Date().toISOString(),
        },
      },
      lastUpdatedStep: stepId,
      lastUpdatedAt: new Date().toISOString(),
    };

    await storage.updatePatientIntakeData(patient.id, updatedIntakeData);

    res.json({
      savedAt: new Date().toISOString(),
      stepId,
    });
  } catch (error) {
    logger.error('Error saving intake step', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to save intake step' });
  }
});

// Create consent record with signature
router.post('/patient-portal/intake/consent', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient, practice } = auth;
    const {
      consentType,
      signatureName,
      signatureRelationship,
      signatureData, // Base64 image of signature if using canvas
      acknowledgedAt,
    } = req.body;

    if (!consentType || !signatureName) {
      return res.status(400).json({ message: 'consentType and signatureName are required' });
    }

    // Map consent type to HIPAA-required fields
    const consentMappings: Record<string, { purpose: string; info: string; recipient: string }> = {
      hipaa_privacy_practices: {
        purpose: 'To inform patient/guardian of privacy practices and obtain acknowledgment',
        info: 'Notice of Privacy Practices document',
        recipient: 'Practice records',
      },
      waiver_release: {
        purpose: 'Waiver of liability and release for occupational therapy services',
        info: 'Emergency contact information, liability waiver acknowledgment',
        recipient: 'Practice records and emergency contacts as needed',
      },
      card_authorization: {
        purpose: 'Authorization to charge payment card for services',
        info: 'Payment method authorization for copays, deductibles, and balances',
        recipient: 'Payment processor (Stripe) and practice billing',
      },
      financial_responsibility: {
        purpose: 'Acknowledgment of financial responsibility for services',
        info: 'Financial responsibility agreement',
        recipient: 'Practice billing department',
      },
    };

    const mapping = consentMappings[consentType];
    if (!mapping) {
      return res.status(400).json({ message: 'Invalid consent type' });
    }

    // Get client IP address
    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

    // Create the consent record with signature data
    const consent = await storage.createPatientConsent({
      practiceId: patient.practiceId,
      patientId: patient.id,
      consentType,
      purposeOfDisclosure: mapping.purpose,
      informationToBeDisclosed: mapping.info,
      recipientOfInformation: mapping.recipient,
      effectiveDate: new Date().toISOString().split('T')[0],
      expirationDate: null, // Until revoked
      signatureType: 'electronic',
      signatureName,
      signatureDate: new Date(),
      signerRelationship: signatureRelationship || 'self',
      signatureIpAddress: Array.isArray(ipAddress) ? ipAddress[0] : ipAddress,
      witnessName: practice?.name || 'System',
      consentVersion: '1.0',
      signatureData: signatureData || null,
      notes: `User-Agent: ${req.headers['user-agent'] || 'unknown'}`,
    });

    res.json({
      consentId: consent.id,
      consentType,
      signedAt: consent.signatureDate,
    });
  } catch (error) {
    logger.error('Error creating consent', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create consent record' });
  }
});

// Create Stripe SetupIntent for collecting card
router.post('/patient-portal/intake/setup-intent', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient, practice } = auth;

    // Check if patient has a Stripe customer ID, create one if not
    let stripeCustomerId = patient.stripeCustomerId;

    if (!stripeCustomerId) {
      // Create Stripe customer for this patient
      const customer = await stripeService.createCustomer(
        patient.email || `patient-${patient.id}@noemail.local`,
        `${patient.firstName} ${patient.lastName}`,
        { patientId: patient.id.toString(), practiceId: patient.practiceId.toString() }
      );
      stripeCustomerId = customer.id;

      // Save Stripe customer ID to patient record
      await storage.updatePatientStripeCustomerId(patient.id, stripeCustomerId);
    }

    // Create SetupIntent
    const setupIntent = await stripeService.createSetupIntent(stripeCustomerId);

    res.json({
      clientSecret: setupIntent.client_secret,
      customerId: stripeCustomerId,
    });
  } catch (error) {
    logger.error('Error creating setup intent', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create payment setup' });
  }
});

// Save payment method after Stripe confirmation
router.post('/patient-portal/intake/save-payment-method', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient, practice } = auth;
    const {
      stripePaymentMethodId,
      billingName,
      billingAddress,
      billingCity,
      billingState,
      billingZip,
    } = req.body;

    if (!stripePaymentMethodId) {
      return res.status(400).json({ message: 'stripePaymentMethodId is required' });
    }

    // Get payment method details from Stripe
    const paymentMethod = await stripeService.getPaymentMethod(stripePaymentMethodId);

    // Determine payment method type
    const type = paymentMethod.type === 'card' ? 'card' :
                 paymentMethod.type === 'us_bank_account' ? 'bank_account' : 'card';

    // Save to patientPaymentMethods
    const savedMethod = await storage.createPatientPaymentMethod({
      patientId: patient.id,
      practiceId: patient.practiceId,
      type,
      stripePaymentMethodId,
      cardBrand: paymentMethod.card?.brand || null,
      cardLast4: paymentMethod.card?.last4 || null,
      cardExpMonth: paymentMethod.card?.exp_month || null,
      cardExpYear: paymentMethod.card?.exp_year || null,
      bankName: paymentMethod.us_bank_account?.bank_name || null,
      bankLast4: paymentMethod.us_bank_account?.last4 || null,
      bankAccountType: paymentMethod.us_bank_account?.account_type || null,
      billingName,
      billingAddress,
      billingCity,
      billingState,
      billingZip,
      isDefault: true,
      isActive: true,
    });

    // Update portal access to indicate payment method on file
    await storage.updatePatientPortalPaymentStatus(patient.id, true);

    res.json({
      paymentMethodId: savedMethod.id,
      type,
      last4: paymentMethod.card?.last4 || paymentMethod.us_bank_account?.last4,
      brand: paymentMethod.card?.brand,
    });
  } catch (error) {
    logger.error('Error saving payment method', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to save payment method' });
  }
});

// Skip credit card step (if practice allows)
router.post('/patient-portal/intake/skip-card', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient, practice } = auth;

    // Check if practice allows skipping
    if (practice?.requireCardOnFile !== false) {
      return res.status(400).json({ message: 'Credit card on file is required by this practice' });
    }

    // Mark card auth as skipped in intake data
    const currentIntakeData = patient.intakeData || {};
    const updatedIntakeData = {
      ...currentIntakeData,
      cardAuthSkipped: true,
      cardAuthSkippedAt: new Date().toISOString(),
    };

    await storage.updatePatientIntakeData(patient.id, updatedIntakeData);

    res.json({
      skipped: true,
      skippedAt: updatedIntakeData.cardAuthSkippedAt,
    });
  } catch (error) {
    logger.error('Error skipping card auth', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to skip card authorization' });
  }
});

// Finalize intake submission
router.post('/patient-portal/intake/submit', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient, practice } = auth;

    // Verify all required items are complete
    const consents = await storage.getPatientConsents(patient.id);
    const hipaaConsent = consents.find(c => c.consentType === 'hipaa_privacy_practices');
    const waiverConsent = consents.find(c => c.consentType === 'waiver_release');

    if (!hipaaConsent) {
      return res.status(400).json({ message: 'HIPAA Notice acknowledgment is required' });
    }

    if (!waiverConsent) {
      return res.status(400).json({ message: 'Waiver and Release acknowledgment is required' });
    }

    // Check card requirement
    const paymentMethods = await storage.getPatientPaymentMethods(patient.id);
    const hasPaymentMethod = paymentMethods.length > 0;
    const intakeData = patient.intakeData || {};

    if (practice?.requireCardOnFile !== false && !hasPaymentMethod && !intakeData.cardAuthSkipped) {
      return res.status(400).json({ message: 'Credit card on file is required' });
    }

    // Mark questionnaire as completed if it has data
    const updatedIntakeData = {
      ...intakeData,
      questionnaireCompleted: true,
      submittedAt: new Date().toISOString(),
    };

    // Set intake completed timestamp
    await storage.completePatientIntake(patient.id, updatedIntakeData);

    // Send front desk notification email
    try {
      const practiceEmail = practice?.email;
      if (practiceEmail) {
        const emailData = intakeSubmissionNotification({
          patientFirstName: patient.firstName,
          patientLastName: patient.lastName,
          patientEmail: patient.email || undefined,
          patientPhone: patient.phone || undefined,
          practiceName: practice.name || 'Your Practice',
          hasInsuranceCard: !!(updatedIntakeData?.insuranceCardFront || updatedIntakeData?.insuranceCardBack),
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
      logger.warn('Error sending intake notification', { error: emailError instanceof Error ? emailError.message : String(emailError) });
    }

    res.json({
      success: true,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Error submitting intake', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to submit intake' });
  }
});

// Check if patient can schedule appointments
router.get('/patient-portal/intake/can-schedule', async (req, res) => {
  try {
    const auth = await getPatientFromPortalToken(req);
    if (!auth) {
      return res.status(401).json({ message: 'Invalid or expired session' });
    }

    const { patient, practice } = auth;

    // Check required consents
    const consents = await storage.getPatientConsents(patient.id);
    const hipaaConsent = consents.find(c => c.consentType === 'hipaa_privacy_practices');
    const waiverConsent = consents.find(c => c.consentType === 'waiver_release');

    // Check payment method requirement
    const paymentMethods = await storage.getPatientPaymentMethods(patient.id);
    const hasPaymentMethod = paymentMethods.length > 0;
    const intakeData = patient.intakeData || {};

    const requirements = {
      hipaaNotice: {
        required: true,
        completed: !!hipaaConsent,
        label: 'HIPAA Notice of Privacy Practices',
      },
      waiverRelease: {
        required: true,
        completed: !!waiverConsent,
        label: 'Waiver and Release of Liability',
      },
      creditCardOnFile: {
        required: practice?.requireCardOnFile !== false,
        completed: hasPaymentMethod || intakeData.cardAuthSkipped,
        label: 'Credit Card on File',
      },
    };

    const canSchedule = requirements.hipaaNotice.completed &&
                        requirements.waiverRelease.completed &&
                        (!requirements.creditCardOnFile.required || requirements.creditCardOnFile.completed);

    const missingRequirements = Object.entries(requirements)
      .filter(([_, req]) => req.required && !req.completed)
      .map(([_, req]) => req.label);

    res.json({
      canSchedule,
      requirements,
      missingRequirements,
    });
  } catch (error) {
    logger.error('Error checking scheduling eligibility', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to check scheduling eligibility' });
  }
});

export default router;
