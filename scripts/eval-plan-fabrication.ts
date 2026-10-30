/**
 * Live-model eval harness for the recurring SOAP Plan fabrication pattern
 * (PR #421-#425): calls the REAL Anthropic API with a fixed set of
 * adversarial scenarios -- mainly a fresh patient with no prior plan, no
 * active treatment goals, and various blank fields -- and asserts on
 * properties of the actual generated output.
 *
 * WHY THIS EXISTS: every automated check before this one tested the PROMPT
 * we send (do the instructions say the right thing), never the OUTPUT the
 * model actually returns. That gap is exactly how the same fabrication
 * pattern (an unsupported "this is a continuation of existing care" claim)
 * resurfaced four times across #421-#424 despite each fix explicitly naming
 * the prior failure. This script closes that gap for the Plan section
 * specifically.
 *
 * It intentionally does NOT run as part of `npm test` / CI by default:
 * LLM output is non-deterministic and this makes real paid API calls, so
 * folding it into every push would make CI flaky and costly. Run it:
 *   - locally before/after touching the Plan prompt in aiSoapBillingService.ts
 *   - in CI only on PRs that touch that file, IF the ANTHROPIC_API_KEY
 *     secret is configured (see .github/workflows/eval-prompt.yml, which
 *     no-ops without that secret)
 *
 * Usage: npm run eval:plan-fabrication
 * Env:   ANTHROPIC_API_KEY (or CLAUDE_API_KEY) required.
 *        EVAL_SAMPLES_PER_SCENARIO (default 3) -- LLM output varies by
 *        sample; each scenario is run this many times and every sample
 *        must pass for the scenario to pass, so a flaky one-off doesn't
 *        mask a real regression.
 *
 * Note: the npm script sets a placeholder DATABASE_URL. This file only
 * imports PURE functions (buildSystemPrompt/buildUserPrompt/
 * hasUnsupportedPlanClosing) from aiSoapBillingService.ts and never queries
 * the DB -- but that file imports `storage`, which transitively imports
 * server/db.ts, which throws at *import time* if DATABASE_URL is unset.
 * node-postgres's Pool connects lazily on first query, which this script
 * never issues, so the placeholder value is never actually dialed.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createAiClient, isAiConfigured } from '../server/services/aiProvider';
import {
  buildSystemPrompt,
  buildUserPrompt,
  hasUnsupportedPlanClosing,
  type AiSoapBillingRequest,
} from '../server/services/aiSoapBillingService';

interface Scenario {
  name: string;
  /** Why this scenario exists -- which prior bug/PR it guards against. */
  guards: string;
  request: AiSoapBillingRequest;
  patient: { firstName: string; lastName: string; dateOfBirth: string };
  treatmentPlan?: any;
  treatmentGoals?: any[];
  priorSessions?: Array<{ date: string; objective?: string; assessment?: string; plan?: string }>;
  /** Run against the raw `plan` string. Return a failure message, or null if it passes. */
  assertions: Array<(plan: string) => string | null>;
}

const BLANK_ASSESSMENT = {
  performance: '',
  assistance: '',
  strength: '',
  motorPlanning: '',
  sensoryRegulation: '',
};

const caseAResponses = [
  'no continuity-style opening ("Current plan remains appropriate" / "no changes recommended") -- there is no prior plan to be continuing',
];

function noContinuityOpening(plan: string): string | null {
  if (/current plan remains appropriate|no changes recommended/i.test(plan)) {
    return 'Plan opens with a continuity claim despite no prior plan existing (#421 regression)';
  }
  return null;
}

function noFrequencyFabrication(plan: string): string | null {
  if (/continue current treatment frequency/i.test(plan)) {
    return 'Plan asserts an established frequency to "continue" despite no treatment history (#422 regression)';
  }
  return null;
}

function noHomeProgramFabrication(plan: string): string | null {
  if (/reviewed continuation of current home strategies/i.test(plan)) {
    return 'Plan claims to have "reviewed continuation" of a home program that was never established (#422 regression)';
  }
  return null;
}

function noGoalsFabrication(plan: string): string | null {
  if (/established treatment goals|documented in the plan of care/i.test(plan)) {
    return 'Plan asserts an "established" plan of care / goals that do not exist on file (#424 regression)';
  }
  return null;
}

function noGenericClosingSentence(plan: string): string | null {
  if (hasUnsupportedPlanClosing(plan)) {
    return 'Plan ends with the recurring generic "will continue to benefit from/participate in skilled OT" closing sentence (#423/#425 regression -- the deterministic backstop would mask this from users, but the eval should still flag it)';
  }
  return null;
}

const CASE_A_ASSERTIONS = [
  noContinuityOpening,
  noFrequencyFabrication,
  noHomeProgramFabrication,
  noGoalsFabrication,
  noGenericClosingSentence,
];

const scenarios: Scenario[] = [
  {
    name: 'Fresh patient, everything blank (the exact shape of every production failure so far)',
    guards: '#421, #422, #423, #424 -- each bug surfaced on a brand-new patient with no history',
    request: {
      patientId: 999001,
      activities: ['Obstacle Course', 'Swing'],
      mood: '',
      duration: 45,
      location: 'Clinic',
      assessment: BLANK_ASSESSMENT,
      planNextSteps: 'Bilateral coordination and sustained attention',
    },
    patient: { firstName: 'Eval', lastName: 'CleanroomA', dateOfBirth: '2018-05-01' },
    treatmentPlan: null,
    treatmentGoals: [],
    priorSessions: [],
    assertions: CASE_A_ASSERTIONS,
  },
  {
    name: 'Fresh patient, rich documented session (no history, but a lot to write about)',
    guards: 'rich input should not make the model reach for a padding closing sentence either',
    request: {
      patientId: 999002,
      activities: ['Trampoline', 'Obstacle Course', 'Ball Skills'],
      mood: '',
      duration: 60,
      location: 'Clinic',
      assessment: BLANK_ASSESSMENT,
      activityDetails: [
        { name: 'Trampoline', response: 'Fatigued at 8 minutes, recovered with brief rest and resumed activity.' },
        { name: 'Obstacle Course', response: 'Required moderate verbal cues to maintain attention across transitions.' },
      ],
      planNextSteps: 'Bilateral coordination and sustained attention through graded dynamic activities',
      nextSessionFocus: 'Sustained attention during multi-step tasks',
    },
    patient: { firstName: 'Eval', lastName: 'CleanroomB', dateOfBirth: '2017-02-14' },
    treatmentPlan: null,
    treatmentGoals: [],
    priorSessions: [],
    assertions: CASE_A_ASSERTIONS,
  },
  {
    name: 'Returning patient WITH a prior plan (CASE B regression guard)',
    guards: 'confirms the CASE A fixes did not break the legitimate CASE B continuity behavior',
    request: {
      patientId: 999003,
      activities: ['Obstacle Course'],
      mood: 'Cooperative',
      duration: 45,
      location: 'Clinic',
      assessment: BLANK_ASSESSMENT,
      planNextSteps: 'Continue bilateral coordination work',
    },
    patient: { firstName: 'Eval', lastName: 'ReturningPatient', dateOfBirth: '2016-09-10' },
    treatmentPlan: null,
    treatmentGoals: [],
    priorSessions: [
      {
        date: '2026-10-01',
        objective: 'Required moderate assist for ball skills.',
        assessment: 'Emerging postural control.',
        plan: 'Continue OT 2x/week focusing on bilateral coordination.',
      },
    ],
    assertions: [
      (plan: string) =>
        /current plan remains appropriate|suggested update:/i.test(plan)
          ? null
          : 'Plan has a prior plan to carry forward but used neither the continuity opening nor a Suggested update -- CASE B behavior may be broken',
    ],
  },
];

interface SampleResult {
  scenario: string;
  sample: number;
  plan: string;
  failures: string[];
}

async function generatePlanOnly(
  client: Anthropic,
  scenario: Scenario,
): Promise<string> {
  const systemPrompt = buildSystemPrompt(null);
  const userPrompt = buildUserPrompt(
    scenario.request,
    scenario.patient,
    3,
    null,
    scenario.treatmentPlan,
    scenario.treatmentGoals,
    scenario.priorSessions,
  );

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 6000,
    temperature: 0.5,
    system: systemPrompt + '\n\nRespond with ONLY a valid JSON object, no markdown fencing or commentary.',
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  const responseText = textBlock?.text;
  if (!responseText) throw new Error('No text response from model');

  const jsonMatch =
    responseText.match(/```json\n?([\s\S]*?)\n?```/) || responseText.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText;
  const parsed = JSON.parse(jsonStr);
  if (typeof parsed.plan !== 'string') throw new Error('Response JSON has no "plan" string field');
  return parsed.plan;
}

async function main() {
  if (!isAiConfigured()) {
    // Self-skip rather than fail, matching the Stedi test-mode e2e
    // convention (npm run test:stedi-e2e): this makes real, paid API calls
    // and isn't meaningful to run without a key, so a missing key is "not
    // configured for this environment," not a failure.
    console.log(
      'ANTHROPIC_API_KEY (or CLAUDE_API_KEY) is not set -- skipping. This eval makes real API calls and needs a key to run.',
    );
    process.exit(0);
  }

  const samplesPerScenario = Number(process.env.EVAL_SAMPLES_PER_SCENARIO ?? 3);
  const client = createAiClient({});
  const results: SampleResult[] = [];

  console.log(
    `Running ${scenarios.length} scenario(s) x ${samplesPerScenario} sample(s) against the live model...\n`,
  );

  for (const scenario of scenarios) {
    console.log(`→ ${scenario.name}`);
    console.log(`  guards: ${scenario.guards}`);
    for (let sample = 1; sample <= samplesPerScenario; sample++) {
      try {
        const plan = await generatePlanOnly(client, scenario);
        const failures = scenario.assertions
          .map((assert) => assert(plan))
          .filter((msg): msg is string => msg !== null);
        results.push({ scenario: scenario.name, sample, plan, failures });
        console.log(`  sample ${sample}/${samplesPerScenario}: ${failures.length === 0 ? 'PASS' : 'FAIL'}`);
      } catch (e: any) {
        results.push({
          scenario: scenario.name,
          sample,
          plan: '',
          failures: [`Generation/parsing error: ${e?.message ?? String(e)}`],
        });
        console.log(`  sample ${sample}/${samplesPerScenario}: ERROR`);
      }
    }
    console.log('');
  }

  const failed = results.filter((r) => r.failures.length > 0);
  if (failed.length > 0) {
    console.error('='.repeat(70));
    console.error(`FAILED: ${failed.length}/${results.length} samples had at least one fabrication finding\n`);
    for (const r of failed) {
      console.error(`--- ${r.scenario} (sample ${r.sample}) ---`);
      for (const f of r.failures) console.error(`  ✗ ${f}`);
      if (r.plan) console.error(`  Plan text:\n    ${r.plan.replace(/\n/g, '\n    ')}`);
      console.error('');
    }
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log(`PASSED: all ${results.length} samples across ${scenarios.length} scenarios`);
}

main().catch((e) => {
  console.error('Eval harness crashed:', e);
  process.exit(1);
});
