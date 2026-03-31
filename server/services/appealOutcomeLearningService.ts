import { db } from '../db';
import { appeals, claims, insurances } from '@shared/schema';
import { eq, and, sql, count } from 'drizzle-orm';
import { logger } from './logger';

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
