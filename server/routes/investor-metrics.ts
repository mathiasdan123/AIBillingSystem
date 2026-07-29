/**
 * Investor Metrics Routes (admin-only)
 *
 * - GET  /api/investor-metrics?days=90  — time series + latest snapshot
 * - POST /api/investor-metrics/backfill — recompute the past N days
 *
 * Global (practiceId 0) rollups over real practices only. The nightly cron
 * writes today's snapshot; GET lazily ensures today exists so the page is
 * never empty on a fresh deploy.
 */

import { Router, type Response, type NextFunction } from 'express';
import { db } from '../db';
import { metricSnapshots } from '@shared/schema';
import { and, eq, gte, asc } from 'drizzle-orm';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import { storeDailySnapshot, backfillSnapshots } from '../services/investorMetricsService';
import logger from '../services/logger';

const router = Router();

const isAdmin = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) return res.status(401).json({ message: 'Unauthorized' });
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }
    next();
  } catch (error) {
    logger.error('investor-metrics admin check failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to verify permissions' });
  }
};

router.get('/', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 90, 1), 365);
    const today = new Date().toISOString().slice(0, 10);

    // Lazily ensure today's snapshot exists (cheap upsert; cron is primary).
    const [todayRow] = await db
      .select({ id: metricSnapshots.id })
      .from(metricSnapshots)
      .where(and(eq(metricSnapshots.practiceId, 0), eq(metricSnapshots.metricDate, today)))
      .limit(1);
    if (!todayRow) await storeDailySnapshot(new Date());

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const rows = await db
      .select({
        metricDate: metricSnapshots.metricDate,
        metric: metricSnapshots.metric,
        value: metricSnapshots.value,
      })
      .from(metricSnapshots)
      .where(and(eq(metricSnapshots.practiceId, 0), gte(metricSnapshots.metricDate, sinceStr)))
      .orderBy(asc(metricSnapshots.metricDate));

    const series: Record<string, Array<{ date: string; value: number }>> = {};
    for (const row of rows) {
      (series[row.metric] ||= []).push({ date: row.metricDate, value: Number(row.value) });
    }
    const latest: Record<string, number> = {};
    for (const [metric, points] of Object.entries(series)) {
      latest[metric] = points[points.length - 1]?.value ?? 0;
    }

    res.json({ days, series, latest });
  } catch (error) {
    logger.error('investor-metrics fetch failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load investor metrics' });
  }
});

router.post('/backfill', isAuthenticated, isAdmin, async (req: any, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.body?.days) || 30, 1), 365);
    const stored = await backfillSnapshots(days);
    res.json({ stored });
  } catch (error) {
    logger.error('investor-metrics backfill failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Backfill failed' });
  }
});

export default router;
