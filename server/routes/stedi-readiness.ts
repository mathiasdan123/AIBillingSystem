/**
 * Stedi Readiness Dashboard
 *
 * Admin-only single-screen view of "how close is this practice to going
 * live on Stedi end-to-end?" Surfaces the three things that previously
 * lived only in someone's head:
 *
 *   1. API key environment — test (sandbox) vs production. Detected from
 *      the key prefix ("test_" = sandbox, anything else = prod).
 *   2. Payer enrollment status, grouped by transaction type
 *      (eligibility / claims / era). Reads from the existing
 *      payer_enrollments table.
 *   3. Recent activity — last 7 days of eligibility checks (270/271),
 *      claim submissions (837), and remittance receipts (835). Confirms
 *      the wire is actually carrying traffic, not just that we *could*.
 *
 * The dashboard is deliberately read-only. Mutating enrollment state
 * happens elsewhere (payer-enrollments routes); this is the "where are
 * we?" view.
 */
import { Router, type Response, type NextFunction } from 'express';
import { and, eq, gte, sql, desc } from 'drizzle-orm';
import { storage } from '../storage';
import { db } from '../db';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import {
  payerEnrollments,
  eligibilityChecks,
  claims,
  remittanceAdvice,
} from '@shared/schema';

const router = Router();

// Same pattern as other admin-only routers; kept inline so this file is
// self-contained for the readiness scope.
const isAdmin = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) return res.status(401).json({ message: 'Unauthorized' });
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || (user.role !== 'admin' && user.role !== 'billing')) {
      return res.status(403).json({ message: 'Access denied. Admin or billing role required.' });
    }
    (req as any).currentUser = user;
    next();
  } catch (error) {
    logger.error('stedi-readiness: failed role check', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to verify permissions' });
  }
};

const getPracticeId = (req: any): number => {
  return (
    req.authorizedPracticeId ??
    req.userPracticeId ??
    (req as any).currentUser?.practiceId
  );
};

/**
 * Classify a Stedi key string into 'production' / 'test' / 'unknown'.
 * Stedi test keys start with "test_". Anything else with content is
 * treated as production. Empty / missing returns 'unknown' (and the
 * route flags it as a blocker).
 */
function classifyKeyEnvironment(key: string | null | undefined): 'production' | 'test' | 'unknown' {
  if (!key || typeof key !== 'string' || key.trim().length === 0) return 'unknown';
  if (key.startsWith('test_')) return 'test';
  return 'production';
}

type EnrollmentBucket = { enrolled: number; pending: number; not_enrolled: number; rejected: number };
function emptyBucket(): EnrollmentBucket {
  return { enrolled: 0, pending: 0, not_enrolled: 0, rejected: 0 };
}

router.get('/', isAuthenticated, isAdmin, async (req: any, res: Response) => {
  try {
    const practiceId = getPracticeId(req);
    if (!practiceId) {
      return res.status(400).json({ message: 'No authorized practice for this user' });
    }

    const practice = await storage.getPractice(practiceId);

    // ── 1. API key ────────────────────────────────────────────────────
    // Practice-level key wins over env (matches stediService.ts behavior).
    // Never return the key itself — only the environment classification.
    let keySource: 'practice' | 'env' | 'none' = 'none';
    let keyEnvironment: 'production' | 'test' | 'unknown' = 'unknown';
    if (practice?.stediApiKey) {
      keySource = 'practice';
      // stediApiKey may be encrypted; we only need the prefix. If the
      // prefix isn't readable plain-text we mark as 'unknown' rather
      // than try to decrypt for a UI signal.
      const raw = typeof practice.stediApiKey === 'string' ? practice.stediApiKey : '';
      keyEnvironment = classifyKeyEnvironment(raw);
    } else if (process.env.STEDI_API_KEY) {
      keySource = 'env';
      keyEnvironment = classifyKeyEnvironment(process.env.STEDI_API_KEY);
    }
    const apiKey = {
      present: keySource !== 'none',
      source: keySource,
      environment: keyEnvironment,
    };

    // ── 2. Payer enrollments ──────────────────────────────────────────
    const enrollmentRows = await db
      .select({
        transactionType: payerEnrollments.transactionType,
        status: payerEnrollments.status,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(payerEnrollments)
      .where(eq(payerEnrollments.practiceId, practiceId))
      .groupBy(payerEnrollments.transactionType, payerEnrollments.status);

    const enrollments: Record<string, EnrollmentBucket> = {
      eligibility: emptyBucket(),
      claims: emptyBucket(),
      era: emptyBucket(),
    };
    for (const row of enrollmentRows as any[]) {
      const t = row.transactionType as string;
      const s = row.status as keyof EnrollmentBucket;
      if (!enrollments[t]) enrollments[t] = emptyBucket();
      if (s in enrollments[t]) enrollments[t][s] = Number(row.count);
    }

    // Also include the full per-payer list so the UI can render a table
    // when the operator wants to drill down. Capped at 200 rows — well
    // beyond any realistic payer count for one practice.
    const enrollmentDetail = await db
      .select()
      .from(payerEnrollments)
      .where(eq(payerEnrollments.practiceId, practiceId))
      .orderBy(payerEnrollments.transactionType, payerEnrollments.payerName)
      .limit(200);

    // ── 3. Recent activity (last 7 days) ─────────────────────────────
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // eligibilityChecks has two timestamps (checkDate w/ default, checkedAt
    // nullable). Use COALESCE so we count rows regardless of which one is set.
    const eligTs = sql`COALESCE(${eligibilityChecks.checkedAt}, ${eligibilityChecks.checkDate})`;
    const [eligibility7d] = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
        lastAt: sql<string>`MAX(${eligTs})`,
      })
      .from(eligibilityChecks)
      .where(
        and(
          eq(eligibilityChecks.practiceId, practiceId),
          gte(eligTs as any, sevenDaysAgo),
        ),
      );

    const [claims7d] = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
        lastAt: sql<string>`MAX(${claims.submittedAt})`,
      })
      .from(claims)
      .where(
        and(
          eq(claims.practiceId, practiceId),
          gte(claims.submittedAt, sevenDaysAgo),
        ),
      );

    const [remit7d] = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
        lastAt: sql<string>`MAX(${remittanceAdvice.createdAt})`,
      })
      .from(remittanceAdvice)
      .where(
        and(
          eq(remittanceAdvice.practiceId, practiceId),
          gte(remittanceAdvice.createdAt, sevenDaysAgo),
        ),
      );

    const recentActivity = {
      eligibility: {
        last7dCount: Number((eligibility7d as any)?.count) || 0,
        lastAt: (eligibility7d as any)?.lastAt || null,
      },
      claims: {
        last7dCount: Number((claims7d as any)?.count) || 0,
        lastAt: (claims7d as any)?.lastAt || null,
      },
      remittance: {
        last7dCount: Number((remit7d as any)?.count) || 0,
        lastAt: (remit7d as any)?.lastAt || null,
      },
    };

    // ── 4. Composite readiness signal ─────────────────────────────────
    // "Ready" means we expect a real claim to clear today. Concretely:
    //   - production key present
    //   - at least one enrolled payer for each of (eligibility, claims, era)
    //   - actual traffic in the last 7 days on at least eligibility + claims
    //
    // Anything else surfaces as a blocker. Operators can read the
    // blockers list top-to-bottom — these are the things to do next.
    const blockers: string[] = [];
    if (!apiKey.present) blockers.push('No Stedi API key configured (set STEDI_API_KEY or per-practice stediApiKey).');
    if (apiKey.environment === 'test') blockers.push('Stedi key is a TEST key. Apply for a production key.');
    if (apiKey.environment === 'unknown' && apiKey.present) blockers.push('Stedi key prefix is unrecognized — verify it is the right value.');
    if (enrollments.eligibility.enrolled === 0) blockers.push('No payers enrolled for eligibility (270/271).');
    if (enrollments.claims.enrolled === 0) blockers.push('No payers enrolled for claim submission (837).');
    if (enrollments.era.enrolled === 0) blockers.push('No payers enrolled for ERA (835). Payments will not auto-post.');
    if (recentActivity.eligibility.last7dCount === 0)
      blockers.push('No eligibility checks ran in the last 7 days — the wire may be inactive.');
    if (recentActivity.claims.last7dCount === 0)
      blockers.push('No claims submitted in the last 7 days — the wire may be inactive.');

    const ready = blockers.length === 0;

    return res.json({
      ready,
      blockers,
      apiKey,
      enrollments,
      enrollmentDetail,
      recentActivity,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('stedi-readiness: failed to build dashboard payload', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ message: 'Failed to build readiness payload' });
  }
});

export default router;
