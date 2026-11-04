/**
 * FINAL-OUTPUT pipeline eval -- the blocking release gate for SOAP note
 * generation (built per Daniel's spec, 2026-11-01).
 *
 * HOW THIS DIFFERS FROM scripts/eval-soap-generation.ts (unchanged, kept as
 * a separate non-blocking diagnostic):
 *
 *   - eval-soap-generation.ts calls the model directly (generateRawNote:
 *     client.messages.create() + JSON.parse) and NEVER calls
 *     validateAndEnhanceResponse -- every backstop (stripUnsupportedMoodClause,
 *     stripUnsupportedPlanClosing, stripUnsupportedDocumentationDenialClause)
 *     is architecturally bypassed. It answers "does the raw model comply
 *     with the prompt," which is useful for drift-hunting but means a
 *     violation that is correctly stripped in production still fails that
 *     harness -- not a real release-blocking signal.
 *
 *   - THIS script calls the real generateSoapNoteAndBilling() -- the exact
 *     function server/routes/soap-notes.ts calls -- with a live Anthropic
 *     client and ONLY `storage` monkey-patched with in-memory fixtures.
 *     Every other piece of app logic that shapes the final note runs for
 *     real: buildSystemPrompt/buildUserPrompt, the CASE A/CASE B context
 *     flags (derived here from the same storage calls the route uses, not
 *     hand-set), every backstop in validateAndEnhanceResponse, and final
 *     response assembly (cptCodes/timeBlocks/reimbursement). It answers
 *     "does what a provider actually sees pass," which is the thing a
 *     release gate should block on.
 *
 * WHY STORAGE IS MONKEY-PATCHED, NOT vi.mock: this is a standalone CLI
 * script (node --import=tsx), not a vitest test file -- vi.mock only works
 * inside the vitest runner. `storage` (server/storage/index.ts) is exported
 * as a plain mutable object literal, so overwriting its methods for the
 * duration of one scenario and restoring them afterward has the same
 * effect as vi.mock for every caller that imports the same module
 * singleton, including aiSoapBillingService.ts.
 *
 * WHAT COUNTS AS A FAILURE (none of these may ever count as a pass):
 *   - A deterministic backstop tripwire firing on the FINAL output. This
 *     should never happen -- the backstops already stripped these patterns
 *     before generateSoapNoteAndBilling returns -- so a hit here means a
 *     backstop regressed, not that this harness found a new wording to add
 *     to a regex.
 *   - A semantic judge finding (fabrication OR omission -- see below).
 *   - result.generationMode !== "ai". generateSoapNoteAndBilling SWALLOWS
 *     every error (auth failure, rate limit, overload, truncated/unparseable
 *     JSON) into a silent rule-based fallback (see its catch block) -- by
 *     design, so a transient AI outage never breaks a provider's workflow.
 *     That design is correct for the product; it is WRONG for a release
 *     gate, which exists to prove the AI path actually ran. A fallback note
 *     here means the live call never completed, for any reason, and must
 *     fail exactly like a crash would.
 *   - The judge itself failing to return parseable findings (no silent
 *     "judge unavailable, skip" -- see runSemanticJudge below, same
 *     contract as the raw harness's version).
 *
 * WORDING: a passing run means "final output passed these checks on these
 * scenarios" -- never "output is safe." Nothing here certifies clinical
 * safety; it certifies that a fixed set of known fabrication/omission
 * patterns did not reappear in the exact code path production uses.
 *
 * Only fake, synthetic patients (see FIXTURES below) -- no real patient
 * data anywhere in this file or its output.
 *
 * Usage: npm run eval:soap-generation-pipeline
 * Env:   ANTHROPIC_API_KEY (or CLAUDE_API_KEY) required -- missing/invalid
 *        FAILS this script (see the isAiConfigured check in main()), same
 *        contract as eval-soap-generation.ts.
 *        EVAL_SAMPLES_PER_SCENARIO (default 3 -- deliberately lower than the
 *        raw diagnostic's default 10; see the cost tradeoff in the PR
 *        description this script shipped with).
 */
import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { createAiClient, isAiConfigured } from '../server/services/aiProvider';
import { storage } from '../server/storage';
import {
  generateSoapNoteAndBilling,
  hasAbsolutistCodingClaim,
  hasUnsupportedContinuityNecessity,
  hasUnsupportedDeficitAssertion,
  hasUnsupportedDocumentationDenialClause,
  hasUnsupportedMoodClause,
  hasUnsupportedPlanClosing,
  SUBJECTIVE_PLACEHOLDER,
  type AiSoapBillingRequest,
  type AiSoapBillingResponse,
} from '../server/services/aiSoapBillingService';

// ---------------------------------------------------------------------------
// Deterministic tripwire checks (final output -- should always pass; a
// failure here means a backstop regressed)
// ---------------------------------------------------------------------------

// The four SOAP sections plus the billing text the provider reads alongside
// them. The 2026-11-04 retest findings (absolutist "only defensible code"
// claims, deficits asserted with no observations) lived in the billing
// rationales, which the first version of this gate never looked at.
type FinalNote = Pick<AiSoapBillingResponse, 'subjective' | 'objective' | 'assessment' | 'plan'> & {
  billingText: string; // billingRationale + every code/pairing rationale + auditNotes, joined
};
type DeterministicCheck = (note: FinalNote, ctx: { hasMood: boolean }) => string | null;

function subjectiveNotBlank(note: FinalNote, _ctx: { hasMood: boolean }) {
  return note.subjective && note.subjective.trim().length > 0
    ? null
    : `Subjective came back EMPTY -- ensureSubjectivePresent should have written "${SUBJECTIVE_PLACEHOLDER}".`;
}

function noAbsolutistCodingClaims(note: FinalNote, _ctx: { hasMood: boolean }) {
  return hasAbsolutistCodingClaim(note.billingText)
    ? 'hasAbsolutistCodingClaim matched the FINAL billing text ("only defensible code", "must be coded as", ...) -- softenAbsolutistCodingClaim should have rewritten this, and the prompt forbids it.'
    : null;
}

// Only meaningful on a scenario that supplies NO performance / strength /
// assistance / endurance observations and NO activity responses.
function noUnsupportedDeficitAssertion(note: FinalNote, _ctx: { hasMood: boolean }) {
  const failures: string[] = [];
  for (const [field, text] of Object.entries(note)) {
    if (hasUnsupportedDeficitAssertion(text as string)) {
      failures.push(`${field} asserts a patient deficit ("underlying ... deficits", "address ... deficits", "decreased strength", ...) although NO observations were supplied -- describing what an activity targets is allowed; a finding nobody documented is not.`);
    }
  }
  return failures.length > 0 ? failures.join(' ') : null;
}

function noBackstopTripwires(note: FinalNote, hasMood: boolean): string | null {
  const failures: string[] = [];
  if (hasUnsupportedPlanClosing(note.plan)) {
    failures.push('hasUnsupportedPlanClosing matched the FINAL plan -- stripUnsupportedPlanClosing should have removed this before generateSoapNoteAndBilling returned.');
  }
  for (const [field, text] of Object.entries(note)) {
    // hasUnsupportedMoodClause is a raw "presented as ..." detector, not
    // itself aware of whether mood was supplied -- the real backstop only
    // strips when mood is BLANK (see stripUnsupportedMoodClause's own
    // `if (hasMood) return text;` guard). Checking it unconditionally here
    // false-positived on P4 (mood genuinely supplied): a real,
    // legitimately-surviving "Patient presented as cooperative..." sentence
    // got flagged as a regression. Mirror the real gate exactly.
    if (!hasMood && hasUnsupportedMoodClause(text as string)) {
      failures.push(`hasUnsupportedMoodClause matched the FINAL ${field} -- stripUnsupportedMoodClause should have removed this.`);
    }
    if (hasUnsupportedDocumentationDenialClause(text as string)) {
      failures.push(`hasUnsupportedDocumentationDenialClause matched the FINAL ${field} -- stripUnsupportedDocumentationDenialClause should have removed this.`);
    }
  }
  return failures.length > 0 ? failures.join(' ') : null;
}

// CASE A scenarios only (no prior plan, no goals): neither the Assessment
// nor the Plan may carry a "remain medically necessary" / "continued need
// for skilled" claim.
function noContinuityNecessityInCaseA(note: FinalNote, _ctx: { hasMood: boolean }) {
  const failures: string[] = [];
  for (const field of ['assessment', 'plan'] as const) {
    if (hasUnsupportedContinuityNecessity(note[field])) {
      failures.push(`hasUnsupportedContinuityNecessity matched the FINAL ${field} -- stripUnsupportedContinuityNecessity / stripUnsupportedPlanClosing should have removed this on a first documented session.`);
    }
  }
  return failures.length > 0 ? failures.join(' ') : null;
}

function noAgeAnywhere(note: FinalNote, _ctx: { hasMood: boolean }) {
  const combined = `${note.subjective} ${note.objective} ${note.assessment} ${note.plan}`;
  return /\b(19|20)\d{2}\b.{0,20}\b(years?[- ]old|y\.?o\.?|age)\b|\b(age(d)?\s*\d+)\b/i.test(combined)
    ? 'An age or birth-year-derived claim appeared with a blank date of birth (the epoch-age bug, #425, applies equally to the final output).'
    : null;
}

function continuityShouldAppear(note: FinalNote, _ctx: { hasMood: boolean }) {
  return /current plan remains appropriate|suggested update:/i.test(note.plan)
    ? null
    : 'Control (real history): a real prior plan + active goals were supplied, but the Plan carries neither the CASE B continuity opening nor a "Suggested update:" -- CASE B carry-forward may be broken in the real pipeline, not an over-correction from the CASE A backstops.';
}

// ---------------------------------------------------------------------------
// Semantic judge -- runs against the FINAL output. One prompt covers BOTH
// directions Daniel asked for:
//   - FABRICATION (same 3 checks as the raw harness's judge): unsupported
//     continuity/necessity, mood/caregiver content invented when the field
//     was left blank.
//   - OMISSION (new): when a field genuinely WAS supplied, the real
//     clinical substance must survive into the note -- matched by MEANING,
//     not exact phrase, so a legitimate paraphrase passes. Only evaluated
//     for whichever field(s) the per-scenario context says are non-blank,
//     to avoid a single combined prompt costing two judge calls.
// ---------------------------------------------------------------------------

interface JudgeFinding {
  check: 'traceability' | 'mood_fabrication' | 'caregiver_report_fabrication' | 'mood_omission' | 'caregiver_report_omission' | 'coding_overclaim' | 'unsupported_deficit';
  quote: string;
  reason: string;
}

const PIPELINE_JUDGE_SYSTEM_PROMPT = `You are a strict compliance reviewer checking a FINAL, already-post-processed pediatric OT SOAP note (produced by the real production pipeline, including its automated backstops) for two opposite defect classes: FABRICATION and OMISSION. You are NOT reviewing writing quality, tone, thoroughness, or clinical style.

You will be told, for each of Mood/Presentation and Caregiver Report, whether the therapist's real input was BLANK or carried a real value (and if real, a summary of its substance). Apply the matching checks below only for the fields actually relevant to this note -- you will be told which.

FABRICATION checks:
1. TRACEABILITY (the Plan section, and ALSO any medical-necessity or "continued need" sentence in the Assessment): every clinical claim in PLAN must trace to an explicit input field you're given, or to a default you're explicitly told applies. A sentence asserting continuity with an existing plan, an established treatment frequency, a reviewed/continued home program, established treatment goals, a documented plan of care, or ongoing necessity of skilled therapy -- when no such history was provided -- is a FABRICATION, however clinically plausible it reads, regardless of exact wording.
2. MOOD FABRICATION: if the Mood/Presentation input was BLANK, the note must not describe the patient's mood, affect, demeanor, or presentation ANYWHERE.
3. CAREGIVER REPORT FABRICATION: if the Caregiver Report input was BLANK, the note must make NO statement about a caregiver report in either direction -- not "a caregiver report was obtained" and not "a caregiver report was not obtained." Silence is correct. A sentence about the patient's mood or presentation ("Patient presented as cooperative and engaged") is a MOOD sentence, judged ONLY under checks 2/4 -- it is never a caregiver-report statement and must never be flagged under this check. The exact sentence "No subjective information was entered for this session." is the pipeline's own placeholder and is always allowed.

CODING-RATIONALE checks (apply to the BILLING TEXT section of every note):
6. CODING OVERCLAIM: flag ONLY wording that claims exclusivity or compulsion -- "the only defensible/correct/appropriate code", "must be coded as", "no other code applies", "required". The pipeline INSTRUCTS the model to use 97530 Therapeutic Activities as the conservative default when documentation could support more than one code and to SAY so; therefore sentences like "97530 is the conservative default when documentation supports multiple interpretations" or "97530 is the conservative choice here" are CORRECT and must NOT be flagged. A rationale that names an alternative and explains its preference is CORRECT. Preferring a code is not overclaiming; denying that any alternative exists is.
7. UNSUPPORTED DEFICIT: apply this check ONLY when the input summary says in so many words that CHECK 7 APPLIES (no observations of any kind). When it applies: any statement that the patient HAS a deficit, weakness, decreased endurance, impaired motor planning, etc. is a fabricated clinical finding; describing what an activity TARGETS or DEMANDS ("trampoline work targets lower-extremity strength and endurance") is allowed. When the input summary says check 7 does NOT apply (activity responses were supplied), do not raise this check at all -- an inference from a supplied response (fatigue at 8 minutes -> endurance/activity tolerance) is reviewable interpretation, not fabrication. Continuity words ("continued need", "remain necessary") are check 1's business, never check 7's.

OMISSION checks (only apply when told the field is NON-blank):
4. MOOD OMISSION: if the Mood/Presentation input carried a real value, the note's Subjective/Objective/Assessment must reflect that real information SOMEWHERE, in substance -- a reasonable paraphrase is fine (e.g. "cooperative and engaged" legitimately becomes "patient demonstrated cooperative engagement throughout the session"). Flag only if the real supplied mood information is entirely absent from the note, not if the wording differs.
5. CAREGIVER REPORT OMISSION: if the Caregiver Report input carried a real value, the note must reflect, somewhere, that a caregiver report was obtained AND its real substance -- again, matched by meaning, not exact phrase. Flag only if the real supplied caregiver information is entirely absent, not if the wording differs.

You MUST allow, and must NOT flag:
- Clinical INFERENCE grounded in what was actually documented (e.g. an activity response describing fatigue may support discussion of endurance/activity tolerance -- that is reviewable interpretation of a real observation, not fabrication). Only flag a claim that goes BEYOND what the observation supports.
- Clinical/skilled-therapy vocabulary in general -- the defect is asserting continuation/necessity grounded in history that doesn't exist, or dropping real supplied content, not the vocabulary itself.
- Any reasonable paraphrase of a real, supplied fact. Do not require exact wording for either a fabrication check (which forbids a CONCEPT, regardless of phrasing) or an omission check (which requires a CONCEPT to survive, regardless of phrasing).

Respond with ONLY this JSON:
{"findings": [{"check": "traceability"|"mood_fabrication"|"caregiver_report_fabrication"|"mood_omission"|"caregiver_report_omission"|"coding_overclaim"|"unsupported_deficit", "quote": "<the EXACT offending sentence copied verbatim from the note, or, for an omission finding, the EXACT sentence(s) that should have contained it but didn't -- if omission is note-wide, quote the full Subjective section>", "reason": "<one sentence stating WHY this IS a violation>"}]}

Every entry in "findings" is an assertion that this IS a real violation -- never include an entry whose own reasoning concludes the content is correct, compliant, or not a violation. If you considered a sentence and decided it does NOT violate any check, leave it out of "findings" entirely; do not add it as a note or explanation. If there are no violations, respond with {"findings": []}. Every finding MUST include a verbatim quote -- never paraphrase or summarize what's wrong without quoting it.`;

async function runSemanticJudge(client: Anthropic, note: FinalNote, judgeContext: string): Promise<JudgeFinding[]> {
  const userPrompt = `INPUT PROVIDED TO THE NOTE-GENERATING PIPELINE:\n${judgeContext}\n\nFINAL NOTE (after production backstops already ran):\nSUBJECTIVE: ${note.subjective}\n\nOBJECTIVE: ${note.objective}\n\nASSESSMENT: ${note.assessment}\n\nPLAN: ${note.plan}\n\nBILLING TEXT (code rationales shown to the provider):\n${note.billingText}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1500,
    temperature: 0,
    system: PIPELINE_JUDGE_SYSTEM_PROMPT + '\n\nRespond with ONLY the JSON object, no markdown fencing or commentary.',
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
// Storage fixtures -- PATCHED ONTO THE REAL `storage` OBJECT for the
// duration of one scenario, then restored. Synthetic data only.
// ---------------------------------------------------------------------------

const PRACTICE_ID = 1;

interface StorageFixture {
  patient: Record<string, unknown>;
  activeTreatmentPlan: Record<string, unknown> | null;
  allTreatmentPlans: Array<Record<string, unknown>>;
  treatmentGoals: Array<Record<string, unknown>>;
  recentSoapNotes: Array<Record<string, unknown>>;
}

type StoragePatch = Pick<
  typeof storage,
  'getPatient' | 'getCachedInsuranceData' | 'getActiveTreatmentPlan' | 'getPatientTreatmentPlans' | 'getTreatmentGoals' | 'getRecentSoapNotesForPatient' | 'getCptCodes' | 'resolvePracticeCptRate'
>;

function applyFixture(fixture: StorageFixture): StoragePatch {
  const original = {
    getPatient: storage.getPatient,
    getCachedInsuranceData: storage.getCachedInsuranceData,
    getActiveTreatmentPlan: storage.getActiveTreatmentPlan,
    getPatientTreatmentPlans: storage.getPatientTreatmentPlans,
    getTreatmentGoals: storage.getTreatmentGoals,
    getRecentSoapNotesForPatient: storage.getRecentSoapNotesForPatient,
    getCptCodes: storage.getCptCodes,
    resolvePracticeCptRate: storage.resolvePracticeCptRate,
  };
  Object.assign(storage, {
    getPatient: async (_id: number) => fixture.patient,
    getCachedInsuranceData: async (_patientId: number, _kind: string) => null,
    getActiveTreatmentPlan: async (_patientId: number) => fixture.activeTreatmentPlan,
    getPatientTreatmentPlans: async (_patientId: number) => fixture.allTreatmentPlans,
    getTreatmentGoals: async (_planId: number) => fixture.treatmentGoals,
    getRecentSoapNotesForPatient: async (_patientId: number, _practiceId: number, _limit: number) => fixture.recentSoapNotes,
    // Real per-code practice-rate lookup is deliberately NOT exercised here --
    // it only refines the displayed dollar estimate (see the try/catch around
    // it in validateAndEnhanceResponse) and has no bearing on note content,
    // which is all this eval checks. Returning [] / null exercises the real
    // "no override, use flat rate" fallback branch rather than faking a catalog.
    getCptCodes: async () => [],
    resolvePracticeCptRate: async (_practiceId: number, _cptCodeId: number) => null,
  });
  return original;
}

function restoreFixture(original: StoragePatch) {
  Object.assign(storage, original);
}

function freshPatient(suffix: string, dateOfBirth: string | null = '2018-05-01') {
  return { id: 900000, practiceId: PRACTICE_ID, firstName: 'Eval', lastName: `PipelineFresh${suffix}`, dateOfBirth };
}

const BASE_ASSESSMENT = {
  performance: '', assistance: '', strength: '', motorPlanning: '', sensoryRegulation: '',
};

const BASE_SESSION = {
  practiceId: PRACTICE_ID,
  activities: ['Obstacle Course', 'Trampoline'],
  activityDetails: [
    { name: 'Obstacle Course', response: 'Completed obstacle course with minimal verbal cues.' },
    { name: 'Trampoline', response: 'Fatigue noted at 8 minutes; recovered with brief rest.' },
  ],
  duration: 45,
  location: 'Sensory gym',
  assessment: BASE_ASSESSMENT,
  planNextSteps: 'Bilateral coordination and sustained attention',
};

const CLEAN_ROOM_CONTEXT_BASE = `- Activities: Obstacle Course (minimal verbal cues to complete), Trampoline (fatigue noted at 8 minutes, recovered with brief rest)
- Clinical observation ratings (performance, assistance, strength, motor planning, sensory regulation): all BLANK
- Plan Next Steps: "Bilateral coordination and sustained attention"
- No prior treatment plan, goals, or session history exists for this patient (this is their first documented session; the pipeline's own storage lookups return nothing).`;

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  guards: string;
  request: AiSoapBillingRequest;
  fixture: StorageFixture;
  deterministicChecks: DeterministicCheck[];
  judge: { context: string } | null; // null => skip the judge call for this scenario
}

const scenarios: Scenario[] = [
  {
    name: 'P1: fresh patient, no history, both optional fields blank (clean room)',
    guards: 'Final-output equivalent of raw harness Scenario 1 -- fabrication checks against the REAL pipeline output (post-backstops).',
    request: { patientId: 900001, mood: '', caregiverReport: undefined, ...BASE_SESSION } as AiSoapBillingRequest,
    fixture: { patient: freshPatient('CleanRoom'), activeTreatmentPlan: null, allTreatmentPlans: [], treatmentGoals: [], recentSoapNotes: [] },
    deterministicChecks: [noBackstopTripwires, subjectiveNotBlank, noAbsolutistCodingClaims, noContinuityNecessityInCaseA],
    judge: { context: `${CLEAN_ROOM_CONTEXT_BASE}\n- Mood/Presentation: BLANK (not entered) -- apply check 2, not check 4.\n- Caregiver Report: BLANK (not entered) -- apply check 3, not check 5.\n- Activity responses WERE supplied (see above): check 7 does NOT apply to this note.` },
  },
  {
    name: 'P2: blank date of birth',
    guards: 'Final-output equivalent of raw harness Scenario 4 -- the epoch-age bug (#425), checked on the real pipeline output.',
    request: { patientId: 900002, mood: '', caregiverReport: undefined, ...BASE_SESSION } as AiSoapBillingRequest,
    fixture: { patient: freshPatient('DobBlank', null), activeTreatmentPlan: null, allTreatmentPlans: [], treatmentGoals: [], recentSoapNotes: [] },
    deterministicChecks: [noBackstopTripwires, noAgeAnywhere, subjectiveNotBlank, noAbsolutistCodingClaims, noContinuityNecessityInCaseA],
    judge: { context: `${CLEAN_ROOM_CONTEXT_BASE}\n- Date of birth: BLANK (not entered).\n- Mood/Presentation: BLANK (not entered) -- apply check 2, not check 4.\n- Caregiver Report: BLANK (not entered) -- apply check 3, not check 5.\n- Activity responses WERE supplied: check 7 does NOT apply to this note.` },
  },
  {
    name: 'P3: real history + active goals (continuity SHOULD appear) -- control, no judge',
    guards: 'Final-output equivalent of raw harness Scenario 11. Unlike the raw harness (which hand-set hasMostRecentPlanContext/hasActiveGoalsContext), the real pipeline DERIVES both flags from these same storage fixtures -- this exercises that derivation for real, not just the backstop functions in isolation.',
    request: {
      patientId: 900003,
      practiceId: PRACTICE_ID,
      activities: ['Obstacle Course'],
      mood: 'Cooperative',
      duration: 45,
      location: 'Clinic',
      assessment: BASE_ASSESSMENT,
      planNextSteps: 'Continue bilateral coordination work',
    } as AiSoapBillingRequest,
    fixture: {
      patient: freshPatient('Returning', '2016-09-10'),
      activeTreatmentPlan: { id: 500003, patientId: 900003, status: 'active' },
      allTreatmentPlans: [{ id: 500003, patientId: 900003, status: 'active' }],
      treatmentGoals: [{ id: 1, treatmentPlanId: 500003, status: 'active', description: 'Improve bilateral coordination for ball skills.' }],
      recentSoapNotes: [{
        therapistSignedAt: '2026-10-01',
        objective: 'Required moderate assist for ball skills.',
        assessment: 'Emerging postural control.',
        plan: 'Continue OT 2x/week focusing on bilateral coordination.',
      }],
    },
    deterministicChecks: [continuityShouldAppear, subjectiveNotBlank, noAbsolutistCodingClaims],
    judge: null,
  },
  {
    name: 'P4: positive control -- genuine mood value must survive',
    guards: 'Requirement #3: a genuinely supplied mood value must appear in the final note in substance (paraphrase allowed), checked via the omission judge.',
    request: { patientId: 900004, mood: 'Cooperative and engaged throughout the session', caregiverReport: undefined, ...BASE_SESSION } as AiSoapBillingRequest,
    fixture: { patient: freshPatient('MoodControl'), activeTreatmentPlan: null, allTreatmentPlans: [], treatmentGoals: [], recentSoapNotes: [] },
    deterministicChecks: [noBackstopTripwires, subjectiveNotBlank, noAbsolutistCodingClaims, noContinuityNecessityInCaseA],
    judge: { context: `${CLEAN_ROOM_CONTEXT_BASE}\n- Mood/Presentation: REAL VALUE supplied -- "Cooperative and engaged throughout the session." Apply check 4 (mood omission), not check 2. A Subjective sentence restating this mood is correct.\n- Caregiver Report: BLANK (not entered) -- apply check 3, not check 5.\n- Activity responses WERE supplied: check 7 does NOT apply to this note.` },
  },
  {
    name: 'P5: positive control -- genuine caregiver report must survive',
    guards: 'Requirement #3: a genuinely supplied caregiver report must appear in the final note in substance (paraphrase allowed), checked via the omission judge.',
    request: { patientId: 900005, mood: '', caregiverReport: 'Caregiver reports increased independence with morning self-dressing routine at home this week.', ...BASE_SESSION } as AiSoapBillingRequest,
    fixture: { patient: freshPatient('CaregiverControl'), activeTreatmentPlan: null, allTreatmentPlans: [], treatmentGoals: [], recentSoapNotes: [] },
    deterministicChecks: [noBackstopTripwires, subjectiveNotBlank, noAbsolutistCodingClaims, noContinuityNecessityInCaseA],
    judge: { context: `${CLEAN_ROOM_CONTEXT_BASE}\n- Mood/Presentation: BLANK (not entered) -- apply check 2, not check 4.\n- Caregiver Report: REAL VALUE supplied -- "Caregiver reports increased independence with morning self-dressing routine at home this week." Apply check 5 (caregiver omission), not check 3.\n- Activity responses WERE supplied: check 7 does NOT apply to this note.` },
  },
  {
    name: 'P6: activities only -- no observations, no activity responses (targets, not deficits)',
    guards: 'Retest finding 2026-11-04: with no performance/strength/assistance/endurance observations and no activity responses, a note asserted "underlying strength and endurance deficits" in the Assessment and the billing explanation. Describing what the activities target is allowed; asserting the patient has a deficit is not. Also the cleanest input for the run-to-run code-consistency metric.',
    request: {
      patientId: 900006,
      practiceId: PRACTICE_ID,
      activities: ['Obstacle Course', 'Trampoline'],
      // NO activityDetails on purpose.
      mood: '',
      caregiverReport: undefined,
      duration: 45,
      location: 'Sensory gym',
      assessment: BASE_ASSESSMENT,
      planNextSteps: 'Bilateral coordination and sustained attention',
    } as AiSoapBillingRequest,
    fixture: { patient: freshPatient('ActivitiesOnly'), activeTreatmentPlan: null, allTreatmentPlans: [], treatmentGoals: [], recentSoapNotes: [] },
    deterministicChecks: [noBackstopTripwires, subjectiveNotBlank, noAbsolutistCodingClaims, noContinuityNecessityInCaseA, noUnsupportedDeficitAssertion],
    judge: { context: `- Activities: Obstacle Course, Trampoline -- NO activity responses were entered.
- Clinical observation ratings (performance, assistance, strength, motor planning, sensory regulation, endurance): all BLANK.
- Plan Next Steps: "Bilateral coordination and sustained attention"
- No prior treatment plan, goals, or session history exists for this patient (first documented session).
- Mood/Presentation: BLANK (not entered) -- apply check 2, not check 4.
- Caregiver Report: BLANK (not entered) -- apply check 3, not check 5.
- NO observations of any kind were supplied: CHECK 7 APPLIES to this note. Any statement that the patient HAS a deficit, weakness or decreased endurance is a fabricated finding; describing what the activities target is fine.` },
  },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

interface SampleRecord {
  runId: string;
  scenario: string;
  sample: number;
  note: FinalNote | null;
  generationMode: AiSoapBillingResponse['generationMode'] | null;
  deterministicFailures: string[];
  judgeFindings: JudgeFinding[];
  error: string | null;
  /** activity -> suggested CPT code, for the run-to-run consistency metric. */
  codesByActivity: Record<string, string> | null;
}

function allFailures(record: SampleRecord): string[] {
  const judgeFailures = record.judgeFindings.map((f) => `Semantic judge [${f.check}]: "${f.quote}" -- ${f.reason}`);
  const modeFailure =
    record.generationMode && record.generationMode !== 'ai'
      ? [`result.generationMode was "${record.generationMode}", not "ai" -- the live call did not complete (see aiSoapBillingService.ts's catch block). A fallback note must never count as a pass.`]
      : [];
  return [...modeFailure, ...record.deterministicFailures, ...judgeFailures];
}

async function main() {
  // Same contract as eval-soap-generation.ts: FAILS (does not skip) without
  // a key. A release gate that can pass without ever running isn't a gate.
  if (!isAiConfigured()) {
    console.error(
      'ANTHROPIC_API_KEY (or CLAUDE_API_KEY) is not set. This eval makes real, billed API calls against the real production pipeline and needs a key to run -- ' +
        'failing rather than skipping, because a release gate that passes without ever running is not a gate. ' +
        'Add the secret in repo Settings -> Secrets and variables -> Actions.',
    );
    process.exit(1);
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const samplesPerScenario = Number(process.env.EVAL_SAMPLES_PER_SCENARIO ?? 3);
  // Used ONLY for judge calls -- generateSoapNoteAndBilling creates its own
  // client internally from the same env vars via aiProvider.createAiClient.
  const judgeClient = createAiClient({});
  const records: SampleRecord[] = [];

  console.log(`Run ID: ${runId}`);
  console.log(`Pipeline eval (final output, real backstops): ${scenarios.length} scenario(s) x ${samplesPerScenario} sample(s) against the live model...\n`);

  for (const scenario of scenarios) {
    console.log(`→ ${scenario.name}`);
    console.log(`  guards: ${scenario.guards}`);
    const original = applyFixture(scenario.fixture);
    try {
      for (let sample = 1; sample <= samplesPerScenario; sample++) {
        const record: SampleRecord = {
          runId,
          scenario: scenario.name,
          sample,
          note: null,
          generationMode: null,
          deterministicFailures: [],
          judgeFindings: [],
          error: null,
          codesByActivity: null,
        };
        try {
          const result = await generateSoapNoteAndBilling(scenario.request);
          record.generationMode = result.generationMode;
          const note: FinalNote = {
            subjective: result.subjective,
            objective: result.objective,
            assessment: result.assessment,
            plan: result.plan,
            billingText: [
              result.billingRationale,
              ...result.cptCodes.map((c) => `${c.code} ${c.name}: ${c.rationale}`),
              ...result.activityCptPairings.map((p) => `${p.activity} -> ${p.code}: ${p.rationale}`),
              ...(result.auditNotes || []),
            ].filter(Boolean).join('\n'),
          };
          record.note = note;
          record.codesByActivity = Object.fromEntries(result.activityCptPairings.map((p) => [p.activity, p.code]));
          const checkCtx = { hasMood: !!scenario.request.mood };
          record.deterministicFailures = scenario.deterministicChecks
            .map((check) => check(note, checkCtx))
            .filter((msg): msg is string => msg !== null);

          if (result.generationMode === 'ai' && scenario.judge) {
            record.judgeFindings = await runSemanticJudge(judgeClient, note, scenario.judge.context);
          }
        } catch (e: any) {
          record.error = e?.message ?? String(e);
        }
        records.push(record);
        const failed = record.error || allFailures(record).length > 0;
        console.log(`  sample ${sample}/${samplesPerScenario}: ${record.error ? 'ERROR' : failed ? 'FAIL' : 'PASS'} (generationMode=${record.generationMode ?? 'n/a'})`);
      }
    } finally {
      restoreFixture(original);
    }
    console.log('');
  }

  // Run-to-run code consistency (REPORTED, not gated). Identical inputs that
  // land on different codes across samples are the 2026-11-04 finding in its
  // raw form. Genuinely ambiguous activities may still split at low
  // temperature, so this is a metric to watch, not a pass/fail -- the gated
  // part is that no rationale may claim its side of a split is the "only
  // defensible" one (noAbsolutistCodingClaims).
  const consistency: Record<string, Record<string, string[]>> = {};
  for (const scenario of scenarios) {
    const perActivity: Record<string, string[]> = {};
    for (const r of records.filter((x) => x.scenario === scenario.name && x.codesByActivity)) {
      for (const [activity, code] of Object.entries(r.codesByActivity!)) {
        (perActivity[activity] ||= []).push(code);
      }
    }
    consistency[scenario.name] = perActivity;
    const splits = Object.entries(perActivity).filter(([, codes]) => new Set(codes).size > 1);
    if (splits.length > 0) {
      console.log(`  consistency (${scenario.name}): ${splits.map(([a, codes]) => `${a} -> ${codes.join('/')}`).join('; ')}  [reported, not gated]`);
    }
  }

  const resultsDir = resolve(import.meta.dirname, '..', '.eval-results');
  mkdirSync(resultsDir, { recursive: true });
  const logPath = resolve(resultsDir, `pipeline-${runId}.json`);
  writeFileSync(
    logPath,
    JSON.stringify({ runId, timestamp: new Date().toISOString(), scenarios: scenarios.map((s) => s.name), consistency, records }, null, 2),
  );
  console.log(`Full results (fixtures + outputs + verdicts) written to ${logPath}\n`);

  const failedRecords = records.filter((r) => r.error || allFailures(r).length > 0);
  if (failedRecords.length > 0) {
    console.error('='.repeat(70));
    console.error(`FAILED: ${failedRecords.length}/${records.length} samples had at least one finding\n`);
    for (const r of failedRecords) {
      console.error(`--- ${r.scenario} (sample ${r.sample}) ---`);
      if (r.error) {
        console.error(`  ✗ Error: ${r.error}`);
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
  console.log(`PASSED: final output passed these checks on these ${scenarios.length} scenarios (${records.length} samples total).`);
}

main().catch((e) => {
  console.error('Pipeline eval crashed:', e);
  process.exit(1);
});
