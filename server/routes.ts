import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { storage } from "./storage";
import AIReimbursementPredictor from "./aiReimbursementPredictor";

// Initialize AI predictor (in production, this would load from database)
const reimbursementPredictor = new AIReimbursementPredictor();

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
  
  const httpServer = createServer(app);
  return httpServer;
}