/**
 * Reviews & Feedback Routes
 *
 * Handles:
 * - GET /api/reviews/stats - Review request statistics
 * - GET /api/reviews/requests - List review requests
 * - GET /api/reviews/eligible-patients - Patients eligible for review requests
 * - POST /api/reviews/requests - Create review request
 * - POST /api/reviews/requests/:id/send - Send review request to patient
 * - PATCH /api/reviews/requests/:id - Update review request status
 * - GET /api/reviews/google - List Google reviews
 * - GET /api/reviews/google/:id - Get single Google review
 * - POST /api/reviews/google - Add Google review manually
 * - PATCH /api/reviews/google/:id - Update Google review
 * - POST /api/reviews/google/:id/generate-response - Generate AI response
 * - POST /api/reviews/google/:id/respond - Mark review as responded
 * - GET /api/public/feedback/:token - Get feedback form (public)
 * - POST /api/public/feedback/:token - Submit feedback (public)
 * - GET /api/feedback - List patient feedback
 * - GET /api/feedback/stats - Feedback statistics
 * - GET /api/feedback/:id - Get single feedback
 * - PATCH /api/feedback/:id - Update feedback
 * - POST /api/feedback/:id/address - Mark feedback as addressed
 * - POST /api/feedback/:id/request-google-post - Request Google post
 * - POST /api/feedback/:id/mark-posted - Mark as posted to Google
 *
 * Mounted at /api so all paths include their full prefix.
 */

import { Router } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

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

// ==================== REVIEW MANAGEMENT ====================

// Get review request statistics
router.get('/reviews/stats', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const requestStats = await storage.getReviewRequestStats(practiceId);
    const reviewStats = await storage.getReviewStats(practiceId);
    res.json({ requests: requestStats, reviews: reviewStats });
  } catch (error) {
    logger.error('Error fetching review stats', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch review stats' });
  }
});

// Get all review requests
router.get('/reviews/requests', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      status: req.query.status as string | undefined,
      patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
    };
    const requests = await storage.getReviewRequests(practiceId, filters);
    res.json(requests);
  } catch (error) {
    logger.error('Error fetching review requests', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch review requests' });
  }
});

// Get patients eligible for review requests
router.get('/reviews/eligible-patients', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const days = parseInt(req.query.days as string) || 1;
    const eligible = await storage.getPatientsEligibleForReview(practiceId, days);
    res.json(eligible);
  } catch (error) {
    logger.error('Error fetching eligible patients', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch eligible patients' });
  }
});

// Create a review request
router.post('/reviews/requests', isAuthenticated, async (req: any, res) => {
  try {
    // Generate a unique feedback token
    const crypto = await import('crypto');
    const feedbackToken = crypto.randomBytes(32).toString('hex');

    const data = {
      ...req.body,
      practiceId: getAuthorizedPracticeId(req),
      feedbackToken,
    };
    const request = await storage.createReviewRequest(data);
    res.status(201).json(request);
  } catch (error) {
    logger.error('Error creating review request', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create review request' });
  }
});

// Send a review request to patient (now sends to feedback page, not Google directly)
router.post('/reviews/requests/:id/send', isAuthenticated, async (req: any, res) => {
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

    const { generateFeedbackRequestMessage } = await import('../services/reviewResponseService');
    const results: { emailSent?: boolean; smsSent?: boolean; errors: string[] } = { errors: [] };

    // Send email
    if ((sendVia === 'email' || sendVia === 'both') && patient.email) {
      try {
        const { isEmailConfigured } = await import('../email');
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
        const { sendSMS, isSMSConfigured } = await import('../services/smsService');
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
    logger.error('Error sending review request', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to send review request' });
  }
});

// Update review request status
router.patch('/reviews/requests/:id', isAuthenticated, async (req: any, res) => {
  try {
    const request = await storage.updateReviewRequest(parseInt(req.params.id), req.body);
    res.json(request);
  } catch (error) {
    logger.error('Error updating review request', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update review request' });
  }
});

// Get all Google reviews
router.get('/reviews/google', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      responseStatus: req.query.responseStatus as string | undefined,
      sentiment: req.query.sentiment as string | undefined,
      minRating: req.query.minRating ? parseInt(req.query.minRating as string) : undefined,
      maxRating: req.query.maxRating ? parseInt(req.query.maxRating as string) : undefined,
    };
    const reviews = await storage.getGoogleReviews(practiceId, filters);
    res.json(reviews);
  } catch (error) {
    logger.error('Error fetching Google reviews', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch Google reviews' });
  }
});

// Get a single Google review
router.get('/reviews/google/:id', isAuthenticated, async (req: any, res) => {
  try {
    const review = await storage.getGoogleReview(parseInt(req.params.id));
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }
    res.json(review);
  } catch (error) {
    logger.error('Error fetching Google review', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch Google review' });
  }
});

// Add a Google review manually
router.post('/reviews/google', isAuthenticated, async (req: any, res) => {
  try {
    const { analyzeReview } = await import('../services/reviewResponseService');

    // Analyze the review
    const analysisResult = await analyzeReview(req.body.reviewText || '', req.body.rating || 3);

    const data = {
      ...req.body,
      practiceId: getAuthorizedPracticeId(req),
      sentiment: analysisResult.analysis?.sentiment,
      tags: analysisResult.analysis?.tags,
    };

    const review = await storage.createGoogleReview(data);
    res.status(201).json(review);
  } catch (error) {
    logger.error('Error creating Google review', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to create Google review' });
  }
});

// Update a Google review
router.patch('/reviews/google/:id', isAuthenticated, async (req: any, res) => {
  try {
    const review = await storage.updateGoogleReview(parseInt(req.params.id), req.body);
    res.json(review);
  } catch (error) {
    logger.error('Error updating Google review', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update Google review' });
  }
});

// Generate AI response for a review
router.post('/reviews/google/:id/generate-response', isAuthenticated, async (req: any, res) => {
  try {
    const review = await storage.getGoogleReview(parseInt(req.params.id));
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    const practice = await storage.getPractice(review.practiceId);
    const { generateReviewResponse } = await import('../services/reviewResponseService');

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
    logger.error('Error generating review response', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to generate response' });
  }
});

// Mark a review as responded
router.post('/reviews/google/:id/respond', isAuthenticated, async (req: any, res) => {
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
    logger.error('Error marking review as responded', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update review' });
  }
});

// ==================== PUBLIC FEEDBACK (No Auth Required) ====================

// Get feedback form data by token
router.get('/public/feedback/:token', async (req: any, res) => {
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
    logger.error('Error fetching feedback form', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load feedback form' });
  }
});

// Submit feedback (public - no auth) - FULLY AUTOMATED WORKFLOW
router.post('/public/feedback/:token', async (req: any, res) => {
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
        const { generateNegativeFeedbackResponse } = await import('../services/reviewResponseService');
        const { isEmailConfigured } = await import('../email');

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

          logger.info(`[AUTO] Negative feedback #${feedback.id}: AI follow-up email sent to ${patient.email}`);
        }
      } catch (err) {
        logger.error('[AUTO] Failed to send negative feedback response', { error: err instanceof Error ? err.message : String(err) });
      }
    } else if (sentiment === 'positive' && practice?.googleReviewUrl && (patient?.email || patient?.phone)) {
      // POSITIVE FEEDBACK: Automatically request Google review post
      try {
        const { generateGooglePostRequestMessage } = await import('../services/reviewResponseService');
        let googleRequestSent = false;

        // Send via email if available
        if (patient.email) {
          try {
            const { isEmailConfigured } = await import('../email');
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
              logger.info(`[AUTO] Positive feedback #${feedback.id}: Google post request email sent to ${patient.email}`);
            }
          } catch (err) {
            logger.error('[AUTO] Email send failed', { error: err instanceof Error ? err.message : String(err) });
          }
        }

        // Also send via SMS if available
        if (patient.phone) {
          try {
            const { sendSMS, isSMSConfigured } = await import('../services/smsService');
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
                logger.info(`[AUTO] Positive feedback #${feedback.id}: Google post request SMS sent to ${patient.phone}`);
              }
            }
          } catch (err) {
            logger.error('[AUTO] SMS send failed', { error: err instanceof Error ? err.message : String(err) });
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
        logger.error('[AUTO] Failed to send Google post request', { error: err instanceof Error ? err.message : String(err) });
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
    logger.error('Error submitting feedback', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to submit feedback' });
  }
});

// ==================== PATIENT FEEDBACK MANAGEMENT (Authenticated) ====================

// Get all patient feedback for practice
router.get('/feedback', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const filters = {
      sentiment: req.query.sentiment as string | undefined,
      isAddressed: req.query.isAddressed === 'true' ? true : req.query.isAddressed === 'false' ? false : undefined,
      googlePostRequested: req.query.googlePostRequested === 'true' ? true : req.query.googlePostRequested === 'false' ? false : undefined,
    };
    const feedback = await storage.getPatientFeedback(practiceId, filters);

    // Enrich with patient info (batch query, not N+1)
    const feedbackPatientIds = Array.from(new Set(feedback.map(fb => fb.patientId).filter((id): id is number => id != null)));
    const feedbackPatientsMap = await storage.getPatientsByIds(feedbackPatientIds);
    const enrichedFeedback = feedback.map((fb) => {
      const patient = feedbackPatientsMap.get(fb.patientId);
      return {
        ...fb,
        patientName: patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown',
        patientEmail: patient?.email,
        patientPhone: patient?.phone,
      };
    });

    res.json(enrichedFeedback);
  } catch (error) {
    logger.error('Error fetching patient feedback', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch patient feedback' });
  }
});

// Get feedback stats
router.get('/feedback/stats', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const stats = await storage.getPatientFeedbackStats(practiceId);
    res.json(stats);
  } catch (error) {
    logger.error('Error fetching feedback stats', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch feedback stats' });
  }
});

// Get single feedback
router.get('/feedback/:id', isAuthenticated, async (req: any, res) => {
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
    logger.error('Error fetching feedback', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch feedback' });
  }
});

// Update feedback (mark as addressed, add notes)
router.patch('/feedback/:id', isAuthenticated, async (req: any, res) => {
  try {
    const feedback = await storage.updatePatientFeedback(parseInt(req.params.id), req.body);
    res.json(feedback);
  } catch (error) {
    logger.error('Error updating feedback', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update feedback' });
  }
});

// Mark feedback as addressed
router.post('/feedback/:id/address', isAuthenticated, async (req: any, res) => {
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
    logger.error('Error addressing feedback', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to address feedback' });
  }
});

// Request Google post for positive feedback
router.post('/feedback/:id/request-google-post', isAuthenticated, async (req: any, res) => {
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
    const { generateGooglePostRequestMessage } = await import('../services/reviewResponseService');
    const results: { emailSent?: boolean; smsSent?: boolean; errors: string[] } = { errors: [] };

    // Send email
    if ((sendVia === 'email' || sendVia === 'both') && patient.email) {
      try {
        const { isEmailConfigured } = await import('../email');
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
        const { sendSMS, isSMSConfigured } = await import('../services/smsService');
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
    logger.error('Error requesting Google post', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to request Google post' });
  }
});

// Mark feedback as posted to Google
router.post('/feedback/:id/mark-posted', isAuthenticated, async (req: any, res) => {
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
    logger.error('Error marking as posted', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to mark as posted' });
  }
});

export default router;
