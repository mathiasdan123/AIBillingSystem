import { describe, it, expect } from 'vitest';
import {
  evaluateGate,
  needsHumanReview,
  renderGateMarkdown,
  renderGateText,
  sampleStatus,
  type GateSample,
} from '../../scripts/eval-gate-policy';

/**
 * Release-gate policy (2026-11-18): deterministic checks zero tolerance;
 * judge-only findings tolerated up to one per scenario; every judge-only
 * finding printed and posted for review.
 */
const finding = (quote: string, check = 'traceability') => ({ check, quote, reason: `${quote} asserts continuity on a first session` });
const clean = (scenario: string, sample: number): GateSample => ({ scenario, sample, error: null, hardFailures: [], judgeFindings: [] });
const judgeOnly = (scenario: string, sample: number, ...quotes: string[]): GateSample => ({
  scenario, sample, error: null, hardFailures: [], judgeFindings: quotes.map((q) => finding(q)),
});

describe('evaluateGate', () => {
  it('passes a fully clean run with nothing to review', () => {
    const v = evaluateGate([clean('P1', 1), clean('P1', 2), clean('P6', 1)]);
    expect(v.passed).toBe(true);
    expect(v.totalJudgeOnlyFindings).toBe(0);
    expect(needsHumanReview(v)).toBe(false);
  });

  it('tolerates one judge-only finding per scenario, and still flags it for review', () => {
    const v = evaluateGate([
      clean('P1', 1), clean('P1', 2), judgeOnly('P1', 3, 'endurance remain areas requiring skilled intervention'),
      judgeOnly('P2', 2, 'Patient will participate in skilled occupational therapy'), clean('P2', 1), clean('P2', 3),
    ]);
    expect(v.passed).toBe(true);
    expect(v.totalJudgeOnlyFindings).toBe(2);
    expect(v.overLimitScenarios).toEqual([]);
    expect(needsHumanReview(v)).toBe(true);
    expect(v.judgeOnlyByScenario.map((e) => [e.scenario, e.findings.length, e.overLimit])).toEqual([['P1', 1, false], ['P2', 1, false]]);
  });

  it('fails when a scenario has two judge-only findings, whether on two samples or one', () => {
    const twoSamples = evaluateGate([judgeOnly('P2', 1, 'Goals will be established'), judgeOnly('P2', 2, 'Patient will participate'), clean('P2', 3)]);
    expect(twoSamples.passed).toBe(false);
    expect(twoSamples.overLimitScenarios).toEqual(['P2']);

    const oneSample = evaluateGate([judgeOnly('P4', 2, 'first sentence', 'second sentence'), clean('P4', 1)]);
    expect(oneSample.passed).toBe(false);
    expect(oneSample.overLimitScenarios).toEqual(['P4']);
  });

  it('two scenarios with one finding each still pass (the limit is per scenario, not per run)', () => {
    const v = evaluateGate([judgeOnly('P2', 2, 'a'), judgeOnly('P4', 2, 'b')]);
    expect(v.passed).toBe(true);
  });

  it('a deterministic failure fails the run regardless of judge tolerance', () => {
    const v = evaluateGate([
      { scenario: 'P6', sample: 1, error: null, hardFailures: ['assessment asserts a patient deficit although NO observations were supplied'], judgeFindings: [] },
      clean('P6', 2), clean('P6', 3),
    ]);
    expect(v.passed).toBe(false);
    expect(v.hardFailed).toHaveLength(1);
    expect(sampleStatus(v.hardFailed[0])).toBe('FAIL');
  });

  it('a non-ai generation mode and a harness error are hard failures too', () => {
    const mode: GateSample = { scenario: 'P1', sample: 1, error: null, hardFailures: ['result.generationMode was "fallback", not "ai"'], judgeFindings: [] };
    const err: GateSample = { scenario: 'P1', sample: 2, error: 'rate limited', hardFailures: [], judgeFindings: [] };
    const v = evaluateGate([mode, err]);
    expect(v.passed).toBe(false);
    expect(v.hardFailed.map(sampleStatus)).toEqual(['FAIL', 'ERROR']);
  });

  it('a sample with both a deterministic failure and judge findings is hard, not judge-only', () => {
    const v = evaluateGate([{ scenario: 'P1', sample: 1, error: null, hardFailures: ['x'], judgeFindings: [finding('y')] }]);
    expect(v.hardFailed).toHaveLength(1);
    expect(v.judgeOnlyByScenario).toEqual([]);
  });
});

describe('renderGateText / renderGateMarkdown', () => {
  const v = evaluateGate([
    judgeOnly('P1', 3, 'endurance remain areas requiring skilled therapeutic intervention'),
    { scenario: 'P6', sample: 1, error: null, hardFailures: ['assessment asserts a patient deficit'], judgeFindings: [], planText: 'Next session: jumping.' },
    judgeOnly('P2', 1, 'Goals will be established'), judgeOnly('P2', 2, 'Patient will participate'),
  ]);

  it('prints every judge-only finding with its quote, labelled tolerated or over limit, after the hard failures', () => {
    const text = renderGateText(v, 18, 6);
    expect(text).toMatch(/^=+\nFAILED: 1 sample\(s\) with a deterministic failure/);
    expect(text).toContain('judge-only findings over the limit of 1 per scenario in: P2');
    expect(text).toContain('--- HARD FAILURE: P6 (sample 1) ---');
    expect(text).toContain('Plan text:\n    Next session: jumping.');
    expect(text).toContain('--- JUDGE-ONLY: P1 -- tolerated (1 of 1 allowed) ---');
    expect(text).toContain('⚠ sample 3 [traceability]: "endurance remain areas requiring skilled therapeutic intervention"');
    expect(text).toContain('--- JUDGE-ONLY: P2 -- OVER LIMIT (2 > 1) -- FAILS THE RUN ---');
    expect(text).toContain('✗ sample 1 [traceability]: "Goals will be established"');
    expect(text).toContain('✗ sample 2 [traceability]: "Patient will participate"');
  });

  it('a passing run with tolerated findings says so loudly and still lists them', () => {
    const pass = evaluateGate([judgeOnly('P1', 3, 'remain areas requiring'), clean('P1', 1)]);
    const text = renderGateText(pass, 18, 6);
    expect(text).toContain('PASSED with 1 tolerated judge-only finding(s)');
    expect(text).toContain('REVIEW THE FINDINGS BELOW');
    expect(text).toContain('"remain areas requiring"');
  });

  it('markdown carries the same findings for the PR comment', () => {
    const md = renderGateMarkdown(v, { runLabel: 'run 123', totalSamples: 18, scenarioCount: 6 });
    expect(md).toContain('## pipeline-eval: ❌ Failed');
    expect(md).toContain('### Hard failures (zero tolerance)');
    expect(md).toContain('### Judge-only findings (please review)');
    expect(md).toContain('> endurance remain areas requiring skilled therapeutic intervention');
    expect(md).toContain('**P2** — **over limit** (2 > 1), fails the run');
    const clean18 = renderGateMarkdown(evaluateGate([clean('P1', 1)]), { runLabel: 'run 1', totalSamples: 1, scenarioCount: 1 });
    expect(clean18).toContain('✅ Passed');
    expect(clean18).toContain('No findings.');
  });
});
