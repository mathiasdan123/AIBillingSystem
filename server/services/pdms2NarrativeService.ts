/**
 * AI narrative drafter for PDMS-2 structured assessments (clinician request — Megan).
 *
 * Drafts a brief narrative summary of what the entered PDMS-2 scores mean and
 * the patient's current ability, incorporating the therapist's own notes on
 * tasks that went well and tasks that were challenging. The therapist reviews
 * and edits before it is used — this only produces a draft; the therapist
 * decides what stands.
 *
 * Anti-fabrication charter (same as SOAP/progress-report generation):
 * - Uses ONLY the entered scores, sums, quotients, and therapist notes below.
 * - Interprets scores ONLY via the standard descriptive bands already attached
 *   to them (Average, Below Average, etc.) — never beyond.
 * - Never invents clinical detail, test observations, or items; never states
 *   PDMS-2 item content or mastery criteria (which live only in the
 *   therapist's Examiner's Manual).
 * - Fails loudly rather than faking a narrative.
 */

import { storage } from "../storage";
import { assertPhiAiAllowed } from "../utils/phiAiGuard";
import { createAiClient, isAiConfigured } from "./aiProvider";
import {
  PDMS2_SUBTESTS,
  PDMS2_SUBTEST_ORDER,
  type Pdms2SubtestKey,
  type Pdms2Subtests,
} from "@shared/pdms2";
import { computeAssessmentState, type Pdms2ComputedState } from "./pdms2ScoringService";
import logger from "./logger";

export interface Pdms2NarrativeResult {
  narrative: string;
}

function describeScores(
  subtests: Pdms2Subtests,
  computed: Pdms2ComputedState,
): string {
  const lines: string[] = [];
  for (const key of PDMS2_SUBTEST_ORDER) {
    const entry = subtests[key];
    const comp = computed.subtests[key as Pdms2SubtestKey];
    if (!entry || !comp) continue;
    const parts: string[] = [];
    if (comp.administeredCount > 0) {
      parts.push(`raw score ${comp.rawScore}${comp.complete ? "" : " (subtest incomplete)"}`);
    }
    if (entry.standardScore != null) {
      parts.push(`standard score ${entry.standardScore} (${comp.standardScoreBand})`);
    }
    if (entry.percentileRank != null && entry.percentileRank !== "") {
      parts.push(`percentile rank ${entry.percentileRank}`);
    }
    if (entry.ageEquivalentMonths != null) {
      parts.push(`age equivalent ${entry.ageEquivalentMonths} months`);
    }
    if (parts.length === 0) continue;
    lines.push(`- ${PDMS2_SUBTESTS[key as Pdms2SubtestKey].name} (${PDMS2_SUBTESTS[key as Pdms2SubtestKey].measures}): ${parts.join(", ")}`);
  }
  return lines.length ? lines.join("\n") : "(no subtest scores entered)";
}

export async function generatePdms2Narrative(params: {
  assessmentId: number;
  practiceId: number;
}): Promise<Pdms2NarrativeResult> {
  assertPhiAiAllowed("PDMS-2 narrative generation");

  const assessment = await storage.getPdms2Assessment(params.assessmentId);
  if (!assessment || assessment.practiceId !== params.practiceId) {
    throw new Error("Assessment not found");
  }

  const client = isAiConfigured()
    ? createAiClient({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY })
    : null;
  if (!client) throw new Error("Narrative generation is unavailable: AI is not configured");

  const subtests = (assessment.subtests ?? {}) as Pdms2Subtests;
  // Recompute rather than trusting the stored blob — the narrative must
  // reflect exactly what the scoring logic says about the entered data.
  const computed = computeAssessmentState({
    ageInMonths: assessment.ageInMonths,
    subtests,
    grossMotorQuotient: assessment.grossMotorQuotient,
    fineMotorQuotient: assessment.fineMotorQuotient,
    totalMotorQuotient: assessment.totalMotorQuotient,
  });

  const scoresBlock = describeScores(subtests, computed);
  if (scoresBlock === "(no subtest scores entered)") {
    throw new Error("No scores entered yet — enter subtest scores before generating a narrative.");
  }

  const quotientLines: string[] = [];
  if (assessment.grossMotorQuotient != null) {
    quotientLines.push(`- Gross Motor Quotient (GMQ): ${assessment.grossMotorQuotient} (${computed.quotientBands.grossMotor})`);
  }
  if (assessment.fineMotorQuotient != null) {
    quotientLines.push(`- Fine Motor Quotient (FMQ): ${assessment.fineMotorQuotient} (${computed.quotientBands.fineMotor})`);
  }
  if (assessment.totalMotorQuotient != null) {
    quotientLines.push(`- Total Motor Quotient (TMQ): ${assessment.totalMotorQuotient} (${computed.quotientBands.totalMotor})`);
  }

  const prompt = `You are a pediatric occupational therapy clinician drafting a brief narrative summary of a PDMS-2 (Peabody Developmental Motor Scales, 2nd ed.) administration. The treating therapist will review and edit this draft; it is never used as-is. Follow these rules absolutely:
- Use ONLY the scores, descriptive categories, and therapist notes below. Invent nothing: no test items, no observations, no clinical detail not present here.
- Interpret scores ONLY through the descriptive categories already attached to them (e.g. "Average", "Below Average"). Do not speculate about diagnoses, causes, or prognosis.
- Do not reference, quote, or describe any PDMS-2 item content, administration instructions, or mastery criteria.
- Weave the therapist's notes about tasks that went well and tasks that were challenging into the summary, attributing them as the therapist's observations.
- Concise clinical prose, 1-2 short paragraphs. No filler, no emojis, no headings.
- If the data is thin, write a modest summary rather than padding.

CHILD'S CHRONOLOGICAL AGE AT TESTING: ${assessment.ageInMonths} months

SUBTEST SCORES ENTERED:
${scoresBlock}

QUOTIENTS ENTERED (from the therapist's normative-table lookups):
${quotientLines.length ? quotientLines.join("\n") : "(none entered)"}

THERAPIST NOTES — TASKS THAT WENT WELL:
${assessment.tasksWentWell?.trim() || "(none recorded)"}

THERAPIST NOTES — TASKS THAT WERE CHALLENGING:
${assessment.tasksChallenging?.trim() || "(none recorded)"}

Respond with ONLY this JSON:
{
  "narrative": "The narrative summary text."
}`;

  const response = await client.messages.create({
    model: process.env.AI_SOAP_MODEL || "claude-sonnet-4-5",
    max_tokens: 1000,
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn("PDMS-2 narrative returned unparseable output");
    throw new Error("Narrative generation failed to produce a result");
  }
  const parsed = JSON.parse(jsonMatch[0]);
  if (typeof parsed.narrative !== "string" || !parsed.narrative.trim()) {
    throw new Error("Narrative generation failed to produce a result");
  }

  return { narrative: parsed.narrative.trim() };
}
