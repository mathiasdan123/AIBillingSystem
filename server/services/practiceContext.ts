import type { Request } from 'express';
import { storage } from '../storage';

export interface PracticeContext {
  userId: string;
  practiceId: number;
  role: string;
}

export async function getUserPracticeContext(req: Request): Promise<PracticeContext | null> {
  const user = (req as any).user;
  const userId = user?.claims?.sub || user?.id;

  if (!userId) return null;

  const dbUser = await storage.getUser(userId);
  if (!dbUser) return null;

  return {
    userId: dbUser.id,
    practiceId: dbUser.practiceId || 1, // Default practice
    role: dbUser.role || 'therapist',
  };
}
