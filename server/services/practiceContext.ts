import type { Request } from 'express';
import { storage } from '../storage';

export interface PracticeContext {
  userId: string;
  practiceId: number;
  role: string;
  /**
   * True when this is one of the shared "Try Demo" accounts (demo@therapybill.com,
   * reviewer1@demo.com, reviewer2@demo.com). Multiple visitors all log in as the
   * same demo user, so anything keyed on userId (chat history, preferences, etc.)
   * leaks between them unless the caller explicitly opts out.
   */
  isDemoUser: boolean;
}

// Kept in sync with DEMO_ACCOUNTS in server/routes/auth.ts. Lowercase only.
const DEMO_USER_EMAILS = new Set<string>([
  'demo@therapybill.com',
  'reviewer1@demo.com',
  'reviewer2@demo.com',
]);

export async function getUserPracticeContext(req: Request): Promise<PracticeContext | null> {
  const user = (req as any).user;
  const userId = user?.claims?.sub || user?.id;

  if (!userId) return null;

  const dbUser = await storage.getUser(userId);
  if (!dbUser) return null;

  // Fail closed: a user with no practice must NOT silently fall through to
  // practice 1 (a real practice). Callers treat null as "no context" and 403.
  if (!dbUser.practiceId) return null;

  const email = (dbUser.email || '').toLowerCase();

  return {
    userId: dbUser.id,
    practiceId: dbUser.practiceId,
    role: dbUser.role || 'therapist',
    isDemoUser: DEMO_USER_EMAILS.has(email),
  };
}
