/**
 * AI Insights Routes
 *
 * Handles:
 * - GET /api/ai-insights - List active insights for the practice
 * - POST /api/ai-insights/generate - Trigger insight generation
 * - GET /api/ai-insights/claim/:id - Get relevant insights for a specific claim
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
      message: `Generated ${result.generated} new insights`,
      generated: result.generated,
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
