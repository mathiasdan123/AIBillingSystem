import OpenAI from "openai";
import { db } from "../db";
import { aiLearningData, aiModelInsights, claims, claimLineItems, cptCodes, icd10Codes, insurances } from "@shared/schema";
import { eq, and, sql, desc, count, avg, isNull } from "drizzle-orm";
import logger from "./logger";

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

interface ClaimOutcomeInput {
  claimId: number;
  practiceId: number;
  status: string; // paid, denied
  paidAmount?: string | null;
  denialReason?: string | null;
}

/**
 * Record the outcome of a claim for AI learning purposes.
 * Called when a claim is marked as paid or denied.
 */
export async function recordClaimOutcome(input: ClaimOutcomeInput): Promise<void> {
  try {
    const claim = await db.select().from(claims).where(eq(claims.id, input.claimId)).limit(1);
    if (!claim || claim.length === 0) {
      logger.warn("AI Learning: claim not found", { claimId: input.claimId });
      return;
    }

    const claimData = claim[0];

    // Get line items with CPT and ICD-10 codes
    const lineItems = await db
      .select({
        cptCode: cptCodes.code,
        icd10Code: icd10Codes.code,
        modifier: claimLineItems.modifier,
      })
      .from(claimLineItems)
      .leftJoin(cptCodes, eq(claimLineItems.cptCodeId, cptCodes.id))
      .leftJoin(icd10Codes, eq(claimLineItems.icd10CodeId, icd10Codes.id))
      .where(eq(claimLineItems.claimId, input.claimId));

    // Get payer name
    let payerName: string | null = null;
    if (claimData.insuranceId) {
      const ins = await db.select({ name: insurances.name }).from(insurances).where(eq(insurances.id, claimData.insuranceId)).limit(1);
      if (ins.length > 0) {
        payerName = ins[0].name;
      }
    }

    // Calculate processing days
    let processingDays: number | null = null;
    if (claimData.submittedAt) {
      const resolvedAt = input.status === "paid" && claimData.paidAt ? claimData.paidAt : new Date();
      processingDays = Math.floor(
        (resolvedAt.getTime() - new Date(claimData.submittedAt).getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    // Determine outcome
    let outcome = input.status === "paid" ? "paid" : "denied";
    const submittedAmt = parseFloat(claimData.submittedAmount || claimData.totalAmount || "0");
    const paidAmt = parseFloat(input.paidAmount || "0");
    if (outcome === "paid" && paidAmt > 0 && paidAmt < submittedAmt * 0.95) {
      outcome = "partial";
    }

    // Get AI score at submission time
    const aiScore = claimData.aiReviewScore ? parseInt(claimData.aiReviewScore) : null;

    // Record one entry per line item (or one overall if no line items)
    if (lineItems.length > 0) {
      const insertValues = lineItems.map((li: any) => ({
        practiceId: input.practiceId,
        claimId: input.claimId,
        cptCode: li.cptCode || null,
        icd10Code: li.icd10Code || null,
        payerName,
        submittedAmount: claimData.submittedAmount || claimData.totalAmount,
        paidAmount: input.paidAmount || null,
        outcome,
        denialReason: input.denialReason || null,
        modifier: li.modifier || null,
        aiScoreAtSubmission: aiScore,
        aiRecommendationsFollowed: null,
        processingDays,
      }));

      await db.insert(aiLearningData).values(insertValues);
    } else {
      await db.insert(aiLearningData).values({
        practiceId: input.practiceId,
        claimId: input.claimId,
        cptCode: null,
        icd10Code: null,
        payerName,
        submittedAmount: claimData.submittedAmount || claimData.totalAmount,
        paidAmount: input.paidAmount || null,
        outcome,
        denialReason: input.denialReason || null,
        modifier: null,
        aiScoreAtSubmission: aiScore,
        aiRecommendationsFollowed: null,
        processingDays,
      });
    }

    logger.info("AI Learning: recorded claim outcome", {
      claimId: input.claimId,
      outcome,
      lineItemCount: lineItems.length,
    });
  } catch (error) {
    logger.error("AI Learning: failed to record claim outcome", {
      claimId: input.claimId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

interface DenialPatternRow {
  payerName: string | null;
  cptCode: string | null;
  icd10Code: string | null;
  totalClaims: number;
  deniedClaims: number;
  denialRate: string;
}

interface UnderpaymentRow {
  payerName: string | null;
  cptCode: string | null;
  totalClaims: number;
  avgSubmitted: string | null;
  avgPaid: string | null;
  underpaymentPct: string | null;
}

interface PayerTrendRow {
  payerName: string | null;
  avgProcessingDays: string | null;
  totalClaims: number;
  recentAvgDays: string | null;
  olderAvgDays: string | null;
}

/**
 * Analyze historical claim outcome data and generate actionable insights.
 * Uses SQL aggregations for data analysis plus OpenAI for natural language generation.
 */
export async function generateInsights(practiceId: number): Promise<{ generated: number }> {
  try {
    // 1. Denial patterns: group by payer + cpt + icd10, compute denial rates
    const denialPatterns: DenialPatternRow[] = await db
      .select({
        payerName: aiLearningData.payerName,
        cptCode: aiLearningData.cptCode,
        icd10Code: aiLearningData.icd10Code,
        totalClaims: count().as("total_claims"),
        deniedClaims: sql<number>`count(*) filter (where ${aiLearningData.outcome} = 'denied')`.as("denied_claims"),
        denialRate: sql<string>`round(count(*) filter (where ${aiLearningData.outcome} = 'denied')::numeric / nullif(count(*), 0) * 100, 1)`.as("denial_rate"),
      })
      .from(aiLearningData)
      .where(eq(aiLearningData.practiceId, practiceId))
      .groupBy(aiLearningData.payerName, aiLearningData.cptCode, aiLearningData.icd10Code)
      .having(sql`count(*) >= 3`);

    // 2. Underpayment patterns: compare submitted vs paid amounts
    const underpaymentPatterns: UnderpaymentRow[] = await db
      .select({
        payerName: aiLearningData.payerName,
        cptCode: aiLearningData.cptCode,
        totalClaims: count().as("total_claims"),
        avgSubmitted: sql<string>`round(avg(${aiLearningData.submittedAmount}::numeric), 2)`.as("avg_submitted"),
        avgPaid: sql<string>`round(avg(${aiLearningData.paidAmount}::numeric), 2)`.as("avg_paid"),
        underpaymentPct: sql<string>`round((1 - avg(${aiLearningData.paidAmount}::numeric) / nullif(avg(${aiLearningData.submittedAmount}::numeric), 0)) * 100, 1)`.as("underpayment_pct"),
      })
      .from(aiLearningData)
      .where(
        and(
          eq(aiLearningData.practiceId, practiceId),
          eq(aiLearningData.outcome, "paid"),
          sql`${aiLearningData.paidAmount} is not null`,
          sql`${aiLearningData.submittedAmount} is not null`,
        )
      )
      .groupBy(aiLearningData.payerName, aiLearningData.cptCode)
      .having(sql`count(*) >= 3 and avg(${aiLearningData.paidAmount}::numeric) < avg(${aiLearningData.submittedAmount}::numeric) * 0.95`);

    // 3. Payer processing time trends
    const payerTrends: PayerTrendRow[] = await db
      .select({
        payerName: aiLearningData.payerName,
        avgProcessingDays: sql<string>`round(avg(${aiLearningData.processingDays}), 0)`.as("avg_processing_days"),
        totalClaims: count().as("total_claims"),
        recentAvgDays: sql<string>`round(avg(case when ${aiLearningData.createdAt} > now() - interval '90 days' then ${aiLearningData.processingDays} end), 0)`.as("recent_avg_days"),
        olderAvgDays: sql<string>`round(avg(case when ${aiLearningData.createdAt} <= now() - interval '90 days' then ${aiLearningData.processingDays} end), 0)`.as("older_avg_days"),
      })
      .from(aiLearningData)
      .where(
        and(
          eq(aiLearningData.practiceId, practiceId),
          sql`${aiLearningData.processingDays} is not null`,
        )
      )
      .groupBy(aiLearningData.payerName)
      .having(sql`count(*) >= 5`);

    // 4. Modifier impact analysis
    const modifierPatterns = await db
      .select({
        cptCode: aiLearningData.cptCode,
        modifier: aiLearningData.modifier,
        totalClaims: count().as("total_claims"),
        deniedClaims: sql<number>`count(*) filter (where ${aiLearningData.outcome} = 'denied')`.as("denied_claims"),
        denialRate: sql<string>`round(count(*) filter (where ${aiLearningData.outcome} = 'denied')::numeric / nullif(count(*), 0) * 100, 1)`.as("denial_rate"),
      })
      .from(aiLearningData)
      .where(eq(aiLearningData.practiceId, practiceId))
      .groupBy(aiLearningData.cptCode, aiLearningData.modifier)
      .having(sql`count(*) >= 3`);

    // Deactivate old insights for this practice before inserting new ones
    await db
      .update(aiModelInsights)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(aiModelInsights.practiceId, practiceId));

    const newInsights: Array<{
      practiceId: number;
      insightType: string;
      payerName: string | null;
      cptCode: string | null;
      title: string;
      description: string;
      confidence: string;
      dataPoints: number;
      isActive: boolean;
    }> = [];

    // Generate denial pattern insights
    for (const row of denialPatterns) {
      const rate = parseFloat(row.denialRate);
      if (rate >= 20 && row.deniedClaims >= 2) {
        const payerLabel = row.payerName || "Unknown payer";
        const cptLabel = row.cptCode || "unspecified CPT";
        const icdLabel = row.icd10Code ? ` + ICD ${row.icd10Code}` : "";
        newInsights.push({
          practiceId,
          insightType: "denial_pattern",
          payerName: row.payerName,
          cptCode: row.cptCode,
          title: `High denial rate for CPT ${cptLabel}${icdLabel} with ${payerLabel}`,
          description: `Claims with CPT ${cptLabel}${icdLabel} have a ${rate}% denial rate with ${payerLabel} (${row.deniedClaims} denied out of ${row.totalClaims} claims). Review documentation requirements and consider pre-authorization.`,
          confidence: String(Math.min(0.95, 0.5 + (row.totalClaims / 50))),
          dataPoints: row.totalClaims,
          isActive: true,
        });
      }
    }

    // Generate underpayment insights
    for (const row of underpaymentPatterns) {
      const pct = parseFloat(row.underpaymentPct || "0");
      if (pct >= 10) {
        const payerLabel = row.payerName || "Unknown payer";
        const cptLabel = row.cptCode || "unspecified CPT";
        newInsights.push({
          practiceId,
          insightType: "underpayment_pattern",
          payerName: row.payerName,
          cptCode: row.cptCode,
          title: `${payerLabel} underpaying for CPT ${cptLabel}`,
          description: `${payerLabel} typically pays ${pct}% below submitted amount for CPT ${cptLabel} (avg submitted: $${row.avgSubmitted}, avg paid: $${row.avgPaid} across ${row.totalClaims} claims). Consider renegotiating contracted rates or filing underpayment appeals.`,
          confidence: String(Math.min(0.95, 0.5 + (row.totalClaims / 40))),
          dataPoints: row.totalClaims,
          isActive: true,
        });
      }
    }

    // Generate payer trend insights
    for (const row of payerTrends) {
      const recentDays = parseFloat(row.recentAvgDays || "0");
      const olderDays = parseFloat(row.olderAvgDays || "0");
      if (recentDays > 0 && olderDays > 0 && recentDays > olderDays * 1.3) {
        const payerLabel = row.payerName || "Unknown payer";
        newInsights.push({
          practiceId,
          insightType: "payer_trend",
          payerName: row.payerName,
          cptCode: null,
          title: `${payerLabel} processing time increasing`,
          description: `${payerLabel} processing time increased from ${Math.round(olderDays)} days to ${Math.round(recentDays)} days recently. Average across ${row.totalClaims} claims is ${row.avgProcessingDays} days. Plan for longer A/R cycles with this payer.`,
          confidence: String(Math.min(0.90, 0.4 + (row.totalClaims / 50))),
          dataPoints: row.totalClaims,
          isActive: true,
        });
      }
    }

    // Generate modifier optimization tips
    const modifiersByCode = new Map<string, Array<typeof modifierPatterns[number]>>();
    for (const row of modifierPatterns) {
      const key = row.cptCode || "unknown";
      if (!modifiersByCode.has(key)) {
        modifiersByCode.set(key, []);
      }
      modifiersByCode.get(key)!.push(row);
    }

    for (const [cptCode, rows] of Array.from(modifiersByCode.entries())) {
      if (rows.length < 2) continue;
      const withModifier = rows.find((r: any) => r.modifier !== null);
      const withoutModifier = rows.find((r: any) => r.modifier === null);
      if (withModifier && withoutModifier) {
        const rateWith = parseFloat(withModifier.denialRate);
        const rateWithout = parseFloat(withoutModifier.denialRate);
        if (rateWithout - rateWith >= 10) {
          newInsights.push({
            practiceId,
            insightType: "optimization_tip",
            payerName: null,
            cptCode,
            title: `Adding modifier ${withModifier.modifier} to CPT ${cptCode} reduces denials`,
            description: `Claims for CPT ${cptCode} with modifier ${withModifier.modifier} have a ${rateWith}% denial rate vs ${rateWithout}% without the modifier. Adding this modifier could reduce denials by ${Math.round(rateWithout - rateWith)}%.`,
            confidence: String(Math.min(0.90, 0.5 + (withModifier.totalClaims / 30))),
            dataPoints: withModifier.totalClaims + withoutModifier.totalClaims,
            isActive: true,
          });
        }
      }
    }

    // Use OpenAI to generate additional natural language insights if available
    const client = getOpenAI();
    if (client && (denialPatterns.length > 0 || underpaymentPatterns.length > 0)) {
      try {
        const summaryData = {
          denialPatterns: denialPatterns.slice(0, 10),
          underpaymentPatterns: underpaymentPatterns.slice(0, 10),
          payerTrends: payerTrends.slice(0, 10),
        };

        const response = await client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You are a medical billing analyst. Generate 1-3 actionable optimization tips based on the claim outcome data. Return JSON array with objects containing: title, description, insightType (optimization_tip), confidence (0-1), payerName (nullable), cptCode (nullable).",
            },
            {
              role: "user",
              content: `Analyze these claim outcome patterns and suggest optimization tips:\n${JSON.stringify(summaryData, null, 2)}`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 1000,
        });

        const content = response.choices[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          const tips = Array.isArray(parsed.insights) ? parsed.insights : Array.isArray(parsed) ? parsed : [];
          for (const tip of tips.slice(0, 3)) {
            newInsights.push({
              practiceId,
              insightType: String(tip.insightType || "optimization_tip"),
              payerName: tip.payerName || null,
              cptCode: tip.cptCode || null,
              title: String(tip.title || "Optimization suggestion"),
              description: String(tip.description || ""),
              confidence: String(Math.min(1, Math.max(0, parseFloat(tip.confidence) || 0.6))),
              dataPoints: 0,
              isActive: true,
            });
          }
        }
      } catch (aiError) {
        logger.warn("AI Learning: OpenAI insight generation failed, using data-only insights", {
          error: aiError instanceof Error ? aiError.message : String(aiError),
        });
      }
    }

    // Insert all new insights
    if (newInsights.length > 0) {
      await db.insert(aiModelInsights).values(newInsights);
    }

    logger.info("AI Learning: generated insights", {
      practiceId,
      insightCount: newInsights.length,
    });

    return { generated: newInsights.length };
  } catch (error) {
    logger.error("AI Learning: insight generation failed", {
      practiceId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get relevant historical insights for a specific claim.
 * Matches by payer, CPT codes, and ICD-10 codes.
 */
export async function getRecommendationsForClaim(claimId: number): Promise<any[]> {
  try {
    const claim = await db.select().from(claims).where(eq(claims.id, claimId)).limit(1);
    if (!claim || claim.length === 0) return [];

    const claimData = claim[0];

    // Get line items
    const lineItems = await db
      .select({
        cptCode: cptCodes.code,
        icd10Code: icd10Codes.code,
      })
      .from(claimLineItems)
      .leftJoin(cptCodes, eq(claimLineItems.cptCodeId, cptCodes.id))
      .leftJoin(icd10Codes, eq(claimLineItems.icd10CodeId, icd10Codes.id))
      .where(eq(claimLineItems.claimId, claimId));

    // Get payer name
    let payerName: string | null = null;
    if (claimData.insuranceId) {
      const ins = await db.select({ name: insurances.name }).from(insurances).where(eq(insurances.id, claimData.insuranceId)).limit(1);
      if (ins.length > 0) {
        payerName = ins[0].name;
      }
    }

    // Collect unique CPT and ICD-10 codes
    const cptCodeSet = new Set<string>();
    const icd10CodeSet = new Set<string>();
    for (const li of lineItems) {
      if (li.cptCode) cptCodeSet.add(li.cptCode);
      if (li.icd10Code) icd10CodeSet.add(li.icd10Code);
    }
    const cptCodeList = Array.from(cptCodeSet);
    const icd10CodeList = Array.from(icd10CodeSet);

    // Build conditions for matching insights
    const conditions = [
      eq(aiModelInsights.practiceId, claimData.practiceId),
      eq(aiModelInsights.isActive, true),
    ];

    const allInsights = await db
      .select()
      .from(aiModelInsights)
      .where(and(...conditions))
      .orderBy(desc(aiModelInsights.confidence));

    // Filter to relevant insights: matching payer, CPT, or general (null payer/cpt)
    const relevant = allInsights.filter((insight: any) => {
      // General insights (no payer/cpt filter) are always relevant
      if (!insight.payerName && !insight.cptCode) return true;
      // Payer match
      if (insight.payerName && payerName && insight.payerName === payerName) return true;
      // CPT match
      if (insight.cptCode && cptCodeList.includes(insight.cptCode)) return true;
      return false;
    });

    return relevant.slice(0, 10);
  } catch (error) {
    logger.error("AI Learning: failed to get claim recommendations", {
      claimId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
