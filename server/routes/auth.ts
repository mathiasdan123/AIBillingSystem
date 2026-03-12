/**
 * Authentication and User Management Routes
 *
 * Handles:
 * - /api/auth/user - Get current user
 * - /api/users/* - User management (admin only)
 * - /api/mfa/* - Multi-factor authentication
 * - /api/setup/make-admin - Initial admin setup
 * - /api/invites/* - User invitations (admin only)
 * - /api/therapists/* - Therapist management
 */

import { Router, type Response, type NextFunction } from 'express';
import * as crypto from 'crypto';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { setMfaVerified, clearMfaVerification, MFA_PROTECTED_ROUTES, MFA_CONFIG } from '../middleware/mfa-required';
import { authLimiter } from '../middleware/rate-limiter';
import logger from '../services/logger';

const router = Router();

// Middleware to check if user has admin role
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
    logger.error("Error checking user role", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to verify permissions" });
  }
};

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

// ==================== AUTH ROUTES ====================

// Get current user
router.get('/auth/user', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    // Include mfaRequired flag: true if MFA is not yet set up (all roles must set up MFA)
    const mfaRequired = !user.mfaEnabled;
    res.json({ ...user, mfaRequired });
  } catch (error) {
    logger.error("Error fetching user", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

// ==================== USER MANAGEMENT (Admin Only) ====================

// Get all users
router.get('/users', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const users = await storage.getAllUsers();
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
    logger.error("Error fetching users", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// Update user role
router.patch('/users/:id/role', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['therapist', 'admin', 'billing'].includes(role)) {
      return res.status(400).json({ message: "Invalid role. Must be 'therapist', 'admin', or 'billing'" });
    }

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
    logger.error("Error updating user role", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to update user role" });
  }
});

// ==================== INITIAL SETUP ====================

// Make current user admin (for initial setup only)
router.post('/setup/make-admin', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const allUsers = await storage.getAllUsers();
    const existingAdmin = allUsers.find(u => u.role === 'admin');

    if (existingAdmin) {
      return res.status(400).json({
        message: "An admin already exists. Use the User Management settings to change roles."
      });
    }

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
    logger.error("Error in setup", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to complete setup" });
  }
});

// ==================== MFA ENDPOINTS ====================

router.post('/mfa/setup', isAuthenticated, async (req: any, res) => {
  try {
    const { generateSecret } = await import('../services/mfaService');
    const userId = req.user.claims.sub;
    const user = await storage.getUser(userId);
    const result = generateSecret(user?.email || 'user');
    await storage.updateUserMfa(userId, { mfaSecret: result.secret });
    res.json({ uri: result.uri, backupCodes: result.backupCodes });
  } catch (error) {
    res.status(500).json({ message: 'MFA setup failed' });
  }
});

router.post('/mfa/verify', isAuthenticated, async (req: any, res) => {
  try {
    const { verifyToken } = await import('../services/mfaService');
    const userId = req.user.claims.sub;
    const user = await storage.getUser(userId);
    if (!user?.mfaSecret) return res.status(400).json({ message: 'MFA not set up' });
    const secret = typeof user.mfaSecret === 'string' ? user.mfaSecret : (user.mfaSecret as any).secret || user.mfaSecret;
    if (!verifyToken(secret as string, req.body.token)) {
      return res.status(400).json({ message: 'Invalid token' });
    }
    await storage.updateUserMfa(userId, { mfaEnabled: true });
    setMfaVerified(req.session, userId);
    logger.info('MFA enabled and verified for user', { userId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'MFA verification failed' });
  }
});

router.post('/mfa/disable', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user.claims.sub;
    // MFA is mandatory for HIPAA compliance - only admins can disable for account recovery
    const currentUser = await storage.getUser(userId);
    if (currentUser?.role !== 'admin') {
      return res.status(403).json({
        message: 'MFA is mandatory for HIPAA compliance and cannot be disabled. Contact an administrator for account recovery.',
        code: 'MFA_DISABLE_FORBIDDEN'
      });
    }
    await storage.updateUserMfa(userId, { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: null });
    clearMfaVerification(req.session);
    logger.warn('MFA disabled by admin for account recovery', { userId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: 'Failed to disable MFA' });
  }
});

// Rate limited to prevent brute force attacks on MFA codes
router.post('/mfa/challenge', authLimiter, isAuthenticated, async (req: any, res) => {
  try {
    const { verifyToken, verifyBackupCode } = await import('../services/mfaService');
    const userId = req.user?.claims?.sub;
    const { token, backupCode } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const user = await storage.getUser(userId);
    if (!user?.mfaEnabled || !user?.mfaSecret) {
      return res.status(400).json({ message: 'MFA not enabled' });
    }
    const secret = typeof user.mfaSecret === 'string' ? user.mfaSecret : (user.mfaSecret as any).secret || user.mfaSecret;
    if (token) {
      if (!verifyToken(secret as string, token)) {
        logger.warn('MFA challenge failed: Invalid token', { userId });
        return res.status(400).json({ message: 'Invalid token' });
      }
    } else if (backupCode) {
      const codes = (user.mfaBackupCodes as string[]) || [];
      if (!verifyBackupCode(backupCode, codes)) {
        logger.warn('MFA challenge failed: Invalid backup code', { userId });
        return res.status(400).json({ message: 'Invalid backup code' });
      }
    } else {
      return res.status(400).json({ message: 'Token or backup code required' });
    }

    setMfaVerified(req.session, userId);
    logger.info('MFA challenge completed successfully', {
      userId,
      method: token ? 'totp' : 'backup_code',
      sessionTimeout: MFA_CONFIG.sessionTimeoutMinutes + ' minutes'
    });

    res.json({
      success: true,
      sessionExpiresIn: MFA_CONFIG.sessionTimeout,
      sessionExpiresInMinutes: MFA_CONFIG.sessionTimeoutMinutes
    });
  } catch (error) {
    logger.error('MFA challenge error', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'MFA challenge failed' });
  }
});

// MFA status endpoint
router.get('/mfa/status', isAuthenticated, async (req: any, res) => {
  try {
    const { getMfaSessionTimeRemaining, isMfaSessionValid } = await import('../middleware/mfa-required');
    const userId = req.user?.claims?.sub;
    const user = await storage.getUser(userId);

    const sessionValid = isMfaSessionValid(req.session, userId);
    const timeRemaining = getMfaSessionTimeRemaining(req.session);

    res.json({
      mfaEnabled: user?.mfaEnabled || false,
      sessionValid,
      timeRemainingMs: timeRemaining,
      timeRemainingMinutes: Math.ceil(timeRemaining / 60000),
      protectedRoutes: MFA_PROTECTED_ROUTES,
      sessionTimeoutMinutes: MFA_CONFIG.sessionTimeoutMinutes
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to get MFA status' });
  }
});

// ==================== INVITES (Admin Only) ====================

router.post('/invites', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    const { email, role, practiceId } = req.body;
    const invitedById = req.user?.claims?.sub;

    logger.info("Creating invite for:", { email, role, practiceId, invitedById });

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Please enter a valid email address" });
    }

    if (role && !['therapist', 'admin', 'billing'].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    if (!invitedById) {
      return res.status(400).json({ message: "Could not determine inviter ID" });
    }

    if (!practiceId) {
      return res.status(400).json({ message: "Practice ID is required for invites" });
    }

    const allUsers = await storage.getAllUsers();
    const existingUser = allUsers.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (existingUser) {
      return res.status(400).json({ message: "A user with this email already exists" });
    }

    const existingInvite = await storage.getInviteByEmail(email);
    if (existingInvite) {
      return res.status(400).json({ message: "An invite has already been sent to this email" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const inviteData = {
      email: email.trim(),
      role: role || 'therapist',
      practiceId,
      invitedById,
      token,
      expiresAt,
      status: 'pending',
    };

    logger.info("Invite data to insert:", inviteData);
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
    logger.error("Error creating invite", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to create invite" });
  }
});

router.get('/invites', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const invites = await storage.getInvitesByPractice(practiceId);
    res.json(invites);
  } catch (error) {
    logger.error("Error fetching invites", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch invites" });
  }
});

router.get('/invites/:token', async (req, res) => {
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
    logger.error("Error fetching invite", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch invite" });
  }
});

router.post('/invites/:token/accept', isAuthenticated, async (req: any, res) => {
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

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await storage.updateUserRole(userId, invite.role || 'therapist');
    await storage.updateInviteStatus(invite.id, 'accepted', new Date());

    res.json({
      message: "Invite accepted successfully",
      role: invite.role
    });
  } catch (error) {
    logger.error("Error accepting invite", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to accept invite" });
  }
});

// ==================== THERAPIST MANAGEMENT ====================

router.get('/therapists', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const therapists = await storage.getTherapistsByPractice(practiceId);

    const therapistData = therapists.map(t => ({
      id: t.id,
      email: t.email,
      firstName: t.firstName,
      lastName: t.lastName,
      credentials: t.credentials,
      licenseNumber: t.licenseNumber,
      npiNumber: t.npiNumber,
      hasSignature: !!t.digitalSignature,
      signatureUploadedAt: t.signatureUploadedAt,
      role: t.role,
      createdAt: t.createdAt
    }));

    res.json(therapistData);
  } catch (error) {
    logger.error("Error fetching therapists", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch therapists" });
  }
});

router.patch('/therapists/:id', isAuthenticated, async (req: any, res) => {
  try {
    const therapistId = req.params.id;
    const currentUserId = req.user?.claims?.sub;
    const userRole = req.userRole;

    if (therapistId !== currentUserId && userRole !== 'admin') {
      return res.status(403).json({ message: "Can only edit your own profile" });
    }

    const { credentials, licenseNumber, npiNumber, digitalSignature } = req.body;

    const updates: any = {};
    if (credentials !== undefined) updates.credentials = credentials;
    if (licenseNumber !== undefined) updates.licenseNumber = licenseNumber;
    if (npiNumber !== undefined) updates.npiNumber = npiNumber;
    if (digitalSignature !== undefined) {
      updates.digitalSignature = digitalSignature;
      updates.signatureUploadedAt = new Date();
    }

    const updatedUser = await storage.updateUser(therapistId, updates);
    if (!updatedUser) {
      return res.status(404).json({ message: "Therapist not found" });
    }

    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      credentials: updatedUser.credentials,
      licenseNumber: updatedUser.licenseNumber,
      npiNumber: updatedUser.npiNumber,
      hasSignature: !!updatedUser.digitalSignature,
      signatureUploadedAt: updatedUser.signatureUploadedAt
    });
  } catch (error) {
    logger.error("Error updating therapist", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to update therapist" });
  }
});

router.get('/therapists/:id/signature', isAuthenticated, async (req: any, res) => {
  try {
    const therapistId = req.params.id;
    const user = await storage.getUser(therapistId);

    if (!user || !user.digitalSignature) {
      return res.status(404).json({ message: "Signature not found" });
    }

    res.json({
      signature: user.digitalSignature,
      name: `${user.firstName} ${user.lastName}`,
      credentials: user.credentials
    });
  } catch (error) {
    logger.error("Error fetching signature", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch signature" });
  }
});

router.post('/therapists', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { email, firstName, lastName, credentials, licenseNumber, npiNumber } = req.body;

    if (!email || !firstName || !lastName) {
      return res.status(400).json({ message: "Email, first name, and last name are required" });
    }

    const id = `therapist-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const newTherapist = await storage.upsertUser({
      id,
      email,
      firstName,
      lastName,
      practiceId,
      role: 'therapist',
      credentials,
      licenseNumber,
      npiNumber
    });

    res.status(201).json({
      id: newTherapist.id,
      email: newTherapist.email,
      firstName: newTherapist.firstName,
      lastName: newTherapist.lastName,
      credentials: newTherapist.credentials,
      licenseNumber: newTherapist.licenseNumber,
      npiNumber: newTherapist.npiNumber,
      hasSignature: false
    });
  } catch (error) {
    logger.error("Error creating therapist", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to create therapist" });
  }
});

export default router;
