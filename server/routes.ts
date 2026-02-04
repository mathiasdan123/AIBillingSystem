import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { storage } from "./storage";
import AIReimbursementPredictor from "./aiReimbursementPredictor";
import { AiClaimOptimizer } from "./aiClaimOptimizer";
import { appealGenerator } from "./aiAppealGenerator";
import { isEmailConfigured, sendTestEmail, sendDeniedClaimsReport, type DeniedClaimsReportInput } from "./email";
import { setDailyReportRecipients, getDailyReportRecipients, triggerDailyReportNow, generateAndSendWeeklyCancellationReport, triggerHardDeletionNow } from "./scheduler";
import insuranceAuthorizationRoutes from "./routes/insuranceAuthorizationRoutes";
import insuranceDataRoutes from "./routes/insuranceDataRoutes";
import { generateSoapNoteAndBilling } from "./services/aiSoapBillingService";
import { optimizeBillingCodes, getInsuranceBillingRules } from "./services/aiBillingOptimizer";
import { transcribeAudioBase64, isVoiceTranscriptionAvailable } from "./services/voiceService";
import { textToSpeech, isTextToSpeechAvailable, getAvailableVoices, soapNoteToSpeech, appealLetterToSpeech, VOICE_PRESETS } from "./services/textToSpeechService";
import { auditMiddleware } from "./middleware/auditMiddleware";
import logger from "./services/logger";
import { registerPatientRightsRoutes } from "./routes/patientRightsRoutes";
import { registerBaaRoutes } from "./routes/baaRoutes";
import { registerBreachNotificationRoutes } from "./routes/breachNotificationRoutes";
import { StediAdapter } from "./payer-integrations/adapters/payers/StediAdapter";

// Initialize AI predictor (in production, this would load from database)
const reimbursementPredictor = new AIReimbursementPredictor();
const claimOptimizer = new AiClaimOptimizer();

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
    console.error("Error checking user role:", error);
    res.status(500).json({ message: "Failed to verify permissions" });
  }
};

// Middleware to check if user has admin role (for user management)
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
    console.error("Error checking user role:", error);
    res.status(500).json({ message: "Failed to verify permissions" });
  }
};

// Generate mock eligibility data for testing
// In production, this would be replaced by real API calls
function generateMockEligibility(patient: any, insurance: any) {
  // Simulate realistic eligibility outcomes
  const random = Math.random();

  // 85% active, 10% inactive, 5% unknown
  let status: 'active' | 'inactive' | 'unknown';
  if (random < 0.85) {
    status = 'active';
  } else if (random < 0.95) {
    status = 'inactive';
  } else {
    status = 'unknown';
  }

  // If inactive or unknown, return minimal info
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
      message: status === 'inactive' ? 'Coverage terminated' : 'Unable to verify eligibility',
    };
  }

  // Generate realistic coverage details for active coverage
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

  // Effective date is 1-2 years ago
  const effectiveDate = new Date(Date.now() - (365 + Math.random() * 365) * 24 * 60 * 60 * 1000);

  // Termination date is end of current year or next year
  const currentYear = new Date().getFullYear();
  const terminationDate = new Date(currentYear + (Math.random() < 0.5 ? 0 : 1), 11, 31);

  return {
    status,
    coverageType,
    effectiveDate: effectiveDate.toISOString().split('T')[0],
    terminationDate: terminationDate.toISOString().split('T')[0],
    copay,
    deductible,
    deductibleMet,
    outOfPocketMax,
    outOfPocketMet,
    coinsurance,
    visitsAllowed,
    visitsUsed,
    authRequired,
    message: 'Coverage verified successfully',
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // HIPAA audit middleware
  app.use('/api', auditMiddleware);

  // Register HIPAA compliance routes
  registerPatientRightsRoutes(app);
  registerBaaRoutes(app);
  registerBreachNotificationRoutes(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Development user endpoint (bypass auth in dev)
  app.get('/api/dev-user', async (req, res) => {
    res.json({
      id: 'dev-user-123',
      email: 'dev@example.com',
      firstName: 'Dev',
      lastName: 'User',
      profileImageUrl: null,
      role: 'admin' // Dev user is admin for testing
    });
  });

  // User management endpoints (admin only)
  app.get('/api/users', isAuthenticated, isAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      // Don't expose sensitive fields
      const safeUsers = users.map(u => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        createdAt: u.createdAt
      }));
      res.json(safeUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch('/api/users/:id/role', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body;

      // Validate role
      if (!['therapist', 'admin', 'billing'].includes(role)) {
        return res.status(400).json({ message: "Invalid role. Must be 'therapist', 'admin', or 'billing'" });
      }

      // Prevent removing your own admin role
      const currentUserId = req.user?.claims?.sub;
      if (id === currentUserId && role !== 'admin') {
        return res.status(400).json({ message: "You cannot remove your own admin role" });
      }

      const updatedUser = await storage.updateUserRole(id, role);
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        role: updatedUser.role
      });
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  // One-time setup: Make current user admin (for initial setup only)
  app.post('/api/setup/make-admin', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      // Check if any admin exists
      const allUsers = await storage.getAllUsers();
      const existingAdmin = allUsers.find(u => u.role === 'admin');

      if (existingAdmin) {
        return res.status(400).json({
          message: "An admin already exists. Use the User Management settings to change roles."
        });
      }

      // Make current user admin
      const updatedUser = await storage.updateUserRole(userId, 'admin');
      res.json({
        message: "You are now an admin!",
        user: {
          id: updatedUser?.id,
          email: updatedUser?.email,
          role: updatedUser?.role
        }
      });
    } catch (error) {
      console.error("Error in setup:", error);
      res.status(500).json({ message: "Failed to complete setup" });
    }
  });

  // ==================== PRACTICE MANAGEMENT ====================

  // Get practice by ID
  app.get('/api/practices/:id', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.params.id);
      const practice = await storage.getPractice(practiceId);
      if (!practice) {
        return res.status(404).json({ message: "Practice not found" });
      }
      res.json(practice);
    } catch (error) {
      console.error("Error fetching practice:", error);
      res.status(500).json({ message: "Failed to fetch practice" });
    }
  });

  // Update practice settings
  app.patch('/api/practices/:id', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.params.id);
      const updates = req.body;

      // Remove any undefined or null values
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([_, v]) => v !== undefined && v !== null)
      );

      const practice = await storage.updatePractice(practiceId, cleanUpdates);
      if (!practice) {
        return res.status(404).json({ message: "Practice not found" });
      }
      res.json(practice);
    } catch (error) {
      console.error("Error updating practice:", error);
      res.status(500).json({ message: "Failed to update practice" });
    }
  });

  // Invite endpoints (admin only)
  app.post('/api/invites', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const { email, role, practiceId } = req.body;
      const invitedById = req.user?.claims?.sub;

      console.log("Creating invite for:", { email, role, practiceId, invitedById });

      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Please enter a valid email address" });
      }

      // Validate role
      if (role && !['therapist', 'admin', 'billing'].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }

      if (!invitedById) {
        return res.status(400).json({ message: "Could not determine inviter ID" });
      }

      // Check if user already exists with this email
      const allUsers = await storage.getAllUsers();
      const existingUser = allUsers.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (existingUser) {
        return res.status(400).json({ message: "A user with this email already exists" });
      }

      // Check if there's already a pending invite for this email
      const existingInvite = await storage.getInviteByEmail(email);
      if (existingInvite) {
        return res.status(400).json({ message: "An invite has already been sent to this email" });
      }

      // Generate unique token
      const token = Math.random().toString(36).substring(2) + Date.now().toString(36);

      // Set expiry to 7 days from now
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const inviteData = {
        email: email.trim(),
        role: role || 'therapist',
        practiceId: practiceId || 1, // Default practice for now
        invitedById,
        token,
        expiresAt,
        status: 'pending',
      };

      console.log("Invite data to insert:", inviteData);

      const invite = await storage.createInvite(inviteData);

      res.json({
        message: "Invite created successfully",
        invite: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          token: invite.token,
          expiresAt: invite.expiresAt,
          inviteLink: `/invite/${invite.token}`
        }
      });
    } catch (error: any) {
      console.error("Error creating invite:", error);
      console.error("Error details:", error?.message, error?.code, error?.detail);
      res.status(500).json({ message: error?.message || "Failed to create invite" });
    }
  });

  app.get('/api/invites', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const practiceId = 1; // Default practice for now
      const invites = await storage.getInvitesByPractice(practiceId);
      res.json(invites);
    } catch (error) {
      console.error("Error fetching invites:", error);
      res.status(500).json({ message: "Failed to fetch invites" });
    }
  });

  app.get('/api/invites/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const invite = await storage.getInviteByToken(token);

      if (!invite) {
        return res.status(404).json({ message: "Invite not found" });
      }

      if (invite.status === 'accepted') {
        return res.status(400).json({ message: "This invite has already been used" });
      }

      if (invite.status === 'expired' || new Date() > invite.expiresAt) {
        return res.status(400).json({ message: "This invite has expired" });
      }

      res.json({
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt
      });
    } catch (error) {
      console.error("Error fetching invite:", error);
      res.status(500).json({ message: "Failed to fetch invite" });
    }
  });

  app.post('/api/invites/:token/accept', isAuthenticated, async (req: any, res) => {
    try {
      const { token } = req.params;
      const userId = req.user?.claims?.sub;

      const invite = await storage.getInviteByToken(token);

      if (!invite) {
        return res.status(404).json({ message: "Invite not found" });
      }

      if (invite.status === 'accepted') {
        return res.status(400).json({ message: "This invite has already been used" });
      }

      if (new Date() > invite.expiresAt) {
        await storage.updateInviteStatus(invite.id, 'expired');
        return res.status(400).json({ message: "This invite has expired" });
      }

      // Update user's role and practice
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Update user role to match invite
      await storage.updateUserRole(userId, invite.role || 'therapist');

      // Mark invite as accepted
      await storage.updateInviteStatus(invite.id, 'accepted', new Date());

      res.json({
        message: "Invite accepted successfully",
        role: invite.role
      });
    } catch (error) {
      console.error("Error accepting invite:", error);
      res.status(500).json({ message: "Failed to accept invite" });
    }
  });

  // Dashboard analytics (financial data filtered by role)
  app.get('/api/analytics/dashboard', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub;
      const user = userId ? await storage.getUser(userId) : null;
      const isAdminOrBillingRole = user?.role === 'admin' || user?.role === 'billing';

      // Base stats visible to all authenticated users
      const baseStats = {
        totalPatients: 3,
        activeClaims: 2,
        pendingPayments: 1,
        claimApprovalRate: 94.2
      };

      // Financial data only for admin/billing
      if (isAdminOrBillingRole) {
        res.json({
          ...baseStats,
          monthlyRevenue: 12500,
          averageReimbursement: 142.50
        });
      } else {
        res.json(baseStats);
      }
    } catch (error) {
      console.error("Error fetching dashboard:", error);
      res.status(500).json({ message: "Failed to fetch dashboard data" });
    }
  });

  // Enhanced reimbursement estimation with AI predictions (admin/billing only)
  app.post('/api/estimate-reimbursement', isAuthenticated, isAdminOrBilling, async (req, res) => {
    try {
      const { insuranceProvider, cptCodes, sessionCount, deductibleMet, planType, region, patientAge } = req.body;

      if (!insuranceProvider || !cptCodes || !Array.isArray(cptCodes)) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Get AI predictions for all CPT codes  
      const predictions = reimbursementPredictor.predictMultipleCodes(
        insuranceProvider,
        cptCodes,
        {
          insuranceProvider,
          practiceCharge: 150, // Default practice rate, should come from practice settings
          deductibleMet: deductibleMet || false,
          planType: planType || 'PPO',
          region: region || 'National',
          patientAge: patientAge || 35,
          sessionType: 'follow-up'
        }
      );

      // Convert predictions to expected format
      const estimates = cptCodes.map((cptCode: string) => {
        const prediction = predictions[cptCode];
        const practiceCharge = 150; // This should come from practice settings
        const insuranceReimbursement = prediction.predictedReimbursement;
        const patientResponsibility = Math.max(0, practiceCharge - insuranceReimbursement);

        return {
          cptCode,
          practiceCharge,
          insuranceReimbursement,
          patientResponsibility,
          confidence: prediction.confidenceScore,
          dataPoints: prediction.dataPoints,
          trends: prediction.trends,
          recommendations: prediction.recommendations
        };
      });

      res.json({
        estimates,
        totalSessions: sessionCount || 1,
        insuranceProvider,
        metadata: {
          predictionAccuracy: 'AI-enhanced estimates',
          lastUpdated: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error estimating reimbursement:', error);
      res.status(500).json({ error: 'Failed to estimate reimbursement' });
    }
  });

  // Upload historical reimbursement data (admin/billing only)
  app.post('/api/upload-reimbursement-data', isAuthenticated, isAdminOrBilling, async (req, res) => {
    try {
      const { records } = req.body;

      if (!Array.isArray(records)) {
        return res.status(400).json({ error: 'Records must be an array' });
      }

      // Validate record format
      const validRecords = records.filter(record => 
        record.insuranceProvider && 
        record.cptCode && 
        typeof record.practiceCharge === 'number' &&
        typeof record.insuranceReimbursement === 'number' &&
        record.dateOfService
      );

      if (validRecords.length === 0) {
        return res.status(400).json({ error: 'No valid records found' });
      }

      // Import data into AI predictor
      reimbursementPredictor.importHistoricalData(validRecords);

      res.json({
        message: 'Historical data imported successfully',
        importedRecords: validRecords.length,
        skippedRecords: records.length - validRecords.length
      });

    } catch (error) {
      console.error('Error uploading reimbursement data:', error);
      res.status(500).json({ error: 'Failed to upload data' });
    }
  });

  // Get AI prediction insights (admin/billing only)
  app.get('/api/reimbursement-insights/:insuranceProvider/:cptCode', isAuthenticated, isAdminOrBilling, async (req, res) => {
    try {
      const { insuranceProvider, cptCode } = req.params;
      
      const prediction = reimbursementPredictor.predictReimbursement({
        insuranceProvider,
        cptCode,
        practiceCharge: 150,
        deductibleMet: false,
        planType: 'PPO'
      });

      res.json({
        prediction,
        insights: {
          dataQuality: prediction.dataPoints > 10 ? 'Good' : 'Limited',
          recommendedActions: prediction.recommendations,
          trendAnalysis: prediction.trends
        }
      });

    } catch (error) {
      console.error('Error getting insights:', error);
      res.status(500).json({ error: 'Failed to get insights' });
    }
  });

  // Export training data for external ML systems (admin/billing only)
  app.get('/api/export-training-data', isAuthenticated, isAdminOrBilling, async (req, res) => {
    try {
      const trainingData = reimbursementPredictor.exportTrainingData();
      
      res.json({
        success: true,
        data: trainingData,
        exportDate: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error exporting training data:', error);
      res.status(500).json({ error: 'Failed to export training data' });
    }
  });

  // Patients API routes
  app.get('/api/patients', async (req, res) => {
    try {
      const patients = await storage.getAllPatients();
      res.json(patients);
    } catch (error) {
      console.error('Error fetching patients:', error);
      res.status(500).json({ error: 'Failed to fetch patients' });
    }
  });

  app.post('/api/patients', async (req, res) => {
    try {
      const patient = await storage.createPatient(req.body);
      res.json(patient);
    } catch (error) {
      console.error('Error creating patient:', error);
      res.status(500).json({ error: 'Failed to create patient' });
    }
  });

  // CPT Codes API routes
  app.get('/api/cpt-codes', async (req, res) => {
    try {
      const cptCodes = await storage.getAllCptCodes();
      res.json(cptCodes);
    } catch (error) {
      console.error('Error fetching CPT codes:', error);
      res.status(500).json({ error: 'Failed to fetch CPT codes' });
    }
  });

  // SOAP Notes API routes
  app.get('/api/soap-notes', async (req, res) => {
    try {
      const soapNotes = await storage.getAllSoapNotes();
      res.json(soapNotes);
    } catch (error) {
      console.error('Error fetching SOAP notes:', error);
      res.status(500).json({ error: 'Failed to fetch SOAP notes' });
    }
  });

  app.post('/api/soap-notes', async (req, res) => {
    try {
      const soapNote = await storage.createSoapNote(req.body);

      // Auto-generate AI-optimized superbill from the session
      let generatedClaim = null;
      let billingOptimization = null;
      if (soapNote.sessionId) {
        try {
          // Get the session details
          const sessions = await storage.getAllSessions();
          const session = sessions.find((s: any) => s.id === soapNote.sessionId);

          if (session) {
            // Check if session already has a claim
            const existingClaims = await storage.getClaims(session.practiceId || 1);
            const existingClaim = existingClaims.find((c: any) => c.sessionId === session.id);

            if (!existingClaim) {
              // Get all CPT codes and ICD-10 codes
              const cptCodes = await storage.getCptCodes();
              const icd10Codes = await storage.getIcd10Codes();

              // Get patient to find their insurance
              const patients = await storage.getPatients(session.practiceId || 1);
              const patient = patients.find((p: any) => p.id === session.patientId);
              const insuranceName = patient?.insuranceProvider || 'Unknown Insurance';

              // Get ICD-10 code if assigned
              const icd10Code = session.icd10CodeId
                ? icd10Codes.find((i: any) => i.id === session.icd10CodeId)
                : null;

              // Get insurance rules (would come from database in production)
              const { rules, preferences } = await getInsuranceBillingRules(storage, null);

              // Use AI to optimize billing codes based on SOAP content and insurance rules
              console.log(`AI optimizing billing for session ${session.id}, insurance: ${insuranceName}`);

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

              // Generate claim number
              const claimNumber = `SB-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

              // Create the claim with AI-optimized total
              const claim = await storage.createClaim({
                practiceId: session.practiceId || 1,
                patientId: session.patientId,
                sessionId: session.id,
                insuranceId: null,
                claimNumber,
                totalAmount: optimization.estimatedAmount.toFixed(2),
                status: 'draft',
                serviceDate: session.sessionDate,
                aiReviewNotes: `AI Billing Optimization (${optimization.complianceScore}% compliance): ${optimization.optimizationNotes}`,
              });

              // Create line items for each recommended code
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

              console.log(`AI-optimized superbill ${claim.claimNumber} for session ${session.id}: ${optimization.lineItems.length} codes, $${optimization.estimatedAmount.toFixed(2)}, ${optimization.complianceScore}% compliance`);
            }
          }
        } catch (claimError) {
          // Log but don't fail - SOAP note was created successfully
          console.error('Error auto-generating AI-optimized superbill:', claimError);
        }
      }

      res.json({
        ...soapNote,
        generatedClaim,
        billingOptimization,
      });
    } catch (error) {
      console.error('Error creating SOAP note:', error);
      res.status(500).json({ error: 'Failed to create SOAP note' });
    }
  });

  // Treatment Sessions API routes
  app.get('/api/sessions', async (req, res) => {
    try {
      const sessions = await storage.getAllSessions();
      res.json(sessions);
    } catch (error) {
      console.error('Error fetching sessions:', error);
      res.status(500).json({ error: 'Failed to fetch sessions' });
    }
  });

  app.post('/api/sessions', async (req, res) => {
    try {
      // Ensure therapist user exists before creating session (foreign key constraint)
      if (req.body.therapistId) {
        const existingUser = await storage.getUser(req.body.therapistId);
        if (!existingUser) {
          // Create a placeholder user record for the therapist
          await storage.upsertUser({
            id: req.body.therapistId,
            email: `${req.body.therapistId}@placeholder.local`,
            firstName: 'Therapist',
            lastName: 'User',
          });
        }
      }
      const session = await storage.createSession(req.body);
      res.json(session);
    } catch (error) {
      console.error('Error creating session:', error);
      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  // ==================== INSURANCES ENDPOINT ====================

  app.get('/api/insurances', isAuthenticated, async (req: any, res) => {
    try {
      const insurances = await storage.getInsurances();
      res.json(insurances);
    } catch (error) {
      console.error('Error fetching insurances:', error);
      res.status(500).json({ message: 'Failed to fetch insurances' });
    }
  });

  // ==================== ELIGIBILITY VERIFICATION ====================

  // Check insurance eligibility for a patient
  app.post('/api/insurance/eligibility', isAuthenticated, async (req: any, res) => {
    try {
      const { patientId, insuranceId } = req.body;

      if (!patientId) {
        return res.status(400).json({ message: 'Patient ID is required' });
      }

      // Get patient details
      const patient = await storage.getPatient(patientId);
      if (!patient) {
        return res.status(404).json({ message: 'Patient not found' });
      }

      // Get insurance details if provided
      let insurance = null;
      if (insuranceId) {
        const insurances = await storage.getInsurances();
        insurance = insurances.find((i: any) => i.id === insuranceId);
      }

      // Check if real API is configured (future: check insurance.eligibilityApiConfig)
      const hasRealApi = insurance?.eligibilityApiConfig &&
                         Object.keys(insurance.eligibilityApiConfig as object).length > 0;

      let eligibilityResult;

      if (hasRealApi) {
        // Future: Call real eligibility API based on config
        // For now, fall through to mock
      }

      // Generate mock eligibility response
      eligibilityResult = generateMockEligibility(patient, insurance);

      // Store the result in the database
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
        insurance: insurance ? {
          id: insurance.id,
          name: insurance.name,
        } : null,
      });
    } catch (error: any) {
      console.error('Error checking eligibility:', error);
      res.status(500).json({ message: error.message || 'Failed to check eligibility' });
    }
  });

  // Get most recent eligibility for a patient
  app.get('/api/patients/:id/eligibility', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const eligibility = await storage.getPatientEligibility(patientId);
      res.json(eligibility || null);
    } catch (error) {
      console.error('Error fetching eligibility:', error);
      res.status(500).json({ message: 'Failed to fetch eligibility' });
    }
  });

  // Get eligibility history for a patient
  app.get('/api/patients/:id/eligibility/history', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const history = await storage.getEligibilityHistory(patientId);
      res.json(history);
    } catch (error) {
      console.error('Error fetching eligibility history:', error);
      res.status(500).json({ message: 'Failed to fetch eligibility history' });
    }
  });

  // ==================== ELIGIBILITY ALERTS ====================

  // Get eligibility alerts for practice
  app.get('/api/eligibility-alerts', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
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
      console.error('Error fetching eligibility alerts:', error);
      res.status(500).json({ message: 'Failed to fetch eligibility alerts' });
    }
  });

  // Get eligibility alert stats
  app.get('/api/eligibility-alerts/stats', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const stats = await storage.getEligibilityAlertStats(practiceId);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching eligibility alert stats:', error);
      res.status(500).json({ message: 'Failed to fetch eligibility alert stats' });
    }
  });

  // Get single eligibility alert
  app.get('/api/eligibility-alerts/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const alert = await storage.getEligibilityAlert(id);
      if (!alert) {
        return res.status(404).json({ message: 'Alert not found' });
      }
      res.json(alert);
    } catch (error) {
      console.error('Error fetching eligibility alert:', error);
      res.status(500).json({ message: 'Failed to fetch eligibility alert' });
    }
  });

  // Create eligibility alert
  app.post('/api/eligibility-alerts', isAuthenticated, async (req: any, res) => {
    try {
      const alert = await storage.createEligibilityAlert(req.body);
      res.status(201).json(alert);
    } catch (error) {
      console.error('Error creating eligibility alert:', error);
      res.status(500).json({ message: 'Failed to create eligibility alert' });
    }
  });

  // Update eligibility alert
  app.patch('/api/eligibility-alerts/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const alert = await storage.updateEligibilityAlert(id, req.body);
      if (!alert) {
        return res.status(404).json({ message: 'Alert not found' });
      }
      res.json(alert);
    } catch (error) {
      console.error('Error updating eligibility alert:', error);
      res.status(500).json({ message: 'Failed to update eligibility alert' });
    }
  });

  // Acknowledge eligibility alert
  app.post('/api/eligibility-alerts/:id/acknowledge', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.id || 'system';
      const alert = await storage.acknowledgeEligibilityAlert(id, userId);
      if (!alert) {
        return res.status(404).json({ message: 'Alert not found' });
      }
      res.json(alert);
    } catch (error) {
      console.error('Error acknowledging eligibility alert:', error);
      res.status(500).json({ message: 'Failed to acknowledge eligibility alert' });
    }
  });

  // Resolve eligibility alert
  app.post('/api/eligibility-alerts/:id/resolve', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.id || 'system';
      const { notes } = req.body;
      const alert = await storage.resolveEligibilityAlert(id, userId, notes);
      if (!alert) {
        return res.status(404).json({ message: 'Alert not found' });
      }
      res.json(alert);
    } catch (error) {
      console.error('Error resolving eligibility alert:', error);
      res.status(500).json({ message: 'Failed to resolve eligibility alert' });
    }
  });

  // Dismiss eligibility alert
  app.post('/api/eligibility-alerts/:id/dismiss', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.id || 'system';
      const { notes } = req.body;
      const alert = await storage.dismissEligibilityAlert(id, userId, notes);
      if (!alert) {
        return res.status(404).json({ message: 'Alert not found' });
      }
      res.json(alert);
    } catch (error) {
      console.error('Error dismissing eligibility alert:', error);
      res.status(500).json({ message: 'Failed to dismiss eligibility alert' });
    }
  });

  // Batch eligibility verification for upcoming appointments
  app.post('/api/eligibility/batch-verify', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.body.practiceId) || 1;
      const hoursAhead = parseInt(req.body.hoursAhead) || 24;

      // Get appointments needing eligibility check
      const appointmentsToCheck = await storage.getAppointmentsNeedingEligibilityCheck(practiceId, hoursAhead);

      const results = [];
      const alertsToCreate = [];

      // Get all insurances for lookup
      const allInsurances = await storage.getInsurances();

      for (const appointment of appointmentsToCheck) {
        if (!appointment.patientId) continue;

        const patient = await storage.getPatient(appointment.patientId);
        if (!patient?.insuranceId && !patient?.insuranceProvider) continue;

        // Find insurance by provider name if available
        const insurance = patient.insuranceProvider
          ? allInsurances.find((i: any) => i.name.toLowerCase() === patient.insuranceProvider?.toLowerCase())
          : null;

        // Generate eligibility check (mock for now)
        const eligibilityResult = generateMockEligibility(patient, insurance);

        // Save eligibility check
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

        // Check for alerts
        if (eligibilityResult.status === 'inactive') {
          alertsToCreate.push({
            patientId: patient.id,
            practiceId,
            appointmentId: appointment.id,
            alertType: 'coverage_inactive',
            severity: 'critical',
            title: 'Coverage Inactive',
            message: `${patient.firstName} ${patient.lastName}'s insurance coverage is inactive. Appointment on ${new Date(appointment.startTime).toLocaleDateString()}.`,
            currentStatus: eligibilityResult,
          });
        } else if (eligibilityResult.authRequired) {
          alertsToCreate.push({
            patientId: patient.id,
            practiceId,
            appointmentId: appointment.id,
            alertType: 'auth_required',
            severity: 'warning',
            title: 'Authorization Required',
            message: `Prior authorization may be required for ${patient.firstName} ${patient.lastName}'s appointment on ${new Date(appointment.startTime).toLocaleDateString()}.`,
            currentStatus: eligibilityResult,
          });
        } else if (eligibilityResult.deductibleMet === 0) {
          alertsToCreate.push({
            patientId: patient.id,
            practiceId,
            appointmentId: appointment.id,
            alertType: 'deductible_not_met',
            severity: 'info',
            title: 'Deductible Not Met',
            message: `${patient.firstName} ${patient.lastName} has not met their deductible ($${eligibilityResult.deductible}). Patient responsibility may be higher.`,
            currentStatus: eligibilityResult,
          });
        } else if (eligibilityResult.copay && eligibilityResult.copay >= 50) {
          alertsToCreate.push({
            patientId: patient.id,
            practiceId,
            appointmentId: appointment.id,
            alertType: 'high_copay',
            severity: 'info',
            title: 'High Copay',
            message: `${patient.firstName} ${patient.lastName} has a $${eligibilityResult.copay} copay for this visit.`,
            currentStatus: eligibilityResult,
          });
        }

        results.push({
          appointmentId: appointment.id,
          patientId: patient.id,
          patientName: `${patient.firstName} ${patient.lastName}`,
          eligibility: savedCheck,
          status: eligibilityResult.status,
        });
      }

      // Create alerts in batch
      if (alertsToCreate.length > 0) {
        await storage.createEligibilityAlertsBatch(alertsToCreate);
      }

      res.json({
        verified: results.length,
        alertsCreated: alertsToCreate.length,
        results,
      });
    } catch (error) {
      console.error('Error in batch eligibility verification:', error);
      res.status(500).json({ message: 'Failed to perform batch eligibility verification' });
    }
  });

  // Run pre-appointment eligibility check for a specific appointment
  app.post('/api/appointments/:id/check-eligibility', isAuthenticated, async (req: any, res) => {
    try {
      const appointmentId = parseInt(req.params.id);
      const appointment = await storage.getAppointment(appointmentId);

      if (!appointment) {
        return res.status(404).json({ message: 'Appointment not found' });
      }

      if (!appointment.patientId) {
        return res.status(400).json({ message: 'Appointment has no patient assigned' });
      }

      const patient = await storage.getPatient(appointment.patientId);
      if (!patient?.insuranceId && !patient?.insuranceProvider) {
        return res.status(400).json({ message: 'Patient has no insurance on file' });
      }

      // Find insurance by provider name if available
      const allInsurances = await storage.getInsurances();
      const insurance = patient.insuranceProvider
        ? allInsurances.find((i: any) => i.name.toLowerCase() === patient.insuranceProvider?.toLowerCase())
        : null;

      // Generate eligibility check
      const eligibilityResult = generateMockEligibility(patient, insurance);

      // Save eligibility check
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

      // Check for issues and create alerts
      const alerts = [];
      if (eligibilityResult.status === 'inactive') {
        const alert = await storage.createEligibilityAlert({
          patientId: patient.id,
          practiceId: appointment.practiceId!,
          appointmentId: appointment.id ?? undefined,
          alertType: 'coverage_inactive',
          severity: 'critical',
          title: 'Coverage Inactive',
          message: `Insurance coverage is inactive for this patient.`,
          currentStatus: eligibilityResult,
        });
        alerts.push(alert);
      }

      if (eligibilityResult.authRequired) {
        const alert = await storage.createEligibilityAlert({
          patientId: patient.id,
          practiceId: appointment.practiceId!,
          appointmentId: appointment.id ?? undefined,
          alertType: 'auth_required',
          severity: 'warning',
          title: 'Authorization Required',
          message: `Prior authorization may be required for this visit.`,
          currentStatus: eligibilityResult,
        });
        alerts.push(alert);
      }

      res.json({
        eligibility: savedCheck,
        alerts,
        patient: {
          id: patient.id,
          name: `${patient.firstName} ${patient.lastName}`,
        },
        insurance: insurance ? {
          id: insurance.id,
          name: insurance.name,
        } : {
          id: null,
          name: patient.insuranceProvider || 'Unknown',
        },
      });
    } catch (error) {
      console.error('Error checking appointment eligibility:', error);
      res.status(500).json({ message: 'Failed to check eligibility' });
    }
  });

  // Get alerts for a specific appointment
  app.get('/api/appointments/:id/eligibility-alerts', isAuthenticated, async (req: any, res) => {
    try {
      const appointmentId = parseInt(req.params.id);
      const alerts = await storage.getOpenAlertsForAppointment(appointmentId);
      res.json(alerts);
    } catch (error) {
      console.error('Error fetching appointment eligibility alerts:', error);
      res.status(500).json({ message: 'Failed to fetch eligibility alerts' });
    }
  });

  // ==================== SESSIONS ENDPOINTS ====================

  // Get all sessions for practice
  app.get('/api/sessions', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const sessions = await storage.getAllSessions();
      const practiceSessions = sessions.filter((s: any) => s.practiceId === practiceId);
      res.json(practiceSessions);
    } catch (error) {
      console.error('Error fetching sessions:', error);
      res.status(500).json({ message: 'Failed to fetch sessions' });
    }
  });

  // Get unbilled sessions (sessions without a claim)
  app.get('/api/sessions/unbilled', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const sessions = await storage.getAllSessions();
      const claims = await storage.getClaims(practiceId);

      // Filter sessions that don't have a claim yet
      const billedSessionIds = claims
        .filter((c: any) => c.sessionId)
        .map((c: any) => c.sessionId);

      const unbilledSessions = sessions.filter((s: any) =>
        s.practiceId === practiceId &&
        s.status === 'completed' &&
        !billedSessionIds.includes(s.id)
      );

      // Enrich with patient, CPT code, and ICD-10 info
      const patients = await storage.getPatients(practiceId);
      const cptCodes = await storage.getCptCodes();
      const icd10Codes = await storage.getIcd10Codes();

      const enrichedSessions = unbilledSessions.map((session: any) => ({
        ...session,
        patient: patients.find((p: any) => p.id === session.patientId),
        cptCode: cptCodes.find((c: any) => c.id === session.cptCodeId),
        icd10Code: icd10Codes.find((i: any) => i.id === session.icd10CodeId),
      }));

      res.json(enrichedSessions);
    } catch (error) {
      console.error('Error fetching unbilled sessions:', error);
      res.status(500).json({ message: 'Failed to fetch unbilled sessions' });
    }
  });

  // Generate superbill/claim with multiple line items
  app.post('/api/superbills', isAuthenticated, async (req: any, res) => {
    try {
      const { patientId, insuranceId, dateOfService, lineItems, sessionId } = req.body;
      const practiceId = 1;

      if (!patientId || !lineItems || lineItems.length === 0) {
        return res.status(400).json({ message: 'Patient ID and at least one line item are required' });
      }

      // Get CPT codes for rate lookup
      const cptCodes = await storage.getCptCodes();
      const icd10Codes = await storage.getIcd10Codes();

      // Calculate totals and validate line items
      let totalAmount = 0;
      const processedLineItems = lineItems.map((item: any) => {
        const cptCode = cptCodes.find((c: any) => c.id === item.cptCodeId);
        if (!cptCode) {
          throw new Error(`Invalid CPT code ID: ${item.cptCodeId}`);
        }
        const rate = parseFloat(cptCode.baseRate || '289.00');
        const units = item.units || 1;
        const amount = rate * units;
        totalAmount += amount;

        return {
          cptCodeId: item.cptCodeId,
          icd10CodeId: item.icd10CodeId || null,
          units,
          rate: rate.toFixed(2),
          amount: amount.toFixed(2),
          dateOfService: dateOfService || new Date().toISOString().split('T')[0],
          modifier: item.modifier || null,
          notes: item.notes || null,
        };
      });

      // Generate claim number
      const claimNumber = `CLM-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      // Create the claim
      const claim = await storage.createClaim({
        practiceId,
        patientId,
        sessionId: sessionId || null,
        insuranceId: insuranceId || null,
        claimNumber,
        totalAmount: totalAmount.toFixed(2),
        status: 'draft',
      });

      // Create line items
      const createdLineItems = [];
      for (const item of processedLineItems) {
        const lineItem = await storage.createClaimLineItem({
          claimId: claim.id,
          ...item,
        });
        createdLineItems.push(lineItem);
      }

      // Enrich response with CPT code details
      const enrichedLineItems = createdLineItems.map((item: any) => {
        const cptCode = cptCodes.find((c: any) => c.id === item.cptCodeId);
        const icd10Code = icd10Codes.find((i: any) => i.id === item.icd10CodeId);
        return {
          ...item,
          cptCode: cptCode ? { code: cptCode.code, description: cptCode.description } : null,
          icd10Code: icd10Code ? { code: icd10Code.code, description: icd10Code.description } : null,
        };
      });

      res.json({
        message: 'Superbill created successfully',
        claim,
        lineItems: enrichedLineItems,
        totalAmount: totalAmount.toFixed(2),
      });
    } catch (error: any) {
      console.error('Error creating superbill:', error);
      res.status(500).json({ message: error.message || 'Failed to create superbill' });
    }
  });

  // Legacy: Generate simple claim from session (single CPT code)
  app.post('/api/sessions/:id/generate-claim', isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const { insuranceId } = req.body;
      const practiceId = 1;

      // Get session details
      const sessions = await storage.getAllSessions();
      const session = sessions.find((s: any) => s.id === sessionId);

      if (!session) {
        return res.status(404).json({ message: 'Session not found' });
      }

      // Check if session already has a claim
      const existingClaims = await storage.getClaims(practiceId);
      const existingClaim = existingClaims.find((c: any) => c.sessionId === sessionId);
      if (existingClaim) {
        return res.status(400).json({ message: 'Session already has a claim', claim: existingClaim });
      }

      // Get CPT code to calculate amount
      const cptCodes = await storage.getCptCodes();
      const cptCode = cptCodes.find((c: any) => c.id === session.cptCodeId);

      if (!cptCode) {
        return res.status(400).json({ message: 'Session has no valid CPT code' });
      }

      // Calculate total amount: rate × units
      const rate = parseFloat(cptCode.baseRate || '289.00');
      const units = session.units || 1;
      const totalAmount = (rate * units).toFixed(2);

      // Generate claim number
      const claimNumber = `CLM-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      // Create the claim/superbill
      const claim = await storage.createClaim({
        practiceId,
        patientId: session.patientId,
        sessionId,
        insuranceId: insuranceId || null,
        claimNumber,
        totalAmount,
        status: 'draft',
      });

      // Create the line item
      const lineItem = await storage.createClaimLineItem({
        claimId: claim.id,
        cptCodeId: session.cptCodeId,
        icd10CodeId: session.icd10CodeId || null,
        units,
        rate: rate.toFixed(2),
        amount: totalAmount,
        dateOfService: session.sessionDate,
      });

      res.json({
        message: 'Superbill generated successfully',
        claim,
        lineItems: [{
          ...lineItem,
          cptCode: { code: cptCode.code, description: cptCode.description },
        }],
        superbillDetails: {
          dateOfService: session.sessionDate,
          cptCode: cptCode.code,
          cptDescription: cptCode.description,
          units,
          rate,
          totalAmount,
          icd10CodeId: session.icd10CodeId,
        }
      });
    } catch (error: any) {
      console.error('Error generating superbill:', error);
      res.status(500).json({ message: 'Failed to generate superbill' });
    }
  });

  // Create superbill with multiple CPT codes (line items)
  app.post('/api/superbills', isAuthenticated, async (req: any, res) => {
    try {
      const { patientId, insuranceId, dateOfService, lineItems } = req.body;
      const practiceId = 1;

      if (!patientId) {
        return res.status(400).json({ message: 'Patient ID is required' });
      }

      if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) {
        return res.status(400).json({ message: 'At least one line item is required' });
      }

      // Get CPT codes to calculate amounts
      const cptCodes = await storage.getCptCodes();

      // Calculate total from all line items
      let totalAmount = 0;
      const validatedLineItems = lineItems.map((item: any) => {
        const cptCode = cptCodes.find((c: any) => c.id === item.cptCodeId);
        if (!cptCode) {
          throw new Error(`Invalid CPT code ID: ${item.cptCodeId}`);
        }
        const rate = parseFloat(cptCode.baseRate || '289.00');
        const units = item.units || 1;
        const amount = rate * units;
        totalAmount += amount;
        return {
          cptCodeId: item.cptCodeId,
          icd10CodeId: item.icd10CodeId || null,
          units,
          rate: rate.toFixed(2),
          amount: amount.toFixed(2),
          dateOfService: dateOfService || new Date().toISOString().split('T')[0],
          cptCode,
        };
      });

      // Generate claim number
      const claimNumber = `SB-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      // Create the claim
      const claim = await storage.createClaim({
        practiceId,
        patientId,
        insuranceId: insuranceId || null,
        claimNumber,
        totalAmount: totalAmount.toFixed(2),
        status: 'draft',
      });

      // Create all line items
      const createdLineItems = [];
      for (const item of validatedLineItems) {
        const lineItem = await storage.createClaimLineItem({
          claimId: claim.id,
          cptCodeId: item.cptCodeId,
          icd10CodeId: item.icd10CodeId,
          units: item.units,
          rate: item.rate,
          amount: item.amount,
          dateOfService: item.dateOfService,
        });
        createdLineItems.push({
          ...lineItem,
          cptCode: { code: item.cptCode.code, description: item.cptCode.description },
        });
      }

      res.json({
        message: 'Superbill created successfully',
        claim,
        lineItems: createdLineItems,
        totalAmount: totalAmount.toFixed(2),
      });
    } catch (error: any) {
      console.error('Error creating superbill:', error);
      res.status(500).json({ message: error.message || 'Failed to create superbill' });
    }
  });

  // ==================== CLAIMS ENDPOINTS ====================

  // Get all claims for practice
  app.get('/api/claims', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = 1; // Default practice for now
      const claims = await storage.getClaims(practiceId);
      res.json(claims);
    } catch (error) {
      console.error('Error fetching claims:', error);
      res.status(500).json({ message: 'Failed to fetch claims' });
    }
  });

  // Get single claim with line items
  app.get('/api/claims/:id', isAuthenticated, async (req: any, res) => {
    try {
      const claim = await storage.getClaim(parseInt(req.params.id));
      if (!claim) {
        return res.status(404).json({ message: 'Claim not found' });
      }

      // Get line items for this claim
      const lineItems = await storage.getClaimLineItems(claim.id);

      // Enrich line items with CPT and ICD-10 details
      const cptCodes = await storage.getCptCodes();
      const icd10Codes = await storage.getIcd10Codes();

      const enrichedLineItems = lineItems.map((item: any) => {
        const cptCode = cptCodes.find((c: any) => c.id === item.cptCodeId);
        const icd10Code = icd10Codes.find((i: any) => i.id === item.icd10CodeId);
        return {
          ...item,
          cptCode: cptCode ? { code: cptCode.code, description: cptCode.description } : null,
          icd10Code: icd10Code ? { code: icd10Code.code, description: icd10Code.description } : null,
        };
      });

      res.json({
        ...claim,
        lineItems: enrichedLineItems,
      });
    } catch (error) {
      console.error('Error fetching claim:', error);
      res.status(500).json({ message: 'Failed to fetch claim' });
    }
  });

  // Get line items for a claim
  app.get('/api/claims/:id/line-items', isAuthenticated, async (req: any, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const lineItems = await storage.getClaimLineItems(claimId);

      // Enrich with CPT and ICD-10 details
      const cptCodes = await storage.getCptCodes();
      const icd10Codes = await storage.getIcd10Codes();

      const enrichedLineItems = lineItems.map((item: any) => {
        const cptCode = cptCodes.find((c: any) => c.id === item.cptCodeId);
        const icd10Code = icd10Codes.find((i: any) => i.id === item.icd10CodeId);
        return {
          ...item,
          cptCode: cptCode ? { code: cptCode.code, description: cptCode.description } : null,
          icd10Code: icd10Code ? { code: icd10Code.code, description: icd10Code.description } : null,
        };
      });

      res.json(enrichedLineItems);
    } catch (error) {
      console.error('Error fetching claim line items:', error);
      res.status(500).json({ message: 'Failed to fetch line items' });
    }
  });

  // Add line item to claim
  app.post('/api/claims/:id/line-items', isAuthenticated, async (req: any, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const { cptCodeId, icd10CodeId, units, dateOfService, modifier, notes } = req.body;

      // Get CPT code for rate
      const cptCodes = await storage.getCptCodes();
      const cptCode = cptCodes.find((c: any) => c.id === cptCodeId);
      if (!cptCode) {
        return res.status(400).json({ message: 'Invalid CPT code' });
      }

      const rate = parseFloat(cptCode.baseRate || '289.00');
      const lineUnits = units || 1;
      const amount = (rate * lineUnits).toFixed(2);

      const lineItem = await storage.createClaimLineItem({
        claimId,
        cptCodeId,
        icd10CodeId: icd10CodeId || null,
        units: lineUnits,
        rate: rate.toFixed(2),
        amount,
        dateOfService: dateOfService || new Date().toISOString().split('T')[0],
        modifier: modifier || null,
        notes: notes || null,
      });

      // Update claim total
      const existingLineItems = await storage.getClaimLineItems(claimId);
      const newTotal = existingLineItems.reduce((sum: number, item: any) =>
        sum + parseFloat(item.amount), 0);
      await storage.updateClaim(claimId, { totalAmount: newTotal.toFixed(2) });

      res.json({
        ...lineItem,
        cptCode: { code: cptCode.code, description: cptCode.description },
      });
    } catch (error) {
      console.error('Error adding line item:', error);
      res.status(500).json({ message: 'Failed to add line item' });
    }
  });

  // Create new claim with AI optimization
  app.post('/api/claims', isAuthenticated, async (req: any, res) => {
    try {
      const { patientId, insuranceId, totalAmount, submittedAmount, sessionId } = req.body;
      const practiceId = 1; // Default practice for now

      if (!patientId || !totalAmount) {
        return res.status(400).json({ message: 'Patient ID and total amount are required' });
      }

      // Generate claim number
      const claimNumber = `CLM-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

      // Initialize AI review fields
      let aiReviewScore = null;
      let aiReviewNotes = null;

      // If there's a session, try to run AI optimization on the SOAP note
      if (sessionId) {
        try {
          const soapNotes = await storage.getSoapNotes(practiceId);
          const sessionSoapNote = soapNotes.find((note: any) => note.sessionId === sessionId);
          const patients = await storage.getPatients(practiceId);
          const patient = patients.find((p: any) => p.id === patientId);

          if (sessionSoapNote && patient) {
            const optimization = await claimOptimizer.optimizeClaim(
              sessionSoapNote,
              patient,
              undefined // insurance provider
            );
            aiReviewScore = optimization.aiReviewScore.toString();
            aiReviewNotes = optimization.aiReviewNotes;
          }
        } catch (aiError) {
          console.error('AI optimization failed, continuing without:', aiError);
        }
      }

      // Create the claim
      const claim = await storage.createClaim({
        practiceId,
        patientId,
        insuranceId: insuranceId || null,
        sessionId: sessionId || null,
        claimNumber,
        totalAmount: totalAmount.toString(),
        submittedAmount: submittedAmount?.toString() || null,
        status: 'draft',
        aiReviewScore,
        aiReviewNotes,
      });

      res.json({
        message: 'Claim created successfully',
        claim
      });
    } catch (error: any) {
      console.error('Error creating claim:', error);
      res.status(500).json({ message: error?.message || 'Failed to create claim' });
    }
  });

  // Update claim
  app.patch('/api/claims/:id', isAuthenticated, async (req: any, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const existingClaim = await storage.getClaim(claimId);

      if (!existingClaim) {
        return res.status(404).json({ message: 'Claim not found' });
      }

      // Only allow updates to draft claims (or admin override)
      if (existingClaim.status !== 'draft') {
        const user = await storage.getUser(req.user?.claims?.sub);
        if (user?.role !== 'admin') {
          return res.status(400).json({ message: 'Can only edit draft claims' });
        }
      }

      const updatedClaim = await storage.updateClaim(claimId, req.body);
      res.json(updatedClaim);
    } catch (error) {
      console.error('Error updating claim:', error);
      res.status(500).json({ message: 'Failed to update claim' });
    }
  });

  // Submit claim (change status from draft to submitted)
  app.post('/api/claims/:id/submit', isAuthenticated, async (req: any, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const claim = await storage.getClaim(claimId);

      if (!claim) {
        return res.status(404).json({ message: 'Claim not found' });
      }

      if (claim.status !== 'draft') {
        return res.status(400).json({ message: 'Only draft claims can be submitted' });
      }

      const updatedClaim = await storage.updateClaim(claimId, {
        status: 'submitted',
        submittedAt: new Date(),
        submittedAmount: claim.totalAmount, // Set submitted amount to total if not set
      });

      res.json({
        success: true,
        message: 'Claim submitted successfully',
        claim: updatedClaim
      });
    } catch (error) {
      console.error('Error submitting claim:', error);
      res.status(500).json({ message: 'Failed to submit claim' });
    }
  });

  // Mark claim as paid
  app.post('/api/claims/:id/paid', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const { paidAmount } = req.body;

      const claim = await storage.getClaim(claimId);
      if (!claim) {
        return res.status(404).json({ message: 'Claim not found' });
      }

      if (claim.status !== 'submitted') {
        return res.status(400).json({ message: 'Only submitted claims can be marked as paid' });
      }

      const updatedClaim = await storage.updateClaim(claimId, {
        status: 'paid',
        paidAt: new Date(),
        paidAmount: paidAmount?.toString() || claim.submittedAmount || claim.totalAmount,
      });

      res.json({
        message: 'Claim marked as paid',
        claim: updatedClaim
      });
    } catch (error) {
      console.error('Error marking claim paid:', error);
      res.status(500).json({ message: 'Failed to mark claim as paid' });
    }
  });

  // Deny claim
  app.post('/api/claims/:id/deny', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const { denialReason } = req.body;
      const practiceId = 1;

      const claim = await storage.getClaim(claimId);
      if (!claim) {
        return res.status(404).json({ message: 'Claim not found' });
      }

      const updatedClaim = await storage.updateClaim(claimId, {
        status: 'denied',
        denialReason: denialReason || 'No reason provided',
      });

      // Auto-generate AI appeal
      let appealResult = null;
      try {
        // Get claim details for AI analysis
        const lineItems = await storage.getClaimLineItems(claimId);
        const patient = await storage.getPatient(claim.patientId);
        const practice = await storage.getPractice(practiceId);

        // Get CPT and ICD-10 codes for line items
        const cptCodes = await storage.getCptCodes();
        const icd10Codes = await storage.getIcd10Codes();

        const enrichedLineItems = lineItems.map((item: any) => ({
          ...item,
          cptCode: cptCodes.find((c: any) => c.id === item.cptCodeId),
          icd10Code: icd10Codes.find((c: any) => c.id === item.icd10CodeId),
        }));

        if (patient && practice) {
          // Generate AI appeal
          appealResult = await appealGenerator.generateAppeal(
            { ...updatedClaim, denialReason: denialReason || 'No reason provided' },
            enrichedLineItems,
            patient,
            practice
          );

          // Store appeal in reimbursement_optimizations table
          await storage.createReimbursementOptimization({
            practiceId,
            claimId,
            originalAmount: claim.totalAmount,
            optimizedAmount: claim.totalAmount, // Same amount - we're appealing for full payment
            improvementAmount: "0",
            ourShareAmount: "0",
            optimizationType: 'appeal',
            optimizationNotes: JSON.stringify({
              appealLetter: appealResult.appealLetter,
              denialCategory: appealResult.denialCategory,
              successProbability: appealResult.successProbability,
              suggestedActions: appealResult.suggestedActions,
              keyArguments: appealResult.keyArguments,
              generatedAt: appealResult.generatedAt,
            }),
            status: 'pending',
          });

          // Update claim with AI notes
          await storage.updateClaim(claimId, {
            aiReviewNotes: `AI Appeal Generated (${appealResult.successProbability}% success probability). Category: ${appealResult.denialCategory}`,
          });
        }
      } catch (aiError) {
        console.error('Error generating AI appeal:', aiError);
        // Continue even if AI appeal fails - the claim is still denied
      }

      res.json({
        message: 'Claim marked as denied',
        claim: updatedClaim,
        appealGenerated: !!appealResult,
        appeal: appealResult ? {
          denialCategory: appealResult.denialCategory,
          successProbability: appealResult.successProbability,
          suggestedActions: appealResult.suggestedActions,
        } : null,
      });
    } catch (error) {
      console.error('Error denying claim:', error);
      res.status(500).json({ message: 'Failed to deny claim' });
    }
  });

  // Get appeals for a claim
  app.get('/api/claims/:id/appeals', isAuthenticated, async (req: any, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const appeals = await storage.getClaimAppeals(claimId);

      // Parse the optimizationNotes JSON for each appeal
      const parsedAppeals = appeals.map((appeal: any) => {
        let notes = {};
        try {
          notes = JSON.parse(appeal.optimizationNotes || '{}');
        } catch (e) {
          notes = { raw: appeal.optimizationNotes };
        }
        return {
          ...appeal,
          parsedNotes: notes,
        };
      });

      res.json(parsedAppeals);
    } catch (error) {
      console.error('Error fetching appeals:', error);
      res.status(500).json({ message: 'Failed to fetch appeals' });
    }
  });

  // Mark appeal as sent
  app.post('/api/claims/:id/appeals/:appealId/sent', isAuthenticated, async (req: any, res) => {
    try {
      const appealId = parseInt(req.params.appealId);
      const updated = await storage.updateAppealStatus(appealId, 'sent', new Date());

      if (!updated) {
        return res.status(404).json({ message: 'Appeal not found' });
      }

      res.json({
        message: 'Appeal marked as sent',
        appeal: updated,
      });
    } catch (error) {
      console.error('Error updating appeal status:', error);
      res.status(500).json({ message: 'Failed to update appeal status' });
    }
  });

  // Mark appeal as completed (won/paid)
  app.post('/api/claims/:id/appeals/:appealId/completed', isAuthenticated, async (req: any, res) => {
    try {
      const appealId = parseInt(req.params.appealId);
      const updated = await storage.updateAppealStatus(appealId, 'completed', new Date());

      if (!updated) {
        return res.status(404).json({ message: 'Appeal not found' });
      }

      res.json({
        message: 'Appeal marked as completed',
        appeal: updated,
      });
    } catch (error) {
      console.error('Error updating appeal status:', error);
      res.status(500).json({ message: 'Failed to update appeal status' });
    }
  });

  // Mark appeal as failed
  app.post('/api/claims/:id/appeals/:appealId/failed', isAuthenticated, async (req: any, res) => {
    try {
      const appealId = parseInt(req.params.appealId);
      const updated = await storage.updateAppealStatus(appealId, 'failed', new Date());

      if (!updated) {
        return res.status(404).json({ message: 'Appeal not found' });
      }

      res.json({
        message: 'Appeal marked as failed',
        appeal: updated,
      });
    } catch (error) {
      console.error('Error updating appeal status:', error);
      res.status(500).json({ message: 'Failed to update appeal status' });
    }
  });

  // Regenerate appeal for a denied claim
  app.post('/api/claims/:id/regenerate-appeal', isAuthenticated, async (req: any, res) => {
    try {
      const claimId = parseInt(req.params.id);
      const practiceId = 1;

      const claim = await storage.getClaim(claimId);
      if (!claim) {
        return res.status(404).json({ message: 'Claim not found' });
      }

      if (claim.status !== 'denied') {
        return res.status(400).json({ message: 'Can only regenerate appeals for denied claims' });
      }

      // Get claim details for AI analysis
      const lineItems = await storage.getClaimLineItems(claimId);
      const patient = await storage.getPatient(claim.patientId);
      const practice = await storage.getPractice(practiceId);

      if (!patient || !practice) {
        return res.status(400).json({ message: 'Missing patient or practice data' });
      }

      // Get CPT and ICD-10 codes for line items
      const cptCodes = await storage.getCptCodes();
      const icd10Codes = await storage.getIcd10Codes();

      const enrichedLineItems = lineItems.map((item: any) => ({
        ...item,
        cptCode: cptCodes.find((c: any) => c.id === item.cptCodeId),
        icd10Code: icd10Codes.find((c: any) => c.id === item.icd10CodeId),
      }));

      // Generate new AI appeal
      const appealResult = await appealGenerator.generateAppeal(
        claim,
        enrichedLineItems,
        patient,
        practice
      );

      // Store new appeal in reimbursement_optimizations table
      const newAppeal = await storage.createReimbursementOptimization({
        practiceId,
        claimId,
        originalAmount: claim.totalAmount,
        optimizedAmount: claim.totalAmount,
        improvementAmount: "0",
        ourShareAmount: "0",
        optimizationType: 'appeal',
        optimizationNotes: JSON.stringify({
          appealLetter: appealResult.appealLetter,
          denialCategory: appealResult.denialCategory,
          successProbability: appealResult.successProbability,
          suggestedActions: appealResult.suggestedActions,
          keyArguments: appealResult.keyArguments,
          generatedAt: appealResult.generatedAt,
        }),
        status: 'pending',
      });

      res.json({
        message: 'Appeal regenerated successfully',
        appeal: {
          id: newAppeal.id,
          ...appealResult,
        },
      });
    } catch (error) {
      console.error('Error regenerating appeal:', error);
      res.status(500).json({ message: 'Failed to regenerate appeal' });
    }
  });

  // ==================== NEW APPEALS MANAGEMENT ENDPOINTS ====================

  // Get appeals dashboard metrics
  app.get('/api/appeals/dashboard', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = 1;
      const dashboard = await storage.getAppealsDashboard(practiceId);
      res.json(dashboard);
    } catch (error) {
      console.error('Error fetching appeals dashboard:', error);
      res.status(500).json({ message: 'Failed to fetch appeals dashboard' });
    }
  });

  // Get upcoming deadlines
  app.get('/api/appeals/deadlines', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = 1;
      const days = parseInt(req.query.days as string) || 30;
      const deadlines = await storage.getUpcomingDeadlines(practiceId, days);
      res.json(deadlines);
    } catch (error) {
      console.error('Error fetching appeal deadlines:', error);
      res.status(500).json({ message: 'Failed to fetch appeal deadlines' });
    }
  });

  // Get denied claims available for appeal
  app.get('/api/appeals/denied-claims', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = 1;
      const deniedClaims = await storage.getDeniedClaimsForAppeals(practiceId);

      // Enrich with patient info
      const enrichedClaims = await Promise.all(deniedClaims.map(async (claim: any) => {
        const patient = claim.patientId ? await storage.getPatient(claim.patientId) : null;
        return {
          ...claim,
          patientName: patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown',
        };
      }));

      res.json(enrichedClaims);
    } catch (error) {
      console.error('Error fetching denied claims:', error);
      res.status(500).json({ message: 'Failed to fetch denied claims' });
    }
  });

  // Get all appeals with filters
  app.get('/api/appeals', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = 1;
      const filters: any = {};

      if (req.query.status) filters.status = req.query.status;
      if (req.query.appealLevel) filters.appealLevel = req.query.appealLevel;
      if (req.query.deadlineWithinDays) filters.deadlineWithinDays = parseInt(req.query.deadlineWithinDays);

      const appeals = await storage.getAppeals(practiceId, filters);

      // Enrich with claim and patient info
      const enrichedAppeals = await Promise.all(appeals.map(async (appeal: any) => {
        const claim = await storage.getClaim(appeal.claimId);
        const patient = claim?.patientId ? await storage.getPatient(claim.patientId) : null;
        return {
          ...appeal,
          claim: claim ? {
            id: claim.id,
            claimNumber: claim.claimNumber,
            totalAmount: claim.totalAmount,
            denialReason: claim.denialReason,
          } : null,
          patientName: patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown',
        };
      }));

      res.json(enrichedAppeals);
    } catch (error) {
      console.error('Error fetching appeals:', error);
      res.status(500).json({ message: 'Failed to fetch appeals' });
    }
  });

  // Get single appeal by ID
  app.get('/api/appeals/:id', isAuthenticated, async (req: any, res) => {
    try {
      const appealId = parseInt(req.params.id);
      const appeal = await storage.getAppealById(appealId);

      if (!appeal) {
        return res.status(404).json({ message: 'Appeal not found' });
      }

      // Enrich with claim and patient info
      const claim = await storage.getClaim(appeal.claimId);
      const patient = claim?.patientId ? await storage.getPatient(claim.patientId) : null;

      res.json({
        ...appeal,
        claim: claim ? {
          id: claim.id,
          claimNumber: claim.claimNumber,
          totalAmount: claim.totalAmount,
          denialReason: claim.denialReason,
          submittedAt: claim.submittedAt,
          paidAmount: claim.paidAmount,
        } : null,
        patient: patient ? {
          id: patient.id,
          firstName: patient.firstName,
          lastName: patient.lastName,
          insuranceProvider: patient.insuranceProvider,
        } : null,
      });
    } catch (error) {
      console.error('Error fetching appeal:', error);
      res.status(500).json({ message: 'Failed to fetch appeal' });
    }
  });

  // Create new appeal from denied claim
  app.post('/api/appeals', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = 1;
      const { claimId, deadlineDate, notes } = req.body;

      if (!claimId) {
        return res.status(400).json({ message: 'claimId is required' });
      }

      // Get the claim
      const claim = await storage.getClaim(claimId);
      if (!claim) {
        return res.status(404).json({ message: 'Claim not found' });
      }

      if (claim.status !== 'denied') {
        return res.status(400).json({ message: 'Can only create appeal for denied claims' });
      }

      // Get patient info for AI appeal generation
      const patient = claim.patientId ? await storage.getPatient(claim.patientId) : null;

      // Generate AI appeal letter
      let appealResult = null;
      try {
        // Get line items for the claim
        const lineItems = await storage.getClaimLineItems(claimId);
        const formattedLineItems = lineItems.map((item: any) => ({
          cptCode: item.cptCodeId ? { code: String(item.cptCodeId), description: '' } : undefined,
          icd10Code: item.diagnosisCodeId ? { code: String(item.diagnosisCodeId), description: '' } : undefined,
          units: item.units || 1,
          amount: item.amount || '0',
        }));
        const practice = { name: 'Practice', npi: null, address: null, phone: null };
        const patientData = patient ? {
          firstName: patient.firstName,
          lastName: patient.lastName,
          dateOfBirth: patient.dateOfBirth,
          insuranceProvider: patient.insuranceProvider,
          insuranceId: patient.insuranceId,
        } : { firstName: 'Unknown', lastName: 'Patient', dateOfBirth: null, insuranceProvider: null, insuranceId: null };

        appealResult = await appealGenerator.generateAppeal(
          { ...claim, denialReason: claim.denialReason || 'No reason provided' },
          formattedLineItems,
          patientData,
          practice
        );
      } catch (aiError) {
        console.error('Error generating AI appeal:', aiError);
      }

      // Calculate deadline (default: 60 days from now if not specified)
      const calculatedDeadline = deadlineDate ||
        new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const appeal = await storage.createAppeal({
        claimId,
        practiceId,
        appealLevel: 'initial',
        status: appealResult ? 'ready' : 'draft',
        denialCategory: appealResult?.denialCategory || null,
        deadlineDate: calculatedDeadline,
        appealedAmount: claim.totalAmount,
        appealLetter: appealResult?.appealLetter || null,
        notes,
        supportingDocs: [],
      });

      // Update claim status to appeal
      await storage.updateClaim(claimId, { status: 'appeal' });

      res.json({
        message: 'Appeal created successfully',
        appeal: {
          ...appeal,
          aiGenerated: !!appealResult,
          successProbability: appealResult?.successProbability,
          suggestedActions: appealResult?.suggestedActions,
        },
      });
    } catch (error) {
      console.error('Error creating appeal:', error);
      res.status(500).json({ message: 'Failed to create appeal' });
    }
  });

  // Update appeal
  app.patch('/api/appeals/:id', isAuthenticated, async (req: any, res) => {
    try {
      const appealId = parseInt(req.params.id);
      const updates = req.body;

      const existingAppeal = await storage.getAppealById(appealId);
      if (!existingAppeal) {
        return res.status(404).json({ message: 'Appeal not found' });
      }

      // Don't allow updates to resolved appeals
      if (['won', 'lost', 'partial'].includes(existingAppeal.status) &&
          !['notes', 'supportingDocs'].includes(Object.keys(updates)[0])) {
        return res.status(400).json({ message: 'Cannot modify resolved appeals' });
      }

      const updatedAppeal = await storage.updateAppealRecord(appealId, updates);
      res.json(updatedAppeal);
    } catch (error) {
      console.error('Error updating appeal:', error);
      res.status(500).json({ message: 'Failed to update appeal' });
    }
  });

  // Submit appeal to payer
  app.post('/api/appeals/:id/submit', isAuthenticated, async (req: any, res) => {
    try {
      const appealId = parseInt(req.params.id);

      const appeal = await storage.getAppealById(appealId);
      if (!appeal) {
        return res.status(404).json({ message: 'Appeal not found' });
      }

      if (!appeal.appealLetter) {
        return res.status(400).json({ message: 'Appeal letter is required before submission' });
      }

      const updatedAppeal = await storage.updateAppealRecord(appealId, {
        status: 'submitted',
        submittedDate: new Date(),
      });

      res.json({
        message: 'Appeal marked as submitted',
        appeal: updatedAppeal,
      });
    } catch (error) {
      console.error('Error submitting appeal:', error);
      res.status(500).json({ message: 'Failed to submit appeal' });
    }
  });

  // Resolve appeal (won/lost/partial)
  app.post('/api/appeals/:id/resolve', isAuthenticated, async (req: any, res) => {
    try {
      const appealId = parseInt(req.params.id);
      const { outcome, recoveredAmount, insurerResponse } = req.body;

      if (!['won', 'lost', 'partial'].includes(outcome)) {
        return res.status(400).json({ message: 'Invalid outcome. Must be won, lost, or partial' });
      }

      const appeal = await storage.getAppealById(appealId);
      if (!appeal) {
        return res.status(404).json({ message: 'Appeal not found' });
      }

      const updatedAppeal = await storage.updateAppealRecord(appealId, {
        status: outcome,
        resolvedDate: new Date(),
        recoveredAmount: recoveredAmount || (outcome === 'won' ? appeal.appealedAmount : '0'),
        insurerResponse,
      });

      // Update claim status based on outcome
      if (outcome === 'won') {
        await storage.updateClaim(appeal.claimId, {
          status: 'paid',
          paidAmount: recoveredAmount || appeal.appealedAmount,
          paidAt: new Date(),
        });
      } else if (outcome === 'partial') {
        await storage.updateClaim(appeal.claimId, {
          status: 'paid',
          paidAmount: recoveredAmount,
          paidAt: new Date(),
        });
      }

      res.json({
        message: `Appeal resolved as ${outcome}`,
        appeal: updatedAppeal,
      });
    } catch (error) {
      console.error('Error resolving appeal:', error);
      res.status(500).json({ message: 'Failed to resolve appeal' });
    }
  });

  // Escalate appeal to next level
  app.post('/api/appeals/:id/escalate', isAuthenticated, async (req: any, res) => {
    try {
      const appealId = parseInt(req.params.id);
      const { newDeadlineDate, notes } = req.body;

      const appeal = await storage.getAppealById(appealId);
      if (!appeal) {
        return res.status(404).json({ message: 'Appeal not found' });
      }

      // Determine next level
      const levelProgression: Record<string, string> = {
        'initial': 'first_appeal',
        'first_appeal': 'second_appeal',
        'second_appeal': 'external_review',
      };

      const nextLevel = levelProgression[appeal.appealLevel];
      if (!nextLevel) {
        return res.status(400).json({ message: 'Cannot escalate further. Already at external review level.' });
      }

      // Mark current appeal as lost (since we're escalating)
      await storage.updateAppealRecord(appealId, {
        status: 'lost',
        resolvedDate: new Date(),
        notes: (appeal.notes || '') + '\n\nEscalated to ' + nextLevel,
      });

      // Get claim for new appeal
      const claim = await storage.getClaim(appeal.claimId);

      // Create new appeal at next level
      const newAppeal = await storage.createAppeal({
        claimId: appeal.claimId,
        practiceId: appeal.practiceId,
        appealLevel: nextLevel,
        status: 'draft',
        denialCategory: appeal.denialCategory,
        deadlineDate: newDeadlineDate ||
          new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        appealedAmount: appeal.appealedAmount,
        notes: notes || `Escalated from ${appeal.appealLevel}`,
        supportingDocs: appeal.supportingDocs as any,
      });

      res.json({
        message: `Appeal escalated to ${nextLevel}`,
        previousAppeal: { id: appealId, status: 'lost' },
        newAppeal,
      });
    } catch (error) {
      console.error('Error escalating appeal:', error);
      res.status(500).json({ message: 'Failed to escalate appeal' });
    }
  });

  // Regenerate AI appeal letter for existing appeal
  app.post('/api/appeals/:id/regenerate-letter', isAuthenticated, async (req: any, res) => {
    try {
      const appealId = parseInt(req.params.id);
      const { additionalContext } = req.body;

      const appeal = await storage.getAppealById(appealId);
      if (!appeal) {
        return res.status(404).json({ message: 'Appeal not found' });
      }

      const claim = await storage.getClaim(appeal.claimId);
      if (!claim) {
        return res.status(404).json({ message: 'Associated claim not found' });
      }

      const patient = claim.patientId ? await storage.getPatient(claim.patientId) : null;

      // Generate new AI appeal letter
      const lineItems = await storage.getClaimLineItems(appeal.claimId);
      const formattedLineItems = lineItems.map((item: any) => ({
        cptCode: item.cptCodeId ? { code: String(item.cptCodeId), description: '' } : undefined,
        icd10Code: item.diagnosisCodeId ? { code: String(item.diagnosisCodeId), description: '' } : undefined,
        units: item.units || 1,
        amount: item.amount || '0',
      }));
      const practice = { name: 'Practice', npi: null, address: null, phone: null };
      const patientData = patient ? {
        firstName: patient.firstName,
        lastName: patient.lastName,
        dateOfBirth: patient.dateOfBirth,
        insuranceProvider: patient.insuranceProvider,
        insuranceId: patient.insuranceId,
      } : { firstName: 'Unknown', lastName: 'Patient', dateOfBirth: null, insuranceProvider: null, insuranceId: null };

      const appealResult = await appealGenerator.generateAppeal(
        { ...claim, denialReason: claim.denialReason || 'No reason provided' },
        formattedLineItems,
        patientData,
        practice
      );

      // Update appeal with new letter
      const updatedAppeal = await storage.updateAppealRecord(appealId, {
        appealLetter: appealResult.appealLetter,
        denialCategory: appealResult.denialCategory,
        status: 'ready',
      });

      res.json({
        message: 'Appeal letter regenerated',
        appeal: updatedAppeal,
        successProbability: appealResult.successProbability,
        suggestedActions: appealResult.suggestedActions,
      });
    } catch (error) {
      console.error('Error regenerating appeal letter:', error);
      res.status(500).json({ message: 'Failed to regenerate appeal letter' });
    }
  });

  // Claims analytics
  app.get('/api/claims/analytics/by-status', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = 1;
      const statusData = await storage.getClaimsByStatus(practiceId);
      res.json(statusData);
    } catch (error) {
      console.error('Error fetching claims by status:', error);
      res.status(500).json({ message: 'Failed to fetch claims analytics' });
    }
  });

  app.get('/api/claims/analytics/denial-reasons', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = 1;
      const denialData = await storage.getTopDenialReasons(practiceId);
      res.json(denialData);
    } catch (error) {
      console.error('Error fetching denial reasons:', error);
      res.status(500).json({ message: 'Failed to fetch denial reasons' });
    }
  });

  // Denied Claims Report endpoints
  app.get('/api/reports/denied-claims', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = 1;
      const period = req.query.period || 'today';
      const customStartDate = req.query.startDate;
      const customEndDate = req.query.endDate;

      let startDate: Date;
      let endDate: Date = new Date();
      endDate.setHours(23, 59, 59, 999);

      switch (period) {
        case 'today':
          startDate = new Date();
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'week':
          startDate = new Date();
          startDate.setDate(startDate.getDate() - 7);
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'month':
          startDate = new Date();
          startDate.setMonth(startDate.getMonth() - 1);
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'custom':
          if (!customStartDate || !customEndDate) {
            return res.status(400).json({ message: 'Custom date range requires startDate and endDate' });
          }
          startDate = new Date(customStartDate);
          endDate = new Date(customEndDate);
          endDate.setHours(23, 59, 59, 999);
          break;
        default:
          startDate = new Date();
          startDate.setHours(0, 0, 0, 0);
      }

      const deniedClaimsWithDetails = await storage.getDeniedClaimsWithDetails(practiceId, startDate, endDate);
      const denialReasons = await storage.getTopDenialReasons(practiceId);

      // Calculate summary statistics
      const totalAmount = deniedClaimsWithDetails.reduce((sum, item) =>
        sum + parseFloat(item.claim.totalAmount || '0'), 0);
      const appealsGenerated = deniedClaimsWithDetails.filter(item => item.appeal !== null).length;
      const appealsSent = deniedClaimsWithDetails.filter(item =>
        item.appeal && item.appeal.status === 'sent').length;
      const appealsWon = deniedClaimsWithDetails.filter(item =>
        item.appeal && item.appeal.status === 'completed').length;

      res.json({
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        summary: {
          totalDenied: deniedClaimsWithDetails.length,
          totalAmountAtRisk: totalAmount,
          appealsGenerated,
          appealsSent,
          appealsWon,
        },
        topDenialReasons: denialReasons,
        claims: deniedClaimsWithDetails.map(item => ({
          id: item.claim.id,
          claimNumber: item.claim.claimNumber,
          patientName: item.patient ? `${item.patient.firstName} ${item.patient.lastName}` : 'Unknown',
          patientId: item.claim.patientId,
          amount: item.claim.totalAmount,
          denialReason: item.claim.denialReason,
          deniedAt: item.claim.updatedAt,
          appealStatus: item.appeal?.status || 'none',
          appealId: item.appeal?.id || null,
        })),
      });
    } catch (error) {
      console.error('Error fetching denied claims report:', error);
      res.status(500).json({ message: 'Failed to fetch denied claims report' });
    }
  });

  // Export denied claims report as CSV
  app.get('/api/reports/denied-claims/export', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = 1;
      const period = req.query.period || 'month';
      const customStartDate = req.query.startDate;
      const customEndDate = req.query.endDate;

      let startDate: Date;
      let endDate: Date = new Date();
      endDate.setHours(23, 59, 59, 999);

      switch (period) {
        case 'today':
          startDate = new Date();
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'week':
          startDate = new Date();
          startDate.setDate(startDate.getDate() - 7);
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'month':
          startDate = new Date();
          startDate.setMonth(startDate.getMonth() - 1);
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'custom':
          if (!customStartDate || !customEndDate) {
            return res.status(400).json({ message: 'Custom date range requires startDate and endDate' });
          }
          startDate = new Date(customStartDate);
          endDate = new Date(customEndDate);
          endDate.setHours(23, 59, 59, 999);
          break;
        default:
          startDate = new Date();
          startDate.setMonth(startDate.getMonth() - 1);
          startDate.setHours(0, 0, 0, 0);
      }

      const deniedClaimsWithDetails = await storage.getDeniedClaimsWithDetails(practiceId, startDate, endDate);

      // Generate CSV
      const csvHeader = 'Claim Number,Patient Name,Amount,Denial Reason,Denied Date,Appeal Status\n';
      const csvRows = deniedClaimsWithDetails.map(item => {
        const patientName = item.patient ? `${item.patient.firstName} ${item.patient.lastName}` : 'Unknown';
        const amount = item.claim.totalAmount || '0';
        const denialReason = (item.claim.denialReason || 'Unknown').replace(/,/g, ';').replace(/\n/g, ' ');
        const deniedAt = item.claim.updatedAt ? new Date(item.claim.updatedAt).toLocaleDateString() : '';
        const appealStatus = item.appeal?.status || 'none';

        return `${item.claim.claimNumber},"${patientName}",${amount},"${denialReason}",${deniedAt},${appealStatus}`;
      }).join('\n');

      const csv = csvHeader + csvRows;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="denied-claims-${period}-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } catch (error) {
      console.error('Error exporting denied claims report:', error);
      res.status(500).json({ message: 'Failed to export denied claims report' });
    }
  });

  // Email settings endpoints
  app.get('/api/reports/email-settings', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      res.json({
        configured: isEmailConfigured(),
        recipients: getDailyReportRecipients(),
      });
    } catch (error) {
      console.error('Error fetching email settings:', error);
      res.status(500).json({ message: 'Failed to fetch email settings' });
    }
  });

  app.post('/api/reports/email-settings', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const { recipients } = req.body;

      if (!Array.isArray(recipients)) {
        return res.status(400).json({ message: 'Recipients must be an array of email addresses' });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = recipients.filter((email: string) => !emailRegex.test(email));
      if (invalidEmails.length > 0) {
        return res.status(400).json({ message: `Invalid email addresses: ${invalidEmails.join(', ')}` });
      }

      setDailyReportRecipients(recipients);

      res.json({
        message: 'Email settings updated successfully',
        recipients: getDailyReportRecipients(),
      });
    } catch (error) {
      console.error('Error updating email settings:', error);
      res.status(500).json({ message: 'Failed to update email settings' });
    }
  });

  app.post('/api/reports/send-test-email', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: 'Email address is required' });
      }

      const result = await sendTestEmail(email);

      if (result.success) {
        res.json({ message: 'Test email sent successfully' });
      } else {
        res.status(500).json({ message: result.error || 'Failed to send test email' });
      }
    } catch (error) {
      console.error('Error sending test email:', error);
      res.status(500).json({ message: 'Failed to send test email' });
    }
  });

  app.post('/api/reports/send-report-now', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const practiceId = 1;
      const { period = 'today', email } = req.body;

      // Get date range based on period
      let startDate: Date;
      let endDate: Date = new Date();
      endDate.setHours(23, 59, 59, 999);

      switch (period) {
        case 'today':
          startDate = new Date();
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'week':
          startDate = new Date();
          startDate.setDate(startDate.getDate() - 7);
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'month':
          startDate = new Date();
          startDate.setMonth(startDate.getMonth() - 1);
          startDate.setHours(0, 0, 0, 0);
          break;
        default:
          startDate = new Date();
          startDate.setHours(0, 0, 0, 0);
      }

      const deniedClaimsWithDetails = await storage.getDeniedClaimsWithDetails(practiceId, startDate, endDate);
      const denialReasons = await storage.getTopDenialReasons(practiceId);
      const practice = await storage.getPractice(practiceId);

      const totalAmount = deniedClaimsWithDetails.reduce((sum, item) =>
        sum + parseFloat(item.claim.totalAmount || '0'), 0);
      const appealsGenerated = deniedClaimsWithDetails.filter(item => item.appeal !== null).length;
      const appealsSent = deniedClaimsWithDetails.filter(item =>
        item.appeal && item.appeal.status === 'sent').length;
      const appealsWon = deniedClaimsWithDetails.filter(item =>
        item.appeal && item.appeal.status === 'completed').length;

      const reportData: DeniedClaimsReportInput = {
        practiceName: practice?.name || 'Your Practice',
        reportDate: new Date(),
        period: period === 'today' ? 'Today' : period === 'week' ? 'Last 7 Days' : 'Last 30 Days',
        summary: {
          totalDenied: deniedClaimsWithDetails.length,
          totalAmountAtRisk: totalAmount,
          appealsGenerated,
          appealsSent,
          appealsWon,
        },
        topDenialReasons: denialReasons,
        claims: deniedClaimsWithDetails.map(item => ({
          claimNumber: item.claim.claimNumber || 'Unknown',
          patientName: item.patient ? `${item.patient.firstName} ${item.patient.lastName}` : 'Unknown',
          amount: item.claim.totalAmount || '0',
          denialReason: item.claim.denialReason,
          deniedAt: item.claim.updatedAt,
          appealStatus: item.appeal?.status || 'none',
        })),
        reportUrl: process.env.APP_URL ? `${process.env.APP_URL}/reports` : undefined,
      };

      const recipients = email ? [email] : getDailyReportRecipients();
      if (recipients.length === 0) {
        return res.status(400).json({ message: 'No email recipients configured' });
      }

      const result = await sendDeniedClaimsReport(recipients, reportData);

      if (result.success) {
        res.json({ message: `Report sent successfully to ${recipients.join(', ')}` });
      } else {
        res.status(500).json({ message: result.error || 'Failed to send report' });
      }
    } catch (error) {
      console.error('Error sending report:', error);
      res.status(500).json({ message: 'Failed to send report' });
    }
  });

  // AI SOAP Note and Billing Generation
  app.post('/api/ai/generate-soap-billing', async (req, res) => {
    try {
      const {
        patientId,
        activities,
        mood,
        caregiverReport,
        duration,
        location,
        assessment,
        planNextSteps,
        nextSessionFocus,
        homeProgram,
        ratePerUnit
      } = req.body;

      // Validate required fields
      if (!patientId || !activities || !Array.isArray(activities) || activities.length === 0) {
        return res.status(400).json({
          error: 'Missing required fields: patientId and activities array required'
        });
      }

      if (!duration || duration < 15) {
        return res.status(400).json({
          error: 'Duration must be at least 15 minutes'
        });
      }

      // Generate SOAP note and billing using AI
      const result = await generateSoapNoteAndBilling({
        patientId,
        activities,
        mood: mood || 'Cooperative',
        caregiverReport,
        duration,
        location: location || 'Clinic',
        assessment: assessment || {
          performance: 'Stable',
          assistance: 'Minimal Assist',
          strength: 'Adequate',
          motorPlanning: 'Mild Difficulty',
          sensoryRegulation: 'Needed Minimal Supports'
        },
        planNextSteps: planNextSteps || 'Continue Current Goals',
        nextSessionFocus,
        homeProgram,
        ratePerUnit
      });

      res.json(result);

    } catch (error) {
      console.error('Error generating AI SOAP note:', error);
      res.status(500).json({
        error: 'Failed to generate SOAP note and billing',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Voice Transcription routes
  app.get('/api/voice/status', (req, res) => {
    res.json({
      available: isVoiceTranscriptionAvailable(),
      method: isVoiceTranscriptionAvailable() ? 'whisper' : 'browser-only'
    });
  });

  app.post('/api/voice/transcribe', async (req, res) => {
    try {
      const { audio, mimeType, language } = req.body;

      if (!audio) {
        return res.status(400).json({ error: 'No audio data provided' });
      }

      const result = await transcribeAudioBase64(audio, mimeType || 'audio/webm', language || 'en');

      if (result.success) {
        res.json({
          text: result.text,
          method: result.method
        });
      } else {
        res.status(500).json({
          error: result.error,
          method: result.method
        });
      }
    } catch (error) {
      console.error('Voice transcription error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Transcription failed'
      });
    }
  });

  // ==================== TEXT-TO-SPEECH (Eleven Labs) ====================

  // Get TTS status and available voices
  app.get('/api/tts/status', (req, res) => {
    res.json({
      available: isTextToSpeechAvailable(),
      voicePresets: VOICE_PRESETS,
    });
  });

  // Get available voices from Eleven Labs
  app.get('/api/tts/voices', async (req, res) => {
    try {
      const voices = await getAvailableVoices();
      res.json({ voices });
    } catch (error) {
      console.error('Error fetching voices:', error);
      res.status(500).json({ error: 'Failed to fetch voices' });
    }
  });

  // Convert text to speech
  app.post('/api/tts/speak', async (req, res) => {
    try {
      const { text, voiceId, stability, similarityBoost } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'Text is required' });
      }

      const result = await textToSpeech(text, {
        voiceId,
        stability,
        similarityBoost,
      });

      if (result.success) {
        res.json({
          audioBase64: result.audioBase64,
          contentType: result.contentType,
        });
      } else {
        res.status(500).json({ error: result.error });
      }
    } catch (error) {
      console.error('TTS error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Text-to-speech failed',
      });
    }
  });

  // Convert SOAP note to speech
  app.post('/api/tts/soap-note', async (req, res) => {
    try {
      const { subjective, objective, assessment, plan, voiceId } = req.body;

      const result = await soapNoteToSpeech(
        { subjective, objective, assessment, plan },
        voiceId
      );

      if (result.success) {
        res.json({
          audioBase64: result.audioBase64,
          contentType: result.contentType,
        });
      } else {
        res.status(500).json({ error: result.error });
      }
    } catch (error) {
      console.error('SOAP note TTS error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Text-to-speech failed',
      });
    }
  });

  // Convert appeal letter to speech
  app.post('/api/tts/appeal', async (req, res) => {
    try {
      const { appealLetter, voiceId } = req.body;

      if (!appealLetter) {
        return res.status(400).json({ error: 'Appeal letter text is required' });
      }

      const result = await appealLetterToSpeech(appealLetter, voiceId);

      if (result.success) {
        res.json({
          audioBase64: result.audioBase64,
          contentType: result.contentType,
        });
      } else {
        res.status(500).json({ error: result.error });
      }
    } catch (error) {
      console.error('Appeal TTS error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Text-to-speech failed',
      });
    }
  });

  // Insurance Authorization and Data routes
  app.use('/api/insurance-authorizations', insuranceAuthorizationRoutes);
  app.use('/api', insuranceDataRoutes);

  // MFA endpoints
  app.post('/api/mfa/setup', isAuthenticated, async (req: any, res) => {
    try {
      const { generateSecret } = await import('./services/mfaService');
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      const result = generateSecret(user?.email || 'user');
      // Store secret temporarily (will be confirmed on verify)
      await storage.updateUserMfa(userId, { mfaSecret: result.secret });
      res.json({ uri: result.uri, backupCodes: result.backupCodes });
    } catch (error) {
      res.status(500).json({ message: 'MFA setup failed' });
    }
  });

  app.post('/api/mfa/verify', isAuthenticated, async (req: any, res) => {
    try {
      const { verifyToken, hashBackupCode } = await import('./services/mfaService');
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user?.mfaSecret) return res.status(400).json({ message: 'MFA not set up' });
      const secret = typeof user.mfaSecret === 'string' ? user.mfaSecret : (user.mfaSecret as any).secret || user.mfaSecret;
      if (!verifyToken(secret as string, req.body.token)) {
        return res.status(400).json({ message: 'Invalid token' });
      }
      await storage.updateUserMfa(userId, { mfaEnabled: true });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'MFA verification failed' });
    }
  });

  app.post('/api/mfa/disable', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      await storage.updateUserMfa(userId, { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: null });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to disable MFA' });
    }
  });

  app.post('/api/mfa/challenge', async (req: any, res) => {
    try {
      const { verifyToken, verifyBackupCode } = await import('./services/mfaService');
      const { userId, token, backupCode } = req.body;
      const user = await storage.getUser(userId);
      if (!user?.mfaEnabled || !user?.mfaSecret) {
        return res.status(400).json({ message: 'MFA not enabled' });
      }
      const secret = typeof user.mfaSecret === 'string' ? user.mfaSecret : (user.mfaSecret as any).secret || user.mfaSecret;
      if (token) {
        if (!verifyToken(secret as string, token)) {
          return res.status(400).json({ message: 'Invalid token' });
        }
      } else if (backupCode) {
        const codes = (user.mfaBackupCodes as string[]) || [];
        if (!verifyBackupCode(backupCode, codes)) {
          return res.status(400).json({ message: 'Invalid backup code' });
        }
      } else {
        return res.status(400).json({ message: 'Token or backup code required' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'MFA challenge failed' });
    }
  });

  // Admin payer management endpoints
  app.get('/api/admin/payer-integrations', isAuthenticated, isAdminOrBilling, async (req, res) => {
    try {
      const creds = await storage.getAllPayerCredentialsList();
      res.json(creds);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch payer integrations' });
    }
  });

  app.post('/api/admin/payer-credentials', isAuthenticated, isAdminOrBilling, async (req, res) => {
    try {
      const { payerName, apiKey, practiceId = 1 } = req.body;
      await storage.upsertPayerCredentials(practiceId, { payerName, apiKey });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: 'Failed to save credentials' });
    }
  });

  app.post('/api/admin/payer-integrations/:name/health-check', isAuthenticated, isAdminOrBilling, async (req, res) => {
    try {
      const { name } = req.params;
      if (name === 'stedi') {
        const creds = await storage.getPayerCredentials(1, 'stedi');
        if (!creds) return res.status(404).json({ message: 'No Stedi credentials found' });
        const adapter = new StediAdapter((creds.credentials as any).apiKey);
        const result = await adapter.healthCheck();
        await storage.updatePayerHealthStatus(creds.id, result.healthy ? 'healthy' : 'down');
        res.json(result);
      } else {
        res.status(404).json({ message: 'Unknown payer' });
      }
    } catch (error) {
      res.status(500).json({ message: 'Health check failed' });
    }
  });

  // Insurance data refresh endpoint
  app.post('/api/patients/:id/insurance-data/refresh', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id, 10);
      const patient = await storage.getPatient(patientId);
      if (!patient) return res.status(404).json({ message: 'Patient not found' });

      const creds = await storage.getPayerCredentials(patient.practiceId, 'stedi');
      if (!creds) return res.status(400).json({ message: 'Stedi not configured' });

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
      logger.error('Insurance data refresh failed', { error });
      res.status(500).json({ message: 'Eligibility check failed' });
    }
  });

  app.get('/api/patients/:id/insurance-data', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id, 10);
      const cached = await storage.getCachedInsuranceData(patientId);
      if (!cached) return res.json({ eligibility: null, benefits: null, verifiedAt: null });
      res.json(cached);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch insurance data' });
    }
  });

  // ==================== APPOINTMENT CRUD ====================

  app.post('/api/appointments', isAuthenticated, async (req: any, res) => {
    try {
      const data = { ...req.body };
      if (data.startTime) data.startTime = new Date(data.startTime);
      if (data.endTime) data.endTime = new Date(data.endTime);
      const appointment = await storage.createAppointment(data);
      res.json(appointment);
    } catch (error) {
      console.error('Error creating appointment:', error);
      res.status(500).json({ message: 'Failed to create appointment' });
    }
  });

  app.get('/api/appointments', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const start = req.query.start ? new Date(req.query.start as string) : undefined;
      const end = req.query.end ? new Date(req.query.end as string) : undefined;

      if (start && end) {
        const appts = await storage.getAppointmentsByDateRange(practiceId, start, end);
        res.json(appts);
      } else {
        const appts = await storage.getAppointments(practiceId);
        res.json(appts);
      }
    } catch (error) {
      console.error('Error fetching appointments:', error);
      res.status(500).json({ message: 'Failed to fetch appointments' });
    }
  });

  app.get('/api/appointments/:id', isAuthenticated, async (req: any, res) => {
    try {
      const appt = await storage.getAppointment(parseInt(req.params.id));
      if (!appt) return res.status(404).json({ message: 'Appointment not found' });
      res.json(appt);
    } catch (error) {
      console.error('Error fetching appointment:', error);
      res.status(500).json({ message: 'Failed to fetch appointment' });
    }
  });

  app.patch('/api/appointments/:id', isAuthenticated, async (req: any, res) => {
    try {
      const appt = await storage.updateAppointment(parseInt(req.params.id), req.body);
      res.json(appt);
    } catch (error) {
      console.error('Error updating appointment:', error);
      res.status(500).json({ message: 'Failed to update appointment' });
    }
  });

  app.post('/api/appointments/:id/cancel', isAuthenticated, async (req: any, res) => {
    try {
      const { reason, notes, cancelledBy } = req.body;
      if (!reason) {
        return res.status(400).json({ message: 'Cancellation reason is required' });
      }
      // Determine who cancelled: use explicit value, or infer from authenticated user's role
      let whoCancelled = cancelledBy;
      if (!whoCancelled) {
        const userId = req.user?.claims?.sub;
        if (userId) {
          const user = await storage.getUser(userId);
          whoCancelled = user?.role || 'therapist';
        }
      }
      const appt = await storage.cancelAppointment(parseInt(req.params.id), reason, notes, whoCancelled);
      res.json(appt);
    } catch (error) {
      console.error('Error cancelling appointment:', error);
      res.status(500).json({ message: 'Failed to cancel appointment' });
    }
  });

  // ==================== APPOINTMENT REMINDERS ====================

  // Get reminder configuration status
  app.get('/api/reminders/status', isAuthenticated, async (req: any, res) => {
    try {
      const { getReminderStatus } = await import('./services/appointmentReminderService');
      const status = getReminderStatus();
      res.json(status);
    } catch (error) {
      console.error('Error getting reminder status:', error);
      res.status(500).json({ message: 'Failed to get reminder status' });
    }
  });

  // Get upcoming appointments that need reminders
  app.get('/api/reminders/upcoming', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const hours = parseInt(req.query.hours as string) || 48;
      const appointments = await storage.getUpcomingAppointments(practiceId, hours);
      res.json(appointments);
    } catch (error) {
      console.error('Error fetching upcoming appointments:', error);
      res.status(500).json({ message: 'Failed to fetch upcoming appointments' });
    }
  });

  // Manually trigger reminder processing
  app.post('/api/reminders/trigger', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const { processAppointmentReminders } = await import('./services/appointmentReminderService');
      const practiceId = parseInt(req.body.practiceId as string) || 1;
      const hoursBeforeAppointment = parseInt(req.body.hours as string) || 24;

      const results = await processAppointmentReminders(practiceId, hoursBeforeAppointment);
      res.json({
        message: `Processed ${results.length} appointment reminders`,
        results,
      });
    } catch (error) {
      console.error('Error triggering reminders:', error);
      res.status(500).json({ message: 'Failed to trigger reminders' });
    }
  });

  // Send a test reminder (for testing configuration)
  app.post('/api/reminders/test', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const { email, phone, patientName, practiceName } = req.body;
      const testDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow

      const results: { emailSent?: boolean; smsSent?: boolean; errors: string[] } = { errors: [] };

      // Test email if provided
      if (email) {
        const { isEmailConfigured } = await import('./email');
        if (isEmailConfigured()) {
          const nodemailer = await import('nodemailer');
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
              user: process.env.SMTP_USER || '',
              pass: process.env.SMTP_PASS || '',
            },
          });

          try {
            await transporter.sendMail({
              from: `"${practiceName || 'Test Practice'}" <${process.env.EMAIL_FROM || 'noreply@therapybill.ai'}>`,
              to: email,
              subject: 'Test Appointment Reminder',
              text: `This is a test reminder from ${practiceName || 'Your Practice'}. If you received this, email reminders are working!`,
            });
            results.emailSent = true;
          } catch (err) {
            results.errors.push(`Email failed: ${(err as Error).message}`);
          }
        } else {
          results.errors.push('Email not configured');
        }
      }

      // Test SMS if provided
      if (phone) {
        const { sendSMS, isSMSConfigured } = await import('./services/smsService');
        if (isSMSConfigured()) {
          const smsResult = await sendSMS(phone, `Test reminder from ${practiceName || 'Your Practice'}. If you received this, SMS reminders are working!`);
          results.smsSent = smsResult.success;
          if (!smsResult.success) {
            results.errors.push(`SMS failed: ${smsResult.error}`);
          }
        } else {
          results.errors.push('SMS not configured (Twilio credentials missing)');
        }
      }

      res.json(results);
    } catch (error) {
      console.error('Error sending test reminder:', error);
      res.status(500).json({ message: 'Failed to send test reminder' });
    }
  });

  // ==================== WAITLIST MANAGEMENT ====================

  // Get all waitlist entries
  app.get('/api/waitlist', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const filters = {
        status: req.query.status as string | undefined,
        therapistId: req.query.therapistId as string | undefined,
        patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
        priority: req.query.priority ? parseInt(req.query.priority as string) : undefined,
      };
      const entries = await storage.getWaitlist(practiceId, filters);
      res.json(entries);
    } catch (error) {
      console.error('Error fetching waitlist:', error);
      res.status(500).json({ message: 'Failed to fetch waitlist' });
    }
  });

  // Get waitlist statistics
  app.get('/api/waitlist/stats', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const stats = await storage.getWaitlistStats(practiceId);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching waitlist stats:', error);
      res.status(500).json({ message: 'Failed to fetch waitlist stats' });
    }
  });

  // Get a single waitlist entry
  app.get('/api/waitlist/:id', isAuthenticated, async (req: any, res) => {
    try {
      const entry = await storage.getWaitlistEntry(parseInt(req.params.id));
      if (!entry) {
        return res.status(404).json({ message: 'Waitlist entry not found' });
      }
      res.json(entry);
    } catch (error) {
      console.error('Error fetching waitlist entry:', error);
      res.status(500).json({ message: 'Failed to fetch waitlist entry' });
    }
  });

  // Create a new waitlist entry
  app.post('/api/waitlist', isAuthenticated, async (req: any, res) => {
    try {
      const data = {
        ...req.body,
        practiceId: req.body.practiceId || 1,
      };
      const entry = await storage.createWaitlistEntry(data);
      res.status(201).json(entry);
    } catch (error) {
      console.error('Error creating waitlist entry:', error);
      res.status(500).json({ message: 'Failed to create waitlist entry' });
    }
  });

  // Update a waitlist entry
  app.patch('/api/waitlist/:id', isAuthenticated, async (req: any, res) => {
    try {
      const entry = await storage.updateWaitlistEntry(parseInt(req.params.id), req.body);
      res.json(entry);
    } catch (error) {
      console.error('Error updating waitlist entry:', error);
      res.status(500).json({ message: 'Failed to update waitlist entry' });
    }
  });

  // Delete a waitlist entry
  app.delete('/api/waitlist/:id', isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteWaitlistEntry(parseInt(req.params.id));
      res.json({ message: 'Waitlist entry deleted' });
    } catch (error) {
      console.error('Error deleting waitlist entry:', error);
      res.status(500).json({ message: 'Failed to delete waitlist entry' });
    }
  });

  // Find matching waitlist entries for a cancellation slot
  app.post('/api/waitlist/find-matches', isAuthenticated, async (req: any, res) => {
    try {
      const { practiceId, therapistId, date, time } = req.body;
      const matches = await storage.getWaitlistForSlot(
        practiceId || 1,
        therapistId,
        new Date(date),
        time
      );
      res.json(matches);
    } catch (error) {
      console.error('Error finding waitlist matches:', error);
      res.status(500).json({ message: 'Failed to find waitlist matches' });
    }
  });

  // Notify a waitlist patient about an opening
  app.post('/api/waitlist/:id/notify', isAuthenticated, async (req: any, res) => {
    try {
      const { date, time, therapistId } = req.body;
      const entryId = parseInt(req.params.id);

      // Get the entry and patient info
      const entry = await storage.getWaitlistEntry(entryId);
      if (!entry) {
        return res.status(404).json({ message: 'Waitlist entry not found' });
      }

      const patient = await storage.getPatient(entry.patientId);
      if (!patient) {
        return res.status(404).json({ message: 'Patient not found' });
      }

      const practice = await storage.getPractice(entry.practiceId);
      const practiceName = practice?.name || 'Your Practice';

      const slotDate = new Date(date);
      const formattedDate = slotDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });

      const results: { emailSent?: boolean; smsSent?: boolean; errors: string[] } = { errors: [] };

      // Send email notification
      if (patient.email) {
        try {
          const { isEmailConfigured } = await import('./email');
          if (isEmailConfigured()) {
            const nodemailer = await import('nodemailer');
            const transporter = nodemailer.createTransport({
              host: process.env.SMTP_HOST || 'smtp.gmail.com',
              port: parseInt(process.env.SMTP_PORT || '587'),
              secure: process.env.SMTP_SECURE === 'true',
              auth: {
                user: process.env.SMTP_USER || '',
                pass: process.env.SMTP_PASS || '',
              },
            });

            await transporter.sendMail({
              from: `"${practiceName}" <${process.env.EMAIL_FROM || 'noreply@therapybill.ai'}>`,
              to: patient.email,
              subject: `Appointment Opening Available - ${formattedDate}`,
              html: `
                <p>Hi ${patient.firstName},</p>
                <p>Great news! An appointment slot has opened up that matches your preferences:</p>
                <p><strong>Date:</strong> ${formattedDate}<br>
                <strong>Time:</strong> ${time}</p>
                <p>If you'd like to book this appointment, please contact us as soon as possible as slots fill up quickly.</p>
                <p>Best regards,<br>${practiceName}</p>
              `,
            });
            results.emailSent = true;
          }
        } catch (err) {
          results.errors.push(`Email failed: ${(err as Error).message}`);
        }
      }

      // Send SMS notification
      if (patient.phone) {
        try {
          const { sendSMS, isSMSConfigured } = await import('./services/smsService');
          if (isSMSConfigured()) {
            const smsResult = await sendSMS(
              patient.phone,
              `Hi ${patient.firstName}! An appointment slot opened at ${practiceName} on ${formattedDate} at ${time}. Reply YES to book or call us ASAP!`
            );
            results.smsSent = smsResult.success;
            if (!smsResult.success) {
              results.errors.push(`SMS failed: ${smsResult.error}`);
            }
          }
        } catch (err) {
          results.errors.push(`SMS error: ${(err as Error).message}`);
        }
      }

      // Update the waitlist entry status
      if (results.emailSent || results.smsSent) {
        await storage.markWaitlistNotified(entryId, { date, time, therapistId });
      }

      res.json({
        message: 'Patient notified',
        ...results,
      });
    } catch (error) {
      console.error('Error notifying waitlist patient:', error);
      res.status(500).json({ message: 'Failed to notify patient' });
    }
  });

  // Mark waitlist entry as scheduled
  app.post('/api/waitlist/:id/schedule', isAuthenticated, async (req: any, res) => {
    try {
      const { appointmentId } = req.body;
      const entry = await storage.markWaitlistScheduled(
        parseInt(req.params.id),
        appointmentId
      );
      res.json(entry);
    } catch (error) {
      console.error('Error scheduling waitlist entry:', error);
      res.status(500).json({ message: 'Failed to schedule waitlist entry' });
    }
  });

  // Expire old waitlist entries
  app.post('/api/waitlist/expire', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.body.practiceId as string) || 1;
      const count = await storage.expireOldWaitlistEntries(practiceId);
      res.json({ message: `Expired ${count} waitlist entries` });
    } catch (error) {
      console.error('Error expiring waitlist entries:', error);
      res.status(500).json({ message: 'Failed to expire waitlist entries' });
    }
  });

  // ==================== REVIEW MANAGEMENT ====================

  // Get review request statistics
  app.get('/api/reviews/stats', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const requestStats = await storage.getReviewRequestStats(practiceId);
      const reviewStats = await storage.getReviewStats(practiceId);
      res.json({ requests: requestStats, reviews: reviewStats });
    } catch (error) {
      console.error('Error fetching review stats:', error);
      res.status(500).json({ message: 'Failed to fetch review stats' });
    }
  });

  // Get all review requests
  app.get('/api/reviews/requests', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const filters = {
        status: req.query.status as string | undefined,
        patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
      };
      const requests = await storage.getReviewRequests(practiceId, filters);
      res.json(requests);
    } catch (error) {
      console.error('Error fetching review requests:', error);
      res.status(500).json({ message: 'Failed to fetch review requests' });
    }
  });

  // Get patients eligible for review requests
  app.get('/api/reviews/eligible-patients', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const days = parseInt(req.query.days as string) || 1;
      const eligible = await storage.getPatientsEligibleForReview(practiceId, days);
      res.json(eligible);
    } catch (error) {
      console.error('Error fetching eligible patients:', error);
      res.status(500).json({ message: 'Failed to fetch eligible patients' });
    }
  });

  // Create a review request
  app.post('/api/reviews/requests', isAuthenticated, async (req: any, res) => {
    try {
      // Generate a unique feedback token
      const crypto = await import('crypto');
      const feedbackToken = crypto.randomBytes(32).toString('hex');

      const data = {
        ...req.body,
        practiceId: req.body.practiceId || 1,
        feedbackToken,
      };
      const request = await storage.createReviewRequest(data);
      res.status(201).json(request);
    } catch (error) {
      console.error('Error creating review request:', error);
      res.status(500).json({ message: 'Failed to create review request' });
    }
  });

  // Send a review request to patient (now sends to feedback page, not Google directly)
  app.post('/api/reviews/requests/:id/send', isAuthenticated, async (req: any, res) => {
    try {
      const requestId = parseInt(req.params.id);
      const { sendVia } = req.body;

      const request = await storage.getReviewRequest(requestId);
      if (!request) {
        return res.status(404).json({ message: 'Review request not found' });
      }

      // Ensure feedback token exists
      if (!request.feedbackToken) {
        const crypto = await import('crypto');
        const feedbackToken = crypto.randomBytes(32).toString('hex');
        await storage.updateReviewRequest(requestId, { feedbackToken });
        request.feedbackToken = feedbackToken;
      }

      const patient = await storage.getPatient(request.patientId);
      if (!patient) {
        return res.status(404).json({ message: 'Patient not found' });
      }

      const practice = await storage.getPractice(request.practiceId);
      const practiceName = practice?.name || 'Your Practice';

      // Build the feedback URL (private feedback page)
      const baseUrl = process.env.APP_URL || 'http://localhost:5000';
      const feedbackUrl = `${baseUrl}/feedback/${request.feedbackToken}`;

      const { generateFeedbackRequestMessage } = await import('./services/reviewResponseService');
      const results: { emailSent?: boolean; smsSent?: boolean; errors: string[] } = { errors: [] };

      // Send email
      if ((sendVia === 'email' || sendVia === 'both') && patient.email) {
        try {
          const { isEmailConfigured } = await import('./email');
          if (isEmailConfigured()) {
            const message = generateFeedbackRequestMessage(patient.firstName, practiceName, feedbackUrl, 'email');
            const nodemailer = await import('nodemailer');
            const transporter = nodemailer.createTransport({
              host: process.env.SMTP_HOST || 'smtp.gmail.com',
              port: parseInt(process.env.SMTP_PORT || '587'),
              secure: process.env.SMTP_SECURE === 'true',
              auth: {
                user: process.env.SMTP_USER || '',
                pass: process.env.SMTP_PASS || '',
              },
            });

            await transporter.sendMail({
              from: `"${practiceName}" <${process.env.EMAIL_FROM || 'noreply@therapybill.ai'}>`,
              to: patient.email,
              subject: message.subject,
              html: message.body,
            });
            results.emailSent = true;
          }
        } catch (err) {
          results.errors.push(`Email failed: ${(err as Error).message}`);
        }
      }

      // Send SMS
      if ((sendVia === 'sms' || sendVia === 'both') && patient.phone) {
        try {
          const { sendSMS, isSMSConfigured } = await import('./services/smsService');
          if (isSMSConfigured()) {
            const message = generateFeedbackRequestMessage(patient.firstName, practiceName, feedbackUrl, 'sms');
            const smsResult = await sendSMS(patient.phone, message.body);
            results.smsSent = smsResult.success;
            if (!smsResult.success) {
              results.errors.push(`SMS failed: ${smsResult.error}`);
            }
          }
        } catch (err) {
          results.errors.push(`SMS error: ${(err as Error).message}`);
        }
      }

      // Update the request status
      if (results.emailSent || results.smsSent) {
        await storage.updateReviewRequest(requestId, {
          status: 'sent',
          sentVia: sendVia,
          emailSent: results.emailSent,
          smsSent: results.smsSent,
          sentAt: new Date(),
        });
      }

      res.json({
        message: 'Review request sent',
        ...results,
      });
    } catch (error) {
      console.error('Error sending review request:', error);
      res.status(500).json({ message: 'Failed to send review request' });
    }
  });

  // Update review request status
  app.patch('/api/reviews/requests/:id', isAuthenticated, async (req: any, res) => {
    try {
      const request = await storage.updateReviewRequest(parseInt(req.params.id), req.body);
      res.json(request);
    } catch (error) {
      console.error('Error updating review request:', error);
      res.status(500).json({ message: 'Failed to update review request' });
    }
  });

  // Get all Google reviews
  app.get('/api/reviews/google', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const filters = {
        responseStatus: req.query.responseStatus as string | undefined,
        sentiment: req.query.sentiment as string | undefined,
        minRating: req.query.minRating ? parseInt(req.query.minRating as string) : undefined,
        maxRating: req.query.maxRating ? parseInt(req.query.maxRating as string) : undefined,
      };
      const reviews = await storage.getGoogleReviews(practiceId, filters);
      res.json(reviews);
    } catch (error) {
      console.error('Error fetching Google reviews:', error);
      res.status(500).json({ message: 'Failed to fetch Google reviews' });
    }
  });

  // Get a single Google review
  app.get('/api/reviews/google/:id', isAuthenticated, async (req: any, res) => {
    try {
      const review = await storage.getGoogleReview(parseInt(req.params.id));
      if (!review) {
        return res.status(404).json({ message: 'Review not found' });
      }
      res.json(review);
    } catch (error) {
      console.error('Error fetching Google review:', error);
      res.status(500).json({ message: 'Failed to fetch Google review' });
    }
  });

  // Add a Google review manually
  app.post('/api/reviews/google', isAuthenticated, async (req: any, res) => {
    try {
      const { analyzeReview } = await import('./services/reviewResponseService');

      // Analyze the review
      const analysisResult = await analyzeReview(req.body.reviewText || '', req.body.rating || 3);

      const data = {
        ...req.body,
        practiceId: req.body.practiceId || 1,
        sentiment: analysisResult.analysis?.sentiment,
        tags: analysisResult.analysis?.tags,
      };

      const review = await storage.createGoogleReview(data);
      res.status(201).json(review);
    } catch (error) {
      console.error('Error creating Google review:', error);
      res.status(500).json({ message: 'Failed to create Google review' });
    }
  });

  // Update a Google review
  app.patch('/api/reviews/google/:id', isAuthenticated, async (req: any, res) => {
    try {
      const review = await storage.updateGoogleReview(parseInt(req.params.id), req.body);
      res.json(review);
    } catch (error) {
      console.error('Error updating Google review:', error);
      res.status(500).json({ message: 'Failed to update Google review' });
    }
  });

  // Generate AI response for a review
  app.post('/api/reviews/google/:id/generate-response', isAuthenticated, async (req: any, res) => {
    try {
      const review = await storage.getGoogleReview(parseInt(req.params.id));
      if (!review) {
        return res.status(404).json({ message: 'Review not found' });
      }

      const practice = await storage.getPractice(review.practiceId);
      const { generateReviewResponse } = await import('./services/reviewResponseService');

      const result = await generateReviewResponse({
        reviewerName: review.reviewerName || 'Valued Patient',
        rating: review.rating || 3,
        reviewText: review.reviewText || '',
        practiceName: practice?.name || 'Your Practice',
        practicePhone: practice?.phone || undefined,
        tone: req.body.tone || 'professional',
        includeCallToAction: req.body.includeCallToAction !== false,
      });

      if (!result.success) {
        return res.status(500).json({ message: result.error });
      }

      // Save the draft response
      await storage.updateGoogleReview(review.id, {
        aiDraftResponse: result.response,
        responseStatus: 'draft',
      });

      res.json({ response: result.response });
    } catch (error) {
      console.error('Error generating review response:', error);
      res.status(500).json({ message: 'Failed to generate response' });
    }
  });

  // Mark a review as responded
  app.post('/api/reviews/google/:id/respond', isAuthenticated, async (req: any, res) => {
    try {
      const { finalResponse } = req.body;
      const userId = req.user?.id;

      const review = await storage.updateGoogleReview(parseInt(req.params.id), {
        finalResponse,
        responseStatus: 'published',
        respondedAt: new Date(),
        respondedBy: userId,
      });

      res.json(review);
    } catch (error) {
      console.error('Error marking review as responded:', error);
      res.status(500).json({ message: 'Failed to update review' });
    }
  });

  // ==================== ONLINE BOOKING ====================

  // --- Appointment Types ---
  app.get('/api/booking/appointment-types', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const activeOnly = req.query.activeOnly === 'true';
      const types = await storage.getAppointmentTypes(practiceId, activeOnly);
      res.json(types);
    } catch (error) {
      console.error('Error fetching appointment types:', error);
      res.status(500).json({ message: 'Failed to fetch appointment types' });
    }
  });

  app.post('/api/booking/appointment-types', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const data = { ...req.body, practiceId: req.body.practiceId || 1 };
      const type = await storage.createAppointmentType(data);
      res.status(201).json(type);
    } catch (error) {
      console.error('Error creating appointment type:', error);
      res.status(500).json({ message: 'Failed to create appointment type' });
    }
  });

  app.patch('/api/booking/appointment-types/:id', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const type = await storage.updateAppointmentType(parseInt(req.params.id), req.body);
      res.json(type);
    } catch (error) {
      console.error('Error updating appointment type:', error);
      res.status(500).json({ message: 'Failed to update appointment type' });
    }
  });

  app.delete('/api/booking/appointment-types/:id', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      await storage.deleteAppointmentType(parseInt(req.params.id));
      res.json({ message: 'Appointment type deleted' });
    } catch (error) {
      console.error('Error deleting appointment type:', error);
      res.status(500).json({ message: 'Failed to delete appointment type' });
    }
  });

  // --- Therapist Availability ---
  app.get('/api/booking/availability', isAuthenticated, async (req: any, res) => {
    try {
      const therapistId = req.query.therapistId as string;
      if (therapistId) {
        const availability = await storage.getTherapistAvailability(therapistId);
        res.json(availability);
      } else {
        const practiceId = parseInt(req.query.practiceId as string) || 1;
        const availability = await storage.getPracticeAvailability(practiceId);
        res.json(availability);
      }
    } catch (error) {
      console.error('Error fetching availability:', error);
      res.status(500).json({ message: 'Failed to fetch availability' });
    }
  });

  app.post('/api/booking/availability', isAuthenticated, async (req: any, res) => {
    try {
      const data = { ...req.body, practiceId: req.body.practiceId || 1 };
      const availability = await storage.setTherapistAvailability(data);
      res.json(availability);
    } catch (error) {
      console.error('Error setting availability:', error);
      res.status(500).json({ message: 'Failed to set availability' });
    }
  });

  app.delete('/api/booking/availability/:id', isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteTherapistAvailability(parseInt(req.params.id));
      res.json({ message: 'Availability deleted' });
    } catch (error) {
      console.error('Error deleting availability:', error);
      res.status(500).json({ message: 'Failed to delete availability' });
    }
  });

  // --- Therapist Time Off ---
  app.get('/api/booking/time-off', isAuthenticated, async (req: any, res) => {
    try {
      const therapistId = req.query.therapistId as string;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const timeOff = await storage.getTherapistTimeOff(therapistId, startDate, endDate);
      res.json(timeOff);
    } catch (error) {
      console.error('Error fetching time off:', error);
      res.status(500).json({ message: 'Failed to fetch time off' });
    }
  });

  app.post('/api/booking/time-off', isAuthenticated, async (req: any, res) => {
    try {
      const data = { ...req.body, practiceId: req.body.practiceId || 1 };
      const timeOff = await storage.addTherapistTimeOff(data);
      res.json(timeOff);
    } catch (error) {
      console.error('Error adding time off:', error);
      res.status(500).json({ message: 'Failed to add time off' });
    }
  });

  app.delete('/api/booking/time-off/:id', isAuthenticated, async (req: any, res) => {
    try {
      await storage.deleteTherapistTimeOff(parseInt(req.params.id));
      res.json({ message: 'Time off deleted' });
    } catch (error) {
      console.error('Error deleting time off:', error);
      res.status(500).json({ message: 'Failed to delete time off' });
    }
  });

  // --- Booking Settings ---
  app.get('/api/booking/settings', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const settings = await storage.getBookingSettings(practiceId);
      res.json(settings || {});
    } catch (error) {
      console.error('Error fetching booking settings:', error);
      res.status(500).json({ message: 'Failed to fetch booking settings' });
    }
  });

  app.post('/api/booking/settings', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const data = { ...req.body, practiceId: req.body.practiceId || 1 };
      const settings = await storage.upsertBookingSettings(data);
      res.json(settings);
    } catch (error) {
      console.error('Error saving booking settings:', error);
      res.status(500).json({ message: 'Failed to save booking settings' });
    }
  });

  // --- Online Bookings (Admin) ---
  app.get('/api/booking/bookings', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const filters = {
        status: req.query.status as string | undefined,
        therapistId: req.query.therapistId as string | undefined,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      };
      const bookings = await storage.getOnlineBookings(practiceId, filters);
      res.json(bookings);
    } catch (error) {
      console.error('Error fetching bookings:', error);
      res.status(500).json({ message: 'Failed to fetch bookings' });
    }
  });

  app.post('/api/booking/bookings/:id/confirm', isAuthenticated, async (req: any, res) => {
    try {
      const bookingId = parseInt(req.params.id);
      const booking = await storage.getOnlineBooking(bookingId);
      if (!booking) {
        return res.status(404).json({ message: 'Booking not found' });
      }

      // Create the actual appointment
      const appointmentType = booking.appointmentTypeId
        ? await storage.getAppointmentType(booking.appointmentTypeId)
        : null;

      const startTime = new Date(`${booking.requestedDate}T${booking.requestedTime}`);
      const endTime = new Date(startTime.getTime() + (appointmentType?.duration || 60) * 60000);

      const appointment = await storage.createAppointment({
        practiceId: booking.practiceId,
        patientId: booking.patientId || undefined,
        therapistId: booking.therapistId || undefined,
        title: appointmentType?.name || 'Online Booking',
        startTime,
        endTime,
        status: 'scheduled',
        notes: booking.notes || undefined,
      });

      // Update the booking
      const confirmedBooking = await storage.confirmOnlineBooking(bookingId, appointment.id);

      // Send confirmation email/SMS
      if (booking.patientId) {
        const patient = await storage.getPatient(booking.patientId);
        if (patient?.email) {
          // TODO: Send confirmation email
        }
      } else if (booking.guestEmail) {
        // TODO: Send confirmation email to guest
      }

      res.json({ booking: confirmedBooking, appointment });
    } catch (error) {
      console.error('Error confirming booking:', error);
      res.status(500).json({ message: 'Failed to confirm booking' });
    }
  });

  app.post('/api/booking/bookings/:id/cancel', isAuthenticated, async (req: any, res) => {
    try {
      const { reason } = req.body;
      const booking = await storage.cancelOnlineBooking(parseInt(req.params.id), reason);
      res.json(booking);
    } catch (error) {
      console.error('Error cancelling booking:', error);
      res.status(500).json({ message: 'Failed to cancel booking' });
    }
  });

  // --- Public Booking Endpoints (No Auth Required) ---

  // Get booking page by slug
  app.get('/api/public/book/:slug', async (req: any, res) => {
    try {
      const settings = await storage.getBookingSettingsBySlug(req.params.slug);
      if (!settings || !settings.isOnlineBookingEnabled) {
        return res.status(404).json({ message: 'Booking page not found' });
      }

      const practice = await storage.getPractice(settings.practiceId);
      const appointmentTypes = await storage.getAppointmentTypes(settings.practiceId, true);
      const activeTypes = appointmentTypes.filter(t => t.allowOnlineBooking);

      // Get therapists for this practice
      const therapists = await storage.getTherapistsByPractice(settings.practiceId);

      res.json({
        practice: {
          id: practice?.id,
          name: practice?.name,
          address: practice?.address,
          phone: practice?.phone,
        },
        settings: {
          welcomeMessage: settings.welcomeMessage,
          allowNewPatients: settings.allowNewPatients,
          newPatientMessage: settings.newPatientMessage,
          cancellationPolicy: settings.cancellationPolicy,
          requirePhoneNumber: settings.requirePhoneNumber,
          requireInsuranceInfo: settings.requireInsuranceInfo,
        },
        appointmentTypes: activeTypes,
        therapists: therapists.map(t => ({
          id: t.id,
          name: `${t.firstName || ''} ${t.lastName || ''}`.trim() || t.email,
        })),
      });
    } catch (error) {
      console.error('Error fetching booking page:', error);
      res.status(500).json({ message: 'Failed to load booking page' });
    }
  });

  // Get available slots (public)
  app.get('/api/public/book/:slug/slots', async (req: any, res) => {
    try {
      const settings = await storage.getBookingSettingsBySlug(req.params.slug);
      if (!settings || !settings.isOnlineBookingEnabled) {
        return res.status(404).json({ message: 'Booking page not found' });
      }

      const { appointmentTypeId, therapistId, date } = req.query;
      if (!appointmentTypeId || !date) {
        return res.status(400).json({ message: 'appointmentTypeId and date are required' });
      }

      const slots = await storage.getAvailableSlots(
        settings.practiceId,
        therapistId as string || null,
        parseInt(appointmentTypeId as string),
        new Date(date as string)
      );

      res.json(slots);
    } catch (error) {
      console.error('Error fetching available slots:', error);
      res.status(500).json({ message: 'Failed to fetch available slots' });
    }
  });

  // Create booking (public)
  app.post('/api/public/book/:slug', async (req: any, res) => {
    try {
      const settings = await storage.getBookingSettingsBySlug(req.params.slug);
      if (!settings || !settings.isOnlineBookingEnabled) {
        return res.status(404).json({ message: 'Booking page not found' });
      }

      const {
        appointmentTypeId,
        therapistId,
        date,
        time,
        firstName,
        lastName,
        email,
        phone,
        notes,
        isNewPatient,
      } = req.body;

      // Validate required fields
      if (!appointmentTypeId || !date || !time || !firstName || !lastName || !email) {
        return res.status(400).json({ message: 'Missing required fields' });
      }

      // Check if slot is still available
      const slots = await storage.getAvailableSlots(
        settings.practiceId,
        therapistId || null,
        parseInt(appointmentTypeId),
        new Date(date)
      );

      if (!slots.includes(time)) {
        return res.status(400).json({ message: 'Selected time slot is no longer available' });
      }

      // Check if this is an existing patient by email
      let patientId: number | undefined;
      const patients = await storage.getPatients(settings.practiceId);
      const existingPatient = patients.find(p => p.email?.toLowerCase() === email.toLowerCase());
      if (existingPatient) {
        patientId = existingPatient.id;
      }

      // Create the booking
      const booking = await storage.createOnlineBooking({
        practiceId: settings.practiceId,
        appointmentTypeId: parseInt(appointmentTypeId),
        therapistId: therapistId || undefined,
        patientId,
        guestFirstName: !patientId ? firstName : undefined,
        guestLastName: !patientId ? lastName : undefined,
        guestEmail: !patientId ? email : undefined,
        guestPhone: !patientId ? phone : undefined,
        requestedDate: date,
        requestedTime: time,
        isNewPatient: isNewPatient || !patientId,
        notes,
        status: settings.requireInsuranceInfo ? 'pending' : 'pending',
      });

      // Send confirmation email
      const practice = await storage.getPractice(settings.practiceId);
      const appointmentType = await storage.getAppointmentType(parseInt(appointmentTypeId));

      // TODO: Send booking confirmation email

      res.status(201).json({
        success: true,
        confirmationCode: booking.confirmationCode,
        message: 'Booking request submitted successfully',
        booking: {
          id: booking.id,
          date: booking.requestedDate,
          time: booking.requestedTime,
          appointmentType: appointmentType?.name,
          status: booking.status,
        },
      });
    } catch (error) {
      console.error('Error creating booking:', error);
      res.status(500).json({ message: 'Failed to create booking' });
    }
  });

  // Check booking status (public)
  app.get('/api/public/booking/:code', async (req: any, res) => {
    try {
      const booking = await storage.getOnlineBookingByCode(req.params.code);
      if (!booking) {
        return res.status(404).json({ message: 'Booking not found' });
      }

      const appointmentType = booking.appointmentTypeId
        ? await storage.getAppointmentType(booking.appointmentTypeId)
        : null;

      res.json({
        confirmationCode: booking.confirmationCode,
        status: booking.status,
        date: booking.requestedDate,
        time: booking.requestedTime,
        appointmentType: appointmentType?.name,
        confirmedAt: booking.confirmedAt,
        cancelledAt: booking.cancelledAt,
      });
    } catch (error) {
      console.error('Error checking booking status:', error);
      res.status(500).json({ message: 'Failed to check booking status' });
    }
  });

  // ==================== TELEHEALTH ====================

  // Get telehealth settings
  app.get('/api/telehealth/settings', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const settings = await storage.getTelehealthSettings(practiceId);
      res.json(settings || { isEnabled: true, practiceId });
    } catch (error) {
      console.error('Error fetching telehealth settings:', error);
      res.status(500).json({ message: 'Failed to fetch telehealth settings' });
    }
  });

  // Save telehealth settings
  app.post('/api/telehealth/settings', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const data = { ...req.body, practiceId: req.body.practiceId || 1 };
      const settings = await storage.upsertTelehealthSettings(data);
      res.json(settings);
    } catch (error) {
      console.error('Error saving telehealth settings:', error);
      res.status(500).json({ message: 'Failed to save telehealth settings' });
    }
  });

  // Get telehealth sessions
  app.get('/api/telehealth/sessions', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const filters = {
        status: req.query.status as string | undefined,
        therapistId: req.query.therapistId as string | undefined,
        patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      };
      const sessions = await storage.getTelehealthSessions(practiceId, filters);
      res.json(sessions);
    } catch (error) {
      console.error('Error fetching telehealth sessions:', error);
      res.status(500).json({ message: 'Failed to fetch telehealth sessions' });
    }
  });

  // Get today's telehealth sessions
  app.get('/api/telehealth/sessions/today', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const therapistId = req.query.therapistId as string | undefined;
      const sessions = await storage.getTodaysTelehealthSessions(practiceId, therapistId);

      // Enrich with patient info
      const enrichedSessions = await Promise.all(sessions.map(async (session) => {
        let patientName = 'Unknown Patient';
        if (session.patientId) {
          const patient = await storage.getPatient(session.patientId);
          if (patient) {
            patientName = `${patient.firstName} ${patient.lastName}`;
          }
        }
        return { ...session, patientName };
      }));

      res.json(enrichedSessions);
    } catch (error) {
      console.error('Error fetching today\'s sessions:', error);
      res.status(500).json({ message: 'Failed to fetch sessions' });
    }
  });

  // Get a single telehealth session
  app.get('/api/telehealth/sessions/:id', isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.getTelehealthSession(parseInt(req.params.id));
      if (!session) {
        return res.status(404).json({ message: 'Session not found' });
      }
      res.json(session);
    } catch (error) {
      console.error('Error fetching telehealth session:', error);
      res.status(500).json({ message: 'Failed to fetch telehealth session' });
    }
  });

  // Create a telehealth session for an appointment
  app.post('/api/telehealth/sessions', isAuthenticated, async (req: any, res) => {
    try {
      const { appointmentId } = req.body;

      // Check if session already exists for this appointment
      const existing = await storage.getTelehealthSessionByAppointment(appointmentId);
      if (existing) {
        return res.json(existing);
      }

      // Get the appointment
      const appointment = await storage.getAppointment(appointmentId);
      if (!appointment) {
        return res.status(404).json({ message: 'Appointment not found' });
      }

      // Generate room name and access code
      const roomName = storage.generateTelehealthRoomName();
      const patientAccessCode = storage.generatePatientAccessCode();

      // Create the session
      const session = await storage.createTelehealthSession({
        practiceId: appointment.practiceId || 1,
        appointmentId,
        patientId: appointment.patientId || undefined,
        therapistId: appointment.therapistId || undefined,
        roomName,
        roomUrl: `/telehealth/room/${roomName}`,
        hostUrl: `/telehealth/room/${roomName}?host=true`,
        patientAccessCode,
        scheduledStart: appointment.startTime,
        scheduledEnd: appointment.endTime,
        status: 'scheduled',
        waitingRoomEnabled: true,
      });

      res.status(201).json(session);
    } catch (error) {
      console.error('Error creating telehealth session:', error);
      res.status(500).json({ message: 'Failed to create telehealth session' });
    }
  });

  // Update telehealth session
  app.patch('/api/telehealth/sessions/:id', isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.updateTelehealthSession(parseInt(req.params.id), req.body);
      res.json(session);
    } catch (error) {
      console.error('Error updating telehealth session:', error);
      res.status(500).json({ message: 'Failed to update telehealth session' });
    }
  });

  // Join a telehealth session (updates status)
  app.post('/api/telehealth/sessions/:id/join', isAuthenticated, async (req: any, res) => {
    try {
      const { isTherapist } = req.body;
      const session = await storage.startTelehealthSession(parseInt(req.params.id), isTherapist);
      res.json(session);
    } catch (error) {
      console.error('Error joining telehealth session:', error);
      res.status(500).json({ message: 'Failed to join session' });
    }
  });

  // End a telehealth session
  app.post('/api/telehealth/sessions/:id/end', isAuthenticated, async (req: any, res) => {
    try {
      const session = await storage.endTelehealthSession(parseInt(req.params.id));
      res.json(session);
    } catch (error) {
      console.error('Error ending telehealth session:', error);
      res.status(500).json({ message: 'Failed to end session' });
    }
  });

  // --- Public Telehealth Endpoints (for patients) ---

  // Join by access code (patient)
  app.get('/api/public/telehealth/join/:code', async (req: any, res) => {
    try {
      const session = await storage.getTelehealthSessionByAccessCode(req.params.code.toUpperCase());
      if (!session) {
        return res.status(404).json({ message: 'Session not found. Please check your access code.' });
      }

      // Check if session is still valid
      const now = new Date();
      const scheduledStart = new Date(session.scheduledStart);
      const scheduledEnd = new Date(session.scheduledEnd);

      // Allow joining 15 minutes before and up to session end
      const earliestJoin = new Date(scheduledStart.getTime() - 15 * 60 * 1000);
      if (now < earliestJoin) {
        return res.status(400).json({
          message: 'Session not yet available',
          availableAt: earliestJoin,
        });
      }

      if (now > scheduledEnd && session.status !== 'in_progress') {
        return res.status(400).json({ message: 'This session has ended' });
      }

      if (session.status === 'cancelled') {
        return res.status(400).json({ message: 'This session has been cancelled' });
      }

      if (session.status === 'completed') {
        return res.status(400).json({ message: 'This session has already completed' });
      }

      // Get patient and practice info
      let patientName = 'Patient';
      if (session.patientId) {
        const patient = await storage.getPatient(session.patientId);
        if (patient) {
          patientName = patient.firstName;
        }
      }

      const practice = await storage.getPractice(session.practiceId);

      res.json({
        sessionId: session.id,
        roomName: session.roomName,
        roomUrl: session.roomUrl,
        patientName,
        practiceName: practice?.name || 'Your Practice',
        scheduledStart: session.scheduledStart,
        scheduledEnd: session.scheduledEnd,
        status: session.status,
        waitingRoomEnabled: session.waitingRoomEnabled,
      });
    } catch (error) {
      console.error('Error joining by access code:', error);
      res.status(500).json({ message: 'Failed to join session' });
    }
  });

  // Patient marks themselves as joined (waiting room)
  app.post('/api/public/telehealth/waiting/:code', async (req: any, res) => {
    try {
      const session = await storage.getTelehealthSessionByAccessCode(req.params.code.toUpperCase());
      if (!session) {
        return res.status(404).json({ message: 'Session not found' });
      }

      // Update patient joined time if not already set
      if (!session.patientJoinedAt) {
        await storage.updateTelehealthSession(session.id, {
          patientJoinedAt: new Date(),
          status: session.status === 'scheduled' ? 'waiting' : session.status,
        });
      }

      res.json({ message: 'Joined waiting room', status: 'waiting' });
    } catch (error) {
      console.error('Error joining waiting room:', error);
      res.status(500).json({ message: 'Failed to join waiting room' });
    }
  });

  // Check session status (for polling)
  app.get('/api/public/telehealth/status/:code', async (req: any, res) => {
    try {
      const session = await storage.getTelehealthSessionByAccessCode(req.params.code.toUpperCase());
      if (!session) {
        return res.status(404).json({ message: 'Session not found' });
      }

      res.json({
        status: session.status,
        therapistJoined: !!session.therapistJoinedAt,
      });
    } catch (error) {
      console.error('Error checking session status:', error);
      res.status(500).json({ message: 'Failed to check status' });
    }
  });

  // ==================== CANCELLATION ANALYTICS ====================

  app.get('/api/analytics/cancellations', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const start = req.query.start ? new Date(req.query.start as string) : new Date(new Date().setMonth(new Date().getMonth() - 6));
      const end = req.query.end ? new Date(req.query.end as string) : new Date(new Date().setMonth(new Date().getMonth() + 3));
      const stats = await storage.getCancellationStats(practiceId, start, end);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching cancellation stats:', error);
      res.status(500).json({ message: 'Failed to fetch cancellation stats' });
    }
  });

  app.get('/api/analytics/cancellations/by-patient', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const start = req.query.start ? new Date(req.query.start as string) : new Date(new Date().setMonth(new Date().getMonth() - 6));
      const end = req.query.end ? new Date(req.query.end as string) : new Date(new Date().setMonth(new Date().getMonth() + 3));
      const data = await storage.getCancellationsByPatient(practiceId, start, end);
      res.json(data);
    } catch (error) {
      console.error('Error fetching cancellations by patient:', error);
      res.status(500).json({ message: 'Failed to fetch cancellations by patient' });
    }
  });

  app.get('/api/analytics/cancellations/trend', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const start = req.query.start ? new Date(req.query.start as string) : new Date(new Date().setMonth(new Date().getMonth() - 12));
      const end = req.query.end ? new Date(req.query.end as string) : new Date(new Date().setMonth(new Date().getMonth() + 3));
      const data = await storage.getCancellationTrend(practiceId, start, end);
      res.json(data);
    } catch (error) {
      console.error('Error fetching cancellation trend:', error);
      res.status(500).json({ message: 'Failed to fetch cancellation trend' });
    }
  });

  // Manual trigger for weekly cancellation report
  app.post('/api/reports/weekly-cancellation', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.body.practiceId as string) || 1;
      await generateAndSendWeeklyCancellationReport(practiceId);
      res.json({ message: 'Weekly cancellation report triggered successfully' });
    } catch (error) {
      console.error('Error triggering weekly cancellation report:', error);
      res.status(500).json({ message: 'Failed to trigger weekly cancellation report' });
    }
  });

  // ==================== HARD DELETION OF EXPIRED PATIENTS ====================

  app.post('/api/admin/hard-delete-expired', isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      logger.info('Manual hard deletion triggered', { userId: req.user?.claims?.sub });
      const result = await triggerHardDeletionNow();

      await storage.createAuditLog({
        userId: req.user?.claims?.sub || 'unknown',
        eventType: 'delete',
        eventCategory: 'data_retention',
        resourceType: 'system',
        resourceId: 'hard-deletion',
        details: { deletedCount: result.deletedCount, errors: result.errors },
        ipAddress: req.ip || '0.0.0.0',
      });

      res.json({
        message: `Hard deletion completed. ${result.deletedCount} patient(s) permanently removed.`,
        deletedCount: result.deletedCount,
        errors: result.errors,
      });
    } catch (error: any) {
      logger.error('Manual hard deletion failed', { error: error.message });
      res.status(500).json({ message: 'Hard deletion failed', error: error.message });
    }
  });

  // ==================== SECURE MESSAGING ====================

  // Get all conversations for a therapist
  app.get('/api/messages/conversations', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = 1; // TODO: get from user
      const therapistId = req.user?.claims?.sub;
      const status = req.query.status as string | undefined;
      const patientId = req.query.patientId ? parseInt(req.query.patientId as string) : undefined;

      const conversations = await storage.getConversations(practiceId, {
        therapistId,
        patientId,
        status: status || 'active',
      });

      res.json(conversations);
    } catch (error) {
      console.error('Error fetching conversations:', error);
      res.status(500).json({ message: 'Failed to fetch conversations' });
    }
  });

  // Get a single conversation with messages
  app.get('/api/messages/conversations/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = await storage.getConversationWithMessages(id);

      if (!data) {
        return res.status(404).json({ message: 'Conversation not found' });
      }

      // Mark as read by therapist
      await storage.markConversationReadByTherapist(id);

      res.json(data);
    } catch (error) {
      console.error('Error fetching conversation:', error);
      res.status(500).json({ message: 'Failed to fetch conversation' });
    }
  });

  // Create a new conversation
  app.post('/api/messages/conversations', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = 1; // TODO: get from user
      const therapistId = req.user?.claims?.sub;
      const { patientId, subject, initialMessage } = req.body;

      if (!patientId) {
        return res.status(400).json({ message: 'Patient ID is required' });
      }

      // Get patient to verify they exist
      const patient = await storage.getPatient(patientId);
      if (!patient) {
        return res.status(404).json({ message: 'Patient not found' });
      }

      // Check for existing active conversation with this patient
      const existingConversations = await storage.getConversations(practiceId, {
        patientId,
        status: 'active',
      });

      if (existingConversations.length > 0) {
        // Return existing conversation
        return res.json({
          conversation: existingConversations[0],
          isExisting: true,
        });
      }

      // Create new conversation
      const conversation = await storage.createConversation({
        practiceId,
        patientId,
        therapistId,
        subject: subject || `Conversation with ${patient.firstName} ${patient.lastName}`,
        status: 'active',
      });

      // If initial message provided, create it
      if (initialMessage) {
        const user = await storage.getUser(therapistId);
        await storage.createMessage({
          conversationId: conversation.id,
          senderId: therapistId,
          senderType: 'therapist',
          senderName: user ? `${user.firstName} ${user.lastName}` : 'Therapist',
          content: initialMessage,
          containsPhi: true,
        });
      }

      // Create audit log
      await storage.createAuditLog({
        userId: therapistId,
        eventType: 'write',
        eventCategory: 'messaging',
        resourceType: 'conversation',
        resourceId: conversation.id.toString(),
        practiceId,
        ipAddress: req.ip || '0.0.0.0',
        details: { patientId, subject },
      });

      res.status(201).json({ conversation, isExisting: false });
    } catch (error) {
      console.error('Error creating conversation:', error);
      res.status(500).json({ message: 'Failed to create conversation' });
    }
  });

  // Send a message in a conversation
  app.post('/api/messages/conversations/:id/messages', isAuthenticated, async (req: any, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const therapistId = req.user?.claims?.sub;
      const { content, attachments } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ message: 'Message content is required' });
      }

      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ message: 'Conversation not found' });
      }

      const user = await storage.getUser(therapistId);

      const message = await storage.createMessage({
        conversationId,
        senderId: therapistId,
        senderType: 'therapist',
        senderName: user ? `${user.firstName} ${user.lastName}` : 'Therapist',
        content: content.trim(),
        attachments: attachments || [],
        containsPhi: true,
      });

      // Create notification for patient (email/SMS would be sent by a background job)
      await storage.createMessageNotification({
        messageId: message.id,
        recipientType: 'patient',
        recipientId: conversation.patientId?.toString(),
        notificationType: 'email',
        status: 'pending',
      });

      res.status(201).json(message);
    } catch (error) {
      console.error('Error sending message:', error);
      res.status(500).json({ message: 'Failed to send message' });
    }
  });

  // Archive a conversation
  app.patch('/api/messages/conversations/:id/archive', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const conversation = await storage.archiveConversation(id);
      res.json(conversation);
    } catch (error) {
      console.error('Error archiving conversation:', error);
      res.status(500).json({ message: 'Failed to archive conversation' });
    }
  });

  // Get unread count for therapist
  app.get('/api/messages/unread-count', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = 1; // TODO: get from user
      const therapistId = req.user?.claims?.sub;
      const count = await storage.getUnreadCount(practiceId, therapistId);
      res.json({ count });
    } catch (error) {
      console.error('Error fetching unread count:', error);
      res.status(500).json({ message: 'Failed to fetch unread count' });
    }
  });

  // Delete a message (soft delete)
  app.delete('/api/messages/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user?.claims?.sub;

      const message = await storage.getMessage(id);
      if (!message) {
        return res.status(404).json({ message: 'Message not found' });
      }

      // Only the sender can delete their own message
      if (message.senderId !== userId) {
        return res.status(403).json({ message: 'You can only delete your own messages' });
      }

      const deleted = await storage.softDeleteMessage(id, userId);
      res.json({ message: 'Message deleted', deleted });
    } catch (error) {
      console.error('Error deleting message:', error);
      res.status(500).json({ message: 'Failed to delete message' });
    }
  });

  // ==================== PUBLIC PATIENT MESSAGING ====================
  // These endpoints allow patients to access their messages via a secure token

  // Get patient's conversations via token
  app.get('/api/public/messages/:token/conversations', async (req, res) => {
    try {
      const { token } = req.params;
      const conversation = await storage.getConversationByToken(token);

      if (!conversation) {
        return res.status(404).json({ message: 'Invalid or expired access link' });
      }

      // Get all conversations for this patient
      const conversations = await storage.getPatientConversations(conversation.patientId);

      res.json(conversations);
    } catch (error) {
      console.error('Error fetching patient conversations:', error);
      res.status(500).json({ message: 'Failed to fetch conversations' });
    }
  });

  // Get a specific conversation with messages (patient view)
  app.get('/api/public/messages/:token/conversations/:id', async (req, res) => {
    try {
      const { token, id } = req.params;
      const tokenConversation = await storage.getConversationByToken(token);

      if (!tokenConversation) {
        return res.status(404).json({ message: 'Invalid or expired access link' });
      }

      const conversationId = parseInt(id);
      const data = await storage.getConversationWithMessages(conversationId);

      if (!data || data.conversation.patientId !== tokenConversation.patientId) {
        return res.status(404).json({ message: 'Conversation not found' });
      }

      // Mark as read by patient
      await storage.markConversationReadByPatient(conversationId);

      res.json(data);
    } catch (error) {
      console.error('Error fetching patient conversation:', error);
      res.status(500).json({ message: 'Failed to fetch conversation' });
    }
  });

  // Patient sends a message
  app.post('/api/public/messages/:token/conversations/:id/messages', async (req, res) => {
    try {
      const { token, id } = req.params;
      const { content } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({ message: 'Message content is required' });
      }

      const tokenConversation = await storage.getConversationByToken(token);
      if (!tokenConversation) {
        return res.status(404).json({ message: 'Invalid or expired access link' });
      }

      const conversationId = parseInt(id);
      const conversation = await storage.getConversation(conversationId);

      if (!conversation || conversation.patientId !== tokenConversation.patientId) {
        return res.status(404).json({ message: 'Conversation not found' });
      }

      // Get patient name
      const patient = await storage.getPatient(conversation.patientId);

      const message = await storage.createMessage({
        conversationId,
        senderId: null, // Patient doesn't have a user ID
        senderType: 'patient',
        senderName: patient ? `${patient.firstName} ${patient.lastName}` : 'Patient',
        content: content.trim(),
        attachments: [],
        containsPhi: true,
      });

      // Create notification for therapist
      if (conversation.therapistId) {
        await storage.createMessageNotification({
          messageId: message.id,
          recipientType: 'therapist',
          recipientId: conversation.therapistId,
          notificationType: 'email',
          status: 'pending',
        });
      }

      res.status(201).json(message);
    } catch (error) {
      console.error('Error sending patient message:', error);
      res.status(500).json({ message: 'Failed to send message' });
    }
  });

  // Get patient's unread count
  app.get('/api/public/messages/:token/unread-count', async (req, res) => {
    try {
      const { token } = req.params;
      const conversation = await storage.getConversationByToken(token);

      if (!conversation) {
        return res.status(404).json({ message: 'Invalid or expired access link' });
      }

      const count = await storage.getPatientUnreadCount(conversation.patientId);
      res.json({ count });
    } catch (error) {
      console.error('Error fetching patient unread count:', error);
      res.status(500).json({ message: 'Failed to fetch unread count' });
    }
  });

  // ==================== PATIENT PORTAL ====================

  // Admin: Create or get portal access for a patient
  app.post('/api/patients/:id/portal-access', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const patient = await storage.getPatient(patientId);
      if (!patient) {
        return res.status(404).json({ message: 'Patient not found' });
      }

      // Check if access already exists
      let access = await storage.getPatientPortalAccess(patientId);
      if (!access) {
        access = await storage.createPatientPortalAccess(patientId, patient.practiceId || 1);
      }

      res.json(access);
    } catch (error) {
      console.error('Error creating portal access:', error);
      res.status(500).json({ message: 'Failed to create portal access' });
    }
  });

  // Admin: Send magic link to patient
  app.post('/api/patients/:id/send-portal-link', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const patient = await storage.getPatient(patientId);
      if (!patient) {
        return res.status(404).json({ message: 'Patient not found' });
      }

      // Ensure portal access exists
      let access = await storage.getPatientPortalAccess(patientId);
      if (!access) {
        access = await storage.createPatientPortalAccess(patientId, patient.practiceId || 1);
      }

      // Create magic link
      const magicLink = await storage.createMagicLink(patientId);
      const portalUrl = `${req.protocol}://${req.get('host')}/portal/login/${magicLink.token}`;

      // Send email with magic link
      if (patient.email) {
        try {
          const nodemailer = await import('nodemailer');
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
              user: process.env.SMTP_USER || '',
              pass: process.env.SMTP_PASS || '',
            },
          });

          const practice = await storage.getPractice(patient.practiceId || 1);
          const practiceName = practice?.name || 'Your Healthcare Provider';

          await transporter.sendMail({
            from: `"${practiceName}" <${process.env.EMAIL_FROM || 'noreply@therapybill.ai'}>`,
            to: patient.email,
            subject: `Access Your Patient Portal - ${practiceName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Hello ${patient.firstName},</h2>
                <p>You've been invited to access your patient portal at ${practiceName}.</p>
                <p>Click the button below to securely access your portal:</p>
                <p style="text-align: center; margin: 30px 0;">
                  <a href="${portalUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                    Access Patient Portal
                  </a>
                </p>
                <p style="color: #666; font-size: 14px;">This link expires in 15 minutes for security purposes.</p>
                <p style="color: #666; font-size: 14px;">If you didn't request this link, please ignore this email.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
                <p style="color: #999; font-size: 12px;">${practiceName}</p>
              </div>
            `,
          });

          res.json({ message: 'Portal access link sent', email: patient.email });
        } catch (emailError) {
          console.error('Error sending portal email:', emailError);
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
      console.error('Error sending portal link:', error);
      res.status(500).json({ message: 'Failed to send portal link' });
    }
  });

  // Admin: Get patient documents
  app.get('/api/patients/:id/documents', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const documents = await storage.getPatientDocuments(patientId);
      res.json(documents);
    } catch (error) {
      console.error('Error fetching documents:', error);
      res.status(500).json({ message: 'Failed to fetch documents' });
    }
  });

  // Admin: Upload document for patient
  app.post('/api/patients/:id/documents', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const { name, description, category, fileUrl, fileType, fileSize, visibleToPatient, requiresSignature } = req.body;

      if (!name || !fileUrl) {
        return res.status(400).json({ message: 'Name and file URL are required' });
      }

      const patient = await storage.getPatient(patientId);
      if (!patient) {
        return res.status(404).json({ message: 'Patient not found' });
      }

      const document = await storage.createPatientDocument({
        patientId,
        practiceId: patient.practiceId || 1,
        uploadedById: req.user?.claims?.sub,
        name,
        description,
        category: category || 'general',
        fileUrl,
        fileType,
        fileSize,
        visibleToPatient: visibleToPatient !== false,
        requiresSignature: requiresSignature || false,
      });

      res.status(201).json(document);
    } catch (error) {
      console.error('Error creating document:', error);
      res.status(500).json({ message: 'Failed to create document' });
    }
  });

  // Admin: Get patient statements
  app.get('/api/patients/:id/statements', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const statements = await storage.getPatientStatements(patientId);
      res.json(statements);
    } catch (error) {
      console.error('Error fetching statements:', error);
      res.status(500).json({ message: 'Failed to fetch statements' });
    }
  });

  // Admin: Create statement for patient
  app.post('/api/patients/:id/statements', isAuthenticated, async (req: any, res) => {
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

      const statement = await storage.createPatientStatement({
        patientId,
        practiceId: patient.practiceId || 1,
        totalAmount,
        balanceDue: totalAmount,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        lineItems: lineItems || [],
      });

      res.status(201).json(statement);
    } catch (error) {
      console.error('Error creating statement:', error);
      res.status(500).json({ message: 'Failed to create statement' });
    }
  });

  // ==================== PUBLIC PATIENT PORTAL ENDPOINTS ====================

  // Login via magic link
  app.get('/api/public/portal/login/:token', async (req, res) => {
    try {
      const { token } = req.params;
      const access = await storage.useMagicLink(token);

      if (!access) {
        return res.status(401).json({ message: 'Invalid or expired login link' });
      }

      // Return the portal token for subsequent requests
      res.json({
        portalToken: access.portalToken,
        expiresAt: access.portalTokenExpiresAt,
      });
    } catch (error) {
      console.error('Error logging in:', error);
      res.status(500).json({ message: 'Login failed' });
    }
  });

  // Get portal dashboard
  app.get('/api/public/portal/:token/dashboard', async (req, res) => {
    try {
      const { token } = req.params;
      const access = await storage.getPatientPortalByToken(token);

      if (!access) {
        return res.status(401).json({ message: 'Invalid or expired session' });
      }

      await storage.updatePortalAccess(access.patientId);
      const dashboard = await storage.getPatientPortalDashboard(access.patientId);

      res.json({
        ...dashboard,
        permissions: {
          canViewAppointments: access.canViewAppointments,
          canViewStatements: access.canViewStatements,
          canViewDocuments: access.canViewDocuments,
          canSendMessages: access.canSendMessages,
          canUpdateProfile: access.canUpdateProfile,
          canCompleteIntake: access.canCompleteIntake,
        },
      });
    } catch (error) {
      console.error('Error fetching dashboard:', error);
      res.status(500).json({ message: 'Failed to fetch dashboard' });
    }
  });

  // Get patient profile
  app.get('/api/public/portal/:token/profile', async (req, res) => {
    try {
      const { token } = req.params;
      const access = await storage.getPatientPortalByToken(token);

      if (!access) {
        return res.status(401).json({ message: 'Invalid or expired session' });
      }

      const patient = await storage.getPatient(access.patientId);
      if (!patient) {
        return res.status(404).json({ message: 'Patient not found' });
      }

      // Return safe patient info (exclude sensitive fields)
      res.json({
        id: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        email: patient.email,
        phone: patient.phone,
        dateOfBirth: patient.dateOfBirth,
        address: patient.address,
      });
    } catch (error) {
      console.error('Error fetching profile:', error);
      res.status(500).json({ message: 'Failed to fetch profile' });
    }
  });

  // Update patient profile
  app.patch('/api/public/portal/:token/profile', async (req, res) => {
    try {
      const { token } = req.params;
      const access = await storage.getPatientPortalByToken(token);

      if (!access) {
        return res.status(401).json({ message: 'Invalid or expired session' });
      }

      if (!access.canUpdateProfile) {
        return res.status(403).json({ message: 'Profile updates not allowed' });
      }

      const { phone, email, address } = req.body;
      const updates: Record<string, unknown> = {};
      if (phone !== undefined) updates.phone = phone;
      if (email !== undefined) updates.email = email;
      if (address !== undefined) updates.address = address;

      const patient = await storage.updatePatient(access.patientId, updates);
      res.json(patient);
    } catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({ message: 'Failed to update profile' });
    }
  });

  // Get appointments
  app.get('/api/public/portal/:token/appointments', async (req, res) => {
    try {
      const { token } = req.params;
      const access = await storage.getPatientPortalByToken(token);

      if (!access) {
        return res.status(401).json({ message: 'Invalid or expired session' });
      }

      if (!access.canViewAppointments) {
        return res.status(403).json({ message: 'Appointment viewing not allowed' });
      }

      const patient = await storage.getPatient(access.patientId);
      if (!patient || !patient.practiceId) {
        return res.status(404).json({ message: 'Patient not found' });
      }

      const allAppointments = await storage.getAppointments(patient.practiceId);
      const patientAppointments = allAppointments.filter((apt: any) => apt.patientId === access.patientId);

      res.json(patientAppointments);
    } catch (error) {
      console.error('Error fetching appointments:', error);
      res.status(500).json({ message: 'Failed to fetch appointments' });
    }
  });

  // Get statements
  app.get('/api/public/portal/:token/statements', async (req, res) => {
    try {
      const { token } = req.params;
      const access = await storage.getPatientPortalByToken(token);

      if (!access) {
        return res.status(401).json({ message: 'Invalid or expired session' });
      }

      if (!access.canViewStatements) {
        return res.status(403).json({ message: 'Statement viewing not allowed' });
      }

      const statements = await storage.getPatientStatements(access.patientId);
      res.json(statements);
    } catch (error) {
      console.error('Error fetching statements:', error);
      res.status(500).json({ message: 'Failed to fetch statements' });
    }
  });

  // View statement (marks as viewed)
  app.get('/api/public/portal/:token/statements/:id', async (req, res) => {
    try {
      const { token, id } = req.params;
      const access = await storage.getPatientPortalByToken(token);

      if (!access) {
        return res.status(401).json({ message: 'Invalid or expired session' });
      }

      const statement = await storage.getPatientStatement(parseInt(id));
      if (!statement || statement.patientId !== access.patientId) {
        return res.status(404).json({ message: 'Statement not found' });
      }

      // Mark as viewed if not already
      if (!statement.viewedAt) {
        await storage.markStatementViewed(statement.id);
      }

      res.json(statement);
    } catch (error) {
      console.error('Error fetching statement:', error);
      res.status(500).json({ message: 'Failed to fetch statement' });
    }
  });

  // Get documents
  app.get('/api/public/portal/:token/documents', async (req, res) => {
    try {
      const { token } = req.params;
      const access = await storage.getPatientPortalByToken(token);

      if (!access) {
        return res.status(401).json({ message: 'Invalid or expired session' });
      }

      if (!access.canViewDocuments) {
        return res.status(403).json({ message: 'Document viewing not allowed' });
      }

      const documents = await storage.getPatientDocuments(access.patientId, true);
      res.json(documents);
    } catch (error) {
      console.error('Error fetching documents:', error);
      res.status(500).json({ message: 'Failed to fetch documents' });
    }
  });

  // View document (marks as viewed)
  app.get('/api/public/portal/:token/documents/:id', async (req, res) => {
    try {
      const { token, id } = req.params;
      const access = await storage.getPatientPortalByToken(token);

      if (!access) {
        return res.status(401).json({ message: 'Invalid or expired session' });
      }

      const document = await storage.getPatientDocument(parseInt(id));
      if (!document || document.patientId !== access.patientId || !document.visibleToPatient) {
        return res.status(404).json({ message: 'Document not found' });
      }

      // Mark as viewed
      await storage.markDocumentViewed(document.id);

      res.json(document);
    } catch (error) {
      console.error('Error fetching document:', error);
      res.status(500).json({ message: 'Failed to fetch document' });
    }
  });

  // Sign document
  app.post('/api/public/portal/:token/documents/:id/sign', async (req, res) => {
    try {
      const { token, id } = req.params;
      const { signatureData } = req.body;

      const access = await storage.getPatientPortalByToken(token);
      if (!access) {
        return res.status(401).json({ message: 'Invalid or expired session' });
      }

      const document = await storage.getPatientDocument(parseInt(id));
      if (!document || document.patientId !== access.patientId) {
        return res.status(404).json({ message: 'Document not found' });
      }

      if (!document.requiresSignature) {
        return res.status(400).json({ message: 'Document does not require signature' });
      }

      if (document.signedAt) {
        return res.status(400).json({ message: 'Document already signed' });
      }

      const signed = await storage.signDocument(document.id, signatureData);
      res.json(signed);
    } catch (error) {
      console.error('Error signing document:', error);
      res.status(500).json({ message: 'Failed to sign document' });
    }
  });

  // ==================== PUBLIC FEEDBACK (No Auth Required) ====================

  // Get feedback form data by token
  app.get('/api/public/feedback/:token', async (req: any, res) => {
    try {
      const { token } = req.params;
      const reviewRequest = await storage.getReviewRequestByToken(token);

      if (!reviewRequest) {
        return res.status(404).json({ message: 'Feedback request not found or expired' });
      }

      // Check if feedback already submitted
      const existingFeedback = await storage.getPatientFeedbackByReviewRequest(reviewRequest.id);
      if (existingFeedback) {
        return res.status(400).json({
          message: 'Feedback already submitted',
          alreadySubmitted: true
        });
      }

      const patient = await storage.getPatient(reviewRequest.patientId);
      const practice = await storage.getPractice(reviewRequest.practiceId);

      // Mark as clicked
      if (reviewRequest.status === 'sent') {
        await storage.updateReviewRequest(reviewRequest.id, {
          status: 'clicked',
          clickedAt: new Date(),
        });
      }

      res.json({
        patientFirstName: patient?.firstName || 'Valued Patient',
        practiceName: practice?.name || 'Our Practice',
        practiceId: reviewRequest.practiceId,
      });
    } catch (error) {
      console.error('Error fetching feedback form:', error);
      res.status(500).json({ message: 'Failed to load feedback form' });
    }
  });

  // Submit feedback (public - no auth) - FULLY AUTOMATED WORKFLOW
  app.post('/api/public/feedback/:token', async (req: any, res) => {
    try {
      const { token } = req.params;
      const { rating, feedbackText, serviceRating, staffRating, facilityRating, wouldRecommend } = req.body;

      const reviewRequest = await storage.getReviewRequestByToken(token);
      if (!reviewRequest) {
        return res.status(404).json({ message: 'Feedback request not found or expired' });
      }

      // Check if feedback already submitted
      const existingFeedback = await storage.getPatientFeedbackByReviewRequest(reviewRequest.id);
      if (existingFeedback) {
        return res.status(400).json({ message: 'Feedback already submitted' });
      }

      // Determine sentiment based on rating
      let sentiment = 'neutral';
      if (rating >= 4) sentiment = 'positive';
      else if (rating <= 2) sentiment = 'negative';

      // Create the feedback
      const feedback = await storage.createPatientFeedback({
        practiceId: reviewRequest.practiceId,
        reviewRequestId: reviewRequest.id,
        patientId: reviewRequest.patientId,
        rating,
        feedbackText,
        serviceRating,
        staffRating,
        facilityRating,
        wouldRecommend,
        sentiment,
      });

      // Update review request status
      await storage.updateReviewRequest(reviewRequest.id, {
        status: 'feedback_received',
        feedbackReceivedAt: new Date(),
      });

      // Get practice and patient for automated responses
      const practice = await storage.getPractice(reviewRequest.practiceId);
      const patient = await storage.getPatient(reviewRequest.patientId);
      const practiceName = practice?.name || 'Our Practice';

      // ============ AUTOMATED WORKFLOW ============
      // Process feedback automatically based on sentiment

      if (sentiment === 'negative' && patient?.email) {
        // NEGATIVE FEEDBACK: AI generates and sends personalized follow-up email
        try {
          const { generateNegativeFeedbackResponse } = await import('./services/reviewResponseService');
          const { isEmailConfigured } = await import('./email');

          if (isEmailConfigured()) {
            const emailContent = await generateNegativeFeedbackResponse({
              patientFirstName: patient.firstName,
              practiceName,
              practicePhone: practice?.phone || undefined,
              practiceEmail: practice?.email || undefined,
              rating,
              feedbackText,
            });

            const nodemailer = await import('nodemailer');
            const transporter = nodemailer.createTransport({
              host: process.env.SMTP_HOST || 'smtp.gmail.com',
              port: parseInt(process.env.SMTP_PORT || '587'),
              secure: process.env.SMTP_SECURE === 'true',
              auth: {
                user: process.env.SMTP_USER || '',
                pass: process.env.SMTP_PASS || '',
              },
            });

            await transporter.sendMail({
              from: `"${practiceName}" <${process.env.EMAIL_FROM || 'noreply@therapybill.ai'}>`,
              to: patient.email,
              subject: emailContent.subject,
              html: emailContent.body,
            });

            // Mark as automatically addressed
            await storage.updatePatientFeedback(feedback.id, {
              isAddressed: true,
              addressedAt: new Date(),
              addressedBy: 'AI_AUTOMATED',
              addressNotes: 'Automated AI-generated follow-up email sent to patient.',
            });

            console.log(`[AUTO] Negative feedback #${feedback.id}: AI follow-up email sent to ${patient.email}`);
          }
        } catch (err) {
          console.error('[AUTO] Failed to send negative feedback response:', err);
        }
      } else if (sentiment === 'positive' && practice?.googleReviewUrl && (patient?.email || patient?.phone)) {
        // POSITIVE FEEDBACK: Automatically request Google review post
        try {
          const { generateGooglePostRequestMessage } = await import('./services/reviewResponseService');
          let googleRequestSent = false;

          // Send via email if available
          if (patient.email) {
            try {
              const { isEmailConfigured } = await import('./email');
              if (isEmailConfigured()) {
                const message = generateGooglePostRequestMessage(
                  patient.firstName,
                  practiceName,
                  practice.googleReviewUrl,
                  'email'
                );

                const nodemailer = await import('nodemailer');
                const transporter = nodemailer.createTransport({
                  host: process.env.SMTP_HOST || 'smtp.gmail.com',
                  port: parseInt(process.env.SMTP_PORT || '587'),
                  secure: process.env.SMTP_SECURE === 'true',
                  auth: {
                    user: process.env.SMTP_USER || '',
                    pass: process.env.SMTP_PASS || '',
                  },
                });

                await transporter.sendMail({
                  from: `"${practiceName}" <${process.env.EMAIL_FROM || 'noreply@therapybill.ai'}>`,
                  to: patient.email,
                  subject: message.subject,
                  html: message.body,
                });

                googleRequestSent = true;
                console.log(`[AUTO] Positive feedback #${feedback.id}: Google post request email sent to ${patient.email}`);
              }
            } catch (err) {
              console.error('[AUTO] Email send failed:', err);
            }
          }

          // Also send via SMS if available
          if (patient.phone) {
            try {
              const { sendSMS, isSMSConfigured } = await import('./services/smsService');
              if (isSMSConfigured()) {
                const message = generateGooglePostRequestMessage(
                  patient.firstName,
                  practiceName,
                  practice.googleReviewUrl,
                  'sms'
                );
                const smsResult = await sendSMS(patient.phone, message.body);
                if (smsResult.success) {
                  googleRequestSent = true;
                  console.log(`[AUTO] Positive feedback #${feedback.id}: Google post request SMS sent to ${patient.phone}`);
                }
              }
            } catch (err) {
              console.error('[AUTO] SMS send failed:', err);
            }
          }

          if (googleRequestSent) {
            await storage.updatePatientFeedback(feedback.id, {
              googlePostRequested: true,
              googlePostRequestedAt: new Date(),
            });

            await storage.updateReviewRequest(reviewRequest.id, {
              status: 'google_requested',
              googleRequestSentAt: new Date(),
            });
          }
        } catch (err) {
          console.error('[AUTO] Failed to send Google post request:', err);
        }
      }
      // ============ END AUTOMATED WORKFLOW ============

      res.status(201).json({
        message: 'Thank you for your feedback!',
        feedbackId: feedback.id,
        sentiment,
        // If positive and practice has Google URL, include it for the thank-you page
        googleReviewUrl: sentiment === 'positive' ? practice?.googleReviewUrl : null,
      });
    } catch (error) {
      console.error('Error submitting feedback:', error);
      res.status(500).json({ message: 'Failed to submit feedback' });
    }
  });

  // ==================== PATIENT FEEDBACK MANAGEMENT (Authenticated) ====================

  // Get all patient feedback for practice
  app.get('/api/feedback', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const filters = {
        sentiment: req.query.sentiment as string | undefined,
        isAddressed: req.query.isAddressed === 'true' ? true : req.query.isAddressed === 'false' ? false : undefined,
        googlePostRequested: req.query.googlePostRequested === 'true' ? true : req.query.googlePostRequested === 'false' ? false : undefined,
      };
      const feedback = await storage.getPatientFeedback(practiceId, filters);

      // Enrich with patient info
      const enrichedFeedback = await Promise.all(feedback.map(async (fb) => {
        const patient = await storage.getPatient(fb.patientId);
        return {
          ...fb,
          patientName: patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown',
          patientEmail: patient?.email,
          patientPhone: patient?.phone,
        };
      }));

      res.json(enrichedFeedback);
    } catch (error) {
      console.error('Error fetching patient feedback:', error);
      res.status(500).json({ message: 'Failed to fetch patient feedback' });
    }
  });

  // Get feedback stats
  app.get('/api/feedback/stats', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const stats = await storage.getPatientFeedbackStats(practiceId);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching feedback stats:', error);
      res.status(500).json({ message: 'Failed to fetch feedback stats' });
    }
  });

  // Get single feedback
  app.get('/api/feedback/:id', isAuthenticated, async (req: any, res) => {
    try {
      const feedback = await storage.getPatientFeedbackById(parseInt(req.params.id));
      if (!feedback) {
        return res.status(404).json({ message: 'Feedback not found' });
      }

      const patient = await storage.getPatient(feedback.patientId);
      res.json({
        ...feedback,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown',
        patientEmail: patient?.email,
        patientPhone: patient?.phone,
      });
    } catch (error) {
      console.error('Error fetching feedback:', error);
      res.status(500).json({ message: 'Failed to fetch feedback' });
    }
  });

  // Update feedback (mark as addressed, add notes)
  app.patch('/api/feedback/:id', isAuthenticated, async (req: any, res) => {
    try {
      const feedback = await storage.updatePatientFeedback(parseInt(req.params.id), req.body);
      res.json(feedback);
    } catch (error) {
      console.error('Error updating feedback:', error);
      res.status(500).json({ message: 'Failed to update feedback' });
    }
  });

  // Mark feedback as addressed
  app.post('/api/feedback/:id/address', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const { addressNotes } = req.body;

      const feedback = await storage.updatePatientFeedback(parseInt(req.params.id), {
        isAddressed: true,
        addressedAt: new Date(),
        addressedBy: userId,
        addressNotes,
      });
      res.json(feedback);
    } catch (error) {
      console.error('Error addressing feedback:', error);
      res.status(500).json({ message: 'Failed to address feedback' });
    }
  });

  // Request Google post for positive feedback
  app.post('/api/feedback/:id/request-google-post', isAuthenticated, async (req: any, res) => {
    try {
      const feedbackId = parseInt(req.params.id);
      const { sendVia } = req.body;

      const feedback = await storage.getPatientFeedbackById(feedbackId);
      if (!feedback) {
        return res.status(404).json({ message: 'Feedback not found' });
      }

      if (feedback.sentiment !== 'positive') {
        return res.status(400).json({ message: 'Can only request Google post for positive feedback' });
      }

      const patient = await storage.getPatient(feedback.patientId);
      if (!patient) {
        return res.status(404).json({ message: 'Patient not found' });
      }

      const practice = await storage.getPractice(feedback.practiceId);
      if (!practice?.googleReviewUrl) {
        return res.status(400).json({ message: 'Practice does not have a Google Review URL configured' });
      }

      const practiceName = practice.name || 'Your Practice';
      const { generateGooglePostRequestMessage } = await import('./services/reviewResponseService');
      const results: { emailSent?: boolean; smsSent?: boolean; errors: string[] } = { errors: [] };

      // Send email
      if ((sendVia === 'email' || sendVia === 'both') && patient.email) {
        try {
          const { isEmailConfigured } = await import('./email');
          if (isEmailConfigured()) {
            const message = generateGooglePostRequestMessage(patient.firstName, practiceName, practice.googleReviewUrl, 'email');
            const nodemailer = await import('nodemailer');
            const transporter = nodemailer.createTransport({
              host: process.env.SMTP_HOST || 'smtp.gmail.com',
              port: parseInt(process.env.SMTP_PORT || '587'),
              secure: process.env.SMTP_SECURE === 'true',
              auth: {
                user: process.env.SMTP_USER || '',
                pass: process.env.SMTP_PASS || '',
              },
            });

            await transporter.sendMail({
              from: `"${practiceName}" <${process.env.EMAIL_FROM || 'noreply@therapybill.ai'}>`,
              to: patient.email,
              subject: message.subject,
              html: message.body,
            });
            results.emailSent = true;
          }
        } catch (err) {
          results.errors.push(`Email failed: ${(err as Error).message}`);
        }
      }

      // Send SMS
      if ((sendVia === 'sms' || sendVia === 'both') && patient.phone) {
        try {
          const { sendSMS, isSMSConfigured } = await import('./services/smsService');
          if (isSMSConfigured()) {
            const message = generateGooglePostRequestMessage(patient.firstName, practiceName, practice.googleReviewUrl, 'sms');
            const smsResult = await sendSMS(patient.phone, message.body);
            results.smsSent = smsResult.success;
            if (!smsResult.success) {
              results.errors.push(`SMS failed: ${smsResult.error}`);
            }
          }
        } catch (err) {
          results.errors.push(`SMS error: ${(err as Error).message}`);
        }
      }

      // Update feedback
      if (results.emailSent || results.smsSent) {
        await storage.updatePatientFeedback(feedbackId, {
          googlePostRequested: true,
          googlePostRequestedAt: new Date(),
        });

        // Also update the review request
        const reviewRequest = await storage.getReviewRequest(feedback.reviewRequestId);
        if (reviewRequest) {
          await storage.updateReviewRequest(reviewRequest.id, {
            status: 'google_requested',
            googleRequestSentAt: new Date(),
          });
        }
      }

      res.json({
        message: 'Google post request sent',
        ...results,
      });
    } catch (error) {
      console.error('Error requesting Google post:', error);
      res.status(500).json({ message: 'Failed to request Google post' });
    }
  });

  // Mark feedback as posted to Google
  app.post('/api/feedback/:id/mark-posted', isAuthenticated, async (req: any, res) => {
    try {
      const feedback = await storage.updatePatientFeedback(parseInt(req.params.id), {
        postedToGoogle: true,
        postedToGoogleAt: new Date(),
      });

      // Update review request status
      const reviewRequest = await storage.getReviewRequest(feedback.reviewRequestId);
      if (reviewRequest) {
        await storage.updateReviewRequest(reviewRequest.id, {
          status: 'reviewed',
          reviewedAt: new Date(),
        });
      }

      res.json(feedback);
    } catch (error) {
      console.error('Error marking as posted:', error);
      res.status(500).json({ message: 'Failed to mark as posted' });
    }
  });

  // ==================== TREATMENT PLANS ====================

  // Get treatment plans for practice
  app.get('/api/treatment-plans', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const filters = {
        patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
        therapistId: req.query.therapistId as string | undefined,
        status: req.query.status as string | undefined,
      };
      const plans = await storage.getTreatmentPlans(practiceId, filters);
      res.json(plans);
    } catch (error) {
      console.error('Error fetching treatment plans:', error);
      res.status(500).json({ message: 'Failed to fetch treatment plans' });
    }
  });

  // Get treatment plan stats
  app.get('/api/treatment-plans/stats', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const stats = await storage.getTreatmentPlanStats(practiceId);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching treatment plan stats:', error);
      res.status(500).json({ message: 'Failed to fetch treatment plan stats' });
    }
  });

  // Get plans needing review
  app.get('/api/treatment-plans/needs-review', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const daysAhead = parseInt(req.query.daysAhead as string) || 7;
      const plans = await storage.getPlansNeedingReview(practiceId, daysAhead);
      res.json(plans);
    } catch (error) {
      console.error('Error fetching plans needing review:', error);
      res.status(500).json({ message: 'Failed to fetch plans needing review' });
    }
  });

  // Get single treatment plan with all details
  app.get('/api/treatment-plans/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const planDetails = await storage.getTreatmentPlanWithDetails(id);
      if (!planDetails) {
        return res.status(404).json({ message: 'Treatment plan not found' });
      }
      res.json(planDetails);
    } catch (error) {
      console.error('Error fetching treatment plan:', error);
      res.status(500).json({ message: 'Failed to fetch treatment plan' });
    }
  });

  // Create treatment plan
  app.post('/api/treatment-plans', isAuthenticated, async (req: any, res) => {
    try {
      const plan = await storage.createTreatmentPlan(req.body);
      res.status(201).json(plan);
    } catch (error) {
      console.error('Error creating treatment plan:', error);
      res.status(500).json({ message: 'Failed to create treatment plan' });
    }
  });

  // Update treatment plan
  app.patch('/api/treatment-plans/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const plan = await storage.updateTreatmentPlan(id, req.body);
      if (!plan) {
        return res.status(404).json({ message: 'Treatment plan not found' });
      }
      res.json(plan);
    } catch (error) {
      console.error('Error updating treatment plan:', error);
      res.status(500).json({ message: 'Failed to update treatment plan' });
    }
  });

  // Sign treatment plan (patient)
  app.post('/api/treatment-plans/:id/patient-sign', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const { signature } = req.body;
      const plan = await storage.updateTreatmentPlan(id, {
        patientSignature: signature,
        patientSignedAt: new Date(),
      });
      if (!plan) {
        return res.status(404).json({ message: 'Treatment plan not found' });
      }
      res.json(plan);
    } catch (error) {
      console.error('Error signing treatment plan:', error);
      res.status(500).json({ message: 'Failed to sign treatment plan' });
    }
  });

  // Sign treatment plan (therapist)
  app.post('/api/treatment-plans/:id/therapist-sign', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const { signature } = req.body;
      const plan = await storage.updateTreatmentPlan(id, {
        therapistSignature: signature,
        therapistSignedAt: new Date(),
      });
      if (!plan) {
        return res.status(404).json({ message: 'Treatment plan not found' });
      }
      res.json(plan);
    } catch (error) {
      console.error('Error signing treatment plan:', error);
      res.status(500).json({ message: 'Failed to sign treatment plan' });
    }
  });

  // Get patient's treatment plans
  app.get('/api/patients/:id/treatment-plans', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const plans = await storage.getPatientTreatmentPlans(patientId);
      res.json(plans);
    } catch (error) {
      console.error('Error fetching patient treatment plans:', error);
      res.status(500).json({ message: 'Failed to fetch patient treatment plans' });
    }
  });

  // Get patient's active treatment plan
  app.get('/api/patients/:id/active-treatment-plan', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const plan = await storage.getActiveTreatmentPlan(patientId);
      if (!plan) {
        return res.json(null);
      }
      const planDetails = await storage.getTreatmentPlanWithDetails(plan.id);
      res.json(planDetails);
    } catch (error) {
      console.error('Error fetching active treatment plan:', error);
      res.status(500).json({ message: 'Failed to fetch active treatment plan' });
    }
  });

  // ==================== TREATMENT GOALS ====================

  // Get goals for a treatment plan
  app.get('/api/treatment-plans/:planId/goals', isAuthenticated, async (req: any, res) => {
    try {
      const planId = parseInt(req.params.planId);
      const goals = await storage.getTreatmentGoals(planId);
      res.json(goals);
    } catch (error) {
      console.error('Error fetching treatment goals:', error);
      res.status(500).json({ message: 'Failed to fetch treatment goals' });
    }
  });

  // Create treatment goal
  app.post('/api/treatment-plans/:planId/goals', isAuthenticated, async (req: any, res) => {
    try {
      const planId = parseInt(req.params.planId);
      const goal = await storage.createTreatmentGoal({
        ...req.body,
        treatmentPlanId: planId,
      });
      res.status(201).json(goal);
    } catch (error) {
      console.error('Error creating treatment goal:', error);
      res.status(500).json({ message: 'Failed to create treatment goal' });
    }
  });

  // Get single goal
  app.get('/api/goals/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const goal = await storage.getTreatmentGoal(id);
      if (!goal) {
        return res.status(404).json({ message: 'Goal not found' });
      }
      const objectives = await storage.getTreatmentObjectives(id);
      const progressNotes = await storage.getGoalProgressNotes(id);
      res.json({ ...goal, objectives, progressNotes });
    } catch (error) {
      console.error('Error fetching goal:', error);
      res.status(500).json({ message: 'Failed to fetch goal' });
    }
  });

  // Update goal
  app.patch('/api/goals/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = { ...req.body };

      // If marking as achieved, set achievedAt
      if (updates.status === 'achieved' && !updates.achievedAt) {
        updates.achievedAt = new Date();
      }

      const goal = await storage.updateTreatmentGoal(id, updates);
      if (!goal) {
        return res.status(404).json({ message: 'Goal not found' });
      }
      res.json(goal);
    } catch (error) {
      console.error('Error updating goal:', error);
      res.status(500).json({ message: 'Failed to update goal' });
    }
  });

  // Delete goal
  app.delete('/api/goals/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTreatmentGoal(id);
      res.json({ message: 'Goal deleted' });
    } catch (error) {
      console.error('Error deleting goal:', error);
      res.status(500).json({ message: 'Failed to delete goal' });
    }
  });

  // ==================== TREATMENT OBJECTIVES ====================

  // Get objectives for a goal
  app.get('/api/goals/:goalId/objectives', isAuthenticated, async (req: any, res) => {
    try {
      const goalId = parseInt(req.params.goalId);
      const objectives = await storage.getTreatmentObjectives(goalId);
      res.json(objectives);
    } catch (error) {
      console.error('Error fetching objectives:', error);
      res.status(500).json({ message: 'Failed to fetch objectives' });
    }
  });

  // Create objective
  app.post('/api/goals/:goalId/objectives', isAuthenticated, async (req: any, res) => {
    try {
      const goalId = parseInt(req.params.goalId);
      const goal = await storage.getTreatmentGoal(goalId);
      if (!goal) {
        return res.status(404).json({ message: 'Goal not found' });
      }
      const objective = await storage.createTreatmentObjective({
        ...req.body,
        goalId,
        treatmentPlanId: goal.treatmentPlanId,
      });
      res.status(201).json(objective);
    } catch (error) {
      console.error('Error creating objective:', error);
      res.status(500).json({ message: 'Failed to create objective' });
    }
  });

  // Update objective
  app.patch('/api/objectives/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = { ...req.body };

      // If marking as achieved, set achievedAt
      if (updates.status === 'achieved' && !updates.achievedAt) {
        updates.achievedAt = new Date();
      }

      const objective = await storage.updateTreatmentObjective(id, updates);
      if (!objective) {
        return res.status(404).json({ message: 'Objective not found' });
      }
      res.json(objective);
    } catch (error) {
      console.error('Error updating objective:', error);
      res.status(500).json({ message: 'Failed to update objective' });
    }
  });

  // Delete objective
  app.delete('/api/objectives/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTreatmentObjective(id);
      res.json({ message: 'Objective deleted' });
    } catch (error) {
      console.error('Error deleting objective:', error);
      res.status(500).json({ message: 'Failed to delete objective' });
    }
  });

  // ==================== TREATMENT INTERVENTIONS ====================

  // Get interventions for a plan
  app.get('/api/treatment-plans/:planId/interventions', isAuthenticated, async (req: any, res) => {
    try {
      const planId = parseInt(req.params.planId);
      const interventions = await storage.getTreatmentInterventions(planId);
      res.json(interventions);
    } catch (error) {
      console.error('Error fetching interventions:', error);
      res.status(500).json({ message: 'Failed to fetch interventions' });
    }
  });

  // Create intervention
  app.post('/api/treatment-plans/:planId/interventions', isAuthenticated, async (req: any, res) => {
    try {
      const planId = parseInt(req.params.planId);
      const intervention = await storage.createTreatmentIntervention({
        ...req.body,
        treatmentPlanId: planId,
      });
      res.status(201).json(intervention);
    } catch (error) {
      console.error('Error creating intervention:', error);
      res.status(500).json({ message: 'Failed to create intervention' });
    }
  });

  // Update intervention
  app.patch('/api/interventions/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const intervention = await storage.updateTreatmentIntervention(id, req.body);
      if (!intervention) {
        return res.status(404).json({ message: 'Intervention not found' });
      }
      res.json(intervention);
    } catch (error) {
      console.error('Error updating intervention:', error);
      res.status(500).json({ message: 'Failed to update intervention' });
    }
  });

  // Delete intervention
  app.delete('/api/interventions/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteTreatmentIntervention(id);
      res.json({ message: 'Intervention deleted' });
    } catch (error) {
      console.error('Error deleting intervention:', error);
      res.status(500).json({ message: 'Failed to delete intervention' });
    }
  });

  // ==================== GOAL PROGRESS NOTES ====================

  // Get progress notes for a goal
  app.get('/api/goals/:goalId/progress', isAuthenticated, async (req: any, res) => {
    try {
      const goalId = parseInt(req.params.goalId);
      const notes = await storage.getGoalProgressNotes(goalId);
      res.json(notes);
    } catch (error) {
      console.error('Error fetching progress notes:', error);
      res.status(500).json({ message: 'Failed to fetch progress notes' });
    }
  });

  // Create progress note
  app.post('/api/goals/:goalId/progress', isAuthenticated, async (req: any, res) => {
    try {
      const goalId = parseInt(req.params.goalId);
      const therapistId = req.user?.id;
      const note = await storage.createGoalProgressNote({
        ...req.body,
        goalId,
        therapistId,
      });
      res.status(201).json(note);
    } catch (error) {
      console.error('Error creating progress note:', error);
      res.status(500).json({ message: 'Failed to create progress note' });
    }
  });

  // Get progress notes for a session
  app.get('/api/sessions/:sessionId/progress-notes', isAuthenticated, async (req: any, res) => {
    try {
      const sessionId = parseInt(req.params.sessionId);
      const notes = await storage.getSessionProgressNotes(sessionId);
      res.json(notes);
    } catch (error) {
      console.error('Error fetching session progress notes:', error);
      res.status(500).json({ message: 'Failed to fetch session progress notes' });
    }
  });

  // ==================== OUTCOME MEASURE TEMPLATES ====================

  // Get all outcome measure templates
  app.get('/api/outcome-measures/templates', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
      const templates = await storage.getOutcomeMeasureTemplates(practiceId);
      res.json(templates);
    } catch (error) {
      console.error('Error fetching outcome measure templates:', error);
      res.status(500).json({ message: 'Failed to fetch outcome measure templates' });
    }
  });

  // Get templates by category
  app.get('/api/outcome-measures/templates/category/:category', isAuthenticated, async (req: any, res) => {
    try {
      const category = req.params.category;
      const practiceId = req.query.practiceId ? parseInt(req.query.practiceId as string) : undefined;
      const templates = await storage.getTemplatesByCategory(category, practiceId);
      res.json(templates);
    } catch (error) {
      console.error('Error fetching templates by category:', error);
      res.status(500).json({ message: 'Failed to fetch templates' });
    }
  });

  // Get single template
  app.get('/api/outcome-measures/templates/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const template = await storage.getOutcomeMeasureTemplate(id);
      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }
      res.json(template);
    } catch (error) {
      console.error('Error fetching outcome measure template:', error);
      res.status(500).json({ message: 'Failed to fetch template' });
    }
  });

  // Create custom template
  app.post('/api/outcome-measures/templates', isAuthenticated, async (req: any, res) => {
    try {
      const template = await storage.createOutcomeMeasureTemplate(req.body);
      res.status(201).json(template);
    } catch (error) {
      console.error('Error creating outcome measure template:', error);
      res.status(500).json({ message: 'Failed to create template' });
    }
  });

  // Update template
  app.patch('/api/outcome-measures/templates/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const template = await storage.updateOutcomeMeasureTemplate(id, req.body);
      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }
      res.json(template);
    } catch (error) {
      console.error('Error updating outcome measure template:', error);
      res.status(500).json({ message: 'Failed to update template' });
    }
  });

  // ==================== PATIENT ASSESSMENTS ====================

  // Get practice assessments with filters
  app.get('/api/outcome-measures/assessments', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const filters = {
        templateId: req.query.templateId ? parseInt(req.query.templateId as string) : undefined,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        assessmentType: req.query.assessmentType as string | undefined,
      };
      const assessments = await storage.getPracticeAssessments(practiceId, filters);
      res.json(assessments);
    } catch (error) {
      console.error('Error fetching assessments:', error);
      res.status(500).json({ message: 'Failed to fetch assessments' });
    }
  });

  // Get outcome measure stats
  app.get('/api/outcome-measures/stats', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const templateId = req.query.templateId ? parseInt(req.query.templateId as string) : undefined;
      const stats = await storage.getOutcomeMeasureStats(practiceId, templateId);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching outcome measure stats:', error);
      res.status(500).json({ message: 'Failed to fetch stats' });
    }
  });

  // Get single assessment
  app.get('/api/outcome-measures/assessments/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const assessment = await storage.getPatientAssessment(id);
      if (!assessment) {
        return res.status(404).json({ message: 'Assessment not found' });
      }

      // Get the template for context
      const template = await storage.getOutcomeMeasureTemplate(assessment.templateId);

      res.json({ assessment, template });
    } catch (error) {
      console.error('Error fetching assessment:', error);
      res.status(500).json({ message: 'Failed to fetch assessment' });
    }
  });

  // Create/submit assessment
  app.post('/api/outcome-measures/assessments', isAuthenticated, async (req: any, res) => {
    try {
      const { templateId, patientId, responses, ...rest } = req.body;

      // Get template for scoring
      const template = await storage.getOutcomeMeasureTemplate(templateId);
      if (!template) {
        return res.status(404).json({ message: 'Template not found' });
      }

      // Calculate total score
      let totalScore = 0;
      if (template.scoringMethod === 'sum') {
        totalScore = responses.reduce((sum: number, r: any) => sum + (r.value || 0), 0);
      } else if (template.scoringMethod === 'average') {
        totalScore = Math.round(
          responses.reduce((sum: number, r: any) => sum + (r.value || 0), 0) / responses.length
        );
      }

      // Determine severity based on scoring ranges
      let severity = 'unknown';
      let interpretation = '';
      if (template.scoringRanges && Array.isArray(template.scoringRanges)) {
        for (const range of template.scoringRanges as any[]) {
          if (totalScore >= range.min && totalScore <= range.max) {
            severity = range.severity;
            interpretation = range.interpretation || '';
            break;
          }
        }
      }

      const assessment = await storage.createPatientAssessment({
        templateId,
        patientId,
        responses,
        totalScore,
        severity,
        interpretation,
        status: 'completed',
        completedAt: new Date(),
        ...rest,
      });

      res.status(201).json(assessment);
    } catch (error) {
      console.error('Error creating assessment:', error);
      res.status(500).json({ message: 'Failed to create assessment' });
    }
  });

  // Update assessment
  app.patch('/api/outcome-measures/assessments/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const assessment = await storage.updatePatientAssessment(id, req.body);
      if (!assessment) {
        return res.status(404).json({ message: 'Assessment not found' });
      }
      res.json(assessment);
    } catch (error) {
      console.error('Error updating assessment:', error);
      res.status(500).json({ message: 'Failed to update assessment' });
    }
  });

  // Get patient's assessments
  app.get('/api/patients/:id/assessments', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const templateId = req.query.templateId ? parseInt(req.query.templateId as string) : undefined;
      const assessments = await storage.getPatientAssessments(patientId, templateId);
      res.json(assessments);
    } catch (error) {
      console.error('Error fetching patient assessments:', error);
      res.status(500).json({ message: 'Failed to fetch assessments' });
    }
  });

  // Get patient's assessment history with trend analysis
  app.get('/api/patients/:id/assessments/:templateId/history', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const templateId = parseInt(req.params.templateId);
      const history = await storage.getPatientAssessmentHistory(patientId, templateId);
      res.json(history);
    } catch (error) {
      console.error('Error fetching assessment history:', error);
      res.status(500).json({ message: 'Failed to fetch assessment history' });
    }
  });

  // Get patient's latest assessment for a template
  app.get('/api/patients/:id/assessments/:templateId/latest', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const templateId = parseInt(req.params.templateId);
      const assessment = await storage.getLatestPatientAssessment(patientId, templateId);
      res.json(assessment || null);
    } catch (error) {
      console.error('Error fetching latest assessment:', error);
      res.status(500).json({ message: 'Failed to fetch latest assessment' });
    }
  });

  // ==================== ASSESSMENT SCHEDULES ====================

  // Get patient's assessment schedules
  app.get('/api/patients/:id/assessment-schedules', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const schedules = await storage.getPatientAssessmentSchedules(patientId);
      res.json(schedules);
    } catch (error) {
      console.error('Error fetching assessment schedules:', error);
      res.status(500).json({ message: 'Failed to fetch assessment schedules' });
    }
  });

  // Create assessment schedule
  app.post('/api/assessment-schedules', isAuthenticated, async (req: any, res) => {
    try {
      // Calculate next due date based on frequency
      const { frequency, dayOfWeek, dayOfMonth, ...rest } = req.body;
      const now = new Date();
      let nextDueAt = new Date();

      if (frequency === 'weekly' && dayOfWeek !== undefined) {
        const daysUntilNext = (dayOfWeek - now.getDay() + 7) % 7 || 7;
        nextDueAt.setDate(now.getDate() + daysUntilNext);
      } else if (frequency === 'bi-weekly' && dayOfWeek !== undefined) {
        const daysUntilNext = (dayOfWeek - now.getDay() + 7) % 7 || 7;
        nextDueAt.setDate(now.getDate() + daysUntilNext + 7);
      } else if (frequency === 'monthly' && dayOfMonth !== undefined) {
        nextDueAt.setMonth(now.getMonth() + 1);
        nextDueAt.setDate(Math.min(dayOfMonth, new Date(nextDueAt.getFullYear(), nextDueAt.getMonth() + 1, 0).getDate()));
      } else {
        nextDueAt.setDate(now.getDate() + 7); // Default to 1 week
      }

      const schedule = await storage.createAssessmentSchedule({
        frequency,
        dayOfWeek,
        dayOfMonth,
        nextDueAt,
        ...rest,
      });
      res.status(201).json(schedule);
    } catch (error) {
      console.error('Error creating assessment schedule:', error);
      res.status(500).json({ message: 'Failed to create assessment schedule' });
    }
  });

  // Update assessment schedule
  app.patch('/api/assessment-schedules/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const schedule = await storage.updateAssessmentSchedule(id, req.body);
      if (!schedule) {
        return res.status(404).json({ message: 'Schedule not found' });
      }
      res.json(schedule);
    } catch (error) {
      console.error('Error updating assessment schedule:', error);
      res.status(500).json({ message: 'Failed to update assessment schedule' });
    }
  });

  // Delete assessment schedule
  app.delete('/api/assessment-schedules/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteAssessmentSchedule(id);
      res.json({ message: 'Schedule deleted' });
    } catch (error) {
      console.error('Error deleting assessment schedule:', error);
      res.status(500).json({ message: 'Failed to delete assessment schedule' });
    }
  });

  // Get due assessments for practice
  app.get('/api/assessment-schedules/due', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const dueSchedules = await storage.getDueAssessments(practiceId);
      res.json(dueSchedules);
    } catch (error) {
      console.error('Error fetching due assessments:', error);
      res.status(500).json({ message: 'Failed to fetch due assessments' });
    }
  });

  // ==================== REFERRAL SOURCES ====================

  // Get referral sources
  app.get('/api/referral-sources', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const filters = {
        type: req.query.type as string | undefined,
        isActive: req.query.isActive === 'true' ? true : req.query.isActive === 'false' ? false : undefined,
      };
      const sources = await storage.getReferralSources(practiceId, filters);
      res.json(sources);
    } catch (error) {
      console.error('Error fetching referral sources:', error);
      res.status(500).json({ message: 'Failed to fetch referral sources' });
    }
  });

  // Get single referral source
  app.get('/api/referral-sources/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const source = await storage.getReferralSource(id);
      if (!source) {
        return res.status(404).json({ message: 'Referral source not found' });
      }
      res.json(source);
    } catch (error) {
      console.error('Error fetching referral source:', error);
      res.status(500).json({ message: 'Failed to fetch referral source' });
    }
  });

  // Create referral source
  app.post('/api/referral-sources', isAuthenticated, async (req: any, res) => {
    try {
      const source = await storage.createReferralSource(req.body);
      res.status(201).json(source);
    } catch (error) {
      console.error('Error creating referral source:', error);
      res.status(500).json({ message: 'Failed to create referral source' });
    }
  });

  // Update referral source
  app.patch('/api/referral-sources/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const source = await storage.updateReferralSource(id, req.body);
      if (!source) {
        return res.status(404).json({ message: 'Referral source not found' });
      }
      res.json(source);
    } catch (error) {
      console.error('Error updating referral source:', error);
      res.status(500).json({ message: 'Failed to update referral source' });
    }
  });

  // Delete referral source (soft delete)
  app.delete('/api/referral-sources/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteReferralSource(id);
      res.json({ message: 'Referral source deleted' });
    } catch (error) {
      console.error('Error deleting referral source:', error);
      res.status(500).json({ message: 'Failed to delete referral source' });
    }
  });

  // ==================== REFERRALS ====================

  // Get referrals with filters
  app.get('/api/referrals', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const filters = {
        direction: req.query.direction as string | undefined,
        status: req.query.status as string | undefined,
        patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
        referralSourceId: req.query.referralSourceId ? parseInt(req.query.referralSourceId as string) : undefined,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      };
      const referralsList = await storage.getReferrals(practiceId, filters);
      res.json(referralsList);
    } catch (error) {
      console.error('Error fetching referrals:', error);
      res.status(500).json({ message: 'Failed to fetch referrals' });
    }
  });

  // Get referral stats
  app.get('/api/referrals/stats', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const stats = await storage.getReferralStats(practiceId, startDate, endDate);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching referral stats:', error);
      res.status(500).json({ message: 'Failed to fetch referral stats' });
    }
  });

  // Get pending referrals
  app.get('/api/referrals/pending', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const pending = await storage.getPendingReferrals(practiceId);
      res.json(pending);
    } catch (error) {
      console.error('Error fetching pending referrals:', error);
      res.status(500).json({ message: 'Failed to fetch pending referrals' });
    }
  });

  // Get referrals needing follow-up
  app.get('/api/referrals/needs-followup', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const needsFollowUp = await storage.getReferralsNeedingFollowUp(practiceId);
      res.json(needsFollowUp);
    } catch (error) {
      console.error('Error fetching referrals needing follow-up:', error);
      res.status(500).json({ message: 'Failed to fetch referrals needing follow-up' });
    }
  });

  // Get single referral with details
  app.get('/api/referrals/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const referralDetails = await storage.getReferralWithDetails(id);
      if (!referralDetails) {
        return res.status(404).json({ message: 'Referral not found' });
      }
      res.json(referralDetails);
    } catch (error) {
      console.error('Error fetching referral:', error);
      res.status(500).json({ message: 'Failed to fetch referral' });
    }
  });

  // Create referral
  app.post('/api/referrals', isAuthenticated, async (req: any, res) => {
    try {
      const referral = await storage.createReferral(req.body);
      res.status(201).json(referral);
    } catch (error) {
      console.error('Error creating referral:', error);
      res.status(500).json({ message: 'Failed to create referral' });
    }
  });

  // Update referral
  app.patch('/api/referrals/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const referral = await storage.updateReferral(id, req.body);
      if (!referral) {
        return res.status(404).json({ message: 'Referral not found' });
      }
      res.json(referral);
    } catch (error) {
      console.error('Error updating referral:', error);
      res.status(500).json({ message: 'Failed to update referral' });
    }
  });

  // Update referral status
  app.post('/api/referrals/:id/status', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      const userId = req.user?.id || 'system';
      const referral = await storage.updateReferralStatus(id, status, userId);
      if (!referral) {
        return res.status(404).json({ message: 'Referral not found' });
      }
      res.json(referral);
    } catch (error) {
      console.error('Error updating referral status:', error);
      res.status(500).json({ message: 'Failed to update referral status' });
    }
  });

  // Get patient's referrals
  app.get('/api/patients/:id/referrals', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const patientReferrals = await storage.getPatientReferrals(patientId);
      res.json(patientReferrals);
    } catch (error) {
      console.error('Error fetching patient referrals:', error);
      res.status(500).json({ message: 'Failed to fetch patient referrals' });
    }
  });

  // ==================== REFERRAL COMMUNICATIONS ====================

  // Get communications for a referral
  app.get('/api/referrals/:id/communications', isAuthenticated, async (req: any, res) => {
    try {
      const referralId = parseInt(req.params.id);
      const communications = await storage.getReferralCommunications(referralId);
      res.json(communications);
    } catch (error) {
      console.error('Error fetching referral communications:', error);
      res.status(500).json({ message: 'Failed to fetch referral communications' });
    }
  });

  // Create communication for a referral
  app.post('/api/referrals/:id/communications', isAuthenticated, async (req: any, res) => {
    try {
      const referralId = parseInt(req.params.id);
      const userId = req.user?.id;
      const communication = await storage.createReferralCommunication({
        ...req.body,
        referralId,
        sentBy: userId,
      });
      res.status(201).json(communication);
    } catch (error) {
      console.error('Error creating referral communication:', error);
      res.status(500).json({ message: 'Failed to create referral communication' });
    }
  });

  // ==================== PAYMENT PROCESSING ====================

  // Get practice payment settings
  app.get('/api/payment-settings', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const settings = await storage.getPracticePaymentSettings(practiceId);
      res.json(settings || {
        practiceId,
        acceptsCreditCards: false,
        acceptsAch: false,
        autoChargeOnFile: false,
        paymentDueDays: 30,
      });
    } catch (error) {
      console.error('Error fetching payment settings:', error);
      res.status(500).json({ message: 'Failed to fetch payment settings' });
    }
  });

  // Update practice payment settings
  app.put('/api/payment-settings', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const settings = await storage.upsertPracticePaymentSettings(req.body);
      res.json(settings);
    } catch (error) {
      console.error('Error updating payment settings:', error);
      res.status(500).json({ message: 'Failed to update payment settings' });
    }
  });

  // ==================== PATIENT PAYMENT METHODS ====================

  // Get patient's payment methods
  app.get('/api/patients/:id/payment-methods', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const methods = await storage.getPatientPaymentMethods(patientId);
      res.json(methods);
    } catch (error) {
      console.error('Error fetching payment methods:', error);
      res.status(500).json({ message: 'Failed to fetch payment methods' });
    }
  });

  // Get patient's default payment method
  app.get('/api/patients/:id/payment-methods/default', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const method = await storage.getDefaultPaymentMethod(patientId);
      res.json(method || null);
    } catch (error) {
      console.error('Error fetching default payment method:', error);
      res.status(500).json({ message: 'Failed to fetch default payment method' });
    }
  });

  // Add payment method
  app.post('/api/patients/:id/payment-methods', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const method = await storage.createPatientPaymentMethod({
        ...req.body,
        patientId,
      });
      res.status(201).json(method);
    } catch (error) {
      console.error('Error creating payment method:', error);
      res.status(500).json({ message: 'Failed to create payment method' });
    }
  });

  // Update payment method
  app.patch('/api/payment-methods/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const method = await storage.updatePatientPaymentMethod(id, req.body);
      if (!method) {
        return res.status(404).json({ message: 'Payment method not found' });
      }
      res.json(method);
    } catch (error) {
      console.error('Error updating payment method:', error);
      res.status(500).json({ message: 'Failed to update payment method' });
    }
  });

  // Set default payment method
  app.post('/api/payment-methods/:id/set-default', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      // Get method first to get patientId
      const existingMethod = await storage.getPatientPaymentMethod(id);
      if (!existingMethod) {
        return res.status(404).json({ message: 'Payment method not found' });
      }
      const method = await storage.setDefaultPaymentMethod(id, existingMethod.patientId);
      res.json(method);
    } catch (error) {
      console.error('Error setting default payment method:', error);
      res.status(500).json({ message: 'Failed to set default payment method' });
    }
  });

  // Delete payment method
  app.delete('/api/payment-methods/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deletePatientPaymentMethod(id);
      res.json({ message: 'Payment method deleted' });
    } catch (error) {
      console.error('Error deleting payment method:', error);
      res.status(500).json({ message: 'Failed to delete payment method' });
    }
  });

  // ==================== PAYMENT TRANSACTIONS ====================

  // Get transactions with filters
  app.get('/api/payment-transactions', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const filters = {
        patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
        status: req.query.status as string | undefined,
        type: req.query.type as string | undefined,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      };
      const transactions = await storage.getPaymentTransactions(practiceId, filters);
      res.json(transactions);
    } catch (error) {
      console.error('Error fetching payment transactions:', error);
      res.status(500).json({ message: 'Failed to fetch payment transactions' });
    }
  });

  // Get payment stats
  app.get('/api/payment-transactions/stats', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
      const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;
      const stats = await storage.getPaymentStats(practiceId, startDate, endDate);
      res.json(stats);
    } catch (error) {
      console.error('Error fetching payment stats:', error);
      res.status(500).json({ message: 'Failed to fetch payment stats' });
    }
  });

  // Get single transaction
  app.get('/api/payment-transactions/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const transaction = await storage.getPaymentTransaction(id);
      if (!transaction) {
        return res.status(404).json({ message: 'Transaction not found' });
      }
      res.json(transaction);
    } catch (error) {
      console.error('Error fetching payment transaction:', error);
      res.status(500).json({ message: 'Failed to fetch transaction' });
    }
  });

  // Create payment transaction (process payment)
  app.post('/api/payment-transactions', isAuthenticated, async (req: any, res) => {
    try {
      const transaction = await storage.createPaymentTransaction(req.body);

      // Create audit log
      await storage.createAuditLog({
        userId: req.user?.claims?.sub || 'system',
        eventType: 'write',
        eventCategory: 'payment',
        resourceType: 'payment_transaction',
        resourceId: transaction.id.toString(),
        practiceId: transaction.practiceId,
        ipAddress: req.ip || '0.0.0.0',
        details: {
          amount: transaction.amount,
          type: transaction.type,
          patientId: transaction.patientId,
        },
      });

      res.status(201).json(transaction);
    } catch (error) {
      console.error('Error creating payment transaction:', error);
      res.status(500).json({ message: 'Failed to create payment transaction' });
    }
  });

  // Update transaction status (refund, void, etc.)
  app.patch('/api/payment-transactions/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const transaction = await storage.updatePaymentTransaction(id, req.body);
      if (!transaction) {
        return res.status(404).json({ message: 'Transaction not found' });
      }
      res.json(transaction);
    } catch (error) {
      console.error('Error updating payment transaction:', error);
      res.status(500).json({ message: 'Failed to update transaction' });
    }
  });

  // Refund a transaction
  app.post('/api/payment-transactions/:id/refund', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const { amount, reason } = req.body;

      const original = await storage.getPaymentTransaction(id);
      if (!original) {
        return res.status(404).json({ message: 'Transaction not found' });
      }

      if (original.status !== 'completed') {
        return res.status(400).json({ message: 'Can only refund completed transactions' });
      }

      // Create refund transaction
      const refundAmount = amount ? parseFloat(amount) : parseFloat(original.amount);
      const refund = await storage.createPaymentTransaction({
        practiceId: original.practiceId,
        patientId: original.patientId,
        claimId: original.claimId,
        paymentMethodId: original.paymentMethodId,
        amount: (-refundAmount).toString(),
        type: 'refund',
        processor: original.processor,
        status: 'completed',
        description: reason || `Refund for transaction #${id}`,
        processedAt: new Date(),
      });

      // Update original transaction status to refunded
      await storage.updatePaymentTransaction(id, {
        status: 'refunded',
      });

      res.json(refund);
    } catch (error) {
      console.error('Error refunding transaction:', error);
      res.status(500).json({ message: 'Failed to refund transaction' });
    }
  });

  // Get patient's transactions
  app.get('/api/patients/:id/transactions', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const transactions = await storage.getPatientPaymentHistory(patientId);
      res.json(transactions);
    } catch (error) {
      console.error('Error fetching patient transactions:', error);
      res.status(500).json({ message: 'Failed to fetch patient transactions' });
    }
  });

  // Get patient's balance
  app.get('/api/patients/:id/balance', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const balance = await storage.getPatientBalance(patientId);
      res.json({ patientId, balance });
    } catch (error) {
      console.error('Error fetching patient balance:', error);
      res.status(500).json({ message: 'Failed to fetch patient balance' });
    }
  });

  // ==================== PAYMENT PLANS ====================

  // Get payment plans
  app.get('/api/payment-plans', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const filters = {
        patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
        status: req.query.status as string | undefined,
      };
      const plans = await storage.getPaymentPlans(practiceId, filters);
      res.json(plans);
    } catch (error) {
      console.error('Error fetching payment plans:', error);
      res.status(500).json({ message: 'Failed to fetch payment plans' });
    }
  });

  // Get single payment plan with installments
  app.get('/api/payment-plans/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const planDetails = await storage.getPaymentPlanWithInstallments(id);
      if (!planDetails) {
        return res.status(404).json({ message: 'Payment plan not found' });
      }
      res.json(planDetails);
    } catch (error) {
      console.error('Error fetching payment plan:', error);
      res.status(500).json({ message: 'Failed to fetch payment plan' });
    }
  });

  // Create payment plan
  app.post('/api/payment-plans', isAuthenticated, async (req: any, res) => {
    try {
      const { numberOfInstallments, ...planData } = req.body;

      // Create the plan
      const plan = await storage.createPaymentPlan(planData);

      // Generate installments if requested
      if (numberOfInstallments && numberOfInstallments > 0) {
        const totalAmount = parseFloat(planData.totalAmount);
        const installmentAmount = (totalAmount / numberOfInstallments).toFixed(2);
        const startDate = new Date(planData.startDate || Date.now());

        for (let i = 0; i < numberOfInstallments; i++) {
          const dueDate = new Date(startDate);
          if (planData.frequency === 'weekly') {
            dueDate.setDate(dueDate.getDate() + (i * 7));
          } else if (planData.frequency === 'bi-weekly') {
            dueDate.setDate(dueDate.getDate() + (i * 14));
          } else {
            dueDate.setMonth(dueDate.getMonth() + i);
          }

          await storage.createPaymentPlanInstallment({
            paymentPlanId: plan.id,
            installmentNumber: i + 1,
            amount: installmentAmount,
            dueDate: dueDate.toISOString().split('T')[0],
            status: 'scheduled',
          });
        }
      }

      // Return plan with installments
      const planWithInstallments = await storage.getPaymentPlanWithInstallments(plan.id);
      res.status(201).json(planWithInstallments);
    } catch (error) {
      console.error('Error creating payment plan:', error);
      res.status(500).json({ message: 'Failed to create payment plan' });
    }
  });

  // Update payment plan
  app.patch('/api/payment-plans/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const plan = await storage.updatePaymentPlan(id, req.body);
      if (!plan) {
        return res.status(404).json({ message: 'Payment plan not found' });
      }
      res.json(plan);
    } catch (error) {
      console.error('Error updating payment plan:', error);
      res.status(500).json({ message: 'Failed to update payment plan' });
    }
  });

  // Cancel payment plan
  app.post('/api/payment-plans/:id/cancel', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const { reason } = req.body;
      const plan = await storage.updatePaymentPlan(id, {
        status: 'cancelled',
        pausedAt: new Date(),
        pauseReason: reason || 'Cancelled by user',
      });
      if (!plan) {
        return res.status(404).json({ message: 'Payment plan not found' });
      }
      res.json(plan);
    } catch (error) {
      console.error('Error cancelling payment plan:', error);
      res.status(500).json({ message: 'Failed to cancel payment plan' });
    }
  });

  // Get patient's payment plans
  app.get('/api/patients/:id/payment-plans', isAuthenticated, async (req: any, res) => {
    try {
      const patientId = parseInt(req.params.id);
      const plans = await storage.getPatientPaymentPlans(patientId);
      res.json(plans);
    } catch (error) {
      console.error('Error fetching patient payment plans:', error);
      res.status(500).json({ message: 'Failed to fetch patient payment plans' });
    }
  });

  // ==================== PAYMENT PLAN INSTALLMENTS ====================

  // Get plan installments
  app.get('/api/payment-plans/:id/installments', isAuthenticated, async (req: any, res) => {
    try {
      const planId = parseInt(req.params.id);
      const installments = await storage.getPaymentPlanInstallments(planId);
      res.json(installments);
    } catch (error) {
      console.error('Error fetching installments:', error);
      res.status(500).json({ message: 'Failed to fetch installments' });
    }
  });

  // Pay an installment
  app.post('/api/installments/:id/pay', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const { paymentMethodId } = req.body;

      const installment = await storage.getPaymentPlanInstallment(id);
      if (!installment) {
        return res.status(404).json({ message: 'Installment not found' });
      }

      if (installment.status === 'paid') {
        return res.status(400).json({ message: 'Installment already paid' });
      }

      // Get the payment plan
      const plan = await storage.getPaymentPlan(installment.paymentPlanId);
      if (!plan) {
        return res.status(404).json({ message: 'Payment plan not found' });
      }

      // Create payment transaction
      const transaction = await storage.createPaymentTransaction({
        practiceId: plan.practiceId,
        patientId: plan.patientId,
        paymentMethodId,
        amount: installment.amount,
        type: 'payment',
        status: 'completed',
        processedAt: new Date(),
        description: `Payment plan installment #${installment.installmentNumber}`,
      });

      // Update installment
      const updated = await storage.updatePaymentPlanInstallment(id, {
        status: 'paid',
        paidAt: new Date(),
        transactionId: transaction.id,
      });

      // Update plan remaining amount
      const installmentAmt = parseFloat(installment.amount);
      const newRemainingAmount = parseFloat(plan.remainingAmount) - installmentAmt;
      const newCompletedInstallments = (plan.completedInstallments || 0) + 1;
      const planStatus = newRemainingAmount <= 0 ? 'completed' : 'active';
      await storage.updatePaymentPlan(plan.id, {
        remainingAmount: newRemainingAmount.toFixed(2),
        completedInstallments: newCompletedInstallments,
        status: planStatus,
      });

      res.json({ installment: updated, transaction });
    } catch (error) {
      console.error('Error paying installment:', error);
      res.status(500).json({ message: 'Failed to pay installment' });
    }
  });

  // Get upcoming due installments
  app.get('/api/installments/upcoming', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const days = parseInt(req.query.days as string) || 7;
      const upcoming = await storage.getUpcomingInstallments(practiceId, days);
      res.json(upcoming);
    } catch (error) {
      console.error('Error fetching upcoming installments:', error);
      res.status(500).json({ message: 'Failed to fetch upcoming installments' });
    }
  });

  // Get overdue installments
  app.get('/api/installments/overdue', isAuthenticated, async (req: any, res) => {
    try {
      const practiceId = parseInt(req.query.practiceId as string) || 1;
      const overdue = await storage.getOverdueInstallments(practiceId);
      res.json(overdue);
    } catch (error) {
      console.error('Error fetching overdue installments:', error);
      res.status(500).json({ message: 'Failed to fetch overdue installments' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}