/**
 * SOAP Notes Routes
 *
 * Handles:
 * - /api/soap-notes - CRUD operations for SOAP notes
 * - /api/soap-notes/:id/sign - Sign a SOAP note
 * - /api/soap-notes/pending-cosign - Get notes pending co-signature
 * - /api/soap-notes/:id/cosign - Co-sign (approve/reject) a SOAP note
 * - /api/therapy-bank - Practice-wide saved therapies
 * - /api/ai/generate-soap - AI-generated SOAP note from session
 */

import { Router, type Response, type NextFunction } from 'express';
import * as crypto from 'crypto';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { optimizeBillingCodes, getInsuranceBillingRules } from '../services/aiBillingOptimizer';
import logger from '../services/logger';

const router = Router();

// Helper to generate cryptographically secure claim numbers
const generateSecureClaimNumber = (prefix: string = 'CLM'): string => {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${dateStr}-${randomPart}`;
};

/**
 * HIPAA Compliance: Verify patient consent before returning PHI
 * SECURITY: Fails closed - denies access on error to protect PHI
 */
const verifyPatientConsent = async (patientId: number, accessReason: string = 'treatment'): Promise<{
  hasConsent: boolean;
  missingConsents: string[];
  verificationError?: boolean;
}> => {
  try {
    const result = await storage.hasRequiredTreatmentConsents(patientId);

    if (!result.hasConsent) {
      logger.warn('PHI access without complete consent', {
        patientId,
        accessReason,
        missingConsents: result.missingConsents,
        timestamp: new Date().toISOString(),
      });
    }

    return result;
  } catch (error) {
    logger.error('Error verifying patient consent - ACCESS DENIED (fail-closed)', {
      patientId,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
    return { hasConsent: false, missingConsents: ['verification_failed'], verificationError: true };
  }
};

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

// ==================== SOAP NOTE CRUD ====================

// Get all SOAP notes
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const soapNotes = await storage.getAllSoapNotes();
    res.json(soapNotes);
  } catch (error) {
    logger.error('Error fetching SOAP notes', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to fetch SOAP notes' });
  }
});

// Create SOAP note with AI-optimized billing
router.post('/', isAuthenticated, async (req: any, res) => {
  try {
    // HIPAA: Verify patient consent before creating PHI record
    if (req.body.patientId) {
      const consentStatus = await verifyPatientConsent(req.body.patientId, 'soap_note_creation');
      if (consentStatus.verificationError) {
        return res.status(503).json({
          message: 'Unable to verify patient consent. Please try again or contact support.',
          code: 'CONSENT_VERIFICATION_FAILED'
        });
      }
    }

    const soapNote = await storage.createSoapNote(req.body);

    // Auto-generate AI-optimized superbill from the session
    let generatedClaim = null;
    let billingOptimization = null;
    if (soapNote.sessionId) {
      try {
        const sessions = await storage.getAllSessions();
        const session = sessions.find((s: any) => s.id === soapNote.sessionId);

        if (session && session.practiceId) {
          const existingClaims = await storage.getClaims(session.practiceId);
          const existingClaim = existingClaims.find((c: any) => c.sessionId === session.id);

          if (!existingClaim) {
            const cptCodes = await storage.getCptCodes();
            const icd10Codes = await storage.getIcd10Codes();

            const patients = await storage.getPatients(session.practiceId);
            const patient = patients.find((p: any) => p.id === session.patientId);
            const insuranceName = patient?.insuranceProvider || 'Unknown Insurance';

            const icd10Code = session.icd10CodeId
              ? icd10Codes.find((i: any) => i.id === session.icd10CodeId)
              : null;

            const { rules, preferences } = await getInsuranceBillingRules(storage, null);

            logger.info(`AI optimizing billing for session ${session.id}, insurance: ${insuranceName}`);

            const optimization = await optimizeBillingCodes(
              {
                duration: session.duration || 45,
                subjective: soapNote.subjective,
                objective: soapNote.objective,
                assessment: soapNote.assessment,
                plan: soapNote.plan,
                interventions: soapNote.interventions as string[] || [],
              },
              cptCodes.map((c: any) => ({
                id: c.id,
                code: c.code,
                description: c.description,
                category: c.category,
                baseRate: c.baseRate,
              })),
              insuranceName,
              rules,
              preferences,
              icd10Code ? { code: icd10Code.code, description: icd10Code.description } : undefined
            );

            billingOptimization = optimization;

            const claimNumber = generateSecureClaimNumber("SB");

            const claim = await storage.createClaim({
              practiceId: session.practiceId,
              patientId: session.patientId,
              sessionId: session.id,
              insuranceId: null,
              claimNumber,
              totalAmount: optimization.estimatedAmount.toFixed(2),
              status: 'draft',
              aiReviewNotes: `AI Billing Optimization (${optimization.complianceScore}% compliance): ${optimization.optimizationNotes}`,
            });

            const createdLineItems = [];
            for (const item of optimization.lineItems) {
              const cptCode = cptCodes.find((c: any) => c.id === item.cptCodeId);
              const rate = parseFloat(cptCode?.baseRate || '289');
              const amount = rate * item.units;

              const lineItem = await storage.createClaimLineItem({
                claimId: claim.id,
                cptCodeId: item.cptCodeId,
                icd10CodeId: session.icd10CodeId || null,
                units: item.units,
                rate: rate.toFixed(2),
                amount: amount.toFixed(2),
                dateOfService: session.sessionDate,
                modifier: item.modifier || null,
                notes: item.reasoning,
              });
              createdLineItems.push({
                ...lineItem,
                cptCode: item.cptCode,
                description: item.description,
                reasoning: item.reasoning,
              });
            }

            generatedClaim = {
              id: claim.id,
              claimNumber: claim.claimNumber,
              totalAmount: optimization.estimatedAmount.toFixed(2),
              lineItems: createdLineItems,
              optimization: {
                totalUnits: optimization.totalUnits,
                complianceScore: optimization.complianceScore,
                notes: optimization.optimizationNotes,
              },
            };

            logger.info(`AI-optimized superbill ${claim.claimNumber} for session ${session.id}: ${optimization.lineItems.length} codes, $${optimization.estimatedAmount.toFixed(2)}, ${optimization.complianceScore}% compliance`);
          }
        }
      } catch (claimError) {
        logger.error('Error auto-generating AI-optimized superbill', { error: claimError instanceof Error ? claimError.message : String(claimError) });
      }
    }

    res.json({
      ...soapNote,
      generatedClaim,
      billingOptimization,
    });
  } catch (error) {
    logger.error('Error creating SOAP note', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to create SOAP note' });
  }
});

// ==================== SOAP NOTE SIGNATURES ====================

// Sign a SOAP note
router.post('/:id/sign', isAuthenticated, async (req: any, res) => {
  try {
    const noteId = parseInt(req.params.id);
    const therapistId = req.user?.claims?.sub;

    const therapist = await storage.getUser(therapistId);
    if (!therapist) {
      return res.status(404).json({ message: "Therapist not found" });
    }

    if (!therapist.digitalSignature) {
      return res.status(400).json({
        message: "No signature on file. Please upload your signature in Settings -> Therapist Profile first."
      });
    }

    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

    const updatedNote = await storage.signSoapNote(noteId, {
      therapistId,
      therapistSignature: therapist.digitalSignature,
      therapistSignedAt: new Date(),
      therapistSignedName: `${therapist.firstName} ${therapist.lastName}`,
      therapistCredentials: therapist.credentials || '',
      signatureIpAddress: typeof ipAddress === 'string' ? ipAddress : ipAddress[0]
    });

    if (!updatedNote) {
      return res.status(404).json({ message: "SOAP note not found" });
    }

    res.json({
      message: "SOAP note signed successfully",
      signedAt: updatedNote.therapistSignedAt,
      signedBy: updatedNote.therapistSignedName
    });
  } catch (error) {
    logger.error("Error signing SOAP note", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to sign SOAP note" });
  }
});

// ==================== SOAP NOTE CO-SIGNING (Supervisor Workflow) ====================

// Get SOAP notes pending co-signature for the current supervisor
router.get('/pending-cosign', isAuthenticated, async (req: any, res) => {
  try {
    const supervisorId = req.user?.claims?.sub;
    if (!supervisorId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const pendingNotes = await storage.getPendingCosignNotes(supervisorId);
    res.json(pendingNotes);
  } catch (error) {
    logger.error("Error fetching pending cosign notes", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch pending notes" });
  }
});

// Co-sign (approve or reject) a SOAP note
router.post('/:id/cosign', isAuthenticated, async (req: any, res) => {
  try {
    const noteId = parseInt(req.params.id);
    const supervisorId = req.user?.claims?.sub;
    const { action, rejectionReason } = req.body;

    if (!supervisorId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: "Invalid action. Must be 'approve' or 'reject'" });
    }

    const soapNote = await storage.getSoapNote(noteId);
    if (!soapNote) {
      return res.status(404).json({ message: "SOAP note not found" });
    }

    if (soapNote.cosignStatus !== 'pending') {
      return res.status(400).json({ message: "SOAP note is not pending co-signature" });
    }

    if (soapNote.therapistId) {
      const therapist = await storage.getUser(soapNote.therapistId);
      if (!therapist || therapist.supervisorId !== supervisorId) {
        return res.status(403).json({ message: "You are not authorized to co-sign this note" });
      }
    } else {
      return res.status(400).json({ message: "SOAP note has no associated therapist" });
    }

    const cosignStatus = action === 'approve' ? 'approved' : 'rejected';
    const updatedNote = await storage.updateSoapNoteCosignStatus(noteId, {
      cosignedBy: supervisorId,
      cosignedAt: new Date(),
      cosignStatus,
      cosignRejectionReason: action === 'reject' ? rejectionReason : undefined,
    });

    if (!updatedNote) {
      return res.status(500).json({ message: "Failed to update co-sign status" });
    }

    const supervisor = await storage.getUser(supervisorId);
    const supervisorName = supervisor ? `${supervisor.firstName} ${supervisor.lastName}` : 'Unknown';

    res.json({
      message: action === 'approve' ? "SOAP note approved" : "SOAP note rejected",
      cosignStatus: updatedNote.cosignStatus,
      cosignedBy: supervisorName,
      cosignedAt: updatedNote.cosignedAt,
      rejectionReason: updatedNote.cosignRejectionReason,
    });
  } catch (error) {
    logger.error("Error co-signing SOAP note", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to co-sign SOAP note" });
  }
});

// ==================== THERAPY BANK ====================

// Get therapy bank entries for practice
router.get('/therapy-bank', isAuthenticated, async (req: any, res) => {
  try {
    const user = await storage.getUser(req.user.claims.sub);
    if (!user?.practiceId) {
      return res.status(400).json({ error: 'User not associated with a practice' });
    }
    const therapies = await storage.getTherapyBank(user.practiceId);
    res.json(therapies);
  } catch (error) {
    logger.error('Error fetching therapy bank', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to fetch therapy bank' });
  }
});

// Create therapy bank entry
router.post('/therapy-bank', isAuthenticated, async (req: any, res) => {
  try {
    const user = await storage.getUser(req.user.claims.sub);
    if (!user?.practiceId) {
      return res.status(400).json({ error: 'User not associated with a practice' });
    }

    const { therapyName, category } = req.body;
    if (!therapyName || typeof therapyName !== 'string' || therapyName.trim().length === 0) {
      return res.status(400).json({ error: 'Therapy name is required' });
    }

    const existingTherapies = await storage.getTherapyBank(user.practiceId);
    const exists = existingTherapies.some(
      t => t.therapyName.toLowerCase() === therapyName.trim().toLowerCase()
    );
    if (exists) {
      return res.status(409).json({ error: 'Therapy already exists in bank' });
    }

    const therapy = await storage.createTherapyBankEntry({
      practiceId: user.practiceId,
      therapyName: therapyName.trim(),
      category: category || null,
      createdBy: user.id,
    });

    res.status(201).json(therapy);
  } catch (error) {
    logger.error('Error creating therapy bank entry', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to create therapy bank entry' });
  }
});

// Delete therapy bank entry
router.delete('/therapy-bank/:id', isAuthenticated, async (req: any, res) => {
  try {
    const user = await storage.getUser(req.user.claims.sub);
    if (!user?.practiceId) {
      return res.status(400).json({ error: 'User not associated with a practice' });
    }

    const therapyId = parseInt(req.params.id);
    if (isNaN(therapyId)) {
      return res.status(400).json({ error: 'Invalid therapy ID' });
    }

    // First verify the therapy belongs to this practice
    const therapies = await storage.getTherapyBank(user.practiceId);
    const therapy = therapies.find(t => t.id === therapyId);
    if (!therapy) {
      return res.status(404).json({ error: 'Therapy not found or not authorized to delete' });
    }

    await storage.deleteTherapyBankEntry(therapyId);

    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting therapy bank entry', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to delete therapy bank entry' });
  }
});

export default router;
