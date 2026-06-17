import { describe, it, expect } from "vitest";
import { extractSoapPreview } from "../soapPreview";

describe("extractSoapPreview", () => {
  it("returns empty string before any section value has streamed", () => {
    expect(extractSoapPreview("")).toBe("");
    // Key opened but no characters yet → nothing shown until the first char.
    expect(extractSoapPreview('{"subjective": "')).toBe("");
    expect(extractSoapPreview('{"subjective": "C')).toBe("Subjective\nC");
  });

  it("shows a partial (still-streaming, unterminated) section value", () => {
    const raw = '{"subjective": "Caregiver reported the patient was tir';
    expect(extractSoapPreview(raw)).toBe("Subjective\nCaregiver reported the patient was tir");
  });

  it("renders sections in order as they complete", () => {
    const raw =
      '{"subjective": "Brief report.", "objective": "Performed obstacle course", "assessment": "Demonstrat';
    expect(extractSoapPreview(raw)).toBe(
      "Subjective\nBrief report.\n\nObjective\nPerformed obstacle course\n\nAssessment\nDemonstrat",
    );
  });

  it("unescapes newlines, tabs, quotes, and backslashes", () => {
    const raw = '{"objective":"Line 1\\nLine 2\\tcol\\\\path \\"quoted\\""}';
    expect(extractSoapPreview(raw)).toBe('Objective\nLine 1\nLine 2 col\\path "quoted"');
  });

  it("ignores non-narrative trailing keys (billing JSON)", () => {
    const raw =
      '{"subjective":"S","objective":"O","assessment":"A","plan":"P","billingCodes":[{"code":"97530"';
    expect(extractSoapPreview(raw)).toBe(
      "Subjective\nS\n\nObjective\nO\n\nAssessment\nA\n\nPlan\nP",
    );
  });

  it("strips a leading ```json code fence and never shows backticks", () => {
    const raw = '```json\n{\n  "subjective": "Caregiver reported no concerns';
    const out = extractSoapPreview(raw);
    expect(out).toBe("Subjective\nCaregiver reported no concerns");
    expect(out).not.toContain("`");
  });

  it("handles a bare ``` fence with no language tag", () => {
    expect(extractSoapPreview('```\n{"subjective":"Hi"}')).toBe("Subjective\nHi");
  });

  it("parses a complete, well-formed note", () => {
    const raw = JSON.stringify({
      subjective: "Caregiver report.",
      objective: "Activities performed.",
      assessment: "Clinical interpretation.",
      plan: "Next steps.",
      billingCodes: [{ code: "97530", units: 2 }],
    });
    expect(extractSoapPreview(raw)).toBe(
      "Subjective\nCaregiver report.\n\nObjective\nActivities performed.\n\nAssessment\nClinical interpretation.\n\nPlan\nNext steps.",
    );
  });
});
