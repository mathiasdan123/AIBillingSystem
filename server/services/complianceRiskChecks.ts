/**
 * Compliance-risk pure checks — no DB / network imports.
 *
 * The documentation-vs-billed-code cross-check and shared types live here so
 * they can be unit-tested without provisioning a database. The orchestrator
 * (complianceRiskService.ts) imports storage/db and composes these with the
 * scrubber + denial predictor; it re-exports this for back-compat.
 */

export interface ComplianceIssue {
  source: "scrubber" | "denial_predictor" | "documentation";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  suggestion?: string;
}

export const severityRank = (s: string): number =>
  ({ low: 1, medium: 2, high: 3, critical: 4 }[s] ?? 1);

/**
 * Deterministic documentation-vs-billed-code cross-check. For each billed CPT,
 * confirm the SOAP note contains language plausibly supporting that code's
 * skilled objective. Conservative: flags for human review, never auto-removes.
 * The richer AI judgment lives in the SOAP accuracy service; this is the fast
 * pre-submission guardrail.
 */
export function checkDocumentationSupport(
  lineItems: Array<{ cptCode?: { code: string } | null }>,
  soapText: string,
): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const text = soapText.toLowerCase();
  if (!text.trim()) {
    if (lineItems.length > 0) {
      issues.push({
        source: "documentation",
        severity: "high",
        description: "No SOAP documentation is linked to this claim to support the billed codes.",
        suggestion: "Attach the session's signed documentation before submitting.",
      });
    }
    return issues;
  }

  // Per-CPT keyword support (OT-first; speech codes added when ST scope opens).
  const CPT_SUPPORT: Record<string, { label: string; terms: string[] }> = {
    "97112": {
      label: "Neuromuscular re-education",
      terms: ["postural", "balance", "coordination", "motor planning", "praxis", "bilateral", "neuromuscular", "propriocept", "vestibular", "body awareness"],
    },
    "97530": {
      label: "Therapeutic activities",
      terms: ["functional", "activity", "task", "transition", "obstacle", "participation", "fine motor", "play", "adl"],
    },
    "97110": {
      label: "Therapeutic exercise",
      terms: ["strength", "range of motion", "rom", "endurance", "exercise", "stretch", "repetition"],
    },
    "97535": {
      label: "Self-care/home management",
      terms: ["self-care", "self care", "adl", "iadl", "dressing", "feeding", "grooming", "home management"],
    },
    "97533": {
      label: "Sensory integrative",
      terms: ["sensory"],
    },
  };

  for (const lineItem of lineItems) {
    const code = lineItem.cptCode?.code;
    if (!code) continue;
    const support = CPT_SUPPORT[code];
    if (!support) continue; // unknown code — scrubber/predictor handle validity
    const matched = support.terms.some((t) => text.includes(t));
    if (!matched) {
      issues.push({
        source: "documentation",
        severity: "high",
        description: `Billed ${code} (${support.label}) but the documentation has no language supporting that skilled objective.`,
        suggestion: `Document the ${support.label.toLowerCase()} performed, or suppress ${code}.`,
      });
    } else if (code === "97533") {
      const hasFunctionalAnchor = [
        "functional", "postural", "motor planning", "regulation to", "participation", "deficit", "skilled",
      ].some((t) => text.includes(t));
      if (!hasFunctionalAnchor) {
        issues.push({
          source: "documentation",
          severity: "medium",
          description: "Billed 97533 (sensory integrative) but documentation frames sensory work without a clear functional/skilled objective — a common denial trigger.",
          suggestion: "Tie the sensory intervention to a functional deficit and measurable skilled analysis, or map to 97112/97530 by the skilled outcome.",
        });
      }
    }
  }
  return issues;
}

/** Compose a single 0-100 audit-readiness score from issues + blocking flag. */
export function scoreFromIssues(issues: ComplianceIssue[], hasBlockingErrors: boolean): number {
  let score = 100;
  for (const i of issues) {
    score -= { low: 3, medium: 8, high: 18, critical: 35 }[i.severity] ?? 5;
  }
  if (hasBlockingErrors) score = Math.min(score, 30);
  return Math.max(0, Math.min(100, score));
}
