import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { storage } from "./storage";
import AIReimbursementPredictor from "./aiReimbursementPredictor";
import { AiClaimOptimizer } from "./aiClaimOptimizer";

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

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

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

  app.patch('/api/users/:id/role', isAuthenticated, isAdmin, async (req, res) => {
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

  // Get single claim
  app.get('/api/claims/:id', isAuthenticated, async (req: any, res) => {
    try {
      const claim = await storage.getClaim(parseInt(req.params.id));
      if (!claim) {
        return res.status(404).json({ message: 'Claim not found' });
      }
      res.json(claim);
    } catch (error) {
      console.error('Error fetching claim:', error);
      res.status(500).json({ message: 'Failed to fetch claim' });
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

      const claim = await storage.getClaim(claimId);
      if (!claim) {
        return res.status(404).json({ message: 'Claim not found' });
      }

      const updatedClaim = await storage.updateClaim(claimId, {
        status: 'denied',
        denialReason: denialReason || 'No reason provided',
      });

      res.json({
        message: 'Claim marked as denied',
        claim: updatedClaim
      });
    } catch (error) {
      console.error('Error denying claim:', error);
      res.status(500).json({ message: 'Failed to deny claim' });
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

  const httpServer = createServer(app);
  return httpServer;
}