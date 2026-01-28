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
import { transcribeAudioBase64, isVoiceTranscriptionAvailable } from "./services/voiceService";
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
      res.json(soapNote);
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

  const httpServer = createServer(app);
  return httpServer;
}