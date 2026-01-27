import type { Express, Response, NextFunction } from 'express';
import { db } from '../db';
import { baaRecords } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { isAuthenticated } from '../supabaseAuth';
import { storage } from '../storage';

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
      const practiceId = 1;
      const records = await storage.getBaaRecords(practiceId);
      res.json(records);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch BAA records' });
    }
  });

  // POST /api/baa - Create new BAA record
  app.post('/api/baa', isAuthenticated, requireAdmin, async (req: any, res: Response) => {
    try {
      const practiceId = 1;
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
