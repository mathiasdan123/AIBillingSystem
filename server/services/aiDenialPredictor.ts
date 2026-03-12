import OpenAI from "openai";
import logger from "./logger";

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    logger.warn("OPENAI_API_KEY not set - AI denial prediction disabled");
    return null;
  }
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
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
  const therapyCodes = ["97110", "97112", "97140", "97530", "97535", "97542"];
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

    if (!/progress|improv|decline|regress|functional|independence|deficit/.test(allText)) {
      issues.push({
        category: "Medical Necessity",
        description:
          "SOAP note lacks functional outcome language needed to support medical necessity",
        suggestion:
          "Include language about patient progress, functional deficits, or decline to demonstrate medical necessity for skilled services",
        severity: "medium",
      });
    }

    if (!/goal|objective|target/.test(allText)) {
      issues.push({
        category: "Medical Necessity",
        description: "SOAP note does not reference treatment goals",
        suggestion:
          "Document specific, measurable treatment goals and how the session addressed them. Payers expect goal-directed treatment documentation.",
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

/**
 * Calculate a risk score from rule-based issues.
 * Used as a fallback when OpenAI is not available.
 */
function calculateRuleBasedScore(issues: DenialPredictionIssue[]): number {
  let score = 0;
  for (const issue of issues) {
    switch (issue.severity) {
      case "critical":
        score += 30;
        break;
      case "high":
        score += 20;
        break;
      case "medium":
        score += 10;
        break;
      case "low":
        score += 5;
        break;
    }
  }
  return Math.min(100, score);
}

function getRiskLevel(score: number): "low" | "medium" | "high" {
  if (score < 30) return "low";
  if (score < 70) return "medium";
  return "high";
}

/**
 * Predict whether a claim will be denied before submission.
 * Uses rule-based checks plus OpenAI analysis when available.
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
  const client = getOpenAI();

  if (!client) {
    // Fallback to rule-based only
    const riskScore = calculateRuleBasedScore(ruleIssues);
    const riskLevel = getRiskLevel(riskScore);
    return {
      riskScore,
      riskLevel,
      issues: ruleIssues,
      overallRecommendation:
        ruleIssues.length === 0
          ? "No obvious denial risks detected based on rule checks. AI analysis unavailable."
          : `Found ${ruleIssues.length} potential issue(s) through rule-based analysis. Configure OPENAI_API_KEY for deeper AI analysis.`,
      analyzedAt: new Date().toISOString(),
    };
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

  const prompt = `You are an expert medical billing analyst specializing in therapy claims (OT, PT, SLP). Analyze this claim for denial risk.

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

Analyze for:
1. CPT/ICD-10 code compatibility and medical necessity linkage
2. Documentation completeness and quality for supporting the billed services
3. Common denial triggers: missing modifiers, authorization requirements, bundling conflicts, frequency limits
4. Payer-specific patterns if the insurance provider is known
5. Any additional issues not caught by the rule-based checks

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
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a medical billing denial prediction system. Respond only with valid JSON. Be specific and actionable in your suggestions.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 1500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI");
    }

    const aiResult = JSON.parse(content);

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

    return {
      riskScore,
      riskLevel,
      issues: allIssues,
      overallRecommendation:
        String(aiResult.overallRecommendation || "") ||
        `Claim analyzed with ${allIssues.length} issue(s) found.`,
      analyzedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error("AI denial prediction failed, using rule-based fallback", {
      error: error instanceof Error ? error.message : String(error),
    });

    // Fallback to rule-based
    const riskScore = calculateRuleBasedScore(ruleIssues);
    const riskLevel = getRiskLevel(riskScore);
    return {
      riskScore,
      riskLevel,
      issues: ruleIssues,
      overallRecommendation:
        ruleIssues.length === 0
          ? "No obvious denial risks detected. AI-enhanced analysis was unavailable."
          : `Found ${ruleIssues.length} potential issue(s). AI-enhanced analysis was unavailable due to an error.`,
      analyzedAt: new Date().toISOString(),
    };
  }
}
