/**
 * Demo-practice MFA exemption
 *
 * The public "Try Free Demo" button signs visitors in as a shared demo
 * account bound to the isolated demo practice (practices.isDemo = true,
 * provisioned by services/demoPractice.ts). That practice holds only
 * seeded, fictional data, so the HIPAA 164.312(d) rationale for MFA does
 * not apply there, and requiring it breaks the demo whenever the shared
 * account's enrollment lapses.
 *
 * That happened in production: the 2026-10-26 mfaSecret encryption fix
 * force-reset every enrollment, demo@therapybill.com included, and from then
 * until 2026-11-04 every prospect who clicked Try Free Demo met the
 * "Set Up Two-Factor Authentication" wall instead of the dashboard. It was
 * only unblocked when an admin happened to re-enroll that account by hand.
 *
 * Both MFA gates (mfa-setup-required, mfa-required) consult this helper and
 * skip enforcement for demo-practice users. Platform admins are never
 * exempt, whatever practice they are attached to.
 */

import { storage } from '../storage';
import logger from '../services/logger';
import { isPlatformAdminEmail } from '../services/platformAdmin';

const CACHE_TTL_MS = 5 * 60 * 1000;
const demoFlagCache = new Map<number, { isDemo: boolean; expiresAt: number }>();

/** Test hook: drop cached practice flags. */
export function clearDemoPracticeCache(): void {
  demoFlagCache.clear();
}

async function isDemoPractice(practiceId: number): Promise<boolean> {
  const now = Date.now();
  const cached = demoFlagCache.get(practiceId);
  if (cached && cached.expiresAt > now) return cached.isDemo;

  const practice = await storage.getPractice(practiceId);
  const isDemo = practice?.isDemo === true;
  demoFlagCache.set(practiceId, { isDemo, expiresAt: now + CACHE_TTL_MS });
  return isDemo;
}

/**
 * True when MFA enforcement should be skipped for this user because they
 * belong to the demo practice. Fails CLOSED: any lookup error means "not
 * exempt", so a database hiccup can never widen access to a real practice.
 */
export async function isMfaExemptDemoUser(
  dbUser: { practiceId?: number | null; email?: string | null } | null | undefined,
): Promise<boolean> {
  if (!dbUser?.practiceId) return false;
  if (isPlatformAdminEmail(dbUser.email)) return false;
  try {
    return await isDemoPractice(dbUser.practiceId);
  } catch (error) {
    logger.warn('Demo-practice MFA exemption lookup failed; enforcing MFA', {
      practiceId: dbUser.practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
