import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import {
  sendAuthorizationRequestEmail,
  sendAuthorizationReminderEmail,
  sendAuthorizationConfirmationEmail,
  sendAuthorizationSMS,
} from '../email';
import type { InsertPatientInsuranceAuthorization } from '@shared/schema';

const router = Router();

// Generate cryptographically secure token
function generateSecureToken(): string {
  return crypto.randomBytes(32).toString('hex'); // 64 character hex string
}

// Rate limiting: max 3 requests per patient per 24 hours
const rateLimitMap = new Map<number, { count: number; resetAt: Date }>();

function checkRateLimit(patientId: number): { allowed: boolean; remaining: number } {
  const now = new Date();
  const limit = rateLimitMap.get(patientId);

  if (!limit || limit.resetAt < now) {
    rateLimitMap.set(patientId, { count: 1, resetAt: new Date(now.getTime() + 24 * 60 * 60 * 1000) });
    return { allowed: true, remaining: 2 };
  }

  if (limit.count >= 3) {
    return { allowed: false, remaining: 0 };
  }

  limit.count++;
  return { allowed: true, remaining: 3 - limit.count };
}

// POST /api/insurance-authorizations - Create new authorization request
router.post('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    const userId = req.user?.claims?.sub;
    const {
      patientId,
      scopes = ['eligibility'],
      deliveryMethod = 'email',
      deliveryEmail,
      deliveryPhone,
    } = req.body;

    if (!patientId) {
      return res.status(400).json({ message: 'Patient ID is required' });
    }

    // Get patient
    const patient = await storage.getPatient(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found' });
    }

    // Check rate limit
    const rateLimit = checkRateLimit(patientId);
    if (!rateLimit.allowed) {
      return res.status(429).json({
        message: 'Rate limit exceeded. Maximum 3 authorization requests per patient per 24 hours.',
      });
    }

    // Get practice
    const practice = await storage.getPractice(patient.practiceId);
    if (!practice) {
      return res.status(404).json({ message: 'Practice not found' });
    }

    // Generate secure token
    const token = generateSecureToken();
    const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year authorization validity

    // Determine delivery email/phone
    const finalDeliveryEmail = deliveryEmail || patient.email;
    const finalDeliveryPhone = deliveryPhone || patient.phone;

    if (deliveryMethod === 'email' && !finalDeliveryEmail) {
      return res.status(400).json({ message: 'Patient email is required for email delivery' });
    }
    if (deliveryMethod === 'sms' && !finalDeliveryPhone) {
      return res.status(400).json({ message: 'Patient phone is required for SMS delivery' });
    }

    // Create authorization record
    const authorizationData: InsertPatientInsuranceAuthorization = {
      practiceId: patient.practiceId,
      patientId,
      requestedById: userId,
      token,
      tokenExpiresAt,
      status: 'pending',
      scopes,
      deliveryMethod,
      deliveryEmail: finalDeliveryEmail,
      deliveryPhone: finalDeliveryPhone,
      expiresAt,
    };

    const authorization = await storage.createInsuranceAuthorization(authorizationData);

    // Build authorization URL
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const authorizationUrl = `${baseUrl}/authorize/${token}`;

    // Send notification based on delivery method
    let sendResult: { success: boolean; error?: string } = { success: false };

    if (deliveryMethod === 'email' || deliveryMethod === 'both') {
      sendResult = await sendAuthorizationRequestEmail(
        practice,
        patient,
        authorization,
        authorizationUrl
      );
    }

    if (deliveryMethod === 'sms' || deliveryMethod === 'both') {
      const smsResult = await sendAuthorizationSMS(
        practice,
        patient,
        authorization,
        authorizationUrl
      );
      if (deliveryMethod === 'sms') {
        sendResult = smsResult;
      }
    }

    // Log the event
    await storage.createAuditLogEntry({
      practiceId: patient.practiceId,
      patientId,
      authorizationId: authorization.id,
      actorType: 'user',
      actorId: userId,
      actorEmail: req.user?.claims?.email,
      actorIpAddress: req.ip,
      actorUserAgent: req.get('User-Agent'),
      eventType: 'authorization_requested',
      eventDetails: { scopes, deliveryMethod },
      success: sendResult.success,
      errorMessage: sendResult.error,
    });

    res.status(201).json({
      id: authorization.id,
      status: authorization.status,
      token: authorization.token,
      deliveryMethod,
      notificationSent: sendResult.success,
      rateLimit: { remaining: rateLimit.remaining },
      message: sendResult.success
        ? `Authorization request sent via ${deliveryMethod}`
        : `Authorization created but notification failed: ${sendResult.error}`,
    });
  } catch (error) {
    console.error('Error creating authorization:', error);
    res.status(500).json({ message: 'Failed to create authorization request' });
  }
});

// GET /api/patients/:id/insurance-authorizations - List patient's authorizations
router.get('/patients/:id/insurance-authorizations', isAuthenticated, async (req: any, res: Response) => {
  try {
    const patientId = parseInt(req.params.id);
    if (isNaN(patientId)) {
      return res.status(400).json({ message: 'Invalid patient ID' });
    }

    const authorizations = await storage.getPatientAuthorizations(patientId);

    // Mask tokens for security
    const maskedAuthorizations = authorizations.map((auth) => ({
      ...auth,
      token: `${auth.token.substring(0, 8)}...`,
    }));

    res.json(maskedAuthorizations);
  } catch (error) {
    console.error('Error fetching authorizations:', error);
    res.status(500).json({ message: 'Failed to fetch authorizations' });
  }
});

// POST /api/insurance-authorizations/:id/resend - Resend authorization request
router.post('/:id/resend', isAuthenticated, async (req: any, res: Response) => {
  try {
    const authorizationId = parseInt(req.params.id);
    const userId = req.user?.claims?.sub;

    if (isNaN(authorizationId)) {
      return res.status(400).json({ message: 'Invalid authorization ID' });
    }

    const authorization = await storage.getAuthorizationById(authorizationId);
    if (!authorization) {
      return res.status(404).json({ message: 'Authorization not found' });
    }

    if (authorization.status !== 'pending') {
      return res.status(400).json({ message: 'Can only resend pending authorizations' });
    }

    // Check resend limit
    if ((authorization.resendCount || 0) >= 3) {
      return res.status(429).json({ message: 'Maximum resend limit reached for this authorization' });
    }

    // Get patient and practice
    const patient = await storage.getPatient(authorization.patientId);
    const practice = await storage.getPractice(authorization.practiceId);

    if (!patient || !practice) {
      return res.status(404).json({ message: 'Patient or practice not found' });
    }

    // Generate new token if close to expiry
    let token = authorization.token;
    let tokenExpiresAt = authorization.tokenExpiresAt;

    const tokenExpiresDate = new Date(tokenExpiresAt);
    if (tokenExpiresDate.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
      // Less than 24 hours left
      token = generateSecureToken();
      tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await storage.updateAuthorizationStatus(authorizationId, { token, tokenExpiresAt });
    }

    // Build URL and send
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const authorizationUrl = `${baseUrl}/authorize/${token}`;

    const sendResult = await sendAuthorizationReminderEmail(
      practice,
      patient,
      { ...authorization, token },
      authorizationUrl
    );

    // Update resend count
    await storage.incrementAuthorizationResendCount(authorizationId);

    // Log the event
    await storage.createAuditLogEntry({
      practiceId: authorization.practiceId,
      patientId: authorization.patientId,
      authorizationId,
      actorType: 'user',
      actorId: userId,
      eventType: 'authorization_sent',
      eventDetails: { isResend: true },
      success: sendResult.success,
      errorMessage: sendResult.error,
    });

    res.json({
      success: sendResult.success,
      message: sendResult.success ? 'Reminder sent successfully' : `Failed to send: ${sendResult.error}`,
    });
  } catch (error) {
    console.error('Error resending authorization:', error);
    res.status(500).json({ message: 'Failed to resend authorization' });
  }
});

// POST /api/insurance-authorizations/:id/revoke - Revoke authorization
router.post('/:id/revoke', isAuthenticated, async (req: any, res: Response) => {
  try {
    const authorizationId = parseInt(req.params.id);
    const userId = req.user?.claims?.sub;
    const { reason } = req.body;

    if (isNaN(authorizationId)) {
      return res.status(400).json({ message: 'Invalid authorization ID' });
    }

    const authorization = await storage.getAuthorizationById(authorizationId);
    if (!authorization) {
      return res.status(404).json({ message: 'Authorization not found' });
    }

    if (authorization.status === 'revoked') {
      return res.status(400).json({ message: 'Authorization is already revoked' });
    }

    // Update status
    await storage.updateAuthorizationStatus(authorizationId, {
      status: 'revoked',
      revokedAt: new Date(),
      revokedReason: reason || 'Revoked by staff',
    });

    // Mark any cached data as stale
    await storage.markCacheAsStale(authorization.patientId);

    // Log the event
    await storage.createAuditLogEntry({
      practiceId: authorization.practiceId,
      patientId: authorization.patientId,
      authorizationId,
      actorType: 'user',
      actorId: userId,
      eventType: 'authorization_revoked',
      eventDetails: { reason },
      success: true,
    });

    res.json({ success: true, message: 'Authorization revoked successfully' });
  } catch (error) {
    console.error('Error revoking authorization:', error);
    res.status(500).json({ message: 'Failed to revoke authorization' });
  }
});

// ============================================
// PATIENT-FACING ENDPOINTS (No auth required)
// ============================================

// GET /api/authorize/:token - Get authorization page info
router.get('/authorize/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const authorization = await storage.getAuthorizationByToken(token);
    if (!authorization) {
      return res.status(404).json({ message: 'Authorization not found or expired' });
    }

    // Check token expiry
    if (new Date(authorization.tokenExpiresAt) < new Date()) {
      await storage.updateAuthorizationStatus(authorization.id, { status: 'expired' });
      return res.status(410).json({ message: 'This authorization link has expired' });
    }

    // Check if already used
    if (authorization.tokenUsedAt) {
      return res.status(410).json({ message: 'This authorization link has already been used' });
    }

    // Check link attempt limit
    if ((authorization.linkAttemptCount || 0) >= 5) {
      return res.status(429).json({ message: 'Too many attempts. Please request a new authorization link.' });
    }

    // Increment link attempts
    await storage.incrementAuthorizationLinkAttempts(authorization.id);

    // Log link click
    await storage.createAuditLogEntry({
      practiceId: authorization.practiceId,
      patientId: authorization.patientId,
      authorizationId: authorization.id,
      actorType: 'patient',
      actorIpAddress: req.ip,
      actorUserAgent: req.get('User-Agent'),
      eventType: 'link_clicked',
      success: true,
    });

    // Get patient and practice info for display
    const patient = await storage.getPatient(authorization.patientId);
    const practice = await storage.getPractice(authorization.practiceId);

    if (!patient || !practice) {
      return res.status(404).json({ message: 'Associated records not found' });
    }

    // Return info needed for authorization page (no sensitive data)
    res.json({
      id: authorization.id,
      status: authorization.status,
      scopes: authorization.scopes,
      practice: {
        name: practice.name,
        logoUrl: practice.brandLogoUrl,
        primaryColor: practice.brandPrimaryColor,
        secondaryColor: practice.brandSecondaryColor,
        phone: practice.phone,
        email: practice.email,
        privacyPolicyUrl: practice.brandPrivacyPolicyUrl,
      },
      patient: {
        firstName: patient.firstName,
      },
      expiresAt: authorization.expiresAt,
    });
  } catch (error) {
    console.error('Error fetching authorization info:', error);
    res.status(500).json({ message: 'Failed to fetch authorization information' });
  }
});

// POST /api/authorize/:token - Submit authorization decision
router.post('/authorize/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { decision, signature } = req.body; // decision: 'authorize' | 'deny'

    const authorization = await storage.getAuthorizationByToken(token);
    if (!authorization) {
      return res.status(404).json({ message: 'Authorization not found' });
    }

    // Validate token hasn't expired
    if (new Date(authorization.tokenExpiresAt) < new Date()) {
      return res.status(410).json({ message: 'This authorization link has expired' });
    }

    // Check if already used
    if (authorization.tokenUsedAt) {
      return res.status(410).json({ message: 'This authorization has already been processed' });
    }

    // Get patient and practice for confirmation email
    const patient = await storage.getPatient(authorization.patientId);
    const practice = await storage.getPractice(authorization.practiceId);

    if (!patient || !practice) {
      return res.status(404).json({ message: 'Associated records not found' });
    }

    const now = new Date();

    if (decision === 'authorize') {
      // Update authorization status
      await storage.updateAuthorizationStatus(authorization.id, {
        status: 'authorized',
        tokenUsedAt: now,
        consentGivenAt: now,
        consentIpAddress: req.ip,
        consentUserAgent: req.get('User-Agent'),
        consentSignature: signature || 'Electronic consent via web form',
      });

      // Log the consent
      await storage.createAuditLogEntry({
        practiceId: authorization.practiceId,
        patientId: authorization.patientId,
        authorizationId: authorization.id,
        actorType: 'patient',
        actorIpAddress: req.ip,
        actorUserAgent: req.get('User-Agent'),
        eventType: 'consent_given',
        eventDetails: {
          scopes: authorization.scopes,
          signature: signature ? 'provided' : 'checkbox',
        },
        success: true,
      });

      // Send confirmation email
      await sendAuthorizationConfirmationEmail(practice, patient, authorization);

      res.json({
        success: true,
        message: 'Thank you! Your authorization has been recorded.',
        status: 'authorized',
      });
    } else if (decision === 'deny') {
      // Update authorization status
      await storage.updateAuthorizationStatus(authorization.id, {
        status: 'denied',
        tokenUsedAt: now,
      });

      // Log the denial
      await storage.createAuditLogEntry({
        practiceId: authorization.practiceId,
        patientId: authorization.patientId,
        authorizationId: authorization.id,
        actorType: 'patient',
        actorIpAddress: req.ip,
        actorUserAgent: req.get('User-Agent'),
        eventType: 'consent_denied',
        success: true,
      });

      res.json({
        success: true,
        message: 'Your decision has been recorded. No data will be accessed.',
        status: 'denied',
      });
    } else {
      return res.status(400).json({ message: 'Invalid decision. Must be "authorize" or "deny"' });
    }
  } catch (error) {
    console.error('Error processing authorization decision:', error);
    res.status(500).json({ message: 'Failed to process your decision' });
  }
});

export default router;
