/**
 * AI Routes
 *
 * Handles:
 * - /api/estimate-reimbursement - AI-enhanced reimbursement estimation
 * - /api/upload-reimbursement-data - Upload historical reimbursement data
 * - /api/reimbursement-insights/:provider/:code - AI prediction insights
 * - /api/export-training-data - Export ML training data
 * - /api/oon-predict - OON reimbursement prediction (single)
 * - /api/oon-predict/batch - OON reimbursement prediction (batch)
 * - /api/oon-predict/payers - Supported payers list
 * - /api/oon-predict/cpt-codes - Supported CPT codes
 * - /api/oon-estimate - Quick patient-facing OON estimate
 * - /api/claim-outcomes - Record/get claim outcomes for ML
 * - /api/ai/generate-soap-billing - AI SOAP note + billing generation
 * - /api/voice/* - Voice transcription
 * - /api/session-recorder/* - Session recording + transcription
 * - /api/tts/* - Text-to-speech (ElevenLabs)
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import AIReimbursementPredictor from '../aiReimbursementPredictor';
import { generateSoapNoteAndBilling } from '../services/aiSoapBillingService';
import { transcribeAudioBase64, isVoiceTranscriptionAvailable } from '../services/voiceService';
import { processSessionRecording, processTranscriptionText } from '../services/sessionRecorderService';
import { predictOONReimbursement, predictMultipleOON, getSupportedPayers, getSupportedCPTCodes, type OONPredictionInput } from '../services/oonReimbursementPredictor';
import { textToSpeech, isTextToSpeechAvailable, getAvailableVoices, soapNoteToSpeech, appealLetterToSpeech, VOICE_PRESETS } from '../services/textToSpeechService';
import { uploadLimiter, exportLimiter } from '../middleware/rate-limiter';

const router = Router();

// Initialize AI predictor
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
    logger.error("Error checking user role", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to verify permissions" });
  }
};

// Enhanced reimbursement estimation with AI predictions (admin/billing only)
router.post('/estimate-reimbursement', isAuthenticated, isAdminOrBilling, async (req, res) => {
  try {
    const { insuranceProvider, cptCodes, sessionCount, deductibleMet, planType, region, patientAge } = req.body;

    if (!insuranceProvider || !cptCodes || !Array.isArray(cptCodes)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const predictions = reimbursementPredictor.predictMultipleCodes(
      insuranceProvider,
      cptCodes,
      {
        insuranceProvider,
        practiceCharge: 150,
        deductibleMet: deductibleMet || false,
        planType: planType || 'PPO',
        region: region || 'National',
        patientAge: patientAge || 35,
        sessionType: 'follow-up'
      }
    );

    const estimates = cptCodes.map((cptCode: string) => {
      const prediction = predictions[cptCode];
      const practiceCharge = 150;
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
    logger.error('Error estimating reimbursement', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to estimate reimbursement' });
  }
});

// Upload historical reimbursement data (admin/billing only)
router.post('/upload-reimbursement-data', uploadLimiter, isAuthenticated, isAdminOrBilling, async (req, res) => {
  try {
    const { records } = req.body;

    if (!Array.isArray(records)) {
      return res.status(400).json({ error: 'Records must be an array' });
    }

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

    reimbursementPredictor.importHistoricalData(validRecords);

    res.json({
      message: 'Historical data imported successfully',
      importedRecords: validRecords.length,
      skippedRecords: records.length - validRecords.length
    });
  } catch (error) {
    logger.error('Error uploading reimbursement data', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to upload data' });
  }
});

// Get AI prediction insights (admin/billing only)
router.get('/reimbursement-insights/:insuranceProvider/:cptCode', isAuthenticated, isAdminOrBilling, async (req, res) => {
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
    logger.error('Error getting insights', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to get insights' });
  }
});

// Export training data for external ML systems (admin/billing only)
router.get('/export-training-data', exportLimiter, isAuthenticated, isAdminOrBilling, async (req, res) => {
  try {
    const trainingData = reimbursementPredictor.exportTrainingData();

    res.json({
      success: true,
      data: trainingData,
      exportDate: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error exporting training data', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to export training data' });
  }
});

// Predict OON reimbursement for a single CPT code
router.post('/oon-predict', async (req, res) => {
  try {
    const {
      cptCode, insuranceProvider, zipCode, billedAmount,
      planType, deductibleMet, deductibleRemaining,
      coinsuranceOverride, providerCredential
    } = req.body;

    if (!cptCode || !insuranceProvider || !billedAmount) {
      return res.status(400).json({
        error: 'Missing required fields: cptCode, insuranceProvider, and billedAmount are required'
      });
    }

    const prediction = predictOONReimbursement({
      cptCode,
      insuranceProvider,
      zipCode: zipCode || '00000',
      billedAmount: parseFloat(billedAmount),
      planType,
      deductibleMet,
      deductibleRemaining: deductibleRemaining ? parseFloat(deductibleRemaining) : undefined,
      coinsuranceOverride: coinsuranceOverride ? parseFloat(coinsuranceOverride) : undefined,
      providerCredential
    });

    res.json({
      success: true,
      prediction,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error predicting OON reimbursement', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to predict reimbursement' });
  }
});

// Predict OON reimbursement for multiple CPT codes (full session)
router.post('/oon-predict/batch', async (req, res) => {
  try {
    const {
      cptCodes, insuranceProvider, zipCode, billedAmounts,
      planType, deductibleMet, deductibleRemaining, coinsuranceOverride
    } = req.body;

    if (!cptCodes || !Array.isArray(cptCodes) || !insuranceProvider || !billedAmounts) {
      return res.status(400).json({
        error: 'Missing required fields: cptCodes (array), insuranceProvider, and billedAmounts (object) are required'
      });
    }

    const result = predictMultipleOON(
      cptCodes,
      insuranceProvider,
      zipCode || '00000',
      billedAmounts,
      {
        planType,
        deductibleMet,
        deductibleRemaining: deductibleRemaining ? parseFloat(deductibleRemaining) : undefined,
        coinsuranceOverride: coinsuranceOverride ? parseFloat(coinsuranceOverride) : undefined
      }
    );

    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error predicting batch OON reimbursement', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to predict batch reimbursement' });
  }
});

// Get list of supported payers with their typical OON characteristics
router.get('/oon-predict/payers', async (req, res) => {
  try {
    const payers = getSupportedPayers();
    res.json({ success: true, payers, count: payers.length });
  } catch (error) {
    logger.error('Error getting supported payers', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to get payers' });
  }
});

// Get list of supported CPT codes with Medicare rates
router.get('/oon-predict/cpt-codes', async (req, res) => {
  try {
    const codes = getSupportedCPTCodes();
    res.json({ success: true, codes, count: codes.length });
  } catch (error) {
    logger.error('Error getting supported CPT codes', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to get CPT codes' });
  }
});

// Quick estimate endpoint for patient-facing use (no auth required for patient portal)
router.get('/oon-estimate', async (req, res) => {
  try {
    const { cptCode, insuranceProvider, billedAmount, zipCode } = req.query;

    if (!cptCode || !insuranceProvider || !billedAmount) {
      return res.status(400).json({
        error: 'Missing required query params: cptCode, insuranceProvider, billedAmount'
      });
    }

    const prediction = predictOONReimbursement({
      cptCode: cptCode as string,
      insuranceProvider: insuranceProvider as string,
      zipCode: (zipCode as string) || '00000',
      billedAmount: parseFloat(billedAmount as string)
    });

    res.json({
      estimatedInsurancePays: prediction.estimatedReimbursement,
      estimatedYouPay: prediction.estimatedPatientResponsibility,
      confidence: prediction.confidenceLevel,
      range: {
        lowEstimate: prediction.range.low,
        highEstimate: prediction.range.high
      },
      note: 'This is an estimate only. Actual reimbursement may vary based on your specific plan benefits.'
    });
  } catch (error) {
    logger.error('Error getting quick OON estimate', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to get estimate' });
  }
});

// Record claim outcome for ML training (authenticated)
router.post('/claim-outcomes', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    const user = await storage.getUser(userId);

    if (!user?.practiceId) {
      return res.status(400).json({ error: 'User not associated with a practice' });
    }

    const outcomeData = { ...req.body, practiceId: user.practiceId };

    if (!outcomeData.cptCode || !outcomeData.insuranceProvider || !outcomeData.billedAmount || !outcomeData.serviceDate) {
      return res.status(400).json({
        error: 'Missing required fields: cptCode, insuranceProvider, billedAmount, serviceDate'
      });
    }

    const outcome = await storage.createClaimOutcome(outcomeData);

    res.json({
      success: true,
      outcome,
      message: 'Claim outcome recorded. Thank you for helping improve our predictions!'
    });
  } catch (error) {
    logger.error('Error recording claim outcome', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to record claim outcome' });
  }
});

// Get claim outcomes for practice (authenticated, admin/billing only)
router.get('/claim-outcomes', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    const user = await storage.getUser(userId);

    if (!user?.practiceId) {
      return res.status(400).json({ error: 'User not associated with a practice' });
    }

    const outcomes = await storage.getClaimOutcomes(user.practiceId);

    res.json({ success: true, outcomes, count: outcomes.length });
  } catch (error) {
    logger.error('Error fetching claim outcomes', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to fetch claim outcomes' });
  }
});

// AI SOAP Note and Billing Generation
router.post('/ai/generate-soap-billing', isAuthenticated, async (req: any, res) => {
  try {
    const {
      patientId, activities, mood, caregiverReport, duration,
      location, assessment, planNextSteps, nextSessionFocus,
      homeProgram, ratePerUnit
    } = req.body;

    if (!patientId || !activities || !Array.isArray(activities) || activities.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields: patientId and activities array required'
      });
    }

    if (!duration || duration < 15) {
      return res.status(400).json({ error: 'Duration must be at least 15 minutes' });
    }

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
    logger.error('Error generating AI SOAP note', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to generate SOAP note and billing' });
  }
});

// Voice Transcription routes
router.get('/voice/status', (req, res) => {
  res.json({
    available: isVoiceTranscriptionAvailable(),
    method: isVoiceTranscriptionAvailable() ? 'whisper' : 'browser-only'
  });
});

router.post('/voice/transcribe', isAuthenticated, async (req: any, res) => {
  try {
    const { audio, mimeType, language } = req.body;

    if (!audio) {
      return res.status(400).json({ error: 'No audio data provided' });
    }

    const result = await transcribeAudioBase64(audio, mimeType || 'audio/webm', language || 'en');

    if (result.success) {
      res.json({ text: result.text, method: result.method });
    } else {
      res.status(500).json({ error: result.error, method: result.method });
    }
  } catch (error) {
    logger.error('Voice transcription error', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Transcription failed' });
  }
});

// Session Recorder routes
router.post('/session-recorder/process', isAuthenticated, async (req: any, res) => {
  try {
    const {
      audioBase64, mimeType, patientId, patientName,
      therapistName, sessionDuration, insuranceName,
      diagnosis, sessionType
    } = req.body;

    if (!audioBase64) {
      return res.status(400).json({ error: 'No audio data provided' });
    }

    if (!patientName || !sessionDuration) {
      return res.status(400).json({ error: 'Patient name and session duration are required' });
    }

    logger.info(`Processing session recording for ${patientName}, ${sessionDuration} minutes`);

    const result = await processSessionRecording({
      audioBase64,
      mimeType: mimeType || 'audio/webm',
      patientId: patientId || 0,
      patientName,
      therapistName: therapistName || 'Therapist',
      sessionDuration,
      insuranceName,
      diagnosis,
      sessionType
    });

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Session recording processing error', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to process recording' });
  }
});

router.post('/session-recorder/process-text', isAuthenticated, async (req: any, res) => {
  try {
    const {
      transcription, patientId, patientName, therapistName,
      sessionDuration, insuranceName, diagnosis, sessionType
    } = req.body;

    if (!transcription) {
      return res.status(400).json({ error: 'No transcription text provided' });
    }

    if (!patientName || !sessionDuration) {
      return res.status(400).json({ error: 'Patient name and session duration are required' });
    }

    logger.info(`Processing transcription text for ${patientName}, ${sessionDuration} minutes`);

    const result = await processTranscriptionText(transcription, {
      patientId: patientId || 0,
      patientName,
      therapistName: therapistName || 'Therapist',
      sessionDuration,
      insuranceName,
      diagnosis,
      sessionType
    });

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Transcription processing error', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to process transcription' });
  }
});

router.get('/session-recorder/status', (req, res) => {
  res.json({
    available: isVoiceTranscriptionAvailable(),
    features: {
      transcription: isVoiceTranscriptionAvailable(),
      soapGeneration: !!process.env.OPENAI_API_KEY,
      billingOptimization: !!process.env.OPENAI_API_KEY
    }
  });
});

// Text-to-Speech routes
router.get('/tts/status', (req, res) => {
  res.json({
    available: isTextToSpeechAvailable(),
    voicePresets: VOICE_PRESETS,
  });
});

router.get('/tts/voices', isAuthenticated, async (req: any, res) => {
  try {
    const voices = await getAvailableVoices();
    res.json({ voices });
  } catch (error) {
    logger.error('Error fetching voices', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to fetch voices' });
  }
});

router.post('/tts/speak', isAuthenticated, async (req: any, res) => {
  try {
    const { text, voiceId, stability, similarityBoost } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const result = await textToSpeech(text, { voiceId, stability, similarityBoost });

    if (result.success) {
      res.json({ audioBase64: result.audioBase64, contentType: result.contentType });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    logger.error('TTS error', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Text-to-speech failed' });
  }
});

router.post('/tts/soap-note', isAuthenticated, async (req: any, res) => {
  try {
    const { subjective, objective, assessment, plan, voiceId } = req.body;

    const result = await soapNoteToSpeech({ subjective, objective, assessment, plan }, voiceId);

    if (result.success) {
      res.json({ audioBase64: result.audioBase64, contentType: result.contentType });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    logger.error('SOAP note TTS error', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Text-to-speech failed' });
  }
});

router.post('/tts/appeal', isAuthenticated, async (req: any, res) => {
  try {
    const { appealLetter, voiceId } = req.body;

    if (!appealLetter) {
      return res.status(400).json({ error: 'Appeal letter text is required' });
    }

    const result = await appealLetterToSpeech(appealLetter, voiceId);

    if (result.success) {
      res.json({ audioBase64: result.audioBase64, contentType: result.contentType });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    logger.error('Appeal TTS error', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Text-to-speech failed' });
  }
});

export default router;
