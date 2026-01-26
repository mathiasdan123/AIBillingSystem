import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { storage } from "./storage";
import AIReimbursementPredictor from "./aiReimbursementPredictor";
import insuranceAuthorizationRoutes from "./routes/insuranceAuthorizationRoutes";
import insuranceDataRoutes from "./routes/insuranceDataRoutes";
import { generateSoapNoteAndBilling } from "./services/aiSoapBillingService";
import { transcribeAudioBase64, isVoiceTranscriptionAvailable } from "./services/voiceService";

// Initialize AI predictor (in production, this would load from database)
const reimbursementPredictor = new AIReimbursementPredictor();

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
      role: 'admin' // Options: 'admin', 'therapist' - Client can override with demo switch
    });
  });

  // Dashboard analytics
  app.get('/api/analytics/dashboard', async (req, res) => {
    res.json({
      totalPatients: 3,
      activeClaims: 2,
      pendingPayments: 1,
      monthlyRevenue: 12500,
      claimApprovalRate: 94.2,
      averageReimbursement: 142.50
    });
  });

  // Enhanced reimbursement estimation with AI predictions
  app.post('/api/estimate-reimbursement', async (req, res) => {
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

  // Upload historical reimbursement data for AI training
  app.post('/api/upload-reimbursement-data', isAuthenticated, async (req, res) => {
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

  // Get AI prediction insights
  app.get('/api/reimbursement-insights/:insuranceProvider/:cptCode', async (req, res) => {
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

  // Export training data for external ML systems
  app.get('/api/export-training-data', isAuthenticated, async (req, res) => {
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
        ratePerUnit // Manual rate override (default $289/unit)
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

  const httpServer = createServer(app);
  return httpServer;
}