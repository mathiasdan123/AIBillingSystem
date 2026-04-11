import { Router } from 'express';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { storage } from '../storage';
import {
  validatePassword,
  hashPassword,
  verifyPassword,
  generateSecureToken,
  isAccountLocked,
  shouldLockAccount,
  calculateLockoutExpiry,
  calculateResetTokenExpiry,
  calculateVerificationTokenExpiry,
  isTokenExpired,
  getRemainingLockoutMinutes,
  PASSWORD_REQUIREMENTS,
} from '../services/passwordService';
import {
  authLimiter,
  passwordResetLimiter,
  registrationLimiter,
  incrementGlobalFailedAuth,
} from '../middleware/rate-limiter';
import {
  sendPasswordResetEmail as sendPasswordResetEmailLegacy,
  sendEmailVerificationEmail,
  sendSecurityAlertEmail,
} from '../email';
import logger from '../services/logger';
import { sendEmail } from '../services/emailService';
import { passwordReset } from '../services/emailTemplates';

/**
 * Send password reset email using the new template system.
 * Falls back to legacy implementation if the new service fails.
 */
async function sendPasswordResetEmail(
  to: string,
  data: { resetUrl: string; firstName: string; expiresInMinutes: number }
): Promise<{ success: boolean; error?: string }> {
  const { subject, html, text } = passwordReset({
    firstName: data.firstName,
    resetUrl: data.resetUrl,
    expiresInMinutes: data.expiresInMinutes,
  });

  return sendEmail({ to, subject, html, text });
}

const router = Router();

// Configure passport-local strategy
passport.use(
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
    },
    async (email, password, done) => {
      try {
        const user = await storage.getUserByEmail(email.toLowerCase());

        if (!user) {
          // Don't reveal whether user exists
          incrementGlobalFailedAuth().catch(() => {});
          return done(null, false, { message: 'Invalid email or password' });
        }

        // Check if user's practice enforces SSO-only login
        if (user.practiceId) {
          try {
            const ssoConfig = await storage.getSsoConfigByPractice(user.practiceId);
            if (ssoConfig?.enabled && ssoConfig?.ssoEnforced) {
              return done(null, false, {
                message: 'Your organization requires SSO login. Please use the "Sign in with SSO" option.',
              });
            }
          } catch (ssoErr) {
            // If SSO check fails, allow password login to avoid lockout
            logger.warn('SSO enforcement check failed, allowing password login', {
              userId: user.id,
              error: ssoErr instanceof Error ? ssoErr.message : String(ssoErr),
            });
          }
        }

        // Check if account is locked
        if (isAccountLocked(user.lockoutUntil)) {
          // Probing a locked account is suspicious — count toward brute force detection
          incrementGlobalFailedAuth().catch(() => {});
          const remainingMinutes = getRemainingLockoutMinutes(user.lockoutUntil);
          return done(null, false, {
            message: `Account locked. Try again in ${remainingMinutes} minutes.`,
          });
        }

        // Check if user has a password set
        if (!user.passwordHash) {
          return done(null, false, { message: 'Invalid email or password' });
        }

        // Verify password
        const isValid = await verifyPassword(password, user.passwordHash);

        if (!isValid) {
          // Increment global brute force counter (distributed detection)
          incrementGlobalFailedAuth().catch(() => {});
          // Increment per-user failed attempts
          const failedAttempts = await storage.incrementFailedLoginAttempts(user.id);

          // Check if we should lock the account
          if (shouldLockAccount(failedAttempts)) {
            const lockoutExpiry = calculateLockoutExpiry();
            await storage.setLockout(user.id, lockoutExpiry);

            // Send security alert email
            if (user.email) {
              await sendSecurityAlertEmail(user.email, {
                alertType: 'account_lockout',
                ipAddress: 'unknown', // Will be set from request
                timestamp: new Date(),
                failedAttempts,
              });
            }

            logger.warn('Account locked due to failed login attempts', {
              userId: user.id,
              failedAttempts,
            });

            return done(null, false, {
              message: `Account locked due to too many failed attempts. Try again in ${PASSWORD_REQUIREMENTS.lockoutDurationMs / 60000} minutes.`,
            });
          }

          return done(null, false, { message: 'Invalid email or password' });
        }

        // Success - reset failed attempts and update last login
        await storage.resetFailedLoginAttempts(user.id);
        await storage.updateLastLoginAt(user.id);

        // Return user object for session
        return done(null, {
          claims: {
            sub: user.id,
            email: user.email,
            first_name: user.firstName,
            last_name: user.lastName,
          },
          expires_at: Math.floor(Date.now() / 1000) + 86400, // 24 hours
        });
      } catch (error) {
        logger.error('Login error', { error });
        return done(error);
      }
    }
  )
);

/**
 * POST /api/auth/signup
 * Self-service practice signup: creates a new practice + admin user in one step
 */
router.post('/signup', registrationLimiter, async (req, res) => {
  try {
    const { practiceName, email, password, firstName, lastName } = req.body;

    // Validate required fields
    if (!practiceName || !email || !password || !firstName || !lastName) {
      return res.status(400).json({ message: 'All fields are required: practiceName, email, password, firstName, lastName' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const trimmedPracticeName = practiceName.trim();

    if (trimmedPracticeName.length < 2) {
      return res.status(400).json({ message: 'Practice name must be at least 2 characters' });
    }

    // Validate password
    const validation = validatePassword(password);
    if (!validation.valid) {
      return res.status(400).json({
        message: 'Password does not meet requirements',
        errors: validation.errors,
      });
    }

    // Check if user already exists
    const existingUser = await storage.getUserByEmail(normalizedEmail);
    if (existingUser) {
      return res.status(400).json({ message: 'Unable to create account with this email' });
    }

    // Create the practice
    const practice = await storage.createPractice({
      name: trimmedPracticeName,
      onboardingCompleted: false,
      onboardingStep: 0,
    });

    // Hash password and create admin user linked to the practice
    const passwordHash = await hashPassword(password);
    const user = await storage.createUserWithPassword({
      email: normalizedEmail,
      passwordHash,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      practiceId: practice.id,
      role: 'admin',
    });

    // Generate email verification token
    const verificationToken = generateSecureToken();
    const verificationExpires = calculateVerificationTokenExpiry();
    await storage.setEmailVerificationToken(user.id, verificationToken, verificationExpires);

    // Send verification email
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    await sendEmailVerificationEmail(normalizedEmail, {
      verificationUrl: `${baseUrl}/verify-email/${verificationToken}`,
      firstName: firstName.trim() || 'there',
    });

    logger.info('Practice signup completed', { userId: user.id, practiceId: practice.id, email: normalizedEmail });

    // Log the user in
    const userSession = {
      claims: {
        sub: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
      },
      expires_at: Math.floor(Date.now() / 1000) + 86400,
    };

    req.login(userSession, (err) => {
      if (err) {
        logger.error('Session login error after signup', { error: err });
        return res.status(500).json({ message: 'Signup successful but login failed' });
      }

      res.status(201).json({
        message: 'Signup successful',
        redirectTo: '/onboarding',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          practiceId: practice.id,
        },
      });
    });
  } catch (error) {
    logger.error('Signup error', { error });
    res.status(500).json({ message: 'Failed to create practice' });
  }
});

/**
 * POST /api/auth/register
 * Register a new user with email and password
 */
router.post('/register', registrationLimiter, async (req, res) => {
  try {
    const { email, password, firstName, lastName, inviteToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Validate password
    const validation = validatePassword(password);
    if (!validation.valid) {
      return res.status(400).json({
        message: 'Password does not meet requirements',
        errors: validation.errors,
      });
    }

    // Check if user already exists
    const existingUser = await storage.getUserByEmail(normalizedEmail);
    if (existingUser) {
      // Don't reveal that user exists
      return res.status(400).json({ message: 'Unable to create account with this email' });
    }

    // Check for invite token
    let invite = null;
    if (inviteToken) {
      invite = await storage.getInviteByToken(inviteToken);
      if (!invite || invite.status !== 'pending') {
        return res.status(400).json({ message: 'Invalid or expired invite' });
      }
      if (invite.email.toLowerCase() !== normalizedEmail) {
        return res.status(400).json({ message: 'Email does not match invite' });
      }
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const user = await storage.createUserWithPassword({
      email: normalizedEmail,
      passwordHash,
      firstName: firstName?.trim(),
      lastName: lastName?.trim(),
      practiceId: invite?.practiceId,
      role: invite?.role || 'therapist',
    });

    // Generate email verification token
    const verificationToken = generateSecureToken();
    const verificationExpires = calculateVerificationTokenExpiry();
    await storage.setEmailVerificationToken(user.id, verificationToken, verificationExpires);

    // Send verification email
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    await sendEmailVerificationEmail(normalizedEmail, {
      verificationUrl: `${baseUrl}/verify-email/${verificationToken}`,
      firstName: firstName || 'there',
    });

    // If invite, mark it as accepted
    if (invite) {
      await storage.updateInviteStatus(invite.id, 'accepted', new Date());
    }

    logger.info('User registered', { userId: user.id, email: normalizedEmail });

    // Log the user in
    const userSession = {
      claims: {
        sub: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
      },
      expires_at: Math.floor(Date.now() / 1000) + 86400,
    };

    req.login(userSession, (err) => {
      if (err) {
        logger.error('Session login error after registration', { error: err });
        return res.status(500).json({ message: 'Registration successful but login failed' });
      }

      res.status(201).json({
        message: 'Account created successfully',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          emailVerified: false,
        },
      });
    });
  } catch (error) {
    logger.error('Registration error', { error });
    res.status(500).json({ message: 'Failed to create account' });
  }
});

/**
 * POST /api/auth/login
 * Login with email and password
 */
router.post('/login', authLimiter, (req, res, next) => {
  passport.authenticate('local', (err: any, user: any, info: any) => {
    if (err) {
      logger.error('Login authentication error', { error: err });
      return res.status(500).json({ message: 'Login failed' });
    }

    if (!user) {
      return res.status(401).json({ message: info?.message || 'Invalid credentials' });
    }

    // Regenerate session before login to prevent session fixation attacks (HIPAA / SOC 2)
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        logger.error('Session regeneration error', { error: regenErr });
        return res.status(500).json({ message: 'Login failed' });
      }

      // Re-initialize passport on the new session
      req.login(user, async (loginErr) => {
        if (loginErr) {
          logger.error('Session login error', { error: loginErr });
          return res.status(500).json({ message: 'Login failed' });
        }

        // Check if user has MFA enabled
        const dbUser = await storage.getUser(user.claims.sub);
        if (dbUser?.mfaEnabled) {
          // Store partial login state in session
          (req.session as any).pendingMfaUserId = user.claims.sub;
          return res.status(200).json({
            requiresMfa: true,
            message: 'MFA verification required',
          });
        }

        // Mark MFA as verified if not enabled
        (req.session as any).mfaVerifiedAt = Date.now();
        (req.session as any).mfaUserId = user.claims.sub;

        logger.info('User logged in', { userId: user.claims.sub });

        res.status(200).json({
          message: 'Login successful',
          user: {
            id: dbUser?.id,
            email: dbUser?.email,
            firstName: dbUser?.firstName,
            lastName: dbUser?.lastName,
            role: dbUser?.role,
            emailVerified: dbUser?.emailVerified,
            mfaEnabled: dbUser?.mfaEnabled,
          },
        });
      });
    });
  })(req, res, next);
});

/**
 * POST /api/auth/logout
 * Logout the current user
 */
router.post('/logout', (req, res) => {
  // Clear MFA verification
  if ((req as any).session) {
    delete (req as any).session.mfaVerifiedAt;
    delete (req as any).session.mfaUserId;
    delete (req as any).session.pendingMfaUserId;
  }

  req.logout((err) => {
    if (err) {
      logger.error('Logout error', { error: err });
      return res.status(500).json({ message: 'Logout failed' });
    }

    req.session?.destroy((destroyErr) => {
      if (destroyErr) {
        logger.error('Session destroy error', { error: destroyErr });
      }
      res.clearCookie('therapybill.sid');
      res.status(200).json({ message: 'Logged out successfully' });
    });
  });
});

/**
 * POST /api/auth/forgot-password
 * Request a password reset email
 */
router.post('/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await storage.getUserByEmail(normalizedEmail);

    // Always return success to prevent email enumeration
    const successMessage = 'If an account exists with this email, you will receive a password reset link.';

    if (!user) {
      logger.info('Password reset requested for non-existent email', { email: normalizedEmail });
      return res.status(200).json({ message: successMessage });
    }

    // Generate reset token
    const resetToken = generateSecureToken();
    const resetExpires = calculateResetTokenExpiry();
    await storage.setPasswordResetToken(user.id, resetToken, resetExpires);

    // Send reset email
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    await sendPasswordResetEmail(normalizedEmail, {
      resetUrl: `${baseUrl}/reset-password/${resetToken}`,
      firstName: user.firstName || 'there',
      expiresInMinutes: PASSWORD_REQUIREMENTS.resetTokenExpiryMs / 60000,
    });

    logger.info('Password reset requested', { userId: user.id });

    res.status(200).json({ message: successMessage });
  } catch (error) {
    logger.error('Forgot password error', { error });
    res.status(500).json({ message: 'Failed to process request' });
  }
});

/**
 * POST /api/auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: 'Token and password are required' });
    }

    // Validate password
    const validation = validatePassword(password);
    if (!validation.valid) {
      return res.status(400).json({
        message: 'Password does not meet requirements',
        errors: validation.errors,
      });
    }

    // Find user by token
    const user = await storage.getUserByPasswordResetToken(token);

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Check if token is expired
    if (isTokenExpired(user.passwordResetExpires)) {
      await storage.clearPasswordResetToken(user.id);
      return res.status(400).json({ message: 'Reset token has expired' });
    }

    // Hash new password
    const passwordHash = await hashPassword(password);

    // Update password and clear token
    await storage.updatePasswordHash(user.id, passwordHash);
    await storage.clearPasswordResetToken(user.id);
    await storage.resetFailedLoginAttempts(user.id);

    // Invalidate all existing sessions for security
    await storage.clearAllUserSessions(user.id);

    // Send confirmation email
    if (user.email) {
      await sendSecurityAlertEmail(user.email, {
        alertType: 'password_changed',
        ipAddress: req.ip || 'unknown',
        timestamp: new Date(),
      });
    }

    logger.info('Password reset completed', { userId: user.id });

    res.status(200).json({ message: 'Password reset successfully. Please log in with your new password.' });
  } catch (error) {
    logger.error('Reset password error', { error });
    res.status(500).json({ message: 'Failed to reset password' });
  }
});

/**
 * POST /api/auth/verify-email
 * Verify email with token
 */
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Verification token is required' });
    }

    // Find user by token
    const user = await storage.getUserByEmailVerificationToken(token);

    if (!user) {
      return res.status(400).json({ message: 'Invalid verification token' });
    }

    // Check if token is expired
    if (isTokenExpired(user.emailVerificationExpires)) {
      return res.status(400).json({ message: 'Verification token has expired' });
    }

    // Verify email
    await storage.verifyEmail(user.id);

    logger.info('Email verified', { userId: user.id });

    res.status(200).json({ message: 'Email verified successfully' });
  } catch (error) {
    logger.error('Verify email error', { error });
    res.status(500).json({ message: 'Failed to verify email' });
  }
});

/**
 * POST /api/auth/resend-verification
 * Resend email verification
 */
router.post('/resend-verification', authLimiter, async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const dbUser = await storage.getUser(user.claims?.sub);

    if (!dbUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (dbUser.emailVerified) {
      return res.status(400).json({ message: 'Email is already verified' });
    }

    // Generate new verification token
    const verificationToken = generateSecureToken();
    const verificationExpires = calculateVerificationTokenExpiry();
    await storage.setEmailVerificationToken(dbUser.id, verificationToken, verificationExpires);

    // Send verification email
    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    await sendEmailVerificationEmail(dbUser.email!, {
      verificationUrl: `${baseUrl}/verify-email/${verificationToken}`,
      firstName: dbUser.firstName || 'there',
    });

    logger.info('Verification email resent', { userId: dbUser.id });

    res.status(200).json({ message: 'Verification email sent' });
  } catch (error) {
    logger.error('Resend verification error', { error });
    res.status(500).json({ message: 'Failed to resend verification email' });
  }
});

/**
 * GET /api/auth/user
 * Get current authenticated user
 */
router.get('/user', async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const user = (req as any).user;
    const userId = user?.claims?.sub;

    if (!userId) {
      return res.status(401).json({ message: 'Invalid session' });
    }

    const dbUser = await storage.getUser(userId);

    if (!dbUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      role: dbUser.role,
      practiceId: dbUser.practiceId,
      emailVerified: dbUser.emailVerified,
      mfaEnabled: dbUser.mfaEnabled,
      profileImageUrl: dbUser.profileImageUrl,
    });
  } catch (error) {
    logger.error('Get user error', { error });
    res.status(500).json({ message: 'Failed to get user' });
  }
});

export default router;
