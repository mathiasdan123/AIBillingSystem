import * as argon2 from 'argon2';
import crypto from 'crypto';

// HIPAA-compliant password requirements
export const PASSWORD_REQUIREMENTS = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
  maxFailedAttempts: 5,
  lockoutDurationMs: 15 * 60 * 1000, // 15 minutes
  resetTokenExpiryMs: 60 * 60 * 1000, // 1 hour
  verificationTokenExpiryMs: 24 * 60 * 60 * 1000, // 24 hours
};

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates password against HIPAA-compliant requirements
 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < PASSWORD_REQUIREMENTS.minLength) {
    errors.push(`Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`);
  }

  if (PASSWORD_REQUIREMENTS.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (PASSWORD_REQUIREMENTS.requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (PASSWORD_REQUIREMENTS.requireNumber && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (PASSWORD_REQUIREMENTS.requireSpecial && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Hash a password using Argon2id (OWASP recommended)
 * Uses memory-hard settings for maximum security
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MiB
    timeCost: 3,
    parallelism: 4,
  });
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Generate a secure random token for password reset or email verification
 * Uses 64 bytes (512 bits) for high security
 */
export function generateSecureToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

/**
 * Check if an account is currently locked out
 */
export function isAccountLocked(lockoutUntil: Date | null): boolean {
  if (!lockoutUntil) return false;
  return new Date() < new Date(lockoutUntil);
}

/**
 * Calculate lockout expiration time
 */
export function calculateLockoutExpiry(): Date {
  return new Date(Date.now() + PASSWORD_REQUIREMENTS.lockoutDurationMs);
}

/**
 * Calculate password reset token expiration time
 */
export function calculateResetTokenExpiry(): Date {
  return new Date(Date.now() + PASSWORD_REQUIREMENTS.resetTokenExpiryMs);
}

/**
 * Calculate email verification token expiration time
 */
export function calculateVerificationTokenExpiry(): Date {
  return new Date(Date.now() + PASSWORD_REQUIREMENTS.verificationTokenExpiryMs);
}

/**
 * Check if a reset or verification token has expired
 */
export function isTokenExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return true;
  return new Date() > new Date(expiresAt);
}

/**
 * Check if the number of failed attempts should trigger a lockout
 */
export function shouldLockAccount(failedAttempts: number): boolean {
  return failedAttempts >= PASSWORD_REQUIREMENTS.maxFailedAttempts;
}

/**
 * Get remaining lockout time in minutes
 */
export function getRemainingLockoutMinutes(lockoutUntil: Date | null): number {
  if (!lockoutUntil) return 0;
  const remaining = new Date(lockoutUntil).getTime() - Date.now();
  return Math.max(0, Math.ceil(remaining / (60 * 1000)));
}
