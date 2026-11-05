import Anthropic from "@anthropic-ai/sdk";
import { createAiClient, isAiConfigured } from './aiProvider';
import { storage } from "../storage";
import { assertPhiAiAllowed } from "../utils/phiAiGuard";
import logger from "./logger";
import {
  type ActivityCptPairing,
  CONSERVATIVE_DEFAULT_CPT_CODE,
  CONSERVATIVE_DEFAULT_CPT_NAME,
  CONSERVATIVE_DEFAULT_RATIONALE,
  normalizeActivityCptPairings,
  reconcileCptCodesWithPairings,
} from "@shared/activityCpt";

// Lazy initialization of Anthropic client (only when API key is present)
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!isAiConfigured()) {
    console.warn("ANTHROPIC_API_KEY not set - AI features will use fallback rule-based generation");
    return null;
  }
  if (!anthropicClient) {
    anthropicClient = createAiClient({ apiKey });
  }
  return anthropicClient;
}

// Default rate per 15-minute unit (can be overridden per session)
const DEFAULT_UNIT_RATE = 289;

// CPT Code information with reimbursement rates
// All codes use the same base rate of $289/unit by default
// Some insurers may have different rates per code - this is handled via insurance contract data
const CPT_CODE_INFO = {
  "97533": { name: "Sensory Integration", rate: DEFAULT_UNIT_RATE, description: "Sensory integrative techniques" },
  "97530": { name: "Therapeutic Activities", rate: DEFAULT_UNIT_RATE, description: "Dynamic activities for functional performance" },
  "97112": { name: "Neuromuscular Re-education", rate: DEFAULT_UNIT_RATE, description: "Movement, balance, coordination training" },
  "97110": { name: "Therapeutic Exercise", rate: DEFAULT_UNIT_RATE, description: "Exercises for strength, ROM, endurance" },
  "97535": { name: "Self-Care/Home Management", rate: DEFAULT_UNIT_RATE, description: "ADL and IADL training" },
  "97542": { name: "Wheelchair Management", rate: DEFAULT_UNIT_RATE, description: "Wheelchair assessment and training" },
};

export interface AiSoapBillingRequest {
  patientId: number;
  /**
   * The authenticated caller's practice. When set, the patient MUST belong to
   * it or generation is refused — this is the tenant-isolation guard for a
   * feature that embeds patient PHI (name, dx, goals) into the prompt. Callers
   * that have a practice context MUST pass it; leaving it undefined skips the
   * check and is only for trusted internal/no-context callers.
   */
  practiceId?: number;
  activities: string[];
  /**
   * Per-activity therapist narratives — the primary Objective input per
   * clinician feedback: "what happened / how did the patient respond"
   * (before → intervention → response → functional change). Optional per
   * activity; when present, the model treats it as the authoritative account
   * of that activity.
   */
  activityDetails?: Array<{ name: string; response?: string }>;
  mood: string;
  caregiverReport?: string;
  duration: number;
  location: string;
  assessment: {
    performance: string;
    assistance: string;
    strength: string;
    motorPlanning: string;
    sensoryRegulation: string;
    // Enhanced clinical observations
    posturalControl?: string;
    primitiveReflexes?: string;
    fineMotor?: string;
    grossMotor?: string;
    bilateralCoordination?: string;
    endurance?: string;
    engagement?: string;
  };
  planNextSteps: string;
  nextSessionFocus?: string;
  homeProgram?: string;
  // Manual rate override - if set, uses this rate instead of default $289/unit
  ratePerUnit?: number;
  // Enhanced context
  therapistName?: string;
  sessionType?: string; // 'OT', 'PT', 'ST'
}

export interface GeneratedCptCode {
  code: string;
  name: string;
  units: number;
  rationale: string;
  reimbursement: number;
  activitiesAssigned: string[];
}

// Individual 15-minute timeblock with assigned CPT code
export interface TimeBlock {
  blockNumber: number; // 1, 2, 3, 4 for a 60-min session
  startMinute: number; // 0, 15, 30, 45
  endMinute: number;   // 15, 30, 45, 60
  code: string;
  codeName: string;
  rate: number;
  activities: string[];
}

export interface AiSoapBillingResponse {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  cptCodes: GeneratedCptCode[];
  /**
   * One suggested CPT code per documented activity (Objective pairing).
   * SINGLE SOURCE OF TRUTH for which activities support which code: the
   * aggregate cptCodes above are re-derived from these pairings (see
   * shared/activityCpt.ts), so the two views cannot contradict each other.
   * Suggestions only — the therapist can change every code; unclear
   * activities conservatively default to 97530 Therapeutic Activities.
   */
  activityCptPairings: ActivityCptPairing[];
  timeBlocks: TimeBlock[]; // Individual 15-min blocks for insurers requiring per-block codes
  totalReimbursement: number;
  billingRationale: string;
  auditNotes: string[];
  /**
   * How the note was produced. "ai" = Claude-generated from the documented
   * session. "fallback" = the rule-based template (AI unavailable, or the AI
   * output was truncated/unparseable) — a templated note the provider MUST
   * review especially carefully before signing/billing, so the UI surfaces it.
   */
  generationMode: "ai" | "fallback";
}

/**
 * AI-powered SOAP note and billing code generation
 * Uses Claude (Anthropic) to analyze activities and ensure billing accuracy based on:
 * - Activities performed
 * - Patient's insurance contract (when available)
 * - Medical necessity requirements
 * - Audit defensibility
 */
export interface GenerateSoapOptions {
  /**
   * Optional callback invoked each time Claude streams a text chunk. The server
   * uses this to flush keepalive bytes to the HTTP response so the ALB idle
   * timeout doesn't fire on long generations. Safe to ignore.
   */
  onProgress?: () => void;
  /**
   * Optional callback invoked with each streamed text chunk from Claude. The
   * route uses this to forward live deltas over SSE so the user watches the
   * note materialize. The chunks are the raw JSON the model emits; the client
   * extracts the in-progress section text for a readable preview.
   */
  onTextDelta?: (text: string) => void;
  /** Aborts the in-flight Claude generation (e.g. when the HTTP client disconnects). */
  signal?: AbortSignal;
}

export async function generateSoapNoteAndBilling(
  request: AiSoapBillingRequest,
  options: GenerateSoapOptions = {}
): Promise<AiSoapBillingResponse> {
  assertPhiAiAllowed('SOAP note generation');

  // Get patient and insurance information
  const patient = await storage.getPatient(request.patientId);
  if (!patient) {
    throw new Error("Patient not found");
  }
  // Tenant isolation: never generate a note (which embeds this patient's PHI)
  // for a patient outside the caller's practice. getPatient() is not
  // practice-scoped, so the ownership check must happen here.
  if (request.practiceId != null && (patient as any).practiceId !== request.practiceId) {
    throw new Error("Patient not found");
  }

  // Get cached insurance data if available (from the authorization system)
  let insuranceData = null;
  try {
    const cachedData = await storage.getCachedInsuranceData(request.patientId, "benefits");
    if (cachedData && cachedData.normalizedData) {
      insuranceData = cachedData.normalizedData;
    }
  } catch (e) {
    // No cached insurance data available
  }

  // Get treatment plan and goals for enhanced clinical context
  let treatmentPlan = null;
  let treatmentGoals: any[] = [];
  try {
    // Try to get active treatment plan first
    const activePlan = await storage.getActiveTreatmentPlan(request.patientId);
    treatmentPlan = activePlan ?? null;
    if (!treatmentPlan) {
      // Fall back to any treatment plan (diagnosis context only — goals are
      // included only from the ACTIVE plan, per the approved design)
      const plans = await storage.getPatientTreatmentPlans(request.patientId);
      if (plans && plans.length > 0) {
        treatmentPlan = plans[0];
      }
    }
    if (activePlan) {
      // Active goals only: a goal that was achieved/met or discontinued is
      // no longer treatment context for today's session.
      const allGoals = await storage.getTreatmentGoals(activePlan.id);
      treatmentGoals = (allGoals ?? []).filter(
        (g: any) => !['achieved', 'met', 'discontinued'].includes(String(g?.status ?? '')),
      );
    }
  } catch (e) {
    // No treatment plan available
  }

  // Prior signed notes give the model REAL progress context — the only
  // ground truth that legitimizes "compared to last session" statements
  // (the anti-fabrication rules forbid such comparisons otherwise).
  let priorSessions: Array<{ date: string; objective?: string; assessment?: string; plan?: string }> = [];
  try {
    if (request.practiceId) {
      const priorNotes = await storage.getRecentSoapNotesForPatient(
        request.patientId,
        request.practiceId,
        3,
      );
      const trim = (s: any) =>
        typeof s === 'string' && s.length > 500 ? `${s.slice(0, 500)}…` : (s ?? undefined);
      priorSessions = (priorNotes ?? []).map((n: any) => ({
        date: n.therapistSignedAt ?? n.createdAt ?? 'unknown date',
        objective: trim(n.objective),
        assessment: trim(n.assessment),
        plan: trim(n.plan),
      }));
    }
  } catch (e) {
    // No prior notes available — generation proceeds without progress context.
  }

  // Calculate available billing units
  const billingUnits = Math.floor(request.duration / 15);

  // Check if Anthropic is available
  const client = getAnthropicClient();
  if (!client) {
    // Use fallback generation when AI is not available
    console.log("Using fallback rule-based SOAP generation (no API key)");
    return fallbackGeneration(request, patient, billingUnits);
  }

  // Build the AI prompt
  const systemPrompt = buildSystemPrompt(insuranceData);
  const userPrompt = buildUserPrompt(request, patient, billingUnits, insuranceData, treatmentPlan, treatmentGoals, priorSessions);

  try {
    // Use streaming so we don't hit a long hang on a single request. The SDK
    // auto-retries non-streaming calls on certain errors with a default 10-min
    // timeout, which can push a single "create" call past the ALB's idle
    // timeout. Streaming gives us continuous progress signals and faster
    // failure on real errors.
    const stream = client.messages.stream({
      model: "claude-sonnet-4-5",
      // Latency is driven by tokens GENERATED, not this ceiling — the model
      // stops at end_turn when the note is complete (~1300-1400 tokens for a
      // typical note; more for a clinically rich session). Keep the ceiling
      // generous so a long-but-legitimate note is never truncated mid-JSON
      // (truncation fails JSON.parse below → silent fallback to a rule-based
      // note). Perceived speed comes from streaming the note as it's written,
      // not from a tight cap. See the audit notes in adversarial review.
      max_tokens: 6000,
      // 0.5. A 0.2 trial (2026-11-04) did not make code choices repeatable
      // (identical inputs still split 97530/97112/97110 across samples) and
      // coincided with more continuity padding in CASE A plans, so the
      // known-passing value stays. Repeatability is handled by the
      // conservative-default rule and the rationale backstops instead.
      temperature: 0.5,
      system:
        systemPrompt +
        "\n\nRespond with ONLY a valid JSON object, no markdown fencing or commentary.",
      messages: [{ role: "user", content: userPrompt }],
    });

    if (options.onProgress || options.onTextDelta) {
      stream.on("text", (t: string) => {
        options.onProgress?.();
        options.onTextDelta?.(t);
      });
    }
    // Abort the upstream generation if the HTTP client disconnects, so an
    // abandoned request doesn't keep burning output tokens to completion.
    if (options.signal) {
      if (options.signal.aborted) stream.abort();
      else options.signal.addEventListener("abort", () => stream.abort(), { once: true });
    }

    const finalMessage = await stream.finalMessage();

    // Output-token visibility for latency diagnosis (alongside the route's
    // durationMs). stop_reason "max_tokens" means the note hit the ceiling and
    // was truncated — the JSON.parse below then fails and we fall back to a
    // rule-based note, so surface it loudly for alerting rather than letting a
    // templated note ship silently.
    if (finalMessage.stop_reason === "max_tokens") {
      logger.warn(
        "SOAP AI generation hit max_tokens — note truncated, will fall back to rule-based",
        { outputTokens: finalMessage.usage.output_tokens },
      );
    } else {
      logger.info("SOAP AI usage", {
        outputTokens: finalMessage.usage.output_tokens,
        stopReason: finalMessage.stop_reason,
      });
    }

    const textBlock = finalMessage.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const responseText = textBlock?.text;
    if (!responseText) {
      throw new Error("No response from AI");
    }

    // Strip markdown fencing if Claude added any, then parse
    const jsonMatch =
      responseText.match(/```json\n?([\s\S]*?)\n?```/) ||
      responseText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : responseText;
    const aiResponse = JSON.parse(jsonStr);

    // Validate and enhance the response
    const hasMostRecentPlanContext = !!priorSessions?.[0]?.plan;
    const hasActiveGoalsContext = !!(treatmentGoals && treatmentGoals.length > 0);
    return await validateAndEnhanceResponse(
      aiResponse,
      request,
      billingUnits,
      hasMostRecentPlanContext,
      hasActiveGoalsContext,
    );

  } catch (error) {
    console.error("AI generation error:", error);
    // Fallback to rule-based generation if AI fails
    return fallbackGeneration(request, patient, billingUnits);
  }
}

export function buildSystemPrompt(insuranceData: any): string {
  let prompt = `You are an expert pediatric occupational therapy clinical documentation specialist. You behave as a CLINICAL EDITOR AND REASONING ASSISTANT, not an autonomous note writer: the therapist supplies the facts; you organize them, translate them into defensible clinical language, relate them to the existing goals, and flag possible changes rather than making unsupported decisions. Your role is to:

1. Generate PROFESSIONAL SOAP notes that meet medical documentation standards and support insurance reimbursement
2. Determine appropriate CPT code assignments to ensure accurate reimbursement while remaining audit defensible

==========================================================================
CRITICAL RULES — ANTI-FABRICATION (READ FIRST)
==========================================================================
These rules override every other instruction in this prompt. Violating them
is a compliance and liability issue, not just a stylistic preference.

1. **Use ONLY what the therapist provided.** The session input contains:
   activities, mood, assessment observations (performance, assistance,
   strength, motor planning, sensory regulation), duration, location, plan
   next steps, and optionally a caregiver report, home program, treatment
   plan, and treatment goals. You may NOT invent anything outside this data.
   This rule, and the numeric-measurement/equipment-descriptor bans in
   rule 4 below, govern EVERY section of the output including the Plan --
   the Plan's own instructions later in this prompt permit connecting
   today's input to next steps, never inventing new numbers, durations, or
   named specifics that aren't in the input.

   Any field below whose value is literally "(not assessed)", "(not
   recorded...)", or "(not specified...)" means the therapist left it
   blank -- it is a marker, not a clinical fact. Treat it exactly like a
   field that was never mentioned at all: do not state a level, finding,
   or conclusion for it, including indirectly through billing/clinical
   vocabulary (e.g. do not write "praxis difficulties" because motor
   planning was blank, or "sensory regulation was adequate" because
   sensory regulation was blank). Omit the topic, or say plainly that the
   therapist did not document it this session.

2. **DO NOT ELABORATE BRIEF INPUTS.** This is a very common failure mode.
   If the caregiver report is a single word ("anxious") or a short phrase,
   the output MUST reflect ONLY that content. Do NOT expand it into
   specific concerns, behaviors, compliance details, functional tasks, or
   explanations the caregiver did not state.

   **Concrete forbidden pattern** — this is NOT acceptable:
     Input: caregiverReport = "anxious"
     Output (WRONG): "Caregiver reports feeling anxious about Felix's
     progress. Parent expressed concerns regarding his ability to maintain
     focus during homework tasks and his continued difficulty with
     self-regulation during transitions. Home program compliance has been
     inconsistent..."

   **Acceptable** — this is what the output should look like instead:
     Input: caregiverReport = "anxious"
     Output (RIGHT): "Caregiver reported that the patient has been
     anxious at home. No further detail was provided."

   Keep the Subjective proportional to what was actually reported. One
   sentence of input → one sentence of output.

3. **Do not use the patient's in-session mood to fabricate caregiver
   statements.** The mood field describes how the patient presented
   during the session, observed by the therapist. It is NOT a source of
   caregiver concerns, home observations, or parent reports. Do not
   translate "anxious mood" in session into "parent reports anxiety at
   home" unless the caregiver report explicitly said so.

4. **Specifically, NEVER fabricate any of the following:**
   - Numeric measurements (e.g., "grip strength 4 lbs", "ROM 120°",
     "completed 8/10 trials", "10-bead string in 2:45 min")
   - Standardized test scores (VMI, Beery, BOT-2, Peabody, Sensory Profile,
     etc.) — do not mention these unless the input explicitly states a
     score was administered and provides the value
   - Direct quotations from the caregiver or patient — do not write
     'Mom reports "he can now button his shirt"' unless that exact
     sentiment appears in the input
   - **Any comparison to prior performance or prior sessions that is not
     grounded in provided data.** Comparisons ("improved from last
     session", "progressed from moderate assist to...", any "was X, now Y"
     structure) are permitted ONLY when the specific prior fact appears in
     the PRIOR SESSION SUMMARIES section or the treatment plan/goals data
     — and the comparison must cite that fact, not extrapolate beyond it.
     If no such section or fact was provided, you have NO data about prior
     sessions: describe today's performance in absolute terms without any
     prior reference.
   - Social/behavioral details that weren't observed (e.g., "demonstrated
     good eye contact", "shared details about his week at school",
     "interacted well with peers") — unless the input mentions them
   - Medications, sleep patterns, school reports, family circumstances
   - Home program compliance details, missed/completed exercise counts,
     resistance to home activities, frustration at home, homework
     behaviors, school uniform dressing, morning routine behavior —
     unless the caregiver report explicitly said so
   - **Descriptors of equipment, materials, or settings that the input
     did not specify.** If the activity says "resistive putty", do NOT
     write "medium resistance putty" — medium/light/heavy is your
     guess, not their data. If the activity says "therapy ball", do
     NOT write "55cm therapy ball". If the activity says "swing", do
     NOT write "lycra swing" or "platform swing". Use exactly the
     words the therapist used; add adjectives only when the input
     contains them.

5. **When data is missing, use one of these patterns:**
   - Qualitative clinical language grounded in the observations that WERE
     provided (e.g., "Patient demonstrated mild difficulty with motor
     planning during [activity]")
   - Explicit acknowledgment ONLY when you actually know the negative fact,
     not merely that a form field was left blank (e.g., "Standardized
     measurements were not administered; observations were qualitative" is
     fine because an administered measure would appear elsewhere in the
     input if one existed — but do NOT write "Caregiver report was not
     obtained this session": a blank Caregiver Report field means the
     therapist didn't type anything here, not that you know no report was
     given. That's a fabricated negative, same as a fabricated positive.
   - Simple omission — it is better to write a shorter section than to
     invent content to fill it, and is the correct choice whenever you
     don't actually know the negative (see above)

6. **Clinical interpretation IS allowed and expected.** Translating the
   therapist's observations into clinical language (e.g., interpreting
   "mild difficulty with motor planning" into "demonstrates emerging
   motor planning skills with continued need for repetition and modeling")
   is the therapist's reasoning, not fabrication. Keep doing this.

7. **If you are uncertain whether a detail is in the input, omit it.**

8. **Input-proportional output.** The Subjective section in particular
   must be proportional to the input. No caregiver report = one sentence
   stating that. Brief caregiver report = a sentence or two. Detailed
   caregiver report = a fuller paragraph. NEVER pad to fill a section.

9. **TREATMENT GOALS ARE CONTEXT, NOT CONTENT.** When active treatment
   goals are provided, you MAY connect the documented activities to the
   goals they target and use goal-consistent terminology — but you must
   NEVER claim progress toward a goal, or any performance, that the
   therapist's entered session data does not state. Goals never supply
   observations: no "progressing toward goal", no goal-percentage
   movement, no "closer to target" unless the therapist's own session
   input says so.
==========================================================================

==========================================================================
CLINICAL WRITING RULES (clinician-authored — Wonder Kids OT review)
==========================================================================
These extend the anti-fabrication rules with the writing discipline a
practicing OT requires of a defensible note.

A. PRESERVE QUANTITATIVE DATA EXACTLY. Repetitions, seconds held, trials,
   distances, percentage accuracy, assistance and cueing levels that the
   therapist provided must appear verbatim — never dropped, rounded, or
   restated loosely. Never force a quantifier where none was given:
   describe the observable performance qualitatively instead.

B. IGNORE METADATA. Timestamps, "Last recorded on…", autosave artifacts,
   or UI text are not clinical content and never appear in the note.

C. NO VAGUE FILLER. "Did well", "progressing well", "showed good effort",
   "had a successful session" are banned unless the same sentence states
   the specific observation that supports the conclusion.

D. PROGRESS VOCABULARY LADDER. "Improved" requires a documented baseline
   or prior fact (see the comparison rule above). Without one, use:
   "demonstrated", "showed emerging ability", "continued difficulty
   with", or "required [assistance/cueing]".

E. DO NOT OVERSTATE CAUSATION. Never claim mechanisms or outcomes
   ("strengthens neural connections", "improves handwriting"). State
   clinically supportable TARGETING relationships instead: "targeting
   proximal stability, bilateral coordination, and midline crossing to
   support seated fine-motor participation."

F. ESTABLISHED CONCEPTS ONLY. Diagnoses and specialized clinical concepts
   (e.g., retained reflexes such as STNR, sensory-seeking profiles) may
   appear ONLY when already present in the chart data provided (treatment
   plan, goals, prior session summaries). Today's activities never
   introduce a new clinical concept on their own — crawling in the
   session does not put "retained STNR" in the note.

G. SECTION DISCIPLINE. Caregiver/patient reports belong in Subjective
   only. Therapist observations belong in Objective. Interpretation
   belongs in Assessment — never in Subjective. Assessment must INTERPRET
   the Objective (what today's performance demonstrates, what remained
   difficult, what it means for function/goals) — never merely restate
   it. When the input is thin, write a modest Assessment rather than an
   inflated one.

H. PLAN DISCIPLINE (extends the carry-forward rule):
   - NEVER change treatment frequency or duration — those come only from
     the established plan of care or explicit therapist instruction.
   - A one-session activity never becomes a new long-term Plan item on
     its own (trapeze today does not add "continue trapeze" to the Plan).
   - Never duplicate the Plan: if it already covers balance/motor
     planning/bilateral coordination, do not append another list saying
     the same thing.

I. CONFLICTS AND QUESTIONABLE CONTENT. If session input conflicts with
   the established plan of care, prioritize the plan of care and the
   therapist-entered facts — and FLAG the conflict in auditNotes rather
   than silently adopting either side. Rewrite clinically questionable
   input conservatively rather than amplifying it.

J. STYLE. "Patient" suffices — no repeated demographic phrasing ("young
   male patient"). Concise clinical prose; no conversational filler; no
   emojis, asterisks, or decorative formatting. OT terminology kept
   readable: motor planning, bilateral coordination, postural control,
   visual-motor integration, regulation, body awareness, ADL
   participation.

K. OBJECTIVE STATEMENT HIERARCHY — write to the best level the input
   supports:
   Best (measurement provided): "Completed prone scooter-board propulsion
   x20 ft with min A for directional control, targeting UE strength,
   bilateral coordination, and motor planning."
   Acceptable (no measurement provided): "Completed prone scooter-board
   propulsion with intermittent verbal cues for directional control,
   targeting UE strength, bilateral coordination, and motor planning."
   Never: "Did scooter board and had fun."
==========================================================================

SOAP NOTE STRUCTURE

SUBJECTIVE SECTION (length: proportional to input — could be a single
sentence if the input is sparse):
Cover, USING ONLY PROVIDED DATA:

1. CAREGIVER/PARENT REPORT:
   - If no caregiver report was provided, OMIT any sentence about it
     entirely. "Caregiver report was not obtained this session" is itself
     a fabrication -- the field being blank in this form does not mean no
     caregiver was present or that nothing was asked; it only means the
     therapist didn't type anything here. Do not assert the negative any
     more than you'd assert a positive you don't have.
   - If a caregiver report WAS provided, reflect ONLY that content.
     Do NOT expand brief inputs into multi-sentence elaborations.
     A one-word report ("anxious") becomes a one-sentence output
     ("Caregiver reported the patient has been anxious at home.")
     — NOT a paragraph about homework, transitions, or compliance.
   - Forbidden: inventing specific functional tasks the caregiver
     mentioned, compliance percentages, behavior details at home,
     school observations, or quoted statements.

2. PATIENT MOOD/PRESENTATION — Use the mood field provided by the
   therapist. Do not invent self-reported statements, social behaviors,
   or interactions unless the input describes them. Do not use the
   mood field as a springboard to invent home/school/family context.

3. PROGRESS CONTEXT — Only reference prior sessions when the PRIOR
   SESSION SUMMARIES section or treatment plan/goals data explicitly
   describes prior performance, and anchor every comparison to the
   specific provided fact. Never invent "improved from last session"
   statements.

Length rule for Subjective: if the only information you have is a mood
and a brief caregiver statement, the Subjective may be 2–3 sentences
total. That is correct and expected. Do NOT pad.

OBJECTIVE SECTION (target: 150-250 words, scaled to the richness of the input):
Cover, USING ONLY PROVIDED DATA:

1. ACTIVITIES & INTERVENTIONS PERFORMED:
   - List the activities that were actually provided in the input
   - Describe them with clinical framing (the clinical purpose of each
     activity) — this is interpretation, not fabrication
   - Equipment/materials: only mention items named in the activities list

2. FUNCTIONAL PERFORMANCE — Use the therapist's performance observations
   (performance, assistance, strength, motor planning, sensory regulation
   fields). Do NOT invent quantified trials, timing data, or standardized
   scores. Qualitative language is appropriate: "demonstrated moderate
   difficulty maintaining prone extension during [activity]".

3. ASSISTANCE LEVELS — Use the assistance field provided by the therapist.
   Standard terms: Independent / Modified Independent / Supervision /
   Minimum Assist / Moderate Assist / Maximum Assist / Dependent. You
   may specify cueing types (verbal, visual, tactile, hand-over-hand)
   when they describe how an activity was supported — do not invent
   specific cue counts.

4. SKILLED INTERVENTIONS — Describe the therapeutic techniques that
   correspond to the activities performed. You may use clinical
   terminology to explain the rationale.

ASSESSMENT SECTION (target: 200-300 words, scaled to input):
This is clinical interpretation of the objective observations. You MAY
and should reason clinically — but still anchor every statement to
observations that were actually provided.

Cover as applicable based on the input:
- Engagement & participation (using mood + observed tolerance)
- Postural/core control (only if observations in the input support it)
- Motor planning & coordination
- Fine motor skills (only if the activities involved fine motor)
- Sensory processing & regulation (using the sensory regulation field)
- Progress toward goals — ONLY if treatment goals data was provided
- Medical necessity statement — summarize the clinical deficits that
  WERE observed and link them to functional participation. Do not
  invent deficits. If no performance/strength/assistance/endurance
  observations were supplied, the note may describe what the activities
  TARGET, but must not state that the patient HAS strength, endurance,
  motor-planning or other deficits.

OMIT any sub-section if the input does not support it. It is better to
write 4 substantive paragraphs than 8 padded ones.

FIRST DOCUMENTED SESSION (no MOST RECENT PLAN and no ACTIVE TREATMENT GOALS
appear in this prompt): there is no history, so do not use continuity words
ANYWHERE in the note about therapy, need, deficits, frequency, goals or the
home program: not "continue", "continued", "continuing", "ongoing",
"remain(s)", "further" or "still". Write "needed external structure", not
"continued need for external structure"; "is challenging", not "remains
challenging"; "activities will target", not "will continue to target". A
present-tense necessity statement ("skilled OT is indicated to address the
observed fatigue response") is allowed only when observations support it.
Never write a Goals line explaining that no goals exist -- omit the Goals
subsection -- and never write "Reviewed continuation of current home
strategies" (write "No home program assigned this session.").

PLAN SECTION (target: 75-150 words):
Use the "planNextSteps", "nextSessionFocus", and "homeProgram" fields.

1. NEXT SESSION FOCUS — Use what the therapist wrote. Add 2-3 specific
   activities that would clinically align with that focus.
2. TREATMENT FREQUENCY — Only state a frequency if one is implied or
   stated in the treatment plan data. Otherwise: with a MOST RECENT PLAN
   on file (CASE B) write "Continue current treatment frequency" without
   a specific cadence; on a first documented session (CASE A) OMIT the
   frequency statement entirely -- there is no cadence to continue.
3. HOME PROGRAM — Use the home program field if provided. If it wasn't
   provided: CASE B "Reviewed continuation of current home strategies; no
   changes to home program at this time."; CASE A "No home program
   assigned this session." (never "no changes" -- nothing existed to change).
4. GOALS — Reference ONLY the treatment goals provided in the input.
5. REFERRALS — Only mention referrals that are clearly indicated by
   the observations. Otherwise omit.

CLINICAL TERMINOLOGY (use when supported by observations):
- "demonstrates [observed clinical quality]"
- "benefited from graded vestibular/proprioceptive input" (only if sensory
  interventions were used)
- "required verbal cueing and physical support" (only if the assistance
  level supports it)
- "emerging adaptability to sensory and motor demands"
- "compensatory movement strategies"
- "proximal stability/weakness"
- "anti-gravity positions"
- "skilled occupational therapy services are medically necessary" (ONLY when
  documented deficits support it; never "remain"/"continue to be" on a first
  documented session -- there is no prior determination to remain in force)

BILLING CODE ASSIGNMENT:
Assign codes by the PRIMARY SKILLED OBJECTIVE the documentation supports —
NOT by reimbursement rate. Never reach for a code because it pays more.
  * 97530 Therapeutic Activities - functional/dynamic activities, obstacle
    courses, transitions, fine-motor and play/ADL tasks framed by functional
    participation.
  * 97112 Neuromuscular Re-education - balance, coordination, motor control,
    postural control, bilateral coordination, motor planning/praxis, body
    awareness — including vestibular-proprioceptive work whose skilled
    objective is one of these motor outcomes.
  * 97110 Therapeutic Exercise - strengthening, ROM, endurance.
  * 97535 Self-Care/Home Management - ADL/IADL training.
  * 97533 Sensory Integration - use SPARINGLY and ONLY when the documentation
    pairs sensory work with clear functional deficits, measurable assistance
    levels, and skilled therapeutic analysis. If sensory activities were done
    but documented in functional/motor terms, code them as 97112 or 97530 by
    their skilled objective. Do NOT default sensory-based activities to 97533,
    and do NOT document treatment primarily as "sensory integration" or
    "sensory play" — payers read that as developmental/non-specific and deny.
Only assign a code the documentation defensibly supports. If support is thin,
use fewer codes; it is safer to omit a code than to bill one the note can't
justify.

PER-ACTIVITY CPT PAIRING (CONSERVATIVE):
In addition to the aggregate code list, suggest EXACTLY ONE CPT code for EACH
documented activity (the activityCptPairings array), so each activity in the
Objective is paired with its billing code.
- CONSERVATIVE DEFAULT: when an activity does not CLEARLY map to a more
  specific code by its documented skilled objective, suggest 97530
  Therapeutic Activities. Some payers only reimburse one type of code, and
  Therapeutic Activities is the defensible conservative choice — never
  stretch for a more specific code the documentation does not support.
- CONSISTENCY: the pairings and the aggregate cptCodes must tell the same
  story — every activity listed in a cptCodes entry's activitiesAssigned must
  be paired with that same code in activityCptPairings.
- These are SUGGESTIONS for accuracy review, never final: the treating
  therapist reviews and can change every per-activity code and makes every
  coding decision.

CODING RATIONALE DISCIPLINE (applies to every rationale and billingRationale):
1. Suggestion-framed, never absolute. A rationale must NEVER call a code the
   "only defensible", "only correct", "only appropriate" or "required"
   choice, and must never say an activity "must be coded/billed as" a code.
   Live retest, 2026-11-04: two notes generated from IDENTICAL inputs chose
   97110 for one and 97530 for the other, and each called its own choice the
   "only defensible" code. Both cannot be true; the certainty was fabricated.
2. Name the alternative when one is plausible. Dynamic gross-motor activities
   (obstacle course, trampoline, climbing) can be argued as 97530 Therapeutic
   Activities (functional/dynamic task) or 97110 Therapeutic Exercise
   (strength/endurance) depending on the documented objective. When the
   documentation supports more than one reading, say so in one clause, name
   the alternative, and state which documented detail tipped the choice. With
   nothing documented to tip it, use the conservative default (97530) and say
   that is why.
3. Targets, not diagnoses. Describe what an activity TARGETS or DEMANDS
   (strength, endurance, motor planning, postural control). Do NOT assert
   that the patient HAS a deficit unless the therapist's performance,
   strength, assistance, endurance or activity-response observations document
   one. "Trampoline work targets lower-extremity strength and endurance" is
   correct with no observations. "Trampoline work addresses the patient's
   underlying strength and endurance deficits" asserts a clinical finding
   nobody documented -- that is fabrication, in a rationale exactly as much
   as in the Assessment. This rule applies to auditNotes too.

Final reminder: when in doubt, write LESS rather than inventing MORE.
A shorter, truthful note is always better than a longer one with
fabricated specifics.

LENGTH DISCIPLINE: do not pad. Never restate the same observation across
sections, and never invent detail to reach a section's word target — the
per-section targets are ceilings on verbosity, not a quota to fill. When
the supplied data is thin, a shorter, fully-supported note is correct and
expected. A tight, complete, audit-defensible note is the goal.

You must respond with a JSON object.`;

  if (insuranceData) {
    prompt += `\n\nPATIENT'S INSURANCE CONTRACT DATA:
${JSON.stringify(insuranceData, null, 2)}

Use this contract data ONLY to surface coverage constraints for the provider —
NEVER to choose codes by reimbursement amount:
- Note if a clinically appropriate code requires prior authorization (and it has not been obtained)
- Note if the documented services would exceed the plan's visit limits
Code selection must be driven solely by the interventions actually documented;
the treating provider makes the final coding decision.`;
  }

  return prompt;
}

export function buildUserPrompt(
  request: AiSoapBillingRequest,
  patient: any,
  billingUnits: number,
  insuranceData: any,
  treatmentPlan?: any,
  treatmentGoals?: any[],
  priorSessions?: Array<{ date: string; objective?: string; assessment?: string; plan?: string }>
): string {
  // Calculate patient age. IMPORTANT: `new Date(null)` silently resolves to
  // the Unix epoch (1970-01-01) rather than an Invalid Date -- a patient
  // with no dateOfBirth on file (blank intake, a quick-add flow, an import
  // gap) would otherwise get a fabricated age fed straight into the prompt
  // as real patient data (confirmed in production: an epoch DOB computed as
  // "56 years" for a patient with no DOB entered). Guard explicitly instead
  // of trusting Date's coercion.
  let ageLine = "- Age: unknown (date of birth not on file -- do not guess or assume an age)";
  if (patient.dateOfBirth) {
    const dob = new Date(patient.dateOfBirth);
    if (!isNaN(dob.getTime())) {
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
      }
      ageLine = `- Age: ${age} years`;
    }
  }

  let prompt = `Generate a COMPREHENSIVE, DETAILED SOAP note for this pediatric OT session.

PATIENT INFORMATION:
- Name: ${patient.firstName} ${patient.lastName}
${ageLine}`;
  // Minimum-necessary: the clinical note only needs name + age. Full DOB,
  // insurance provider, and policy number are not used to write the note, so
  // they are deliberately NOT sent to the model.

  // Add diagnosis information if available
  if (treatmentPlan?.diagnosisCodes && Array.isArray(treatmentPlan.diagnosisCodes)) {
    prompt += `\n\nDIAGNOSES (ICD-10):`;
    for (const dx of treatmentPlan.diagnosisCodes) {
      prompt += `\n- ${dx.code}: ${dx.description}`;
    }
  } else if (treatmentPlan?.diagnosis) {
    prompt += `\n\nDIAGNOSIS: ${treatmentPlan.diagnosis}`;
  }

  // Add active treatment goals if available — CONTEXT ONLY, so the model can
  // connect documented activities to the goals they target and keep the
  // note's vocabulary goal-consistent. Grounding rule 9 (system prompt)
  // forbids inventing goal progress from this data.
  if (treatmentGoals && treatmentGoals.length > 0) {
    prompt += `\n\nACTIVE TREATMENT GOALS (CONTEXT ONLY — connect today's documented
activities to the goals they target and use goal-consistent terminology, but
NEVER claim progress toward a goal, or performance, that the session data
above/below does not state):`;
    for (const goal of treatmentGoals) {
      const parts: string[] = [];
      if (goal.status) parts.push(`status: ${goal.status}`);
      if (goal.goalTerm) parts.push(`term: ${goal.goalTerm}`);
      if (goal.durationWeeks != null) parts.push(`duration: ${goal.durationWeeks} weeks`);
      if (goal.startDate) parts.push(`started: ${String(goal.startDate).slice(0, 10)}`);
      if (goal.progressPercentage != null) parts.push(`documented progress: ${goal.progressPercentage}%`);
      if (goal.baselineMeasure) parts.push(`baseline: ${goal.baselineMeasure}`);
      if (goal.targetMeasure) parts.push(`target: ${goal.targetMeasure}`);
      if (goal.currentMeasure) parts.push(`last recorded: ${goal.currentMeasure}`);
      const numberPrefix = goal.goalNumber != null ? `Goal ${goal.goalNumber}: ` : '';
      prompt += `\n- ${numberPrefix}${goal.description}${parts.length ? ` (${parts.join('; ')})` : ''}`;
    }
  }

  prompt += `

SESSION DETAILS:
- Date: ${new Date().toLocaleDateString()}
- Duration: ${request.duration} minutes (${billingUnits} billable units)
- Location: ${request.location}
- Session Type: ${request.sessionType || 'OT'}
${request.therapistName ? `- Treating Therapist: ${request.therapistName}` : ''}

SUBJECTIVE DATA:
- Mood/Presentation: ${request.mood || "(not recorded — do not state a mood or presentation; omit this detail entirely)"}
- Caregiver Report: ${request.caregiverReport || "(not provided — omit any caregiver-report sentence entirely; do not state that it 'was not obtained', which itself asserts something not known)"}

ACTIVITIES/EXERCISES PERFORMED:
${request.activities.map(a => {
  const detail = request.activityDetails?.find(d => d.name === a);
  return detail?.response
    ? `- ${a}\n  THERAPIST'S ACCOUNT (primary source for this activity — use its facts, do not embellish): "${detail.response}"`
    : `- ${a}`;
}).join('\n')}
${request.activityDetails?.some(d => d.response) ? `
The THERAPIST'S ACCOUNT lines above are the primary Objective data. Structure
each activity's documentation around the clinical arc they describe —
presentation before → skilled intervention provided → patient response →
functional change — using ONLY the facts in the account. Where an account and
a structured rating disagree, the account wins. Activities without an account
get the standard treatment from the structured fields alone.` : ''}

CLINICAL OBSERVATIONS (any field below reading "not assessed" was left blank by
the therapist -- it is NOT a real observation. Do not state a finding, level,
or conclusion for it anywhere in the note, including implicitly through billing
language like "praxis difficulties" or "sensory regulation was adequate". Omit
it, or if the note's structure requires addressing the area, say the therapist
did not document an assessment of it this session):
- Overall Performance: ${request.assessment.performance || "(not assessed)"}
- Assistance Level Required: ${request.assessment.assistance || "(not assessed)"}
- Core Strength/Endurance: ${request.assessment.strength || "(not assessed)"}
- Motor Planning: ${request.assessment.motorPlanning || "(not assessed)"}
- Sensory Regulation: ${request.assessment.sensoryRegulation || "(not assessed)"}`;

  // Add enhanced observations if provided
  if (request.assessment.posturalControl) {
    prompt += `\n- Postural Control: ${request.assessment.posturalControl}`;
  }
  if (request.assessment.primitiveReflexes) {
    prompt += `\n- Primitive Reflex Observations: ${request.assessment.primitiveReflexes}`;
  }
  if (request.assessment.fineMotor) {
    prompt += `\n- Fine Motor: ${request.assessment.fineMotor}`;
  }
  if (request.assessment.grossMotor) {
    prompt += `\n- Gross Motor: ${request.assessment.grossMotor}`;
  }
  if (request.assessment.bilateralCoordination) {
    prompt += `\n- Bilateral Coordination: ${request.assessment.bilateralCoordination}`;
  }
  if (request.assessment.engagement) {
    prompt += `\n- Engagement/Participation: ${request.assessment.engagement}`;
  }

  if (priorSessions && priorSessions.length > 0) {
    prompt += `

PRIOR SESSION SUMMARIES (real data from this patient's signed notes — the
ONLY sanctioned source for progress comparisons; cite nothing beyond it):`;
    for (const s of priorSessions) {
      prompt += `\n--- Session ${String(s.date).slice(0, 10)} ---`;
      if (s.objective) prompt += `\nObjective: ${s.objective}`;
      if (s.assessment) prompt += `\nAssessment: ${s.assessment}`;
    }
    const mostRecentPlan = priorSessions[0]?.plan;
    if (mostRecentPlan) {
      prompt += `\n\nMOST RECENT PLAN (carry-forward baseline — see the plan instructions):\n${mostRecentPlan}`;
    }
  }

  prompt += `

PLAN NOTES:
- Next Steps: ${request.planNextSteps || "(not specified by the therapist — base the plan on nextSessionFocus/homeProgram/treatment-plan data below instead of inventing next steps)"}
- Next Session Focus: ${request.nextSessionFocus || "(none specified — continue current goals)"}
- Home Program: ${request.homeProgram || "(none provided this session — use the no-change continuation wording; do not invent exercises or imply parent education)"}

RESPOND WITH THIS JSON STRUCTURE.
IMPORTANT: the bracketed examples below show the STRUCTURE only. Fill them
using ONLY data from the input. The word-count targets are CEILINGS for when
the input is rich — never pad to reach them, and never invent specifics
(trial counts, scores, prior-session comparisons, equipment adjectives) to
fill space. The anti-fabrication rules above OVERRIDE every example here.
{
  "subjective": "Proportional to the input (a single sentence if the input is sparse). Structure when data exists:\\n\\nCaregiver report: ONLY if the Caregiver Report field above has a real value (not the marker), write it as 'Caregiver reported: [that value].' If the field is the marker, OMIT any caregiver-report sentence entirely -- do NOT write 'Caregiver report was not obtained this session' or anything asserting that no report was given; the field being blank in this form means the therapist didn't type anything here, not that you know a report wasn't obtained. Do NOT invent home observations, compliance details, or functional examples the caregiver didn't state.\\n\\nMood/presentation: ONLY if the Mood/Presentation field above has a real value (not the \\\"(not recorded...)\\\" marker), write '[Patient] presented as [that value].' If the field is the marker, OMIT this sentence entirely -- do not write a presentation/mood sentence of any kind, and never default to a plausible-sounding word like 'cooperative' or 'engaged'. Describe only behaviors actually observed. Do not invent self-reported statements or social details.\\n\\nReference prior sessions ONLY if treatment-plan/goal data provides a prior measurement.\n\nIf BOTH the Caregiver Report and Mood/Presentation fields are the marker and no other subjective input exists, write exactly: 'No subjective information was entered for this session.' -- a statement about this form, not a claim about what happened in the room. Never leave the section empty.",

  "objective": "Scaled to the richness of the input (120-300 words when rich; shorter when sparse). Structure:\\n\\nSession conducted in [location] for [duration] minutes. Standardized measures: include scores ONLY if the input explicitly states a measure was administered and gives the value; otherwise write 'Standardized measurements were not administered; observations were qualitative.'\\n\\nActivities & performance:\\n- [Activity from the activities list]: describe with the assistance level the therapist provided and qualitative performance. Do NOT invent trial counts (e.g. '8/10 trials'), timings, or percentages that weren't provided.\\n\\nAssistance levels: use the assistance field. Standard terms (Independent / Modified Independent / Supervision / Min / Mod / Max Assist / Dependent). Cue types (verbal/visual/tactile/hand-over-hand) when they describe how an activity was supported — no invented cue counts.\\n\\nEquipment/materials: name ONLY items in the activities list, with ONLY the adjectives the therapist used (no '55cm', 'medium resistance', '2 lb' unless stated).\\n\\nSkilled interventions: describe the techniques corresponding to the activities, framed by their skilled/functional objective (e.g. neuromuscular re-education for postural control; graded vestibular-proprioceptive input to support motor planning).",

  "assessment": "Clinical interpretation anchored to the observations actually provided (200-400 words when the input supports it; fewer paragraphs when it doesn't — omit sub-sections you have no data for). Connect each skilled intervention to a specific functional deficit using payer-aligned skilled vocabulary (skilled clinical analysis, clinical reasoning, task grading, neuromuscular re-education, cueing hierarchy, compensatory strategies, safety/judgment, measurable functional impact). Cover, as supported by the input: engagement/participation; postural/core control; motor planning & coordination; fine motor (only if fine-motor activities were done); sensory processing & regulation (frame in functional/neuromuscular terms — e.g. 'vestibular-proprioceptive input to support postural control and motor planning' — NOT as 'sensory play'); progress toward goals ONLY if goal data was provided (no invented 'improved from last session'). End with a medical-necessity statement ONLY when the documented observations support one — it must tie the OBSERVED deficits to functional participation, customized to this session. If the input is thin (sparse observations, no documented deficits), OMIT the medical-necessity statement entirely: per clinical review, a generic necessity sentence weakens documentation more than leaving it out. Do not name primitive reflexes (TLR/STNR/ATNR/Moro) or specific test patterns unless the input observed them.",

  "plan": "Scaled to the input (80-200 words). FIRST, check whether a 'MOST RECENT PLAN' section actually appears earlier in this prompt -- these are two different cases with different required openings, and using the wrong one is a common failure mode:\\n\\nCASE A -- NO 'MOST RECENT PLAN' SECTION ABOVE (true for every patient's first documented session, and for any session where no prior signed note exists): there is no prior plan to continue, so NEVER write 'Current plan remains appropriate', 'no changes recommended', or any other continuity-style opening -- that claim is meaningless with nothing to compare against, and writing it anyway is itself a fabrication (a claim about continuity that doesn't exist). Draft entirely from the planNextSteps, nextSessionFocus, and homeProgram fields below. If those are sparse, keep this section SHORT and SPECIFIC to what's actually there. Do NOT pad it with a generic closing sentence about the patient continuing to benefit from skilled therapy, and do NOT name deficits (endurance, motor planning, bilateral coordination, etc.) just to sound thorough unless the Assessment section above actually documented them -- a short, honest plan is correct and preferred over a padded one. RECURRING FAILURE MODE: this prohibition has been evaded before by paraphrasing around the literal banned wording while writing the same kind of sentence -- e.g. '[Patient] will continue to participate in skilled occupational therapy services to address identified areas of need through graded therapeutic activities and neuromuscular re-education.' That is the same prohibited padding under different words. The rule is about the SENTENCE'S FUNCTION, not its exact phrasing: in CASE A, do not write ANY trailing sentence whose job is to generically assert that skilled OT remains necessary, appropriate, indicated, or something the patient will 'continue to participate in' or 'continue to benefit from' -- whatever words it uses. CASE A's plan ends after the Goals/Coordination content below; add nothing after it.\\n\\nCASE B -- A 'MOST RECENT PLAN' SECTION DOES APPEAR ABOVE: CONTINUITY RULE (clinician-requested) applies -- it is the baseline, and plans appropriately stay the same across visits. If today's documented session gives no clinical reason to change it, carry its substance forward and OPEN with exactly: 'Current plan remains appropriate; no changes recommended.' If today's data DOES indicate a change, the FIRST PARAGRAPH must be exactly the suggestion: 'Suggested update: [the change]' followed by the one observation from today that motivates it — then a blank line (\\n\\n), then the carried-forward remainder as its own paragraphs. The UI parses that first paragraph into an accept/dismiss card, so never mix carried-forward content into it. Never rewrite the plan wholesale, and never invent a change to appear thorough. When carrying the prior plan's substance forward, paraphrase ONLY that single prior plan's own content -- never pull in numbers, durations, thresholds, or named activities from any other prior session's objective or assessment text shown elsewhere in this prompt (that's a different session; blending a real number from one into a paraphrase of another is fabrication even though the number itself is real).\\n\\nIn EITHER case:\\n\\nNext session focus: use what the therapist wrote. Do NOT add new named activities, techniques, durations, or numeric thresholds beyond what's in planNextSteps, nextSessionFocus, or today's documented activities -- the same anti-fabrication rules at the top of this prompt (numeric measurements, equipment descriptors, invented specifics) apply here too. If the therapist's focus is brief, keep this section correspondingly brief.\\n\\nTreatment frequency: state a cadence only if the treatment-plan data implies one. If it doesn't: in CASE B, write 'Continue current treatment frequency' -- there IS an established cadence to continue. In CASE A, there is no established frequency yet (first documented session) -- 'continue' would fabricate a history that doesn't exist, so OMIT any frequency statement entirely rather than writing 'continue current' anything.\\n\\nHome program: use the home program field if provided. If none was given: in CASE B, write exactly 'Reviewed continuation of current home strategies; no changes to home program at this time.' In CASE A, there is no prior home program to review or continue -- that sentence would fabricate a history that doesn't exist, so instead write exactly 'No home program assigned this session.' Do NOT invent exercises, rep counts, or imply parent education that didn't occur.\\n\\nGoals: check whether an 'ACTIVE TREATMENT GOALS' section actually appears earlier in this prompt -- same check as the MOST RECENT PLAN check above, same failure mode. If it DOES appear, reference those specific goals (not a vague restatement -- name what they actually target). If it does NOT appear, there is no established plan of care or documented goal for this patient yet -- do NOT write a sentence that asserts one exists, in any wording (e.g. 'Continue working toward established treatment goals as documented in the plan of care' -- there is no plan of care on file to document anything, so this fabricates one). Omit the Goals subsection entirely in that case. Coordination/referrals: only if clearly indicated.",

  "cptCodes": [
    {
      "code": "97533",
      "name": "Sensory Integration",
      "units": 2,
      "rationale": "Why this code fits the documented skilled objective. Suggestion-framed for provider review: if another code is also plausible for these activities, name it in one clause and say which documented detail tipped the choice (or that 97530 is the conservative default because nothing documented tips it). Describe what the activities TARGET; never assert the patient HAS a deficit unless an observation above documents one. Never use \"only defensible\", \"only correct\", \"must be coded as\" or similar absolute wording.",
      "activitiesAssigned": ["Activity 1", "Activity 2"]
    }
  ],
  "activityCptPairings": [
    {
      "activity": "Activity name EXACTLY as it appears in the activities list above",
      "code": "97530",
      "rationale": "Why this code fits this activity's documented skilled objective (or that 97530 is the conservative default because nothing more specific is clearly supported). Same discipline as above: name a plausible alternative in one clause, describe targets rather than asserting undocumented deficits, no absolute wording."
    }
  ],
  "billingRationale": "Explanation of the code-assignment reasoning for provider review: which documented details drove each code, which alternative code(s) were considered and why they were not chosen. Never present a choice as the only defensible one, and never describe patient deficits that no observation above documents.",
  "auditNotes": ["Documentation points supporting the billing codes"]
}

REQUIREMENTS (the anti-fabrication rules at the top OVERRIDE all of these):
1. Each section is proportional to the input. The word ranges in the JSON are CEILINGS for rich input, not quotas — a truthful short note is correct and expected when the input is sparse. NEVER pad.
2. Use professional OT/ST clinical terminology AND payer-aligned skilled vocabulary (skilled clinical analysis, clinical reasoning, task grading, neuromuscular re-education, cueing hierarchy, compensatory strategies, measurable functional impact). Avoid generic phrases ("provided skilled support", "therapeutic engagement", "facilitated participation").
3. Include quantified data (trial counts, timings, scores, assistance percentages) ONLY when the input actually provides it. Do NOT manufacture numbers, standardized scores, primitive-reflex patterns, or prior-session comparisons to look thorough — fabricated specifics are the #1 audit/denial risk.
4. The medical-necessity statement must be CUSTOMIZED to this session's documented skilled interventions and observed deficits — not a generic boilerplate sentence repeated across notes. If the documentation doesn't support a skilled-necessity claim (thin note, no documented deficits), OMIT the statement entirely and simply describe what was done in functional terms — a generic necessity sentence weakens the note more than leaving it out (clinical reviewer guidance).
5. Frame sensory-based work by its functional/neuromuscular objective (postural control, motor planning, bilateral coordination, regulation supporting participation), NOT as "sensory play" or "sensory diet".
6. Distribute units only across codes the documentation supports (see BILLING CODE ASSIGNMENT). It is correct to use fewer codes/units than available if the documentation doesn't support more.
7. activityCptPairings must contain EXACTLY ONE entry per activity in the activities list (same spelling), consistent with cptCodes[].activitiesAssigned; when unclear, use the conservative default 97530 (see PER-ACTIVITY CPT PAIRING).`;

  return prompt;
}

// Deterministic backstop for a recurring CASE A fabrication (no prior plan,
// no active treatment goals): despite rounds of prompt-level prohibition
// (#421-#424) explicitly naming this failure mode, the model has kept
// reintroducing paraphrases of a continuity/necessity claim -- "[Patient]
// will continue to benefit from/participate in skilled occupational
// therapy...", "...remains medically necessary...", "...ongoing need for
// skilled intervention...", "Goals: Continue working toward established
// treatment goals..." -- in the Plan. There's no prior documentation to
// ground any such claim in CASE A, so this strips any sentence matching the
// pattern as a safety net independent of the model actually following the
// prompt. Logged when triggered so recurrence stays visible rather than
// silently "fixed."
//
// WIDENED 2026-11-01 after the eval harness's first live-credentials run
// (scripts/eval-soap-generation.ts, 10 samples/scenario against the real
// model) found the original narrow regex -- scoped to the single literal
// phrase "continue to [benefit from|participate in|receive] ... skilled ...
// occupational therapy" -- caught only 1 of 16 real paraphrases the model
// produced in that one run. The model doesn't just reuse one sentence
// shape; it freely recombines a continuity/persistence signal word
// (continue/continued/remain/ongoing) with a therapy-necessity claim in
// either order and many surface phrasings. Rather than chase each literal
// wording, this now checks -- via lookaheads, order-independent -- that a
// sentence contains BOTH a persistence-signal word AND a therapy/goals
// reference AND a necessity/participation word, anywhere in the sentence.
// Verified against all 16 real failures from that run (13 of the 16 fit
// this continuity-signal shape and are now all caught, including the
// Goals-subsection variant; the other 3 are bare, ungrounded necessity
// claims with NO continuity word at all -- a related but structurally
// different violation of the prompt's "don't assert necessity the
// documentation doesn't support" rule, deliberately NOT backstopped here:
// matching on "asserts necessity" alone with no continuity signal would
// require matching almost any clinical-sounding sentence, an unacceptable
// false-positive risk against legitimately grounded necessity statements)
// and 8 negative controls including the legitimate CASE B phrases this
// function must never touch ("Current plan remains appropriate; no changes
// recommended.", "Reviewed continuation of current home strategies...") --
// though the hasMostRecentPlanContext/hasActiveGoalsContext gate below
// already keeps this function from ever running in CASE B regardless.
// FLAGS: `m` is load-bearing (added 2026-11-04). Every sentence regex in
// this file anchors on `(?:^|(?<=[.!?]\s))`. Without `m`, `^` is the start
// of the whole string and the lookbehind wants punctuation plus ONE
// whitespace character -- so a sentence that opens a paragraph after a
// blank line ("...session.\n\nPatient will continue to participate in
// skilled occupational therapy...") never matched, and the backstop silently
// did nothing for exactly the trailing-paragraph closing it was built for.
// The pipeline eval (run 2026-11-04T20-50) showed 3/3 clean-room samples
// with that sentence surviving as its own final paragraph.
// 2026-11-04 (pipeline eval round 4): "Patient will continue with skilled
// occupational therapy to address bilateral coordination..." carried a
// persistence word and a therapy word but none of the necessity/participation
// words, so it slipped through. "address"/"target"/"continue with" added to
// that third group.
const SKILLED_OT_CONTINUATION_CLOSING =
  /(?:^|(?<=[.!?]\s))(?=[^.!?\n]*\b(?:continue[sd]?|continuing|remain(?:s|ing)?|ongoing)\b)(?=[^.!?\n]*\b(?:skilled|therap(?:y|eutic|ies)|occupational therapy|\bOT\b|intervention|treatment goals?|plan of care)\b)(?=[^.!?\n]*\b(?:necessary|indicated|need(?:ed|s)?|participat\w*|benefit\w*|receiv\w*|work(?:ing)?\s+toward|establish\w*|address\w*|target\w*|continue\s+with)\b)[^.!?\n]*[.!?]/gim;

/**
 * Detection only (no mutation) — exposed so callers like the fabrication
 * eval harness (scripts/eval-plan-fabrication.ts) can assert on whether raw
 * AI output needed the backstop, without duplicating the regex or fighting
 * its `g` flag's statefulness.
 */
export function hasUnsupportedPlanClosing(plan: string): boolean {
  if (!plan) return false;
  SKILLED_OT_CONTINUATION_CLOSING.lastIndex = 0;
  const result = SKILLED_OT_CONTINUATION_CLOSING.test(plan);
  SKILLED_OT_CONTINUATION_CLOSING.lastIndex = 0;
  return result;
}

// CASE A only: the prompt's own CASE B default sentence, which the model
// keeps emitting on first sessions where there is no frequency to continue.
const CASE_A_CONTINUE_FREQUENCY =
  /(?:^|(?<=[.!?]\s))(?:Treatment frequency:\s*)?Continue (?:the )?current treatment frequency[^.!?\n]*[.!?]?/gim;
// CASE A: a frequency line that explains there is no frequency ("Treatment
// frequency: No established frequency documented.", "...not specified at
// this time.", "...has not been established"). The prompt says omit the
// statement; writing it names an "established" cadence that does not exist
// (pipeline eval round 5). Only CASE A, only sentences that mention
// frequency/cadence together with a negation.
const CASE_A_NO_FREQUENCY_LINE =
  /(?:^|(?<=[.!?]\s))(?:Treatment frequency:\s*)?[^.!?\n]*\b(?:no|not|none|unspecified)\b[^.!?\n]*\b(?:frequency|cadence)\b[^.!?\n]*[.!?]?|(?:^|(?<=[.!?]\s))(?:Treatment frequency:\s*)?[^.!?\n]*\b(?:frequency|cadence)\b[^.!?\n]*\b(?:not|no|none|unspecified)\b[^.!?\n]*[.!?]?/gim;

export function stripUnsupportedPlanClosing(
  plan: string,
  hasMostRecentPlanContext: boolean,
  hasActiveGoalsContext: boolean,
): string {
  if (hasMostRecentPlanContext || hasActiveGoalsContext || !plan) return plan;
  const extras = [CASE_A_CONTINUE_FREQUENCY, CASE_A_NO_FREQUENCY_LINE, CASE_A_HOME_PROGRAM_CARRYOVER, CASE_A_NO_GOALS_LINE];
  const hasExtra = extras.some((re) => {
    re.lastIndex = 0;
    const hit = re.test(plan);
    re.lastIndex = 0;
    return hit;
  });
  if (!hasUnsupportedPlanClosing(plan) && !hasExtra) return plan;
  SKILLED_OT_CONTINUATION_CLOSING.lastIndex = 0;
  for (const re of extras) re.lastIndex = 0;
  const stripped = plan
    .replace(SKILLED_OT_CONTINUATION_CLOSING, "")
    .replace(CASE_A_CONTINUE_FREQUENCY, "")
    .replace(CASE_A_NO_FREQUENCY_LINE, "")
    .replace(CASE_A_HOME_PROGRAM_CARRYOVER, (_m, prefix) => `${prefix ?? ""}No home program assigned this session.`)
    .replace(CASE_A_NO_GOALS_LINE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  logger.warn(
    "Stripped unsupported skilled-OT continuation closing from CASE A plan (no prior plan/goals context)",
    { originalLength: plan.length, strippedLength: stripped.length },
  );
  return stripped;
}

// Deterministic backstop for mood/presentation fabrication. The JSON-template
// CASE A continuity-necessity claims OUTSIDE the Plan. Pipeline eval run
// 2026-11-04T20-50: first-session notes closed the Assessment with "Skilled
// occupational therapy services remain medically necessary..." and "These
// observations demonstrate continued need for skilled occupational therapy
// services..." -- the Plan backstop's banned class, one section earlier.
// Tighter than the Plan regex on purpose: the persistence word must share
// the sentence with a NECESSITY phrase (medically necessary / need for /
// benefit from skilled), so an observation like "continued to participate in
// the obstacle course with skilled cueing" is never touched. Gated to CASE A
// by the caller exactly like stripUnsupportedPlanClosing.
const CASE_A_CONTINUITY_NECESSITY =
  /(?:^|(?<=[.!?]\s))(?=[^.!?\n]*\b(?:continue[sd]?|continuing|remain(?:s|ing)?|ongoing)\b)(?=[^.!?\n]*\b(?:medically\s+necessary|medical\s+necessity|necessary|need\s+for\s+(?:continued\s+|ongoing\s+)?skilled|benefit\s+from\s+(?:continued\s+|ongoing\s+)?skilled|necessit\w+)\b)[^.!?\n]*[.!?]/gim;

// CASE A word-level continuity rewrites. Pipeline eval run 2026-11-04T21-08:
// with the sentence-level strips working, the judge's remaining traceability
// findings were continuity WORDS riding on otherwise-grounded sentences --
// "continued need for external structure" (a within-session observation),
// "remains challenging", "Activities will continue to target...", "require
// continued therapeutic intervention". On a first documented session there
// is nothing for any of these to continue from, so the word goes and the
// sentence stays. Never applied in CASE B.
const CASE_A_CONTINUITY_REWRITES: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  [/\b(?:continued|ongoing|continuing)\s+need\s+for\b/gi, "need for"],
  [/\b(?:continued|ongoing)\s+(deficits?|limitations?|difficult(?:y|ies)|challenges?|weakness)\b/gi, "$1"],
  [/\b(?:require|requires|requiring|indicates?|indicating|suggests?|suggesting|demonstrates?|demonstrating|need\s+for|warrants?)\s+(?:continued|ongoing|further)\s+/gi, (m: string) => m.replace(/\s+(?:continued|ongoing|further)\s+$/i, " ")],
  [/\bcontinued\s+((?:skilled\s+|clinical\s+|graded\s+)?(?:therapeutic\s+)?(?:intervention|strengthening|practice|support|work|therapy|focus|emphasis|training|development|monitoring|attention|use|progress|exposure|participation\s+in))\b/gi, "$1"],
  [/\bremains?\s+(challenging|difficult|limited|an\s+area|a\s+(?:focus|priority)|(?:a|an)\s+(?:clinically\s+)?(?:appropriate|relevant|primary|key|important|reasonable)|(?:clinically\s+)?(?:appropriate|indicated|relevant|important|warranted))\b/gi, "is $1"],
  [/\b(?:will\s+)?continue\s+to\s+(target|address|focus\s+on|work\s+on|emphasi[sz]e|build|support|benefit|develop|strengthen|monitor)\b/gi, "will $1"],
  [/\b(to\s+)?continue\s+(supporting|building|developing|addressing|targeting|working\s+on|strengthening|monitoring|emphasi[sz]ing)\b/gi, (_m: string, to: string | undefined, ing: string) => {
    const base: Record<string, string> = { supporting: "support", building: "build", developing: "develop", addressing: "address", targeting: "target", strengthening: "strengthen", monitoring: "monitor", emphasizing: "emphasize", emphasising: "emphasise" };
    const key = ing.toLowerCase().replace(/\s+on$/, "");
    const verb = key === "working" ? "work on" : (base[key] ?? ing);
    return to ? `to ${verb}` : verb;
  }],
  [/(?:^|(?<=[.!?]\s))Continue\s+(?:targeting|to\s+target)\b/gim, "Target"],
  [/(?:^|(?<=[.!?]\s))Continue\s+((?:graded\s+|dynamic\s+)?(?:therapeutic\s+)?activities)\b/gim, "Use $1"],
  // STRUCTURAL RULE (pipeline eval round 5, 2026-11-05): the specific shapes
  // above kept being outrun by new nouns -- "continued obstacle course work",
  // "continued benefit from external structure", "continued skilled OT
  // services", "continued need for services". On a first documented session
  // the adjective "continued"/"ongoing" is unjustified in front of ANY noun
  // phrase, and removing it leaves the sentence grammatical. Verb uses are
  // preserved by excluding the words that follow a verb: "continued to
  // participate", "continued the activity", "continued with/despite/after/
  // until/for/on/in/at/through/during/as/and", pronoun objects.
  [/\b(?:continued|ongoing)\s+(?!(?:to|the|a|an|this|that|these|those|his|her|their|its|with|despite|after|until|for|on|in|at|through|throughout|during|as|and|but|or|into|from|by|over|under|without|while|when|because|if|it|them|him|she|he|they|we|you)\b)(?=[a-z])/gi, ""],
  [/\bstill\s+(requires?|needs?|benefits?\s+from|warrants?|demonstrates?|shows?|presents?\s+with)\b/gi, "$1"],
];

export function hasCaseAContinuityWording(text: string): boolean {
  if (!text) return false;
  return CASE_A_CONTINUITY_REWRITES.some(([re]) => {
    re.lastIndex = 0;
    const hit = re.test(text);
    re.lastIndex = 0;
    return hit;
  });
}

export function removeCaseAContinuityWording(
  text: string,
  hasMostRecentPlanContext: boolean,
  hasActiveGoalsContext: boolean,
): string {
  if (hasMostRecentPlanContext || hasActiveGoalsContext || !text) return text;
  if (!hasCaseAContinuityWording(text)) return text;
  let out = text;
  for (const [re, replacement] of CASE_A_CONTINUITY_REWRITES) {
    re.lastIndex = 0;
    out = out.replace(re, replacement as any);
  }
  logger.warn("Rewrote CASE A continuity wording (first documented session; nothing to continue from)", {
    originalLength: text.length,
    rewrittenLength: out.length,
  });
  return out;
}

// CASE A: the prompt's own CASE B home-program default, and any "Goals:" line
// that explains there are no goals. Both name a history (a current home
// program, a plan of care) that does not exist on a first documented
// session. Pipeline eval run 2026-11-04T21-08 caught both surviving.
const CASE_A_HOME_PROGRAM_CARRYOVER =
  /(?:^|(?<=[.!?]\s))(Home program:\s*)?Reviewed continuation of current home strategies;?\s*no changes to (?:the )?home program at this time\.?/gim;
const CASE_A_NO_GOALS_LINE =
  /(?:^|(?<=[.!?]\s))(?:Goals?:\s*)?[^.!?\n]*\b(?:no|not|none|cannot|omitted)\b[^.!?\n]*\b(?:treatment\s+goals?|active\s+goals?|plan\s+of\s+care)\b[^.!?\n]*[.!?]?/gim;

export function hasUnsupportedContinuityNecessity(text: string): boolean {
  if (!text) return false;
  CASE_A_CONTINUITY_NECESSITY.lastIndex = 0;
  const result = CASE_A_CONTINUITY_NECESSITY.test(text);
  CASE_A_CONTINUITY_NECESSITY.lastIndex = 0;
  return result;
}

export function stripUnsupportedContinuityNecessity(
  text: string,
  hasMostRecentPlanContext: boolean,
  hasActiveGoalsContext: boolean,
): string {
  if (hasMostRecentPlanContext || hasActiveGoalsContext || !text) return text;
  if (!hasUnsupportedContinuityNecessity(text)) return text;
  CASE_A_CONTINUITY_NECESSITY.lastIndex = 0;
  const stripped = text
    .replace(CASE_A_CONTINUITY_NECESSITY, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  logger.warn(
    "Stripped CASE A continuity/necessity claim outside the Plan (no prior plan or goals exist)",
    { originalLength: text.length, strippedLength: stripped.length },
  );
  return stripped;
}

// subjective-field instruction has, since #420, explicitly forbidden
// defaulting to "a plausible-sounding word like 'cooperative' or 'engaged'"
// when Mood/Presentation is blank -- yet confirmed in production (clean-room
// test, Mia Example, Mood/Behavior and comments both blank): "Mia presented
// as cooperative during today's session." The model used the EXACT banned
// word the instruction names, proving prompt-level prohibition alone isn't
// reliable here either, the same lesson #423/#425 already taught for the
// Plan closing sentence. This strips the fabricated clause from every
// section (not just Subjective -- the equivalent fallbackGeneration bug
// leaked the same pattern into Assessment too) whenever mood is blank.
//
// Scoped to "presented as" specifically -- the literal phrase the prompt's
// own template instructs ("'[Patient] presented as [that value].'") and the
// only confirmed real example -- NOT "appeared"/"seemed", which show up in
// legitimate OBSERVED findings unrelated to mood (e.g. "appeared to have
// difficulty maintaining balance") and would be a real false-positive risk
// without a second confirmed example to justify the wider net.
const MOOD_PRESENTATION_CLAUSE =
  /(?:^|(?<=[.!?]\s))[^.!?\n]*?\bpresented\s+as\s+[^.!?\n]+[.!?]/gim;

/** Detection only (no mutation) -- mirrors hasUnsupportedPlanClosing. */
export function hasUnsupportedMoodClause(text: string): boolean {
  if (!text) return false;
  MOOD_PRESENTATION_CLAUSE.lastIndex = 0;
  const result = MOOD_PRESENTATION_CLAUSE.test(text);
  MOOD_PRESENTATION_CLAUSE.lastIndex = 0;
  return result;
}

export function stripUnsupportedMoodClause(text: string, hasMood: boolean): string {
  if (hasMood || !text) return text;
  if (!hasUnsupportedMoodClause(text)) return text;
  MOOD_PRESENTATION_CLAUSE.lastIndex = 0;
  const stripped = text
    .replace(MOOD_PRESENTATION_CLAUSE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  logger.warn(
    "Stripped unsupported mood/presentation clause (Mood/Presentation field was blank)",
    { originalLength: text.length, strippedLength: stripped.length },
  );
  return stripped;
}

// Deterministic backstop for the "documentation denial" fabrication: a
// sentence asserting that a blank field was affirmatively confirmed absent
// ("X was not obtained/documented" or "No X was documented"), rather than
// simply omitted. The prompt has forbidden exactly this since the original
// caregiver-report fix ("do NOT write 'Caregiver report was not obtained
// this session' or anything asserting that no report was given; the field
// being blank in this form means the therapist didn't type anything here,
// not that you know a report wasn't obtained") -- yet confirmed in a live
// retest (Mia Example, clean room, caregiver report and mood both blank):
// "No caregiver report or patient mood was documented this session." Same
// lesson as the mood/plan sagas: a different SHAPE of the same banned claim
// (an omission reframed as a confirmed absence) evades every check built for
// the earlier shapes -- hasUnsupportedMoodClause only matches "presented
// as", which this sentence never uses. Unconditional (no hasMood/
// hasCaregiverReport gate): the prompt forbids this sentence shape outright,
// regardless of field state -- asserting a field "was not documented" is
// never a true claim this app can support, whether or not the field was
// actually filled in.
//
// Scoped to the confirmed vocabulary (caregiver report / mood / presentation
// + was/were (not) documented/obtained/provided/recorded/reported) rather
// than a broader net, matching the discipline from the mood backstop above.
const DOCUMENTATION_DENIAL_CLAUSE =
  /(?:^|(?<=[.!?]\s))(?:No\s+[^.!?\n]*?\b(?:caregiver report|mood|presentation)\b[^.!?\n]*?\b(?:was|were)\b[^.!?\n]*?\b(?:documented|obtained|provided|recorded|reported)\b|[^.!?\n]*?\b(?:caregiver report|mood|presentation)\b[^.!?\n]*?\b(?:was|were)\s+not\b[^.!?\n]*?\b(?:documented|obtained|provided|recorded|reported)\b)[^.!?\n]*[.!?]/gim;

/** Detection only (no mutation) -- mirrors hasUnsupportedMoodClause. */
export function hasUnsupportedDocumentationDenialClause(text: string): boolean {
  if (!text) return false;
  DOCUMENTATION_DENIAL_CLAUSE.lastIndex = 0;
  const result = DOCUMENTATION_DENIAL_CLAUSE.test(text);
  DOCUMENTATION_DENIAL_CLAUSE.lastIndex = 0;
  return result;
}

export function stripUnsupportedDocumentationDenialClause(text: string): string {
  if (!text || !hasUnsupportedDocumentationDenialClause(text)) return text;
  DOCUMENTATION_DENIAL_CLAUSE.lastIndex = 0;
  const stripped = text
    .replace(DOCUMENTATION_DENIAL_CLAUSE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  logger.warn(
    "Stripped unsupported documentation-denial clause (asserted a blank field was confirmed absent)",
    { originalLength: text.length, strippedLength: stripped.length },
  );
  return stripped;
}

// ---------------------------------------------------------------------------
// Subjective placeholder. Live retest, 2026-11-04: with Mood/Presentation and
// Caregiver Report both blank, one generation wrote a sentence explaining
// that nothing subjective was supplied and another left the section EMPTY.
// An empty Subjective reads as a documentation gap on a signed note. The
// placeholder is a statement about the form ("was entered"), deliberately
// NOT about the room ("was not obtained") -- see DOCUMENTATION_DENIAL_CLAUSE
// above for why that distinction matters, and note its vocabulary (caregiver
// report / mood / presentation) does not match this sentence.
// ---------------------------------------------------------------------------
export const SUBJECTIVE_PLACEHOLDER = "No subjective information was entered for this session.";

export function ensureSubjectivePresent(text: string): string {
  return text && text.trim().length > 0 ? text : SUBJECTIVE_PLACEHOLDER;
}

// ---------------------------------------------------------------------------
// Absolutist coding-claim backstop. Live retest, 2026-11-04: two generations
// from IDENTICAL inputs chose 97110 and 97530 respectively for the same
// activities, and each rationale called its own choice the "only defensible"
// code. Whatever the right code is, that certainty was fabricated, and it is
// the kind of sentence a provider is least likely to question. The prompt now
// forbids the wording (CODING RATIONALE DISCIPLINE); this rewrites the known
// shapes into suggestion framing when the model uses them anyway. Scoped to
// the rationale fields only -- never applied to S/O/A/P prose.
// ---------------------------------------------------------------------------
const ABSOLUTIST_CODING_REWRITES: Array<[RegExp, string]> = [
  // "the only defensible code" -> "the suggested code"
  [/\b(?:the\s+)?only\s+(?:defensible|correct|appropriate|supportable|justifiable|valid|accurate)\s+(code|choice|option|assignment|selection)\b/gi, "suggested $1"],
  // "is the only defensible ..." (no noun) -> "is a defensible ..."
  [/\b(is|are|remains|was)\s+the\s+only\s+(defensible|correct|appropriate|supportable|justifiable|valid|accurate)\b/gi, "$1 a $2"],
  // "must be coded/billed as" -> "is suggested as"
  [/\bmust\s+be\s+(?:coded|billed|assigned|reported)\s+as\b/gi, "is suggested as"],
  // "no other code is defensible/appropriate" -> alternative acknowledged
  [/\bno\s+other\s+code\s+(?:is|would\s+be|could\s+be)\s+(?:defensible|appropriate|correct|supportable|justifiable|valid|accurate)\b/gi, "an alternative code may also be defensible"],
];

/** Detection only (no mutation) -- mirrors hasUnsupportedMoodClause. */
export function hasAbsolutistCodingClaim(text: string): boolean {
  if (!text) return false;
  return ABSOLUTIST_CODING_REWRITES.some(([re]) => {
    re.lastIndex = 0;
    const hit = re.test(text);
    re.lastIndex = 0;
    return hit;
  });
}

export function softenAbsolutistCodingClaim(text: string): string {
  if (!text || !hasAbsolutistCodingClaim(text)) return text;
  let out = text;
  for (const [re, replacement] of ABSOLUTIST_CODING_REWRITES) {
    re.lastIndex = 0;
    out = out.replace(re, replacement);
  }
  logger.warn("Softened absolutist coding claim in a billing rationale", {
    originalLength: text.length,
    softenedLength: out.length,
  });
  return out;
}

// ---------------------------------------------------------------------------
// Unsupported-deficit detector. Live retest, 2026-11-04: with no performance,
// strength, assistance or endurance observations supplied, a generation
// asserted "underlying strength and endurance deficits" in the Assessment and
// the billing explanation. Describing what an activity TARGETS is fine;
// asserting the patient HAS a deficit is a clinical finding nobody made.
//
// DETECTION ONLY. Unlike the mood/denial clauses, "deficit" sentences in the
// Assessment are legitimate whenever observations exist, and the right fix
// when they do not is to regenerate, not to excise prose from a clinical
// paragraph. Used by the pipeline eval on its no-observation scenario and
// available to callers that know no observations were supplied.
// ---------------------------------------------------------------------------
const UNSUPPORTED_DEFICIT_PATTERNS: RegExp[] = [
  /\b(?:underlying|patient'?s|his|her|their|identified|existing|noted|documented|observed)\s+(?:[\w/-]+\s+){0,3}deficits?\b/i,
  /\bdeficits?\s+(?:in|with|of)\s+(?:strength|endurance|motor\s+planning|postural|core|balance|coordination|bilateral|praxis|regulation)/i,
  /\baddress(?:es|ing)?\s+(?:the\s+)?(?:[\w/-]+\s+){0,3}deficits?\b/i,
  /\b(?:weakness|decreased|reduced|poor|impaired|limited)\s+(?:[\w/-]+\s+){0,2}(?:strength|endurance|postural\s+control|core\s+stability|motor\s+planning|balance|coordination)\b/i,
];

export function hasUnsupportedDeficitAssertion(text: string): boolean {
  if (!text) return false;
  return UNSUPPORTED_DEFICIT_PATTERNS.some((re) => re.test(text));
}

/** True when the therapist supplied ANY observation the note could ground a deficit in. */
export function requestHasObservations(request: AiSoapBillingRequest): boolean {
  const a = request.assessment || ({} as AiSoapBillingRequest["assessment"]);
  const ratingFields = [
    a.performance, a.assistance, a.strength, a.motorPlanning, a.sensoryRegulation,
    a.posturalControl, a.primitiveReflexes, a.fineMotor, a.grossMotor,
    a.bilateralCoordination, a.endurance, a.engagement,
  ];
  if (ratingFields.some((v) => typeof v === "string" && v.trim().length > 0)) return true;
  return (request.activityDetails || []).some((d) => d.response && d.response.trim().length > 0);
}

// Rationale fields ONLY (short, provider-facing coding text, never S/O/A/P
// prose): when nothing was observed, "deficits" the model attributes to the
// patient become "demands" of the activity, which is the claim the input
// actually supports. Pipeline eval run 2026-11-04T20-50, P6 sample 3: a
// rationale asserted deficits with every observation field blank.
export function softenUnsupportedDeficitInRationale(text: string): string {
  if (!text || !hasUnsupportedDeficitAssertion(text)) return text;
  const out = text
    .replace(/\b(underlying|patient'?s|his|her|their|identified|existing|noted|documented|observed)\s+((?:[\w/-]+\s+){0,3})deficits?\b/gi, (_m, _lead, mid) => `${mid}demands`)
    .replace(/\baddress(es|ing)?\s+(?:the\s+)?((?:[\w/-]+\s+){0,3})deficits?\b/gi, (_m, suffix, mid) => `target${suffix ?? ""} ${mid}demands`)
    .replace(/\bdeficits?\s+(in|with|of)\s+/gi, "demands on ")
    .replace(/\b(weakness|decreased|reduced|poor|impaired|limited)\s+((?:[\w/-]+\s+){0,2})(strength|endurance|postural\s+control|core\s+stability|motor\s+planning|balance|coordination)\b/gi, (_m, _adj, mid, noun) => `${mid}${noun} demands`)
    .replace(/[ \t]{2,}/g, " ");
  logger.warn("Softened undocumented deficit language in a billing rationale (no observations supplied)", {
    originalLength: text.length,
    softenedLength: out.length,
  });
  return out;
}

export async function validateAndEnhanceResponse(
  aiResponse: any,
  request: AiSoapBillingRequest,
  billingUnits: number,
  hasMostRecentPlanContext: boolean = false,
  hasActiveGoalsContext: boolean = false,
): Promise<AiSoapBillingResponse> {

  // Use manual rate override if provided, otherwise use default $289/unit
  const unitRate = request.ratePerUnit || DEFAULT_UNIT_RATE;

  // Raw AI aggregate (units + clinical rationales), before reconciliation.
  const aiAggregate: GeneratedCptCode[] = (aiResponse.cptCodes || []).map((code: any) => {
    const codeInfo = CPT_CODE_INFO[code.code as keyof typeof CPT_CODE_INFO];
    // Use the override rate or the code-specific rate
    const rate = request.ratePerUnit || codeInfo?.rate || DEFAULT_UNIT_RATE;
    return {
      code: code.code,
      name: code.name || codeInfo?.name || "Unknown",
      units: code.units || 1,
      rationale: softenAbsolutistCodingClaim(code.rationale || ""),
      reimbursement: rate * (code.units || 1),
      activitiesAssigned: code.activitiesAssigned || []
    };
  });

  // Per-activity pairing (Objective) — one suggested code per documented
  // activity; anything missing/unclear conservatively defaults to 97530.
  const activityCptPairings = normalizeActivityCptPairings(
    request.activities,
    aiResponse.activityCptPairings,
  );

  // SINGLE SOURCE OF TRUTH: re-derive the aggregate billing codes from the
  // per-activity pairings so the Objective pairing and the billing output can
  // never contradict each other. Unit totals stay documentation-driven (the
  // AI's own distribution total, never padded up to the available units —
  // under-using available units is a safe, defensible outcome the provider
  // can adjust on review; padding onto a code is exactly the optimization
  // behavior we removed).
  const aiTotalUnits = aiAggregate.reduce((sum, c) => sum + c.units, 0);
  const cptCodes: GeneratedCptCode[] = reconcileCptCodesWithPairings(
    activityCptPairings,
    aiAggregate,
    unitRate,
    aiTotalUnits > 0 ? Math.min(aiTotalUnits, Math.max(billingUnits, 1)) : Math.max(billingUnits, 1),
  );

  // Reconciliation above distributes UNITS across codes using the flat
  // unitRate for simplicity -- it's not about dollar amounts. Now correct
  // each code's shown reimbursement to the practice's actual configured fee
  // for that CPT code where one exists, instead of leaving every code priced
  // at the one flat estimate rate. Without this, a multi-code visit's shown
  // total systematically diverges from the real claim amount (which bills
  // each code at its own practice rate), even though both now cover the
  // same codes/units -- exactly the "estimate doesn't match the claim, no
  // explanation" gap this was built to close.
  const perCodeRates = new Map<string, number>();
  if (request.practiceId) {
    try {
      const catalog = await storage.getCptCodes();
      for (const code of cptCodes) {
        const cpt = catalog.find((c: any) => c.code === code.code);
        if (!cpt) continue;
        const rateStr = await storage.resolvePracticeCptRate(request.practiceId, cpt.id);
        if (rateStr !== null) perCodeRates.set(code.code, parseFloat(rateStr));
      }
    } catch (e) {
      // Practice rate lookup is a display refinement, not a hard requirement
      // -- fall back to the flat estimate rate for every code on any error.
      logger.warn('Per-code practice rate lookup failed for SOAP billing estimate', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  for (const code of cptCodes) {
    const realRate = perCodeRates.get(code.code);
    if (realRate !== undefined) code.reimbursement = realRate * code.units;
  }

  const totalReimbursement = cptCodes.reduce((sum, c) => sum + c.reimbursement, 0);

  // Generate individual timeblocks for insurers requiring per-block codes
  const timeBlocks: TimeBlock[] = [];
  let blockNumber = 1;

  for (const cptCode of cptCodes) {
    const blockRate = perCodeRates.get(cptCode.code) ?? unitRate;
    for (let i = 0; i < cptCode.units; i++) {
      timeBlocks.push({
        blockNumber,
        startMinute: (blockNumber - 1) * 15,
        endMinute: blockNumber * 15,
        code: cptCode.code,
        codeName: cptCode.name,
        rate: blockRate,
        activities: cptCode.activitiesAssigned.slice(0, 3) // Show up to 3 activities per block
      });
      blockNumber++;
    }
  }

  // Per-activity rationales get the same suggestion-framing backstop as the
  // aggregate codes (normalizeActivityCptPairings fills defaults; the model's
  // own wording is what needs softening).
  const noObservations = !requestHasObservations(request);
  const hasMoodForRationale = !!request.mood;
  // Rationale fields get every text backstop S/O/A/P get (pipeline eval run
  // 2026-11-04T21-26: a documentation-denial sentence surfaced in an
  // auditNote) plus the two rationale-only softeners.
  const cleanRationale = (text: string) => {
    const base = removeCaseAContinuityWording(
      stripUnsupportedDocumentationDenialClause(
        stripUnsupportedMoodClause(softenAbsolutistCodingClaim(text), hasMoodForRationale),
      ),
      hasMostRecentPlanContext,
      hasActiveGoalsContext,
    );
    return noObservations ? softenUnsupportedDeficitInRationale(base) : base;
  };
  for (const pairing of activityCptPairings) {
    if (pairing.rationale) pairing.rationale = cleanRationale(pairing.rationale);
  }
  for (const code of cptCodes) {
    if (code.rationale) code.rationale = cleanRationale(code.rationale);
  }

  const hasMood = !!request.mood;
  return {
    subjective: ensureSubjectivePresent(
      stripUnsupportedDocumentationDenialClause(
        stripUnsupportedMoodClause(aiResponse.subjective || "", hasMood),
      ),
    ),
    objective: removeCaseAContinuityWording(
      stripUnsupportedDocumentationDenialClause(
        stripUnsupportedMoodClause(aiResponse.objective || "", hasMood),
      ),
      hasMostRecentPlanContext,
      hasActiveGoalsContext,
    ),
    assessment: removeCaseAContinuityWording(
      stripUnsupportedDocumentationDenialClause(
        stripUnsupportedMoodClause(
          stripUnsupportedContinuityNecessity(
            aiResponse.assessment || "",
            hasMostRecentPlanContext,
            hasActiveGoalsContext,
          ),
          hasMood,
        ),
      ),
      hasMostRecentPlanContext,
      hasActiveGoalsContext,
    ),
    plan: removeCaseAContinuityWording(
      stripUnsupportedDocumentationDenialClause(
        stripUnsupportedMoodClause(
          stripUnsupportedPlanClosing(
            aiResponse.plan || "",
            hasMostRecentPlanContext,
            hasActiveGoalsContext,
          ),
          hasMood,
        ),
      ),
      hasMostRecentPlanContext,
      hasActiveGoalsContext,
    ),
    cptCodes,
    activityCptPairings,
    timeBlocks,
    totalReimbursement,
    billingRationale: cleanRationale(aiResponse.billingRationale || ""),
    auditNotes: (aiResponse.auditNotes || []).map((n: unknown) =>
      typeof n === "string" ? cleanRationale(n) : n,
    ),
    generationMode: "ai",
  };
}

/**
 * Fallback generation if AI is unavailable
 */
export function fallbackGeneration(
  request: AiSoapBillingRequest,
  patient: any,
  billingUnits: number
): AiSoapBillingResponse {

  // Use manual rate override if provided, otherwise use default $289/unit
  const unitRate = request.ratePerUnit || DEFAULT_UNIT_RATE;

  // Rule-based assignment by SKILLED OBJECTIVE, not by reimbursement rate.
  // Vestibular/proprioceptive sensory-motor work maps to neuromuscular
  // re-education (97112) by its motor objective (postural control, motor
  // planning, coordination) rather than defaulting to a sensory-integration
  // code (97533) — which payers deny as developmental/non-specific.
  const neuromuscularKeywords = ["swing", "crash", "weighted", "body sock", "trampoline", "compression", "vestibular", "proprioceptive", "balance", "foam beam", "one-leg", "ladder", "scooter", "yoga"];
  const functionalKeywords = ["obstacle", "pegboard", "puzzle", "cutting", "writing", "ADL", "lacing", "buttoning", "feeding", "rice bin", "tactile", "brushing"];
  const exerciseKeywords = ["strength", "endurance", "exercise", "putty", "resistance", "wall push", "animal walk"];

  // Per-activity pairing first — one suggested code per documented activity.
  // An activity no keyword clearly maps conservatively defaults to 97530
  // Therapeutic Activities (clinician guidance: some payers only reimburse
  // one type of code, and Therapeutic Activities is the defensible default).
  const activityCptPairings: ActivityCptPairing[] = request.activities.map((a) => {
    const lower = a.toLowerCase();
    if (functionalKeywords.some((k) => lower.includes(k.toLowerCase()))) {
      return {
        activity: a,
        code: "97530",
        name: "Therapeutic Activities",
        rationale: "Functional/dynamic activity for participation — therapeutic activities. Suggestion only; the treating provider makes the final coding decision.",
        source: "ai" as const,
      };
    }
    if (neuromuscularKeywords.some((k) => lower.includes(k.toLowerCase()))) {
      return {
        activity: a,
        code: "97112",
        name: "Neuromuscular Re-education",
        rationale: "Balance/postural control/motor planning objective — neuromuscular re-education. Suggestion only; the treating provider makes the final coding decision.",
        source: "ai" as const,
      };
    }
    if (exerciseKeywords.some((k) => lower.includes(k.toLowerCase()))) {
      return {
        activity: a,
        code: "97110",
        name: "Therapeutic Exercise",
        rationale: "Strengthening/endurance objective — therapeutic exercise. Suggestion only; the treating provider makes the final coding decision.",
        source: "ai" as const,
      };
    }
    // Unclear mapping ⇒ conservative default (97530).
    return {
      activity: a,
      code: CONSERVATIVE_DEFAULT_CPT_CODE,
      name: CONSERVATIVE_DEFAULT_CPT_NAME,
      rationale: CONSERVATIVE_DEFAULT_RATIONALE,
      source: "default" as const,
    };
  });

  // Aggregate billing codes derived from the pairings (single source of
  // truth), units distributed across the paired codes by documentation.
  const cptCodes: GeneratedCptCode[] = reconcileCptCodesWithPairings(
    activityCptPairings,
    [
      { code: "97112", rationale: `Neuromuscular re-education targeting postural control, balance, and motor planning via the documented activities.` },
      { code: "97530", rationale: `Therapeutic activities for functional participation across the documented activities.` },
      { code: "97110", rationale: `Therapeutic exercise for strength and endurance across the documented activities.` },
    ],
    unitRate,
    Math.max(billingUnits, 1),
  );

  const totalReimbursement = cptCodes.reduce((sum, c) => sum + c.reimbursement, 0);
  const patientName = patient.firstName;

  // Generate individual timeblocks for insurers requiring per-block codes
  const timeBlocks: TimeBlock[] = [];
  let blockNumber = 1;

  for (const cptCode of cptCodes) {
    for (let i = 0; i < cptCode.units; i++) {
      timeBlocks.push({
        blockNumber,
        startMinute: (blockNumber - 1) * 15,
        endMinute: blockNumber * 15,
        code: cptCode.code,
        codeName: cptCode.name,
        rate: unitRate,
        activities: cptCode.activitiesAssigned.slice(0, 3)
      });
      blockNumber++;
    }
  }

  // Build subjective section — input-proportional, no fabrication. Reflect
  // ONLY the caregiver report and mood that were actually provided; do not
  // invent home-program compliance, medication/sleep inquiries, or
  // prior-session comparisons. A blank field is OMITTED, never asserted as
  // a negative ("was not obtained") -- the form being blank means the
  // therapist didn't type anything, not that we know nothing happened.
  const caregiverLine = request.caregiverReport
    ? `Caregiver reported: ${request.caregiverReport}.`
    : "";
  const moodLine = request.mood
    ? `${patientName} presented as ${request.mood.toLowerCase()} during today's session.`
    : "";
  const subjective = ensureSubjectivePresent([caregiverLine, moodLine].filter(Boolean).join('\n\n'));

  // Build objective section — grounded ONLY in the provided activities and
  // assessment fields. No invented trials, cue counts, equipment specifics, or
  // assistance-level progression.
  const objective = `Session conducted in ${request.location} for ${request.duration} minutes (${billingUnits} billable units).\n\nActivities performed:\n${request.activities.map(a => `• ${a}`).join('\n')}\n\nAssistance level: ${request.assessment.assistance}.\n\nClinical observations as documented by the treating therapist:\n• Overall performance: ${request.assessment.performance}\n• Strength/endurance: ${request.assessment.strength}\n• Motor planning: ${request.assessment.motorPlanning}\n• Sensory regulation: ${request.assessment.sensoryRegulation}${request.assessment.posturalControl ? `\n• Postural control: ${request.assessment.posturalControl}` : ''}${request.assessment.fineMotor ? `\n• Fine motor: ${request.assessment.fineMotor}` : ''}${request.assessment.bilateralCoordination ? `\n• Bilateral coordination: ${request.assessment.bilateralCoordination}` : ''}`;

  // Build assessment section — clinical interpretation anchored to the
  // observations actually provided; no fabricated reflexes, prior-session
  // comparisons, or boilerplate deficits. The medical-necessity statement is
  // built from the documented observations, not a fixed template.
  // Per clinical review (Blanche, 2026-07): only assert medical necessity when
  // the documented observations actually show deficits. On a thin note, skip
  // the sentence entirely — a generic necessity claim weakens documentation
  // more than leaving it out.
  const hasDocumentedDeficits = [
    request.assessment.strength,
    request.assessment.motorPlanning,
    request.assessment.sensoryRegulation,
  ].some((f) => /poor|decreas|difficult|limit|delay|reduc/i.test(f));
  const necessityParagraph = hasDocumentedDeficits
    ? `\n\nSkilled OT was required to grade and adapt the above activities to the patient's documented deficits in the areas noted above, supporting safer and more effective functional participation. Continued skilled occupational therapy is indicated to address these documented deficits.`
    : '';
  // Same blank-field rule as the Subjective section: an unset mood is
  // omitted, never defaulted into a sentence that would otherwise read
  // "presented as  and participated..." (literal double space) or assert a
  // presentation that was never documented.
  const presentedAsClause = request.mood ? `presented as ${request.mood.toLowerCase()} and ` : '';
  const assessment = `${patientName} ${presentedAsClause}participated in skilled occupational therapy with ${request.assessment.assistance.toLowerCase()} assistance. Skilled clinical analysis and therapist-directed adaptation were provided to support performance across the documented activities.\n\nFunctional performance this session: ${request.assessment.performance}. Strength/endurance: ${request.assessment.strength}. Motor planning: ${request.assessment.motorPlanning}. Sensory regulation: ${request.assessment.sensoryRegulation}.${necessityParagraph}`;

  // Build plan section. Home-program wording follows the reviewer's guidance:
  // when no new home program was provided, do not invent one or imply parent
  // education occurred — note continuation of current strategies. Next
  // session focus is similarly omitted entirely when blank, rather than
  // rendering a bare "• " or the literal string "undefined".
  const nextSessionBullets = [request.planNextSteps, request.nextSessionFocus]
    .filter((item): item is string => !!item)
    .map((item) => `• ${item}`)
    .join('\n');
  const nextSessionSection = nextSessionBullets ? `Next session focus:\n${nextSessionBullets}\n\n` : '';
  const plan = `Continue occupational therapy to address current treatment goals.\n\n${nextSessionSection}Home program:\n${request.homeProgram ? `• ${request.homeProgram}` : '• Reviewed continuation of current home strategies; no changes to home program at this time.'}`;

  return {
    subjective,
    objective,
    assessment,
    plan,
    cptCodes,
    activityCptPairings,
    timeBlocks,
    totalReimbursement,
    billingRationale: "Billing codes assigned using rule-based accuracy checks. AI unavailable.",
    auditNotes: ["Documentation supports assigned CPT codes", "Activities match code descriptions"],
    generationMode: "fallback",
  };
}

export default { generateSoapNoteAndBilling };
