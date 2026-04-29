import { db } from '../db';
import { appeals, claims, insurances } from '@shared/schema';
import { eq, and, sql, count, desc, inArray } from 'drizzle-orm';
import { logger } from './logger';

export interface ProvenArgument {
  argument: string;
  /** Number of past WON or PARTIAL appeals that used this exact argument string. */
  winCount: number;
  /** Total appeals (won + lost + partial) that used it — denominator for win rate. */
  totalCount: number;
  /** winCount / totalCount, rounded to 1 decimal. */
  winRate: number;
}

/**
 * Get arguments that have historically WON or partially won appeals for a
 * given (practice, payer, denial category) context. Powers the Tier A #2
 * outcome learning loop — the appeal generator feeds these in as
 * "approaches that worked before for this payer" so subsequent appeals
 * compound on past wins.
 *
 * Returns at most `limit` distinct arguments, sorted by win count desc.
 * Empty array when no historical data — caller falls through gracefully.
 *
 * Multi-tenant safe: scoped by practiceId. We do NOT mine cross-practice
 * arguments here for HIPAA reasons (an argument citing a specific prior
 * member's plan language could leak). Cross-practice anonymized intel
 * is a separate workstream.
 */
export async function getProvenArgumentsForContext(args: {
  practiceId: number;
  /** Payer / insurance name (matched case-insensitively). Optional — when
   *  omitted, returns proven arguments across all payers. */
  payerName?: string | null;
  /** Denial category from the AI generator's classification. Optional but
   *  highly recommended — narrows results dramatically. */
  denialCategory?: string | null;
  /** Lookback in days. Default 540 (~18 months) since appeal cycles are slow. */
  daysBack?: number;
  /** Max distinct arguments to return. Default 5. */
  limit?: number;
}): Promise<ProvenArgument[]> {
  const { practiceId, payerName, denialCategory, daysBack = 540, limit = 5 } = args;
  if (!practiceId) return [];

  const horizon = new Date();
  horizon.setDate(horizon.getDate() - daysBack);

  try {
    const conditions = [
      eq(appeals.practiceId, practiceId),
      sql`${appeals.createdAt} >= ${horizon}`,
      sql`${appeals.keyArguments} IS NOT NULL`,
      sql`${appeals.status} IN ('won', 'partial', 'lost')`, // include lost for the denominator
    ];
    if (denialCategory) {
      conditions.push(eq(appeals.denialCategory, denialCategory));
    }

    const rows = await db
      .select({
        keyArguments: appeals.keyArguments,
        status: appeals.status,
        claimId: appeals.claimId,
      })
      .from(appeals)
      .where(and(...conditions));

    if (rows.length === 0) return [];

    // Optional payer filter — applied via claims.insuranceId lookup since
    // appeals doesn't denormalize the payer name.
    let payerFiltered = rows;
    if (payerName) {
      const claimIds = rows.map((r: any) => r.claimId).filter(Boolean);
      if (claimIds.length > 0) {
        const claimRows = await db
          .select({
            id: claims.id,
            insuranceId: claims.insuranceId,
          })
          .from(claims)
          .where(inArray(claims.id, claimIds));
        const insuranceIds = claimRows
          .map((c: any) => c.insuranceId)
          .filter((v: any): v is number => typeof v === 'number');
        if (insuranceIds.length > 0) {
          const insuranceRows = await db
            .select({ id: insurances.id, name: insurances.name })
            .from(insurances)
            .where(inArray(insurances.id, insuranceIds));
          const matchingInsuranceIds = new Set(
            insuranceRows
              .filter((i: any) => typeof i.name === 'string' &&
                i.name.toLowerCase().includes(payerName.toLowerCase()))
              .map((i: any) => i.id),
          );
          const matchingClaimIds = new Set(
            claimRows
              .filter((c: any) => matchingInsuranceIds.has(c.insuranceId))
              .map((c: any) => c.id),
          );
          payerFiltered = rows.filter((r: any) => matchingClaimIds.has(r.claimId));
        } else {
          payerFiltered = [];
        }
      }
    }

    if (payerFiltered.length === 0) return [];

    // Tally arguments. winCount = won + partial. totalCount includes lost.
    const tally = new Map<string, { winCount: number; totalCount: number }>();
    for (const row of payerFiltered) {
      const argList = row.keyArguments;
      if (!Array.isArray(argList)) continue;
      const isWin = row.status === 'won' || row.status === 'partial';

      for (const raw of argList) {
        if (typeof raw !== 'string') continue;
        // Normalize whitespace; otherwise duplicates with subtle formatting
        // differences inflate the distinct count.
        const arg = raw.trim().replace(/\s+/g, ' ');
        if (arg.length === 0) continue;

        const entry = tally.get(arg) ?? { winCount: 0, totalCount: 0 };
        entry.totalCount += 1;
        if (isWin) entry.winCount += 1;
        tally.set(arg, entry);
      }
    }

    const results: ProvenArgument[] = [];
    tally.forEach((stats, arg) => {
      // Only surface arguments that have actually won at least once.
      if (stats.winCount === 0) return;
      results.push({
        argument: arg,
        winCount: stats.winCount,
        totalCount: stats.totalCount,
        winRate: Math.round((stats.winCount / stats.totalCount) * 1000) / 10,
      });
    });

    results.sort((a, b) =>
      b.winCount - a.winCount || b.winRate - a.winRate,
    );

    return results.slice(0, limit);
  } catch (err: any) {
    logger.error('getProvenArgumentsForContext failed', {
      practiceId,
      payerName,
      denialCategory,
      error: err?.message,
    });
    return [];
  }
}

/**
 * Formats a list of proven arguments as a quotable string for inclusion in
 * the appeal prompt. Returns empty string when the list is empty.
 */
export function formatProvenArgumentsForPrompt(args: ProvenArgument[]): string {
  if (args.length === 0) return '';
  const lines = args.map((a) => `  - "${a.argument}" (won ${a.winCount}/${a.totalCount} = ${a.winRate}% on this category)`);
  return [
    `The following arguments have HISTORICALLY WON appeals for this practice, payer, and denial category.`,
    `Weave the most relevant ones into the new appeal letter where they apply — but only if they apply truthfully to this specific case. Do not force them in if they don't fit.`,
    ...lines,
  ].join('\n');
}

export interface AppealSuccessRate {
  category: string;
  totalAppeals: number;
  won: number;
  lost: number;
  partial: number;
  successRate: number;
  avgRecoveredAmount: number;
}

/**
 * Records appeal outcome details when an appeal is resolved
 */
export async function recordAppealOutcome(appealId: number): Promise<void> {
  try {
    const appeal = await db.query.appeals.findFirst({
      where: eq(appeals.id, appealId),
    });

    if (!appeal) {
      logger.error('Appeal not found for outcome recording', { appealId });
      return;
    }

    // Only process resolved appeals
    if (!['won', 'lost', 'partial'].includes(appeal.status || '')) {
      logger.info('Appeal not in resolved status, skipping outcome recording', {
        appealId,
        status: appeal.status,
      });
      return;
    }

    // Calculate days to resolution
    let daysToResolution = null;
    if (appeal.resolvedDate && appeal.createdAt) {
      const resolved = new Date(appeal.resolvedDate);
      const created = new Date(appeal.createdAt);
      daysToResolution = Math.ceil(
        (resolved.getTime() - created.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    // Log the outcome details
    logger.info('Appeal outcome recorded', {
      appealId,
      status: appeal.status,
      denialCategory: appeal.denialCategory,
      appealLevel: appeal.appealLevel,
      appealedAmount: appeal.appealedAmount,
      recoveredAmount: appeal.recoveredAmount,
      daysToResolution,
      practiceId: appeal.practiceId,
    });

    // Additional outcome analysis
    if (appeal.recoveredAmount && appeal.appealedAmount) {
      const recoveryRate = (appeal.recoveredAmount / appeal.appealedAmount) * 100;
      logger.info('Appeal recovery rate calculated', {
        appealId,
        recoveryRate: recoveryRate.toFixed(2) + '%',
      });
    }
  } catch (error) {
    logger.error('Error recording appeal outcome', { error, appealId });
  }
}

/**
 * Get appeal success rates grouped by denial category for a practice
 */
export async function getAppealSuccessRates(
  practiceId: number
): Promise<AppealSuccessRate[]> {
  try {
    // Query appeals grouped by denial category
    const results = await db
      .select({
        category: appeals.denialCategory,
        status: appeals.status,
        recoveredAmount: appeals.recoveredAmount,
      })
      .from(appeals)
      .where(
        and(
          eq(appeals.practiceId, practiceId),
          sql`${appeals.status} IN ('won', 'lost', 'partial')`
        )
      );

    // Group by category and calculate statistics
    const categoryMap = new Map<string, {
      total: number;
      won: number;
      lost: number;
      partial: number;
      totalRecovered: number;
      recoveredCount: number;
    }>();

    results.forEach((result: any) => {
      const category = result.category || 'Unknown';
      const existing = categoryMap.get(category) || {
        total: 0,
        won: 0,
        lost: 0,
        partial: 0,
        totalRecovered: 0,
        recoveredCount: 0,
      };

      existing.total++;
      if (result.status === 'won') existing.won++;
      else if (result.status === 'lost') existing.lost++;
      else if (result.status === 'partial') existing.partial++;

      if (result.recoveredAmount) {
        existing.totalRecovered += result.recoveredAmount;
        existing.recoveredCount++;
      }

      categoryMap.set(category, existing);
    });

    // Convert to array and calculate success rates
    const successRates: AppealSuccessRate[] = Array.from(categoryMap.entries())
      .map(([category, stats]) => {
        const successCount = stats.won + stats.partial;
        const successRate = stats.total > 0 ? (successCount / stats.total) * 100 : 0;
        const avgRecoveredAmount = stats.recoveredCount > 0
          ? stats.totalRecovered / stats.recoveredCount
          : 0;

        return {
          category,
          totalAppeals: stats.total,
          won: stats.won,
          lost: stats.lost,
          partial: stats.partial,
          successRate: Math.round(successRate * 10) / 10, // Round to 1 decimal
          avgRecoveredAmount: Math.round(avgRecoveredAmount * 100) / 100, // Round to cents
        };
      })
      .sort((a, b) => b.totalAppeals - a.totalAppeals); // Sort by total appeals desc

    logger.info('Appeal success rates calculated', {
      practiceId,
      categoriesAnalyzed: successRates.length,
      totalAppeals: successRates.reduce((sum, r) => sum + r.totalAppeals, 0),
    });

    return successRates;
  } catch (error) {
    logger.error('Error calculating appeal success rates', { error, practiceId });
    return [];
  }
}

/**
 * Get success rate for a specific payer and denial category combination
 */
export async function getPayerSuccessRate(
  payerName: string,
  denialCategory: string
): Promise<number | null> {
  try {
    // Query resolved appeals for this denial category
    // Note: payer filtering uses insurances table via claims.insuranceId
    const results = await db
      .select({
        claimId: appeals.claimId,
        status: appeals.status,
      })
      .from(appeals)
      .innerJoin(claims, eq(appeals.claimId, claims.id))
      .innerJoin(insurances, eq(claims.insuranceId, insurances.id))
      .where(
        and(
          eq(insurances.name, payerName),
          eq(appeals.denialCategory, denialCategory),
          sql`${appeals.status} IN ('won', 'lost', 'partial')`
        )
      );

    if (results.length === 0) {
      logger.info('No appeal data for payer/category combination', {
        payerName,
        denialCategory,
      });
      return null;
    }

    // Calculate success rate
    const successCount = results.filter((r: any) =>
      r.status === 'won' || r.status === 'partial'
    ).length;

    const successRate = (successCount / results.length) * 100;

    logger.info('Payer success rate calculated', {
      payerName,
      denialCategory,
      totalAppeals: results.length,
      successCount,
      successRate: successRate.toFixed(1) + '%',
    });

    return Math.round(successRate * 10) / 10; // Round to 1 decimal
  } catch (error) {
    logger.error('Error calculating payer success rate', {
      error,
      payerName,
      denialCategory,
    });
    return null;
  }
}
