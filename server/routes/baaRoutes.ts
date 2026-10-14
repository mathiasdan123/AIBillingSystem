import type { Express, Response, NextFunction } from 'express';
import { db } from '../db';
import { baaRecords } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';

// Helper to get practice ID from authenticated user.
//
// The session user object only carries `claims.sub` (see localAuth /
// demo login) — it never contains practiceId or role. Those are attached
// to the request by the isAuthenticated middleware (req.userPracticeId /
// req.userRole) after a DB lookup, so read them from there. Reading them
// off req.user (the old behavior) resolved undefined for every user and
// made GET /api/baa throw → 500 for any non-platform-admin.
function getAuthorizedPracticeId(req: any): number | undefined {
  const userPracticeId =
    req.userPracticeId ?? req.user?.claims?.practiceId ?? req.user?.practiceId;
  const requestedPracticeId = req.query?.practiceId
    ? parseInt(req.query.practiceId as string, 10)
    : undefined;

  // Only a platform (founder) admin may resolve a foreign practice; a
  // practice's own admin is clamped to their own practice.
  if (req.isPlatformAdmin) {
    return requestedPracticeId || userPracticeId || 1;
  }

  return userPracticeId ?? undefined;
}

export function registerBaaRoutes(app: Express) {
  const requireAdmin = async (req: any, res: Response, next: NextFunction) => {
    try {
      const sub = req.user?.claims?.sub || req.user?.id;
      if (!sub) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const user = await storage.getUser(sub);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: admin access required' });
      }
      next();
    } catch (err) {
      return res.status(500).json({ error: 'Failed to verify admin status' });
    }
  };

  // GET /api/baa - List all BAA records for practice
  app.get('/api/baa', isAuthenticated, requireAdmin, async (req: any, res: Response) => {
    try {
      const practiceId = getAuthorizedPracticeId(req);
      // No practice context (e.g. a user not yet assigned to a practice) is a
      // normal empty state for a list endpoint, not an error.
      if (!practiceId) {
        return res.json([]);
      }
      const records = await storage.getBaaRecords(practiceId);
      res.json(records);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch BAA records' });
    }
  });

  // POST /api/baa - Create new BAA record
  app.post('/api/baa', isAuthenticated, requireAdmin, async (req: any, res: Response) => {
    try {
      const practiceId = getAuthorizedPracticeId(req);
      if (!practiceId) {
        return res.status(400).json({ error: 'User not assigned to a practice. Contact administrator.' });
      }
      const record = await storage.createBaaRecord({ ...req.body, practiceId });
      res.status(201).json(record);
    } catch (err) {
      res.status(500).json({ error: 'Failed to create BAA record' });
    }
  });

  // PATCH /api/baa/:id - Update BAA record
  app.patch('/api/baa/:id', isAuthenticated, requireAdmin, async (req: any, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const record = await storage.updateBaaRecord(id, req.body);
      if (!record) {
        return res.status(404).json({ error: 'BAA record not found' });
      }
      res.json(record);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update BAA record' });
    }
  });

  // DELETE /api/baa/:id - Delete BAA record
  app.delete('/api/baa/:id', isAuthenticated, requireAdmin, async (req: any, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      await storage.deleteBaaRecord(id);
      res.json({ message: 'BAA record deleted' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete BAA record' });
    }
  });
}
