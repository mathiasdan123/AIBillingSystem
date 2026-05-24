/**
 * Cost Dashboard Routes (admin-only)
 *
 * Proxies the Anthropic Organization Admin API to surface:
 *  - GET /api/admin/cost-dashboard/summary  — MTD spend, daily trend, by-model, cache efficiency
 *  - GET /api/admin/cost-dashboard/per-practice — placeholder until per-practice attribution lands
 *
 * Mounted at /api so all paths include their full prefix.
 *
 * The Anthropic key never leaves the server.
 */

import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { fetchCost, fetchMessagesUsage, clearAdminApiCache } from '../services/anthropicAdminApi';
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
    logger.error('cost-dashboard isAdmin check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to verify permissions' });
  }
};

const MONTHLY_BUDGET_USD = Number(process.env.ANTHROPIC_MONTHLY_BUDGET_USD || '500');
const BUDGET_WARN_PCT = Number(process.env.ANTHROPIC_BUDGET_WARN_PCT || '80');

/**
 * Anthropic's cost_report returns `amount` in the report currency (usually
 * USD) as a decimal — we treat it as USD directly. If we ever see non-USD,
 * we log and skip the row rather than silently mixing currencies.
 */
function sumCostUsd(results: Array<{ amount?: number; currency?: string }>): number {
  let total = 0;
  for (const r of results) {
    const amt = Number(r.amount ?? 0);
    if (!Number.isFinite(amt)) continue;
    const cur = (r.currency || 'USD').toUpperCase();
    if (cur !== 'USD') {
      logger.warn('cost-dashboard: skipping non-USD cost row', { currency: cur, amount: amt });
      continue;
    }
    total += amt;
  }
  return total;
}

/** Start-of-month in UTC. */
function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
/** N days ago, at UTC midnight. */
function nDaysAgoUtc(n: number, now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

router.get('/admin/cost-dashboard/summary', isAuthenticated, isAdmin, async (_req, res) => {
  try {
    const now = new Date();
    const monthStart = startOfMonthUtc(now);
    const thirtyDaysAgo = nDaysAgoUtc(30, now);

    // Fetch all four datasets in parallel. Each is cached server-side for 5 min.
    const [mtdCost, dailyCost, modelCost, dailyUsage] = await Promise.all([
      fetchCost({ startingAt: monthStart, endingAt: now }),
      fetchCost({ startingAt: thirtyDaysAgo, endingAt: now }),
      fetchCost({ startingAt: monthStart, endingAt: now, groupBy: ['model'] }),
      fetchMessagesUsage({ startingAt: thirtyDaysAgo, endingAt: now, bucketWidth: '1d' }),
    ]);

    // 1) MTD spend
    const mtdSpendUsd = mtdCost.data.reduce((acc, bucket) => acc + sumCostUsd(bucket.results), 0);
    const usedPct = MONTHLY_BUDGET_USD > 0 ? (mtdSpendUsd / MONTHLY_BUDGET_USD) * 100 : 0;
    const warning = usedPct >= BUDGET_WARN_PCT;

    // 2) Daily spend, last 30 days
    const dailyTrend = dailyCost.data.map((b) => ({
      date: b.starting_at.slice(0, 10),
      usd: Number(sumCostUsd(b.results).toFixed(4)),
    }));

    // 3) Spend by model (MTD)
    const byModelMap = new Map<string, number>();
    for (const bucket of modelCost.data) {
      for (const r of bucket.results) {
        const cur = (r.currency || 'USD').toUpperCase();
        if (cur !== 'USD') continue;
        const model = r.model || 'unknown';
        byModelMap.set(model, (byModelMap.get(model) || 0) + Number(r.amount ?? 0));
      }
    }
    const spendByModel = Array.from(byModelMap.entries())
      .map(([model, usd]) => ({ model, usd: Number(usd.toFixed(4)) }))
      .sort((a, b) => b.usd - a.usd);

    // 4) Cache efficiency over time
    const cacheEfficiency = dailyUsage.data.map((b) => {
      let cacheRead = 0;
      let cacheCreate = 0;
      let uncached = 0;
      for (const r of b.results) {
        cacheRead += r.cache_read_input_tokens ?? 0;
        cacheCreate += r.cache_creation_input_tokens ?? 0;
        uncached += r.uncached_input_tokens ?? 0;
      }
      const denom = cacheRead + cacheCreate + uncached;
      const hitRatePct = denom > 0 ? (cacheRead / denom) * 100 : 0;
      return {
        date: b.starting_at.slice(0, 10),
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreate,
        uncachedInputTokens: uncached,
        hitRatePct: Number(hitRatePct.toFixed(2)),
      };
    });

    res.json({
      generatedAt: now.toISOString(),
      mtd: {
        spendUsd: Number(mtdSpendUsd.toFixed(2)),
        budgetUsd: MONTHLY_BUDGET_USD,
        usedPct: Number(usedPct.toFixed(2)),
        warnPct: BUDGET_WARN_PCT,
        warning,
      },
      dailyTrend,
      spendByModel,
      cacheEfficiency,
      cacheTtlSeconds: 300,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('cost-dashboard summary failed', { error: msg });
    res.status(502).json({ message: 'Failed to load Anthropic cost report', detail: msg });
  }
});

/**
 * Per-practice attribution view.
 *
 * Today: NOT IMPLEMENTED. All call sites use a single shared org key with no
 * metadata or workspace tag, so the Admin Cost/Usage API cannot break spend
 * out per practice. See memory: blanche-prompt-caching-verification and
 * blanche-monetization-plan. Recommended path:
 *   1. Add an `ai_usage_events` table keyed by (practice_id, model, day).
 *    2. Wrap every `messages.create` call with a helper that records token
 *       counts (input/output/cache_read/cache_creation) for that call.
 *    3. Compute estimated $ per practice from a posted price table.
 *    4. Reconcile monthly totals against this endpoint's org-level cost.
 */
router.get('/admin/cost-dashboard/per-practice', isAuthenticated, isAdmin, async (_req, res) => {
  res.json({
    available: false,
    reason:
      'Per-practice attribution is not yet wired. All Anthropic calls share one org key with no per-practice tag, ' +
      'so the Admin Cost API cannot bucket spend per practice. Recommended next step: add an ai_usage_events table ' +
      'and instrument every messages.create call site (currently only ai-assistant.ts logs cache tokens).',
    rows: [],
  });
});

/** Manual cache flush (admin-only) — handy if you just changed pricing or want a fresh poll. */
router.post('/admin/cost-dashboard/refresh', isAuthenticated, isAdmin, async (_req, res) => {
  clearAdminApiCache();
  res.json({ ok: true });
});

export default router;
