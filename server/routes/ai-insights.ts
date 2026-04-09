/**
 * AI Insights Routes
 *
 * Handles:
 * - GET /api/ai-insights - List active insights for the practice
 * - POST /api/ai-insights/generate - Trigger insight generation
 * - GET /api/ai-insights/claim/:id - Get relevant insights for a specific claim
 * - GET /api/ai-insights/dashboard - Dashboard stats (denial reasons, success rates, payer patterns)
 * - GET /api/ai-insights/historical-outcomes - Historical outcome data for AI services
 * - DELETE /api/ai-insights/:id - Dismiss an insight
 */

import { Router, type Response, type NextFunction } from "express";
import { db } from "../db";
import { aiModelInsights, aiLearningData } from "@shared/schema";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { isAuthenticated } from "../replitAuth";
import { storage } from "../storage";
import { generateInsights, getRecommendationsForClaim } from "../services/aiLearningService";
import logger from "../services/logger";

const router = Router();

// Helper to get authorized practiceId from request
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) {
    return req.authorizedPracticeId;
  }
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;

  if (userRole === "admin") {
    return requestedPracticeId || userPracticeId || 1;
  }
  if (!userPracticeId) {
    throw new Error("User not assigned to a practice. Contact administrator.");
  }
  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    return userPracticeId;
  }
  return requestedPracticeId || userPracticeId;
};

// GET /api/ai-insights - List active insights for the practice
router.get("/", isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);

    const insights = await db
      .select()
      .from(aiModelInsights)
      .where(
        and(
          eq(aiModelInsights.practiceId, practiceId),
          eq(aiModelInsights.isActive, true),
        )
      )
      .orderBy(desc(aiModelInsights.confidence));

    // Get summary stats
    const stats = await db
      .select({
        totalDataPoints: count().as("total_data_points"),
        denialPatterns: sql<number>`count(*) filter (where ${aiModelInsights.insightType} = 'denial_pattern' and ${aiModelInsights.isActive} = true)`.as("denial_patterns"),
        optimizationTips: sql<number>`count(*) filter (where ${aiModelInsights.insightType} = 'optimization_tip' and ${aiModelInsights.isActive} = true)`.as("optimization_tips"),
        underpaymentPatterns: sql<number>`count(*) filter (where ${aiModelInsights.insightType} = 'underpayment_pattern' and ${aiModelInsights.isActive} = true)`.as("underpayment_patterns"),
        payerTrends: sql<number>`count(*) filter (where ${aiModelInsights.insightType} = 'payer_trend' and ${aiModelInsights.isActive} = true)`.as("payer_trends"),
      })
      .from(aiModelInsights)
      .where(eq(aiModelInsights.practiceId, practiceId));

    // Count total learning data points
    const learningStats = await db
      .select({
        totalRecords: count().as("total_records"),
      })
      .from(aiLearningData)
      .where(eq(aiLearningData.practiceId, practiceId));

    res.json({
      insights,
      summary: {
        totalInsights: insights.length,
        denialPatterns: stats[0]?.denialPatterns || 0,
        optimizationTips: stats[0]?.optimizationTips || 0,
        underpaymentPatterns: stats[0]?.underpaymentPatterns || 0,
        payerTrends: stats[0]?.payerTrends || 0,
        dataPointsAnalyzed: learningStats[0]?.totalRecords || 0,
      },
    });
  } catch (error) {
    logger.error("Error fetching AI insights", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: "Failed to fetch AI insights" });
  }
});

// POST /api/ai-insights/generate - Trigger insight generation
router.post("/generate", isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);

    const result = await generateInsights(practiceId);

    res.json({
      message: result.openAiAvailable
        ? `Generated ${result.generated} new insights`
        : `Generated ${result.generated} data-driven insights. Configure OPENAI_API_KEY for AI-powered insights.`,
      generated: result.generated,
      openAiAvailable: result.openAiAvailable,
    });
  } catch (error) {
    logger.error("Error generating AI insights", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: "Failed to generate AI insights" });
  }
});

// GET /api/ai-insights/claim/:id - Get relevant insights for a specific claim
router.get("/claim/:id", isAuthenticated, async (req: any, res) => {
  try {
    const claimId = parseInt(req.params.id);
    if (isNaN(claimId)) {
      return res.status(400).json({ message: "Invalid claim ID" });
    }

    const recommendations = await getRecommendationsForClaim(claimId);

    res.json({ insights: recommendations });
  } catch (error) {
    logger.error("Error fetching claim insights", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: "Failed to fetch claim insights" });
  }
});

// GET /api/ai-insights/dashboard - Dashboard stats for AI insights section
router.get("/dashboard", isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);

    // 1. Top denial reasons by payer
    const topDenialsByPayer = await db
      .select({
        payerName: aiLearningData.payerName,
        denialReason: aiLearningData.denialReason,
        totalDenied: count().as("total_denied"),
      })
      .from(aiLearningData)
      .where(
        and(
          eq(aiLearningData.practiceId, practiceId),
          eq(aiLearningData.outcome, "denied"),
          sql`${aiLearningData.denialReason} is not null`,
        )
      )
      .groupBy(aiLearningData.payerName, aiLearningData.denialReason)
      .orderBy(desc(sql`count(*)`))
      .limit(20);

    // 2. AI optimization success rate: claims that followed AI suggestions vs those that didn't
    const aiSuccessStats = await db
      .select({
        followedAi: aiLearningData.followedAiSuggestion,
        totalClaims: count().as("total_claims"),
        paidClaims: sql<number>`count(*) filter (where ${aiLearningData.outcome} = 'paid')`.as("paid_claims"),
        deniedClaims: sql<number>`count(*) filter (where ${aiLearningData.outcome} = 'denied')`.as("denied_claims"),
        partialClaims: sql<number>`count(*) filter (where ${aiLearningData.outcome} = 'partial')`.as("partial_claims"),
        avgPaidAmount: sql<string>`round(avg(${aiLearningData.paidAmount}::numeric), 2)`.as("avg_paid"),
      })
      .from(aiLearningData)
      .where(
        and(
          eq(aiLearningData.practiceId, practiceId),
          sql`${aiLearningData.followedAiSuggestion} is not null`,
        )
      )
      .groupBy(aiLearningData.followedAiSuggestion);

    // 3. Payer-specific outcome patterns
    const payerPatterns = await db
      .select({
        payerName: aiLearningData.payerName,
        totalClaims: count().as("total_claims"),
        paidClaims: sql<number>`count(*) filter (where ${aiLearningData.outcome} = 'paid')`.as("paid_claims"),
        deniedClaims: sql<number>`count(*) filter (where ${aiLearningData.outcome} = 'denied')`.as("denied_claims"),
        avgProcessingDays: sql<string>`round(avg(${aiLearningData.processingDays}), 0)`.as("avg_processing_days"),
        avgPaidAmount: sql<string>`round(avg(${aiLearningData.paidAmount}::numeric), 2)`.as("avg_paid"),
        approvalRate: sql<string>`round(count(*) filter (where ${aiLearningData.outcome} in ('paid', 'partial'))::numeric / nullif(count(*), 0) * 100, 1)`.as("approval_rate"),
      })
      .from(aiLearningData)
      .where(
        and(
          eq(aiLearningData.practiceId, practiceId),
          sql`${aiLearningData.payerName} is not null`,
        )
      )
      .groupBy(aiLearningData.payerName)
      .orderBy(desc(sql`count(*)`))
      .limit(15);

    // 4. Overall outcome breakdown
    const overallStats = await db
      .select({
        totalClaims: count().as("total_claims"),
        paidClaims: sql<number>`count(*) filter (where ${aiLearningData.outcome} = 'paid')`.as("paid_claims"),
        deniedClaims: sql<number>`count(*) filter (where ${aiLearningData.outcome} = 'denied')`.as("denied_claims"),
        partialClaims: sql<number>`count(*) filter (where ${aiLearningData.outcome} = 'partial')`.as("partial_claims"),
        avgProcessingDays: sql<string>`round(avg(${aiLearningData.processingDays}), 0)`.as("avg_processing_days"),
      })
      .from(aiLearningData)
      .where(eq(aiLearningData.practiceId, practiceId));

    // Format AI success rate data
    const followed = aiSuccessStats.find((s: any) => s.followedAi === true);
    const notFollowed = aiSuccessStats.find((s: any) => s.followedAi === false);
    const aiOptimizationRate = {
      followedAi: {
        totalClaims: followed?.totalClaims || 0,
        paidClaims: followed?.paidClaims || 0,
        deniedClaims: followed?.deniedClaims || 0,
        successRate: followed && followed.totalClaims > 0
          ? Math.round(((followed.paidClaims + (followed.partialClaims || 0)) / followed.totalClaims) * 100)
          : 0,
      },
      didNotFollowAi: {
        totalClaims: notFollowed?.totalClaims || 0,
        paidClaims: notFollowed?.paidClaims || 0,
        deniedClaims: notFollowed?.deniedClaims || 0,
        successRate: notFollowed && notFollowed.totalClaims > 0
          ? Math.round(((notFollowed.paidClaims + (notFollowed.partialClaims || 0)) / notFollowed.totalClaims) * 100)
          : 0,
      },
    };

    res.json({
      topDenialsByPayer,
      aiOptimizationRate,
      payerPatterns,
      overallStats: overallStats[0] || {
        totalClaims: 0,
        paidClaims: 0,
        deniedClaims: 0,
        partialClaims: 0,
        avgProcessingDays: null,
      },
    });
  } catch (error) {
    logger.error("Error fetching AI dashboard stats", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: "Failed to fetch AI dashboard stats" });
  }
});

// GET /api/ai-insights/historical-outcomes - Historical outcome data for AI services to improve predictions
router.get("/historical-outcomes", isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { payerName, cptCode, limit: queryLimit } = req.query;
    const resultLimit = Math.min(parseInt(queryLimit as string) || 100, 500);

    // Build filter conditions
    const conditions = [eq(aiLearningData.practiceId, practiceId)];
    if (payerName) {
      conditions.push(eq(aiLearningData.payerName, payerName as string));
    }
    if (cptCode) {
      conditions.push(eq(aiLearningData.cptCode, cptCode as string));
    }

    // Get raw outcome records
    const outcomes = await db
      .select()
      .from(aiLearningData)
      .where(and(...conditions))
      .orderBy(desc(aiLearningData.createdAt))
      .limit(resultLimit);

    // Get aggregated stats for the filtered set
    const aggregated = await db
      .select({
        payerName: aiLearningData.payerName,
        cptCode: aiLearningData.cptCode,
        totalClaims: count().as("total_claims"),
        deniedClaims: sql<number>`count(*) filter (where ${aiLearningData.outcome} = 'denied')`.as("denied_claims"),
        paidClaims: sql<number>`count(*) filter (where ${aiLearningData.outcome} = 'paid')`.as("paid_claims"),
        avgSubmitted: sql<string>`round(avg(${aiLearningData.submittedAmount}::numeric), 2)`.as("avg_submitted"),
        avgPaid: sql<string>`round(avg(${aiLearningData.paidAmount}::numeric), 2)`.as("avg_paid"),
        denialRate: sql<string>`round(count(*) filter (where ${aiLearningData.outcome} = 'denied')::numeric / nullif(count(*), 0) * 100, 1)`.as("denial_rate"),
      })
      .from(aiLearningData)
      .where(and(...conditions))
      .groupBy(aiLearningData.payerName, aiLearningData.cptCode)
      .having(sql`count(*) >= 2`);

    res.json({
      outcomes,
      aggregatedPatterns: aggregated,
      meta: {
        practiceId,
        filters: { payerName: payerName || null, cptCode: cptCode || null },
        totalRecords: outcomes.length,
        limit: resultLimit,
      },
    });
  } catch (error) {
    logger.error("Error fetching historical outcomes", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: "Failed to fetch historical outcomes" });
  }
});

// DELETE /api/ai-insights/:id - Dismiss an insight
router.delete("/:id", isAuthenticated, async (req: any, res) => {
  try {
    const insightId = parseInt(req.params.id);
    if (isNaN(insightId)) {
      return res.status(400).json({ message: "Invalid insight ID" });
    }

    const practiceId = getAuthorizedPracticeId(req);

    // Verify the insight belongs to this practice
    const existing = await db
      .select()
      .from(aiModelInsights)
      .where(
        and(
          eq(aiModelInsights.id, insightId),
          eq(aiModelInsights.practiceId, practiceId),
        )
      )
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({ message: "Insight not found" });
    }

    await db
      .update(aiModelInsights)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(aiModelInsights.id, insightId));

    res.json({ message: "Insight dismissed" });
  } catch (error) {
    logger.error("Error dismissing AI insight", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: "Failed to dismiss insight" });
  }
});

export default router;
