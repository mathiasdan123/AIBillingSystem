import { describe, it, expect } from 'vitest';
import { checkDocumentationSupport } from '../services/complianceRiskChecks';

const li = (code: string) => ({ cptCode: { code } });

describe('compliance risk — documentation-vs-billed-code cross-check', () => {
  it('passes when the note supports the billed skilled objective', () => {
    const issues = checkDocumentationSupport(
      [li('97112')],
      'Worked on postural control and motor planning during dynamic balance tasks.',
    );
    expect(issues).toHaveLength(0);
  });

  it('flags a billed code with no supporting documentation', () => {
    const issues = checkDocumentationSupport(
      [li('97110')], // therapeutic exercise — needs strength/ROM/exercise language
      'Patient engaged in quiet tabletop coloring; calm affect throughout.',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].source).toBe('documentation');
    expect(issues[0].severity).toBe('high');
    expect(issues[0].description).toContain('97110');
  });

  it('flags 97533 sensory work lacking a functional/skilled anchor', () => {
    const issues = checkDocumentationSupport(
      [li('97533')],
      'Sensory swing and tactile bin play; child enjoyed the sensory activities.',
    );
    expect(issues.some((i) => i.description.includes('97533'))).toBe(true);
    expect(issues.find((i) => i.description.includes('97533'))?.severity).toBe('medium');
  });

  it('accepts 97533 when sensory work is tied to a functional objective', () => {
    const issues = checkDocumentationSupport(
      [li('97533')],
      'Skilled sensory integrative intervention targeting postural regulation to improve functional participation; addressed documented sensory-processing deficit.',
    );
    expect(issues).toHaveLength(0);
  });

  it('flags missing documentation entirely when codes are billed', () => {
    const issues = checkDocumentationSupport([li('97530')], '');
    expect(issues).toHaveLength(1);
    expect(issues[0].description).toMatch(/no soap documentation/i);
  });

  it('ignores unknown codes (scrubber/predictor own validity)', () => {
    const issues = checkDocumentationSupport([li('99999')], 'anything');
    expect(issues).toHaveLength(0);
  });

  it('does not false-match short terms inside other words (word boundaries)', () => {
    // 97110 (therapeutic exercise) needs strength/ROM/exercise language.
    // "from" contains "rom" but must NOT count as support → should flag.
    const issues = checkDocumentationSupport(
      [li('97110')],
      'Patient transitioned from the mat to standing; calm and cooperative.',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].description).toContain('97110');
  });

  it('does not false-match "adl" inside words like "cradle"', () => {
    // 97535 (self-care) needs ADL/self-care language; "cradle" must not match.
    const issues = checkDocumentationSupport(
      [li('97535')],
      'Worked on cradle-position carries during play; no self-care tasks addressed.',
    );
    // "self-care" IS present here, so it should pass — but verify "cradle"
    // alone wouldn't have. Test the negative explicitly:
    const negative = checkDocumentationSupport([li('97535')], 'cradle and ladle play only');
    expect(negative).toHaveLength(1);
    expect(negative[0].description).toContain('97535');
  });

  it('still matches genuine "range of motion" phrasing for 97110', () => {
    const issues = checkDocumentationSupport(
      [li('97110')],
      'Addressed shoulder range of motion with active stretching.',
    );
    expect(issues).toHaveLength(0);
  });
});
