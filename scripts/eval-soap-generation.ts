/**
 * Live-model eval harness for SOAP generation fabrication (PR #421-#427).
 *
 * WHY THIS EXISTS: generation is non-deterministic prose, so one passing run
 * proves nothing, and phrase-only checks miss a reworded defect -- which is
 * exactly what happened here: the same unwanted Plan closing sentence kept
 * returning under new wording (#423, then again after #425) even after
 * every other defect from the same bug report was fixed. Every automated
 * check before this one tested the PROMPT (do the instructions say the
 * right thing), never the OUTPUT the model actually returns. This harness
 * calls the real model with fixed inputs and asserts the response against
 * invariants, so a change to the prompt or model that reintroduces a known
 * failure -- in any wording -- fails the gate.
 *
 * HOW IT RUNS (see each scenario/check for which prior bug it guards):
 *   1. Synthetic patients only -- no real patient data in any fixture.
 *   2. Every scenario is history-free by construction, not by inspection:
 *      fixtures are built in-memory (treatmentPlan/treatmentGoals/
 *      priorSessions passed directly as empty/undefined/null) and this
 *      script never calls storage or writes to a database at all. There is
 *      no save path for it to accidentally use, so the failure mode from
 *      manual UI testing -- "no notes alone does not prove no history,"
 *      e.g. a demo patient that silently accumulated a saved test note
 *      from an earlier manual run -- cannot happen here: each `main()` run
 *      constructs fresh scenario objects and nothing persists between
 *      samples or across runs.
 *   3. Each scenario runs EVAL_SAMPLES_PER_SCENARIO times (default 10).
 *      ALL samples must pass for the scenario to pass -- one failing run
 *      fails the gate.
 *   4. Two assertion layers per sample:
 *        - DETERMINISTIC: known-bad strings/patterns (checks 1-4, 9) and
 *          arithmetic (timeBlocks, covered by a fast unit test instead --
 *          see the note in Scenario 10 below).
 *        - SEMANTIC JUDGE: a second real model call reviews the full note
 *          against the traceability principle and, separately, the mood
 *          and caregiver-report rules, and must QUOTE the exact offending
 *          sentence for any finding -- so a defect with new wording still
 *          fails even when no deterministic pattern anticipated it.
 *   5. Every sample's full output, fixture, and a run ID are written to
 *      .eval-results/<runId>.json so a failure can be replayed exactly.
 *
 * NOT part of `npm test` / every CI push: real, billed, non-deterministic
 * API calls would make CI flaky and costly. Wired into
 * .github/workflows/eval-prompt.yml instead, gated on the
 * ANTHROPIC_API_KEY secret existing (a cost decision, not this script's to
 * make) and path-filtered to PRs touching aiSoapBillingService.ts.
 *
 * Usage: npm run eval:soap-generation
 * Env:   ANTHROPIC_API_KEY (or CLAUDE_API_KEY) required.
 *        EVAL_SAMPLES_PER_SCENARIO (default 10).
 *
 * Note on DATABASE_URL: the npm script sets a placeholder. This file only
 * imports PURE functions from aiSoapBillingService.ts and never queries the
 * DB -- but that file imports `storage`, which transitively imports
 * server/db.ts, which throws at *import time* if DATABASE_URL is unset.
 * node-postgres's Pool connects lazily on first query, which this script
 * never issues, so the placeholder value is never actually dialed.
 *
 * A passing run means these known failure classes, and their rewordings,
 * did not appear in this run. It is NOT a clinical-safety guarantee. Add a
 * new scenario/check for each new failure class found in the field, and
 * seed its exact wording into the deterministic list the same way.
 */
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { createAiClient, isAiConfigured } from '../server/services/aiProvider';
import {
  buildSystemPrompt,
  buildUserPrompt,
  hasUnsupportedPlanClosing,
  type AiSoapBillingRequest,
} from '../server/services/aiSoapBillingService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  auditNotes: string[];
}

interface JudgeFinding {
  check: 'traceability' | 'mood' | 'caregiver_report';
  quote: string;
  reason: string;
}

interface Scenario {
  name: string;
  /** Which prior bug/PR this guards against, and what it means for a check to pass here. */
  guards: string;
  request: AiSoapBillingRequest;
  patient: { firstName: string; lastName: string; dateOfBirth?: string | null };
  treatmentPlan?: any;
  treatmentGoals?: any[];
  priorSessions?: Array<{ date: string; objective?: string; assessment?: string; plan?: string }>;
  /** Deterministic checks against the raw note. Each returns a failure message, or null. */
  deterministicChecks: Array<(note: RawNote) => string | null>;
  /**
   * What to tell the semantic judge about this scenario's inputs, so it can
   * correctly separate "doesn't trace to input" (fabrication) from
   * "legitimate inference from what was provided" (allowed).
   */
  judgeContext: string;
  /** Skip the semantic judge entirely (used by the CASE B control, which is
   * SUPPOSED to produce continuity language -- the judge's traceability
   * check doesn't know about carry-forward semantics). */
  skipJudge?: boolean;
}

// ---------------------------------------------------------------------------
// Deterministic checks -- known-bad strings seeded from real production
// failures. Layer 1: cheap, exact, but blind to new wording.
// ---------------------------------------------------------------------------

function noContinuityOpening(note: RawNote): string | null {
  if (/current plan remains appropriate|no changes recommended/i.test(note.plan)) {
    return 'Check 1 (no continuity opening): Plan references an existing/current plan with no prior history. Seed failure: "Current plan remains appropriate; no changes recommended." (#421)';
  }
  return null;
}

function noFrequencyFabrication(note: RawNote): string | null {
  if (/continue current treatment frequency/i.test(note.plan)) {
    return 'Check 2 (no frequency claim): Plan states/recommends a treatment frequency with no history to continue. Seed failure: "Continue current treatment frequency." (#422)';
  }
  return null;
}

function homeProgramDefault(note: RawNote): string | null {
  if (/reviewed continuation of current home strategies/i.test(note.plan)) {
    return 'Check 3 (home program default): Plan claims to have reviewed/continued home strategies that were never established. Seed failure: "Reviewed continuation of current home strategies; no changes to home program at this time." (#422)';
  }
  if (!note.plan.includes('No home program assigned this session')) {
    return 'Check 3 (home program default): with Home Program blank, the Plan must say exactly "No home program assigned this session" -- it did not.';
  }
  return null;
}

function noGoalsFabrication(note: RawNote): string | null {
  if (/established treatment goals|documented in the plan of care/i.test(note.plan)) {
    return 'Check 4 (no goals reference): Plan references established goals / a plan of care that do not exist. Seed failure: "Goals: Continue working toward established treatment goals as documented in the plan of care." (#424)';
  }
  return null;
}

function noClosingSentenceDeterministic(note: RawNote): string | null {
  if (hasUnsupportedPlanClosing(note.plan)) {
    return 'Check 5 (no closing sentence, deterministic): Plan ends with the recurring generic skilled-OT continuation/necessity sentence. Seed failure (still failing as of the last manual run): "Patient will continue to participate in skilled occupational therapy to address identified deficits in strength, endurance, bilateral coordination, and sustained attention through graded therapeutic activities and neuromuscular re-education." (#423/#425)';
  }
  return null;
}

function noAgeAnywhere(note: RawNote): string | null {
  const haystack = [note.subjective, note.objective, note.assessment, note.plan, ...note.auditNotes].join('\n');
  // Catches "56 years", "56-year-old", "age 56", "aged 56" etc. Deliberately
  // broad: the whole point (check 9) is that NO age should appear anywhere,
  // including Audit Support, when DOB is blank -- not just a specific number.
  const match = haystack.match(/\b(\d{1,3})[\s-]?year|(?:age[d]?\s+(\d{1,3}))/i);
  if (match) {
    return `Check 9 (blank DOB -> no age anywhere): found an age reference ("${match[0]}") despite no date of birth on file. Seed failure: "Patient age listed as 56 years - verify this is correct" generated from a null DOB silently resolving to the Unix epoch.`;
  }
  return null;
}

const CASE_A_DETERMINISTIC_CHECKS = [
  noContinuityOpening,
  noFrequencyFabrication,
  homeProgramDefault,
  noGoalsFabrication,
  noClosingSentenceDeterministic,
];

// ---------------------------------------------------------------------------
// Semantic judge -- layer 2: a second real model call. Must quote the exact
// offending sentence, so a NEW wording of an old defect, or a wholly new
// failure class, still fails even though no regex anticipated it.
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM_PROMPT = `You are a strict compliance reviewer checking an AI-generated pediatric OT SOAP note for FABRICATION. You are NOT reviewing writing quality, tone, thoroughness, or clinical style -- a short, honest note that stays silent about something the therapist didn't document is CORRECT, not a defect.

Check for exactly these three things:

1. TRACEABILITY (the Plan section): every clinical claim in PLAN must trace to an explicit input field you're given below, or to a default you're explicitly told applies. A sentence asserting continuity with an existing plan, an established treatment frequency, a reviewed/continued home program, established treatment goals, a documented plan of care, or ongoing necessity of skilled therapy -- when no such history was provided -- is a FABRICATION, however clinically plausible it reads. This applies regardless of exact wording; do not require the sentence to match any specific phrase.

2. MOOD: if the Mood/Presentation input was left blank (you'll be told), the note must not describe the patient's mood, affect, demeanor, or presentation ANYWHERE -- Subjective, Objective, Assessment, or Plan.

3. CAREGIVER REPORT: if the Caregiver Report input was left blank (you'll be told), the note must make NO statement about a caregiver report in either direction -- not "a caregiver report was obtained" and not "a caregiver report was not obtained." The field being blank means the therapist didn't type anything, not that you know what did or didn't happen. Silence is correct.

You MUST allow, and must NOT flag:
- Clinical INFERENCE grounded in what was actually documented. Example: if the input states "Fatigue noted at 8 minutes; recovered with brief rest," the note may legitimately discuss endurance limitations, activity tolerance, fatigue management, or recovery capacity -- that is reviewable clinical interpretation of a real observation, not fabrication. Only flag a claim that goes BEYOND what the observation supports (e.g. asserting a specific numeric threshold, a diagnosis, or a trend across sessions that was never stated).
- Clinical/skilled-therapy vocabulary in general. The defect is asserting CONTINUATION or NECESSITY grounded in history that doesn't exist -- not the vocabulary itself. A sentence like "skilled grading of activity demands supported safe participation given today's observed fatigue" is fine; "continued skilled occupational therapy is indicated to address these documented deficits" with no history behind it is not.

Respond with ONLY this JSON:
{"findings": [{"check": "traceability"|"mood"|"caregiver_report", "quote": "<the EXACT offending sentence, copied verbatim from the note>", "reason": "<one sentence>"}]}

If there are no violations, respond with {"findings": []}. Every finding MUST include an exact, verbatim quote from the note -- never paraphrase or summarize what's wrong without quoting it.`;

async function runSemanticJudge(
  client: Anthropic,
  note: RawNote,
  judgeContext: string,
): Promise<JudgeFinding[]> {
  const userPrompt = `INPUT PROVIDED TO THE NOTE-GENERATING MODEL:\n${judgeContext}\n\nGENERATED NOTE:\nSUBJECTIVE: ${note.subjective}\n\nOBJECTIVE: ${note.objective}\n\nASSESSMENT: ${note.assessment}\n\nPLAN: ${note.plan}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1500,
    temperature: 0,
    system: JUDGE_SYSTEM_PROMPT + '\n\nRespond with ONLY the JSON object, no markdown fencing or commentary.',
    messages: [{ role: 'user', content: userPrompt }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  const responseText = textBlock?.text;
  if (!responseText) throw new Error('Judge: no text response from model');

  const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/) || responseText.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText;
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed.findings)) throw new Error('Judge: response JSON has no "findings" array');
  return parsed.findings;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

// The exact core fixture: a brand-new patient, every clinical field empty,
// one fixed documented session. This is deliberately the literal shape that
// has produced every confirmed production failure in this thread.
const CORE_SESSION = {
  activities: ['Obstacle Course', 'Trampoline'],
  activityDetails: [
    { name: 'Obstacle Course', response: 'Completed obstacle course with minimal verbal cues.' },
    { name: 'Trampoline', response: 'Fatigue noted at 8 minutes; recovered with brief rest.' },
  ],
  mood: '',
  caregiverReport: undefined,
  duration: 45,
  location: 'Sensory gym',
  assessment: {
    performance: '',
    assistance: '',
    strength: '',
    motorPlanning: '',
    sensoryRegulation: '',
  },
  planNextSteps: 'Bilateral coordination and sustained attention',
  nextSessionFocus: undefined,
  homeProgram: undefined,
};

const CORE_JUDGE_CONTEXT = `- Activities: Obstacle Course (minimal verbal cues to complete), Trampoline (fatigue noted at 8 minutes, recovered with brief rest)
- Mood/Presentation: BLANK (not entered)
- Caregiver Report: BLANK (not entered)
- Clinical observation ratings (performance, assistance, strength, motor planning, sensory regulation): all BLANK
- Plan Next Steps: "Bilateral coordination and sustained attention"
- Next Session Focus: BLANK
- Home Program: BLANK
- No prior treatment plan, goals, or session history exists for this patient (this is their first documented session).`;

function freshPatient(suffix: string, dateOfBirth: string | null = '2018-05-01') {
  return { firstName: 'Eval', lastName: `Fresh${suffix}`, dateOfBirth };
}

// Check 10 (time-block arithmetic) and control 12 (inference) are NOT
// separate scenarios here:
//
// - Check 10's historical bug (footer total diverging from the sum of its
//   own blocks) lived entirely in client-side React state recomputation
//   (client/src/pages/soap-notes.tsx), not in anything the model generates
//   -- the model's JSON response doesn't contain a total at all; the
//   dollar amounts are computed server-side in validateAndEnhanceResponse
//   from the model's cptCodes/units. That's deterministic code, not
//   generation behavior, so it's covered by fast, free unit tests instead
//   of a live-API eval: client/src/__tests__/timeBlocks.test.ts (the exact
//   client regression) and the "billing arithmetic consistency" test in
//   server/__tests__/soapNarrativePrompt.test.ts (the server-side
//   invariant those client totals are built from).
//
// - Control 12 (legitimate inference must not be flagged) isn't a separate
//   fixture: Scenario 1's own Trampoline observation ("Fatigue noted at 8
//   minutes; recovered with brief rest") IS the inference-control example,
//   and the semantic judge's instructions explicitly require it to allow
//   clinical inference from that exact observation while still catching
//   unsupported continuity/necessity claims elsewhere in the same note.
//   A judge finding on Scenario 1 that quotes endurance/fatigue language
//   grounded in that observation would itself indicate the judge is
//   over-restricting -- visible immediately in the printed quote -- rather
//   than something a second fixture would catch differently.

const scenarios: Scenario[] = [
  {
    name: 'Scenario 1: fresh patient, no history (the core clean room)',
    guards:
      'Checks 1-6, 7, 8 -- #421 (continuity), #422 (frequency/home program), #424 (goals), #423/#425 (closing sentence), caregiver-report fabrication fix (this change)',
    request: { patientId: 999001, ...CORE_SESSION } as AiSoapBillingRequest,
    patient: freshPatient('A'),
    treatmentPlan: null,
    treatmentGoals: [],
    priorSessions: [],
    deterministicChecks: CASE_A_DETERMINISTIC_CHECKS,
    judgeContext: CORE_JUDGE_CONTEXT,
  },
  {
    name: 'Scenario 4: blank date of birth',
    guards: 'Check 9 -- the epoch-age bug (#425): new Date(null) silently resolving to 1970-01-01',
    request: { patientId: 999004, ...CORE_SESSION } as AiSoapBillingRequest,
    patient: freshPatient('DobBlank', null),
    treatmentPlan: null,
    treatmentGoals: [],
    priorSessions: [],
    deterministicChecks: [...CASE_A_DETERMINISTIC_CHECKS, noAgeAnywhere],
    judgeContext: CORE_JUDGE_CONTEXT + '\n- Date of birth: BLANK (not entered).',
  },
  {
    name: 'Scenario 11: real-history control (continuity SHOULD appear)',
    guards:
      'Confirms the harness punishes invention, not supported continuity -- a fixture with a real prior plan must get continuity language, and that must NOT be flagged',
    request: {
      patientId: 999011,
      activities: ['Obstacle Course'],
      mood: 'Cooperative',
      duration: 45,
      location: 'Clinic',
      assessment: {
        performance: '', assistance: '', strength: '', motorPlanning: '', sensoryRegulation: '',
      },
      planNextSteps: 'Continue bilateral coordination work',
    } as AiSoapBillingRequest,
    patient: freshPatient('Returning', '2016-09-10'),
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
    deterministicChecks: [
      (note: RawNote) =>
        /current plan remains appropriate|suggested update:/i.test(note.plan)
          ? null
          : 'Control 11 (real history): a prior plan exists to carry forward, but the Plan used neither the continuity opening nor a Suggested update -- CASE B behavior may be broken, not an over-correction from the CASE A fixes.',
    ],
    judgeContext: '(not used -- judge skipped for this control; see skipJudge)',
    skipJudge: true,
  },
];

// ---------------------------------------------------------------------------
// Generation + evaluation
// ---------------------------------------------------------------------------

async function generateRawNote(client: Anthropic, scenario: Scenario): Promise<RawNote> {
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

  const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/) || responseText.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText;
  const parsed = JSON.parse(jsonStr);
  for (const field of ['subjective', 'objective', 'assessment', 'plan']) {
    if (typeof parsed[field] !== 'string') throw new Error(`Response JSON has no "${field}" string field`);
  }
  return {
    subjective: parsed.subjective,
    objective: parsed.objective,
    assessment: parsed.assessment,
    plan: parsed.plan,
    auditNotes: Array.isArray(parsed.auditNotes) ? parsed.auditNotes : [],
  };
}

interface SampleRecord {
  runId: string;
  scenario: string;
  sample: number;
  note: RawNote | null;
  deterministicFailures: string[];
  judgeFindings: JudgeFinding[];
  error: string | null;
}

function allFailures(record: SampleRecord): string[] {
  const judgeFailures = record.judgeFindings.map(
    (f) => `Semantic judge [${f.check}]: "${f.quote}" -- ${f.reason}`,
  );
  return [...record.deterministicFailures, ...judgeFailures];
}

async function main() {
  if (!isAiConfigured()) {
    console.log(
      'ANTHROPIC_API_KEY (or CLAUDE_API_KEY) is not set -- skipping. This eval makes real API calls and needs a key to run.',
    );
    process.exit(0);
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const samplesPerScenario = Number(process.env.EVAL_SAMPLES_PER_SCENARIO ?? 10);
  const client = createAiClient({});
  const records: SampleRecord[] = [];

  console.log(`Run ID: ${runId}`);
  console.log(
    `Running ${scenarios.length} scenario(s) x ${samplesPerScenario} sample(s) against the live model...\n`,
  );

  for (const scenario of scenarios) {
    console.log(`→ ${scenario.name}`);
    console.log(`  guards: ${scenario.guards}`);
    for (let sample = 1; sample <= samplesPerScenario; sample++) {
      const record: SampleRecord = {
        runId,
        scenario: scenario.name,
        sample,
        note: null,
        deterministicFailures: [],
        judgeFindings: [],
        error: null,
      };
      try {
        const note = await generateRawNote(client, scenario);
        record.note = note;
        record.deterministicFailures = scenario.deterministicChecks
          .map((check) => check(note))
          .filter((msg): msg is string => msg !== null);

        if (!scenario.skipJudge) {
          record.judgeFindings = await runSemanticJudge(client, note, scenario.judgeContext);
        }
      } catch (e: any) {
        record.error = e?.message ?? String(e);
      }
      records.push(record);
      const failed = record.error || allFailures(record).length > 0;
      console.log(`  sample ${sample}/${samplesPerScenario}: ${record.error ? 'ERROR' : failed ? 'FAIL' : 'PASS'}`);
    }
    console.log('');
  }

  // Structured, replayable log: full fixture + output + verdicts for every
  // sample, keyed by run ID.
  const resultsDir = resolve(import.meta.dirname, '..', '.eval-results');
  mkdirSync(resultsDir, { recursive: true });
  const logPath = resolve(resultsDir, `${runId}.json`);
  writeFileSync(
    logPath,
    JSON.stringify({ runId, timestamp: new Date().toISOString(), scenarios: scenarios.map((s) => s.name), records }, null, 2),
  );
  console.log(`Full results (fixtures + outputs + verdicts) written to ${logPath}\n`);

  const failedRecords = records.filter((r) => r.error || allFailures(r).length > 0);
  if (failedRecords.length > 0) {
    console.error('='.repeat(70));
    console.error(`FAILED: ${failedRecords.length}/${records.length} samples had at least one finding\n`);
    for (const r of failedRecords) {
      console.error(`--- ${r.scenario} (sample ${r.sample}) ---`);
      if (r.error) {
        console.error(`  ✗ Generation/parsing error: ${r.error}`);
      } else {
        for (const f of allFailures(r)) console.error(`  ✗ ${f}`);
      }
      if (r.note) {
        console.error(`  Plan text:\n    ${r.note.plan.replace(/\n/g, '\n    ')}`);
      }
      console.error('');
    }
    console.error(`Replay this run: cat ${logPath}`);
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log(`PASSED: all ${records.length} samples across ${scenarios.length} scenarios`);
}

main().catch((e) => {
  console.error('Eval harness crashed:', e);
  process.exit(1);
});
