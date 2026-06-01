/**
 * Compliance Risk Service — pre-submission "will this survive an audit?" layer.
 *
 * This is the Practice-Intel-equivalent of the payer-advocacy wedge: it
 * composes the signals we ALREADY compute (claim scrubber + AI denial
 * predictor + documentation-vs-billed-code cross-check) into ONE
 * audit-readiness verdict a practice can see BEFORE submitting — so risk is
 * caught up front, not discovered via a denial weeks later. Denial prevention
 * is what feeds the Recovery Ledger's "denials flagged pre-submission" pillar.
 *
 * ADVISORY ONLY. This does not add a new hard gate — the claim scrubber's
 * existing error-block on true validation errors is unchanged. This layer
 * surfaces a score + issue list and lets the treating provider decide. It
 * never auto-suppresses or auto-submits.
 *
 * Reuses (does not duplicate):
 *   - scrubClaim()      — server/services/claimScrubber.ts (structural validity)
 *   - predictDenial()   — server/services/aiDenialPredictor.ts (risk model)
 *   - the documentation-support judgment behind the SOAP accuracy work
 */

import { scrubClaim } from "./claimScrubber";
import { predictDenial, type DenialPredictionResult } from "./aiDenialPredictor";
import { storage } from "../storage";
import logger from "./logger";
import {
  type ComplianceIssue,
  severityRank as sev,
  checkDocumentationSupport,
  scoreFromIssues,
} from "./complianceRiskChecks";

// Re-export the pure pieces so existing importers/tests can use this module.
export { checkDocumentationSupport, scoreFromIssues } from "./complianceRiskChecks";
export type { ComplianceIssue } from "./complianceRiskChecks";

export interface ComplianceRiskResult {
  /** 0-100 audit-readiness score. Higher = more defensible. */
  score: number;
  /** Bucketed for UI. */
  level: "ready" | "review" | "at_risk";
  /** True only when the scrubber would hard-block (structural errors). */
  hasBlockingErrors: boolean;
  issues: ComplianceIssue[];
  /** Plain-English headline for the provider. */
  summary: string;
  assessedAt: string;
  /** Echo of the denial model's own score, for transparency. */
  denialRiskScore: number | null;
}

/**
 * Assess a claim's pre-submission audit readiness. Tolerant of partial
 * failures: if the AI predictor is unavailable, we still return the
 * scrubber + documentation signals. Pure helpers (checkDocumentationSupport,
 * scoreFromIssues, severity ranking) live in ./complianceRiskChecks.
 */
export async function assessComplianceRisk(
  claimId: number,
  practiceId: number,
): Promise<ComplianceRiskResult> {
  const issues: ComplianceIssue[] = [];
  let hasBlockingErrors = false;
  let denialRiskScore: number | null = null;

  // 1) Structural scrub (authoritative for hard errors).
  try {
    const scrub = await scrubClaim(claimId, practiceId);
    if (!scrub.passed) hasBlockingErrors = true;
    for (const e of scrub.errors) {
      issues.push({ source: "scrubber", severity: "critical", description: e });
    }
    for (const w of scrub.warnings) {
      issues.push({ source: "scrubber", severity: "medium", description: w });
    }
  } catch (err) {
    logger.warn("complianceRisk: scrub failed", {
      claimId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 2) Gather claim context for the predictor + doc check.
  const claim = await storage.getClaim(claimId);
  const lineItems = await storage.getClaimLineItems(claimId);
  let soapNote: any = null;
  if (claim?.sessionId) {
    try {
      soapNote = await storage.getSoapNoteBySession(claim.sessionId);
    } catch {
      /* no linked note */
    }
  }

  // 3) Documentation-vs-billed-code cross-check (the audit-survival piece
  //    nothing else does pre-submission).
  const soapText = soapNote
    ? [soapNote.subjective, soapNote.objective, soapNote.assessment, soapNote.plan]
        .filter(Boolean)
        .join("\n")
    : "";
  issues.push(...checkDocumentationSupport(lineItems as any[], soapText));

  // 4) AI denial prediction (best-effort).
  if (claim) {
    try {
      const patient = claim.patientId ? await storage.getPatient(claim.patientId) : null;
      const prediction: DenialPredictionResult = await predictDenial(
        claim as any,
        lineItems as any[],
        soapNote,
        (patient as any) ?? { firstName: "", lastName: "" },
      );
      denialRiskScore = prediction.riskScore;
      for (const i of prediction.issues) {
        issues.push({
          source: "denial_predictor",
          severity: i.severity,
          description: i.description,
          suggestion: i.suggestion,
        });
      }
    } catch (err) {
      logger.warn("complianceRisk: denial prediction failed", {
        claimId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 5) Compose a single audit-readiness score (pure helper).
  const score = scoreFromIssues(issues, hasBlockingErrors);

  const level: ComplianceRiskResult["level"] =
    hasBlockingErrors || score < 50 ? "at_risk" : score < 80 ? "review" : "ready";

  const highCount = issues.filter((i) => sev(i.severity) >= 3).length;
  const summary = hasBlockingErrors
    ? "Has blocking validation errors — the claim cannot be submitted until these are fixed."
    : level === "ready"
      ? "Audit-ready. No significant compliance concerns detected."
      : `${highCount} higher-risk issue${highCount === 1 ? "" : "s"} to review before submitting.`;

  // Sort issues most-severe first for display.
  issues.sort((a, b) => sev(b.severity) - sev(a.severity));

  return {
    score,
    level,
    hasBlockingErrors,
    issues,
    summary,
    assessedAt: new Date().toISOString(),
    denialRiskScore,
  };
}
