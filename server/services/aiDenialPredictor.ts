import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, isAiConfigured } from './aiProvider';
import logger from "./logger";
import { getRecommendationsForClaim } from "./aiLearningService";

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!isAiConfigured()) {
    logger.warn("ANTHROPIC_API_KEY not set - AI denial prediction disabled");
    return null;
  }
  if (!anthropicClient) {
    anthropicClient = createAiClient({ apiKey });
  }
  return anthropicClient;
}

export interface DenialPredictionIssue {
  category: string;
  description: string;
  suggestion: string;
  severity: "low" | "medium" | "high" | "critical";
}

export interface DenialPredictionResult {
  riskScore: number; // 0-100
  riskLevel: "low" | "medium" | "high";
  issues: DenialPredictionIssue[];
  overallRecommendation: string;
  analyzedAt: string;
}

interface ClaimInput {
  id: number;
  claimNumber?: string | null;
  totalAmount: string;
  status?: string | null;
  insuranceId?: number | null;
  sessionId?: number | null;
}

interface LineItemInput {
  cptCodeId: number;
  icd10CodeId?: number | null;
  units: number;
  rate: string;
  amount: string;
  modifier?: string | null;
  dateOfService?: string | null;
  cptCode?: { code: string; description: string } | null;
  icd10Code?: { code: string; description: string } | null;
}

interface SoapNoteInput {
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  sessionType?: string | null;
  interventions?: any;
  homeProgram?: string | null;
  progressNotes?: string | null;
}

interface PatientInput {
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
  insuranceProvider?: string | null;
  insuranceId?: string | null;
}

/**
 * Run rule-based pre-checks before calling the AI model.
 * These catch obvious issues without spending API tokens.
 */
function runRuleBasedChecks(
  claim: ClaimInput,
  lineItems: LineItemInput[],
  soapNote: SoapNoteInput | null,
  patient: PatientInput
): DenialPredictionIssue[] {
  const issues: DenialPredictionIssue[] = [];

  // Check for missing line items
  if (!lineItems || lineItems.length === 0) {
    issues.push({
      category: "Missing Data",
      description: "Claim has no line items / CPT codes",
      suggestion: "Add at least one CPT code with appropriate units before submitting",
      severity: "critical",
    });
  }

  // Check for missing diagnosis codes
  const lineItemsWithoutDiagnosis = lineItems.filter(
    (li) => !li.icd10CodeId && !li.icd10Code
  );
  if (lineItemsWithoutDiagnosis.length > 0) {
    issues.push({
      category: "Missing Diagnosis",
      description: `${lineItemsWithoutDiagnosis.length} line item(s) missing ICD-10 diagnosis code`,
      suggestion:
        "Every service line should have an ICD-10 code that supports medical necessity for the procedure",
      severity: "high",
    });
  }

  // Check for missing modifiers on therapy codes
  const therapyCodes = ["97110", "97112", "97140", "97530", "97533", "97535", "97542"];
  for (const li of lineItems) {
    const code = li.cptCode?.code || "";
    if (therapyCodes.includes(code) && !li.modifier) {
      issues.push({
        category: "Missing Modifier",
        description: `CPT ${code} (${li.cptCode?.description || "therapy"}) may require a modifier (e.g., GP for physical therapy, GO for occupational therapy)`,
        suggestion:
          "Add the appropriate therapy modifier. Many payers deny claims without discipline-specific modifiers on therapy codes.",
        severity: "medium",
      });
      break; // Only flag once for modifier issues
    }
  }

  // Check SOAP note documentation quality
  if (soapNote) {
    const sections = [
      { name: "Subjective", value: soapNote.subjective, minLength: 30 },
      { name: "Objective", value: soapNote.objective, minLength: 30 },
      { name: "Assessment", value: soapNote.assessment, minLength: 30 },
      { name: "Plan", value: soapNote.plan, minLength: 20 },
    ];

    const missingSections = sections.filter(
      (s) => !s.value || s.value.trim().length < s.minLength
    );

    if (missingSections.length > 0) {
      issues.push({
        category: "Documentation",
        description: `SOAP note has insufficient documentation in: ${missingSections.map((s) => s.name).join(", ")}`,
        suggestion:
          "Ensure all SOAP sections contain detailed clinical documentation. Payers may deny claims with inadequate medical records.",
        severity: missingSections.length >= 3 ? "high" : "medium",
      });
    }

    // Check for functional outcomes / medical necessity language
    const allText = `${soapNote.subjective || ""} ${soapNote.objective || ""} ${soapNote.assessment || ""} ${soapNote.plan || ""}`.toLowerCase();

    const hasFunctionalLang = /progress|improv|decline|regress|functional|independence|deficit/.test(allText);
    const hasGoalLang = /goal|objective|target/.test(allText);
    // Skilled-clinical-reasoning markers: grading/adapting the activity, cueing,
    // facilitation technique, hand-over-hand, explicit clinical reasoning.
    const hasSkilledLang = /skilled|clinical reasoning|grade[d]?|adapt|facilitat|cue|technique|hand-over-hand/.test(allText);

    if (!hasFunctionalLang) {
      issues.push({
        category: "Medical Necessity",
        description:
          "SOAP note lacks functional outcome language needed to support medical necessity",
        suggestion:
          "Include language about patient progress, functional deficits, or decline to demonstrate medical necessity for skilled services",
        severity: "medium",
      });
    }

    if (!hasGoalLang) {
      issues.push({
        category: "Medical Necessity",
        description: "SOAP note does not reference treatment goals",
        suggestion:
          "Document specific, measurable treatment goals and how the session addressed them. Payers expect goal-directed treatment documentation.",
        severity: "medium",
      });
    }

    // Sensory-based intervention without a functional/skilled/goal connection.
    // Scoped narrowly per clinical guidance: the sensory work itself is fine — the
    // risk is documentation that reads as an activity list. Only fire when NONE of
    // functional language, skilled reasoning, or a goal link is present.
    const hasSensoryIntervention =
      /sensory|vestibular|propriocept|deep pressure|brushing|swing|body sock|crash (mat|pad)|tactile|sensory diet|sensory integration/.test(allText);
    if (hasSensoryIntervention && !hasFunctionalLang && !hasSkilledLang && !hasGoalLang) {
      issues.push({
        category: "Medical Necessity",
        description:
          "Sensory-based intervention is documented without a clear functional connection, skilled clinical reasoning, or link to treatment goals",
        suggestion:
          "For sensory-based treatment, document the functional deficit addressed, the skilled component (e.g., grading/adapting the activity, clinical reasoning), and how it connects to the child's functional goals. Payers deny sensory documentation that reads as an activity list.",
        severity: "medium",
      });
    }

    // Non-functional goal language: goals targeting an underlying skill (sensory
    // processing, attention, strength, etc.) with no participation-based outcome.
    const hasParticipationOutcome =
      /participat|classroom|self-care|daily activit|\badl\b|function|play|school|community|routine/.test(allText);
    const hasUnderlyingSkillGoal =
      /improve (sensory processing|sensory|attention|strength|postural control|tone|range of motion|coordination|core)/.test(allText);
    if (hasUnderlyingSkillGoal && !hasParticipationOutcome) {
      issues.push({
        category: "Medical Necessity",
        description:
          "Goal language targets an underlying skill (e.g., sensory processing, attention, strength) without a participation-based functional outcome",
        suggestion:
          'Reframe the goal around functional participation (e.g., "...to participate in classroom handwriting" rather than "improve strength"). Payers more readily approve goals tied to daily-activity participation.',
        severity: "medium",
      });
    }
  } else {
    issues.push({
      category: "Documentation",
      description: "No SOAP note found for this claim's session",
      suggestion:
        "Attach a detailed SOAP note to the treatment session before submitting the claim. Claims without supporting documentation are frequently denied.",
      severity: "high",
    });
  }

  // Check for timely filing (basic check using date of service)
  if (lineItems.length > 0) {
    const oldestService = lineItems
      .filter((li) => li.dateOfService)
      .map((li) => new Date(li.dateOfService!))
      .sort((a, b) => a.getTime() - b.getTime())[0];

    if (oldestService) {
      const daysSinceService = Math.floor(
        (Date.now() - oldestService.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceService > 90) {
        issues.push({
          category: "Timely Filing",
          description: `Date of service is ${daysSinceService} days ago. Many payers require submission within 90 days.`,
          suggestion:
            "Submit this claim immediately. Check the payer's timely filing limit. Consider including documentation explaining the delay if past the deadline.",
          severity: daysSinceService > 180 ? "critical" : "high",
        });
      } else if (daysSinceService > 60) {
        issues.push({
          category: "Timely Filing",
          description: `Date of service is ${daysSinceService} days ago. Approaching common timely filing deadlines.`,
          suggestion:
            "Submit this claim soon to avoid timely filing denials. Most payers have 90-180 day filing windows.",
          severity: "medium",
        });
      }
    }
  }

  // Check for duplicate/excessive units
  for (const li of lineItems) {
    if (li.units > 4) {
      issues.push({
        category: "Excessive Units",
        description: `${li.units} units billed for CPT ${li.cptCode?.code || li.cptCodeId}. Most payers allow a maximum of 4 units (1 hour) per code per session.`,
        suggestion:
          "Review the number of units. If more than 4 units are clinically appropriate, ensure documentation supports the extended treatment time.",
        severity: "medium",
      });
    }
  }

  return issues;
}

const SEVERITY_WEIGHT: Record<DenialPredictionIssue["severity"], number> = {
  critical: 30,
  high: 20,
  medium: 10,
  low: 5,
};

/**
 * Calculate a risk score from rule-based issues.
 * Used as a fallback when Claude is not available.
 */
function calculateRuleBasedScore(issues: DenialPredictionIssue[]): number {
  let score = 0;
  for (const issue of issues) {
    score += SEVERITY_WEIGHT[issue.severity] ?? 0;
  }
  return Math.min(100, score);
}

function getRiskLevel(score: number): "low" | "medium" | "high" {
  if (score < 30) return "low";
  if (score < 70) return "medium";
  return "high";
}

/**
 * Date handling rules for the analysis prompt.
 *
 * The model has no clock. Given a bare date of service it reasoned from its
 * training cutoff and called a date three months PAST "in the future, which is
 * invalid" — raising it as a CRITICAL data-entry error on a real claim, and
 * burying the genuine timely-filing risk the rule-based check had already
 * found correctly. Worse, it told the biller to "correct the date of service",
 * which on a real claim is an instruction to falsify a treatment record.
 *
 * Exported so the guarantee is testable without a live model call.
 */
export function buildDateGuidance(now: Date = new Date()): string {
  const today = now.toISOString().split("T")[0];
  return `TODAY'S DATE IS ${today}. Judge every date against it — a date of service before today is in the PAST, however far ahead it may seem. Never describe a past date as a future date.

NEVER suggest changing, correcting, or adjusting a date of service to improve a claim's chances. The date of service records when care actually happened; altering it to get a claim paid is fraud. If a date looks wrong, say to verify it against the clinical record — nothing more.`;
}

/** The only thing we will ever say about a date that looks wrong. */
const SAFE_DATE_ADVICE =
  "Verify the date of service against the clinical record. Do not alter it — the date records when care actually happened.";

/** Text asserting the service date is in the future. */
const FUTURE_CLAIM = /\b(future[- ]dated|in the future|future date|not yet occurred|has not occurred)\b/i;

/** Text referring to the date of service. */
const SERVICE_DATE = /\b(date[s]? of service|service date[s]?|DOS)\b/i;

/** "correct the date of service" and its many phrasings, in either word order. */
const CHANGE_VERB = /\b(correct|change|changing|adjust|adjusting|updat(?:e|ing)|fix(?:ing)?|amend(?:ing)?|modif(?:y|ying)|revis(?:e|ing)|backdat(?:e|ing))\b/i;

/** True if one sentence advises editing the date of service. */
function advisesDateChange(sentence: string): boolean {
  if (!SERVICE_DATE.test(sentence)) return false;
  if (!CHANGE_VERB.test(sentence)) return false;
  // Both orders occur: "correct the date of service" and "the date of service
  // should be corrected". Requiring only co-occurrence within one sentence is
  // deliberately broad — a false positive costs one stripped sentence, a false
  // negative tells a biller to falsify a treatment record.
  return true;
}

/**
 * Remove the offending clause from one sentence, keeping the rest.
 *
 * Granularity matters here. The real recommendation was a single sentence —
 * "Immediately correct the date of service, add appropriate therapy modifiers
 * (GP/GO/GN), and obtain comprehensive SOAP documentation" — so dropping the
 * whole sentence would have thrown away the legitimate advice along with the
 * unsafe clause. Returns "" when nothing separable survives.
 */
function stripDateChangeClauses(sentence: string): string {
  const clauses = sentence.split(/\s*[,;]\s*/);
  if (clauses.length < 2) return "";
  const kept = clauses.filter((c) => !advisesDateChange(c));
  if (kept.length === 0) return "";
  let rebuilt = kept.join(", ").replace(/^(and|then|also)\s+/i, "").trim();
  rebuilt = rebuilt.charAt(0).toUpperCase() + rebuilt.slice(1);
  return /[.!?]$/.test(rebuilt) ? rebuilt : `${rebuilt}.`;
}

/** Remove advice to edit the date of service; keep everything else it said. */
function stripDateChangeAdvice(text: string): { text: string; changed: boolean } {
  if (!text) return { text, changed: false };
  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  let changed = false;

  for (const sentence of sentences) {
    if (!advisesDateChange(sentence)) {
      kept.push(sentence);
      continue;
    }
    changed = true;
    const salvaged = stripDateChangeClauses(sentence);
    if (salvaged) kept.push(salvaged);
  }

  if (!changed) return { text, changed: false };
  const remainder = kept.join(" ").trim();
  return {
    text: remainder ? `${remainder} ${SAFE_DATE_ADVICE}` : SAFE_DATE_ADVICE,
    changed: true,
  };
}

/** A date-ish value reduced to YYYY-MM-DD, or null if unparseable. */
function toIsoDay(value: string): string | null {
  const direct = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().split("T")[0];
}

/**
 * Deterministic guard over the model's output.
 *
 * #321 told the model today's date and forbade date-change advice, but that is
 * a prompt — nothing checked what came back. Two guarantees are too important
 * to leave to instruction-following, so they are enforced here on the result:
 *
 *  1. A date of service that is NOT in the future is never reported as one.
 *     The model, reasoning from its training cutoff, called a date 107 days
 *     past "in the future, which is invalid" and marked it CRITICAL — burying
 *     the real timely-filing risk underneath it.
 *  2. Nothing ever advises changing, correcting, or adjusting a date of
 *     service. On a real claim that is an instruction to falsify when
 *     treatment happened. This one is unconditional: it holds even when the
 *     date genuinely IS in the future.
 *
 * Dropping a fabricated issue also removes its contribution to the score, so
 * the risk level reflects what is actually left. The surviving rule-based
 * score is a floor — sanitizing must not talk a genuinely risky claim down.
 *
 * Exported for testing: this asserts on the OUTPUT, which is what the prompt
 * fix could not.
 */
export function sanitizeDateAdvice(
  result: DenialPredictionResult,
  lineItems: Pick<LineItemInput, "dateOfService">[],
  now: Date = new Date()
): DenialPredictionResult {
  const today = now.toISOString().split("T")[0];
  const serviceDays = (lineItems || [])
    .map((li) => (li.dateOfService ? toIsoDay(li.dateOfService) : null))
    .filter((d): d is string => !!d);
  // String comparison is safe on YYYY-MM-DD and sidesteps timezone drift.
  const hasFutureService = serviceDays.some((d) => d > today);

  const dropped: DenialPredictionIssue[] = [];
  const issues: DenialPredictionIssue[] = [];
  let strippedSuggestions = 0;

  for (const issue of result.issues || []) {
    const claimsFuture =
      FUTURE_CLAIM.test(`${issue.category} ${issue.description}`) &&
      SERVICE_DATE.test(`${issue.category} ${issue.description}`);

    // Only a fabrication if no service date is actually in the future. When a
    // date really is future-dated the finding is legitimate and stays.
    if (claimsFuture && !hasFutureService && serviceDays.length > 0) {
      dropped.push(issue);
      continue;
    }

    const suggestion = stripDateChangeAdvice(issue.suggestion || "");
    if (suggestion.changed) strippedSuggestions++;
    issues.push(suggestion.changed ? { ...issue, suggestion: suggestion.text } : issue);
  }

  const recommendation = stripDateChangeAdvice(result.overallRecommendation || "");

  if (dropped.length === 0 && strippedSuggestions === 0 && !recommendation.changed) {
    return result;
  }

  // Re-score: remove what the dropped issues contributed, but never fall below
  // the risk the surviving rule-based findings justify on their own.
  const droppedWeight = dropped.reduce((sum, i) => sum + (SEVERITY_WEIGHT[i.severity] ?? 0), 0);
  const floor = Math.min(calculateRuleBasedScore(issues), result.riskScore);
  const riskScore = Math.max(0, Math.min(100, Math.max(result.riskScore - droppedWeight, floor)));

  // A signal that the model regressed against its own instructions. Counts
  // only — issue text can quote claim data.
  logger.warn("Denial prediction output failed date guardrails; sanitized", {
    droppedFutureDateIssues: dropped.length,
    strippedSuggestions,
    strippedOverallRecommendation: recommendation.changed,
    riskScoreBefore: result.riskScore,
    riskScoreAfter: riskScore,
  });

  return {
    ...result,
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    issues,
    overallRecommendation: recommendation.text,
  };
}

/**
 * Predict whether a claim will be denied before submission.
 * Uses rule-based checks plus Claude analysis when available.
 */
export async function predictDenial(
  claim: ClaimInput,
  lineItems: LineItemInput[],
  soapNote: SoapNoteInput | null,
  patient: PatientInput
): Promise<DenialPredictionResult> {
  // Step 1: Rule-based pre-checks
  const ruleIssues = runRuleBasedChecks(claim, lineItems, soapNote, patient);

  // Step 2: Try AI-enhanced analysis
  const client = getAnthropic();

  if (!client) {
    // Fallback to rule-based only
    const riskScore = calculateRuleBasedScore(ruleIssues);
    const riskLevel = getRiskLevel(riskScore);
    return sanitizeDateAdvice(
      {
        riskScore,
        riskLevel,
        issues: ruleIssues,
        overallRecommendation:
          ruleIssues.length === 0
            ? "No obvious denial risks detected based on rule checks. AI analysis unavailable."
            : `Found ${ruleIssues.length} potential issue(s) through rule-based analysis. Configure OPENAI_API_KEY for deeper AI analysis.`,
        analyzedAt: new Date().toISOString(),
      },
      lineItems
    );
  }

  // Build context for AI
  const lineItemDetails = lineItems.map((li) => ({
    cptCode: li.cptCode?.code || `ID:${li.cptCodeId}`,
    cptDescription: li.cptCode?.description || "Unknown",
    icd10Code: li.icd10Code?.code || (li.icd10CodeId ? `ID:${li.icd10CodeId}` : "MISSING"),
    icd10Description: li.icd10Code?.description || "",
    units: li.units,
    modifier: li.modifier || "None",
    amount: li.amount,
    dateOfService: li.dateOfService || "Not specified",
  }));

  const soapSummary = soapNote
    ? {
        subjective: (soapNote.subjective || "").substring(0, 500),
        objective: (soapNote.objective || "").substring(0, 500),
        assessment: (soapNote.assessment || "").substring(0, 500),
        plan: (soapNote.plan || "").substring(0, 500),
        sessionType: soapNote.sessionType || "individual",
        hasInterventions: !!soapNote.interventions,
        hasHomeProgram: !!soapNote.homeProgram,
        hasProgressNotes: !!soapNote.progressNotes,
      }
    : null;

  // Fetch historical AI insights for this claim
  let historicalInsights: any[] = [];
  try {
    historicalInsights = await getRecommendationsForClaim(claim.id);
  } catch (insightError) {
    logger.warn("Failed to fetch historical insights for denial prediction (non-blocking)", {
      claimId: claim.id,
      error: insightError instanceof Error ? insightError.message : String(insightError),
    });
  }

  const historicalInsightsText = historicalInsights.length > 0
    ? `\nHISTORICAL INSIGHTS FROM CLAIM OUTCOMES:\n${historicalInsights.map((i: any) => `- [${i.insightType}] ${i.title}: ${i.description} (confidence: ${i.confidence}, data points: ${i.dataPoints})`).join("\n")}`
    : "";

  const prompt = `You are an expert medical billing analyst specializing in therapy claims (OT, PT, SLP). Analyze this claim for denial risk.

${buildDateGuidance()}

CLAIM DETAILS:
- Total Amount: $${claim.totalAmount}
- Insurance Provider: ${patient.insuranceProvider || "Unknown"}
- Patient DOB: ${patient.dateOfBirth || "Unknown"}

LINE ITEMS:
${JSON.stringify(lineItemDetails, null, 2)}

SOAP NOTE:
${soapSummary ? JSON.stringify(soapSummary, null, 2) : "No SOAP note available"}

RULE-BASED ISSUES ALREADY IDENTIFIED:
${ruleIssues.length > 0 ? JSON.stringify(ruleIssues, null, 2) : "None"}
${historicalInsightsText}

Analyze for:
1. CPT/ICD-10 code compatibility and medical necessity linkage
2. Documentation completeness and quality for supporting the billed services
3. Common denial triggers: missing modifiers, authorization requirements, bundling conflicts, frequency limits
4. Payer-specific patterns if the insurance provider is known
5. Any additional issues not caught by the rule-based checks
6. Patterns from historical claim outcomes (if available above)

Return a JSON object with this exact structure:
{
  "riskScore": <number 0-100>,
  "riskLevel": "<low|medium|high>",
  "additionalIssues": [
    {
      "category": "<string>",
      "description": "<string>",
      "suggestion": "<string>",
      "severity": "<low|medium|high|critical>"
    }
  ],
  "overallRecommendation": "<1-2 sentence summary of overall claim health and next steps>"
}

Only include ADDITIONAL issues not already in the rule-based list. Set riskScore considering BOTH rule-based and your additional findings.`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      temperature: 0.3,
      // Cache the system prompt as a text-block array. The current prompt
      // body is well under the 1024-token caching minimum so the API will
      // not actually cache it today — the marker is in place so that if the
      // prompt is later extended past the threshold (rule library, payer
      // playbooks, etc.) it caches automatically without another code change.
      system: [
        {
          type: "text",
          text: "You are a medical billing denial prediction system. Respond with ONLY a valid JSON object, no markdown fencing or commentary. Be specific and actionable in your suggestions.",
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const content = textBlock?.text;
    if (!content) {
      throw new Error("No response from Claude");
    }

    const jsonMatch =
      content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content;
    const aiResult = JSON.parse(jsonStr);

    // Merge rule-based issues with AI-detected additional issues
    const allIssues: DenialPredictionIssue[] = [
      ...ruleIssues,
      ...(aiResult.additionalIssues || []).map((issue: any) => ({
        category: String(issue.category || "AI Analysis"),
        description: String(issue.description || ""),
        suggestion: String(issue.suggestion || ""),
        severity: (["low", "medium", "high", "critical"].includes(issue.severity)
          ? issue.severity
          : "medium") as DenialPredictionIssue["severity"],
      })),
    ];

    const riskScore = Math.max(
      0,
      Math.min(100, Math.round(Number(aiResult.riskScore) || 0))
    );
    const riskLevel = getRiskLevel(riskScore);

    return sanitizeDateAdvice(
      {
        riskScore,
        riskLevel,
        issues: allIssues,
        overallRecommendation:
          String(aiResult.overallRecommendation || "") ||
          `Claim analyzed with ${allIssues.length} issue(s) found.`,
        analyzedAt: new Date().toISOString(),
      },
      lineItems
    );
  } catch (error) {
    logger.error("AI denial prediction failed, using rule-based fallback", {
      error: error instanceof Error ? error.message : String(error),
    });

    // Fallback to rule-based
    const riskScore = calculateRuleBasedScore(ruleIssues);
    const riskLevel = getRiskLevel(riskScore);
    return sanitizeDateAdvice(
      {
        riskScore,
        riskLevel,
        issues: ruleIssues,
        overallRecommendation:
          ruleIssues.length === 0
            ? "No obvious denial risks detected. AI-enhanced analysis was unavailable."
            : `Found ${ruleIssues.length} potential issue(s). AI-enhanced analysis was unavailable due to an error.`,
        analyzedAt: new Date().toISOString(),
      },
      lineItems
    );
  }
}
