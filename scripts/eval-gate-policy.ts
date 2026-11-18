/**
 * Pass/fail policy for the SOAP generation pipeline eval (the release gate).
 *
 * Pure: no I/O, no model calls, so it can be unit-tested from the server
 * suite (server/__tests__/evalGatePolicy.test.ts) without running the eval.
 *
 * WHY THIS EXISTS (2026-11-18): five consecutive PR runs failed on five
 * different first-session continuity phrasings, each a judge finding, while
 * a baseline run on main passed. The model emits some CASE A continuity
 * wording in roughly 6-7% of samples; with 18 samples and an all-or-nothing
 * gate, a clean run was a ~30% event regardless of the PR's content, and
 * every failure taught one more deterministic rule without moving the odds.
 *
 * POLICY (Daniel, 2026-11-18):
 *   - Deterministic checks are ZERO tolerance. Any deterministic failure,
 *     any non-"ai" generation mode, any error fails the run. Deterministic
 *     coverage is unchanged by this policy.
 *   - A sample whose only findings come from the semantic judge is
 *     "judge-only". At most MAX_JUDGE_ONLY_PER_SCENARIO judge-only FINDINGS
 *     (not samples) are tolerated per scenario; one more fails the run.
 *   - Every judge-only finding, tolerated or not, is printed in the CI
 *     summary and posted on the PR so a person reviews it. Tolerated never
 *     means hidden.
 */

export interface GateFinding {
  check: string;
  quote: string;
  reason: string;
}

export interface GateSample {
  scenario: string;
  sample: number;
  /** Harness error for this sample (model call failed, fixture failed, ...). */
  error: string | null;
  /** Deterministic failures plus the generation-mode failure, already rendered. */
  hardFailures: string[];
  /** Judge findings that survived deterministic verification. */
  judgeFindings: GateFinding[];
  /** The final Plan text, shown under a hard failure for context. */
  planText?: string | null;
}

export const MAX_JUDGE_ONLY_PER_SCENARIO = 1;

export type SampleStatus = 'PASS' | 'JUDGE-ONLY' | 'FAIL' | 'ERROR';

export function sampleStatus(s: GateSample): SampleStatus {
  if (s.error) return 'ERROR';
  if (s.hardFailures.length > 0) return 'FAIL';
  if (s.judgeFindings.length > 0) return 'JUDGE-ONLY';
  return 'PASS';
}

export interface ScenarioJudgeOnly {
  scenario: string;
  /** Judge-only findings in this scenario, across its judge-only samples. */
  findings: Array<GateFinding & { sample: number }>;
  /** True when findings.length > the per-scenario limit. */
  overLimit: boolean;
}

export interface GateVerdict {
  passed: boolean;
  /** Samples with an error, a deterministic failure or a non-ai mode. */
  hardFailed: GateSample[];
  /** Per scenario, every judge-only finding and whether the scenario exceeded the limit. */
  judgeOnlyByScenario: ScenarioJudgeOnly[];
  totalJudgeOnlyFindings: number;
  /** Scenarios whose judge-only findings exceed the limit (each fails the run). */
  overLimitScenarios: string[];
  maxJudgeOnlyPerScenario: number;
}

export function evaluateGate(
  samples: GateSample[],
  maxJudgeOnlyPerScenario: number = MAX_JUDGE_ONLY_PER_SCENARIO,
): GateVerdict {
  const hardFailed = samples.filter((s) => sampleStatus(s) === 'FAIL' || sampleStatus(s) === 'ERROR');

  const byScenario = new Map<string, ScenarioJudgeOnly>();
  for (const s of samples) {
    if (sampleStatus(s) !== 'JUDGE-ONLY') continue;
    const entry = byScenario.get(s.scenario) ?? { scenario: s.scenario, findings: [], overLimit: false };
    for (const f of s.judgeFindings) entry.findings.push({ ...f, sample: s.sample });
    byScenario.set(s.scenario, entry);
  }
  const judgeOnlyByScenario = Array.from(byScenario.values()).map((e) => ({
    ...e,
    overLimit: e.findings.length > maxJudgeOnlyPerScenario,
  }));
  const overLimitScenarios = judgeOnlyByScenario.filter((e) => e.overLimit).map((e) => e.scenario);
  const totalJudgeOnlyFindings = judgeOnlyByScenario.reduce((n, e) => n + e.findings.length, 0);

  return {
    passed: hardFailed.length === 0 && overLimitScenarios.length === 0,
    hardFailed,
    judgeOnlyByScenario,
    totalJudgeOnlyFindings,
    overLimitScenarios,
    maxJudgeOnlyPerScenario,
  };
}

/** True when a person should look at this run (anything tolerated or failed). */
export function needsHumanReview(v: GateVerdict): boolean {
  return !v.passed || v.totalJudgeOnlyFindings > 0;
}

const indent = (text: string, pad = '    ') => text.replace(/\n/g, `\n${pad}`);

/**
 * The plain-text summary printed at the end of the CI log. Hard failures
 * first (they fail the run), then EVERY judge-only finding, each labelled
 * tolerated or over the limit.
 */
export function renderGateText(v: GateVerdict, totalSamples: number, scenarioCount: number): string {
  const lines: string[] = [];
  lines.push('='.repeat(70));
  if (v.passed) {
    lines.push(
      v.totalJudgeOnlyFindings > 0
        ? `PASSED with ${v.totalJudgeOnlyFindings} tolerated judge-only finding(s) (limit ${v.maxJudgeOnlyPerScenario} per scenario; deterministic checks all clean) on ${scenarioCount} scenarios (${totalSamples} samples total). REVIEW THE FINDINGS BELOW.`
        : `PASSED: final output passed these checks on these ${scenarioCount} scenarios (${totalSamples} samples total).`,
    );
  } else {
    const reasons: string[] = [];
    if (v.hardFailed.length > 0) reasons.push(`${v.hardFailed.length} sample(s) with a deterministic failure, non-ai generation mode or error (zero tolerance)`);
    if (v.overLimitScenarios.length > 0) reasons.push(`judge-only findings over the limit of ${v.maxJudgeOnlyPerScenario} per scenario in: ${v.overLimitScenarios.join(', ')}`);
    lines.push(`FAILED: ${reasons.join('; ')}.`);
  }
  lines.push('');

  for (const s of v.hardFailed) {
    lines.push(`--- HARD FAILURE: ${s.scenario} (sample ${s.sample}) ---`);
    if (s.error) lines.push(`  ✗ Error: ${s.error}`);
    for (const f of s.hardFailures) lines.push(`  ✗ ${f}`);
    for (const f of s.judgeFindings) lines.push(`  ✗ Semantic judge [${f.check}]: "${f.quote}" -- ${f.reason}`);
    if (s.planText) lines.push(`  Plan text:\n    ${indent(s.planText)}`);
    lines.push('');
  }

  for (const e of v.judgeOnlyByScenario) {
    const label = e.overLimit ? `OVER LIMIT (${e.findings.length} > ${v.maxJudgeOnlyPerScenario}) -- FAILS THE RUN` : `tolerated (${e.findings.length} of ${v.maxJudgeOnlyPerScenario} allowed)`;
    lines.push(`--- JUDGE-ONLY: ${e.scenario} -- ${label} ---`);
    for (const f of e.findings) {
      lines.push(`  ${e.overLimit ? '✗' : '⚠'} sample ${f.sample} [${f.check}]: "${f.quote}"`);
      lines.push(`      ${f.reason}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * The Markdown posted as a PR comment and appended to the GitHub step
 * summary. Same content as the text summary, shaped for review.
 */
export function renderGateMarkdown(v: GateVerdict, opts: { runLabel: string; totalSamples: number; scenarioCount: number }): string {
  const md: string[] = [];
  const status = v.passed ? (v.totalJudgeOnlyFindings > 0 ? '✅ Passed with tolerated judge-only findings' : '✅ Passed') : '❌ Failed';
  md.push(`## pipeline-eval: ${status}`);
  md.push('');
  md.push(`${opts.runLabel} · ${opts.scenarioCount} scenarios × ${opts.totalSamples / Math.max(opts.scenarioCount, 1)} samples · deterministic checks: ${v.hardFailed.length === 0 ? 'all clean' : `${v.hardFailed.length} sample(s) failed`} · judge-only findings: ${v.totalJudgeOnlyFindings} (limit ${v.maxJudgeOnlyPerScenario} per scenario)`);
  md.push('');
  if (v.hardFailed.length > 0) {
    md.push('### Hard failures (zero tolerance)');
    for (const s of v.hardFailed) {
      md.push(`- **${s.scenario}**, sample ${s.sample}`);
      if (s.error) md.push(`  - Error: ${s.error}`);
      for (const f of s.hardFailures) md.push(`  - ${f}`);
      for (const f of s.judgeFindings) md.push(`  - Judge [${f.check}]: "${f.quote}" — ${f.reason}`);
    }
    md.push('');
  }
  if (v.judgeOnlyByScenario.length > 0) {
    md.push('### Judge-only findings (please review)');
    md.push('');
    md.push('Each one is a semantic-judge finding on a sample whose deterministic checks were clean. Tolerated findings do not fail the run but are listed here so a person decides whether the sentence is a real fabrication that needs a deterministic rule.');
    md.push('');
    for (const e of v.judgeOnlyByScenario) {
      md.push(`- **${e.scenario}** — ${e.overLimit ? `**over limit** (${e.findings.length} > ${v.maxJudgeOnlyPerScenario}), fails the run` : `tolerated (${e.findings.length} of ${v.maxJudgeOnlyPerScenario})`}`);
      for (const f of e.findings) {
        md.push(`  - sample ${f.sample}, \`${f.check}\`: > ${f.quote}`);
        md.push(`    - ${f.reason}`);
      }
    }
    md.push('');
  }
  if (v.passed && v.totalJudgeOnlyFindings === 0) md.push('No findings.');
  return md.join('\n');
}
