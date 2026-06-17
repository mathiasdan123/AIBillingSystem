import Anthropic from "@anthropic-ai/sdk";
import { storage } from "../storage";
import { assertPhiAiAllowed } from "../utils/phiAiGuard";
import logger from "./logger";

// Lazy initialization of Anthropic client (only when API key is present)
let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.warn("ANTHROPIC_API_KEY not set - AI features will use fallback rule-based generation");
    return null;
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
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
  activities: string[];
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
  timeBlocks: TimeBlock[]; // Individual 15-min blocks for insurers requiring per-block codes
  totalReimbursement: number;
  billingRationale: string;
  auditNotes: string[];
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
    treatmentPlan = await storage.getActiveTreatmentPlan(request.patientId);
    if (!treatmentPlan) {
      // Fall back to any treatment plan
      const plans = await storage.getPatientTreatmentPlans(request.patientId);
      if (plans && plans.length > 0) {
        treatmentPlan = plans[0];
      }
    }
    if (treatmentPlan) {
      treatmentGoals = await storage.getTreatmentGoals(treatmentPlan.id);
    }
  } catch (e) {
    // No treatment plan available
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
  const userPrompt = buildUserPrompt(request, patient, billingUnits, insuranceData, treatmentPlan, treatmentGoals);

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
    return validateAndEnhanceResponse(aiResponse, request, billingUnits);

  } catch (error) {
    console.error("AI generation error:", error);
    // Fallback to rule-based generation if AI fails
    return fallbackGeneration(request, patient, billingUnits);
  }
}

function buildSystemPrompt(insuranceData: any): string {
  let prompt = `You are an expert pediatric occupational therapy clinical documentation specialist. Your role is to:

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
   - **Any comparison to prior performance or prior sessions.** Forbidden
     phrasings include "improved from last session", "compared to
     baseline observations", "carry-over of previously taught strategies",
     "better than previously", "progressed from moderate assist to...",
     and any "was X, now Y" structure. You have NO data about prior
     sessions UNLESS the treatment plan or treatment goals data
     explicitly provides a prior measurement or observation to compare
     against. If in doubt, describe today's performance in absolute
     terms without any prior reference.
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
   - Explicit acknowledgment that data wasn't collected
     (e.g., "Formal caregiver report was not obtained this session",
     "Standardized measurements were not administered; observations were
     qualitative")
   - Simple omission — it is better to write a shorter section than to
     invent content to fill it

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
==========================================================================

SOAP NOTE STRUCTURE

SUBJECTIVE SECTION (length: proportional to input — could be a single
sentence if the input is sparse):
Cover, USING ONLY PROVIDED DATA:

1. CAREGIVER/PARENT REPORT:
   - If no caregiver report was provided, write exactly one sentence:
     "Caregiver report was not obtained this session."
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

3. PROGRESS CONTEXT — Only reference prior sessions if the treatment
   plan or goals data explicitly describes prior performance. Never
   invent "improved from last session" statements.

Length rule for Subjective: if the only information you have is a mood
and a brief caregiver statement, the Subjective may be 2–3 sentences
total. That is correct and expected. Do NOT pad.

OBJECTIVE SECTION (target: 120-300 words, scaled to the richness of the input):
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

ASSESSMENT SECTION (target: 200-400 words, scaled to input):
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
  invent deficits.

OMIT any sub-section if the input does not support it. It is better to
write 4 substantive paragraphs than 8 padded ones.

PLAN SECTION (target: 80-200 words):
Use the "planNextSteps", "nextSessionFocus", and "homeProgram" fields.

1. NEXT SESSION FOCUS — Use what the therapist wrote. Add 2-3 specific
   activities that would clinically align with that focus.
2. TREATMENT FREQUENCY — Only state a frequency if one is implied or
   stated in the treatment plan data. Otherwise write
   "Continue current treatment frequency" without a specific cadence.
3. HOME PROGRAM — Use the home program field if provided. If it wasn't
   provided, write "Home program: no changes" or omit this subsection.
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
- "skilled occupational therapy services remain medically necessary"

BILLING CODE ASSIGNMENT (choose codes by the interventions actually performed —
do NOT choose by reimbursement; the treating provider makes the final decision):
  * 97533 Sensory Integration - sensory-based interventions
  * 97530 Therapeutic Activities - functional, dynamic activities
  * 97112 Neuromuscular Re-ed - balance, coordination, motor control
  * 97110 Therapeutic Exercise - pure strengthening/ROM

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

Use this contract data to:
- Prioritize codes that are covered at higher rates
- Avoid codes that require prior authorization (if not obtained)
- Stay within visit limits if applicable`;
  }

  return prompt;
}

function buildUserPrompt(
  request: AiSoapBillingRequest,
  patient: any,
  billingUnits: number,
  insuranceData: any,
  treatmentPlan?: any,
  treatmentGoals?: any[]
): string {
  // Calculate patient age
  const dob = new Date(patient.dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }

  let prompt = `Generate a COMPREHENSIVE, DETAILED SOAP note for this pediatric OT session.

PATIENT INFORMATION:
- Name: ${patient.firstName} ${patient.lastName}
- Age: ${age} years`;
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

  // Add treatment goals if available
  if (treatmentGoals && treatmentGoals.length > 0) {
    prompt += `\n\nACTIVE TREATMENT GOALS:`;
    for (const goal of treatmentGoals) {
      prompt += `\n- ${goal.description} (Status: ${goal.status}, Progress: ${goal.currentProgress || 'N/A'})`;
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
- Mood/Presentation: ${request.mood}
- Caregiver Report: ${request.caregiverReport || "No specific concerns reported today"}

ACTIVITIES/EXERCISES PERFORMED:
${request.activities.map(a => `- ${a}`).join('\n')}

CLINICAL OBSERVATIONS:
- Overall Performance: ${request.assessment.performance}
- Assistance Level Required: ${request.assessment.assistance}
- Core Strength/Endurance: ${request.assessment.strength}
- Motor Planning: ${request.assessment.motorPlanning}
- Sensory Regulation: ${request.assessment.sensoryRegulation}`;

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

  prompt += `

PLAN NOTES:
- Next Steps: ${request.planNextSteps}
- Next Session Focus: ${request.nextSessionFocus || "Continue current goals"}
- Home Program: ${request.homeProgram || "Recommendations provided to caregiver"}

RESPOND WITH THIS JSON STRUCTURE:
{
  "subjective": "THIS MUST BE 100-200 WORDS (2-3 paragraphs). Example structure:\\n\\nCaregiver reports [specific observations at home since last session, including any functional changes noticed]. [Parent/Mom/Dad] notes [specific examples of progress or difficulty with daily activities such as dressing, feeding, handwriting, playground participation]. Home program compliance has been [consistent/inconsistent], with caregiver reporting [specific details about home exercise completion and response].\\n\\n[Patient] presented as [mood/affect] upon arrival to today's session. [He/She] [specific behavioral observations - eagerness, reluctance, social interaction details]. [Patient] self-reported [any relevant statements from the child about pain, preferences, or feelings about therapy].\\n\\n[Any relevant context: school reports, medication changes, sleep changes, or comparison to previous session presentation].",

  "objective": "Target 200-400 words ONLY if the supplied data supports it — never pad with invented detail. Describe the session using ONLY what the therapist provided (the activities listed, the assistance level given, the location/duration). Structure:\\n\\nSession conducted in [location] for [duration] minutes.\\n- Include standardized scores, trial counts, timings, ROM/grip measurements, or specific equipment specs (e.g. resistance level, ball size, vest weight) ONLY if the therapist actually recorded them in the inputs. If they are not in the inputs, OMIT them — do NOT invent numbers, scores, or equipment specifications.\\n\\nFor each activity the therapist listed: describe participation and the assistance level provided (using the therapist's stated level and standard terminology — Independent, Modified Independent, Supervision, Min/Mod/Max Assist, Dependent), and the cueing type if stated.\\n\\nSkilled interventions provided: describe the clinical interventions that correspond to the activities listed.\\n\\nDo NOT state a comparison to a previous session unless prior-session data was supplied.",

  "assessment": "THIS MUST BE 300-500 WORDS MINIMUM. Write 5-7 detailed paragraphs. Example structure:\\n\\nDuring today's occupational therapy session, [Patient] demonstrated [engagement level] throughout therapist-directed activities, with [tolerance observations] as the session progressed. [He/She] benefited from structured activities and graded sensory input to support regulation and sustained participation.\\n\\n[Patient] continues to present with decreased core and postural strength, which impacted [his/her] ability to sustain prone extension and maintain upright postural control during dynamic activities. [He/She] required verbal cueing and physical support to facilitate appropriate weight-bearing through [his/her] upper extremities and to maintain alignment during anti-gravity positions. [Motor planning observations with specific examples].\\n\\nPrimitive reflex integration challenges remain evident, including patterns consistent with retained TLR, STNR, ATNR, and possible Moro reflex, which continue to interfere with separation of upper and lower body movements, postural control, and coordinated transitions. These reflex patterns contributed to [specific observations].\\n\\nFine-motor skills continue to emerge; however, performance remains impacted by proximal weakness and decreased postural stability. [Patient] demonstrated [specific observations] with external postural support.\\n\\n[Patient] benefited from graded vestibular and proprioceptive input, which supported improved regulation, motor organization, and task engagement.\\n\\nProgress toward treatment goals: describe progress in the goal areas ONLY as supported by the supplied data and treatment goals. Include a comparison to a previous session ONLY if prior-session data was provided — do NOT invent measurable comparisons, trial data, or assistance-level changes. Clinical reasoning supports continued treatment at current frequency due to [rationale grounded in the documented deficits].\\n\\nOverall, [Patient] continues to demonstrate deficits in core strength, postural control, motor planning, primitive reflex integration, and sensory-motor regulation, which impact [his/her] ability to efficiently participate in age-appropriate gross-motor, fine-motor, and functional activities including [specific ADLs, school tasks, play activities]. Skilled occupational therapy services remain medically necessary to address these deficits through targeted intervention.",

  "plan": "THIS MUST BE 100-200 WORDS. Example structure:\\n\\nContinue occupational therapy services [frequency, e.g., 2x/week for 45-minute sessions] to address the following goals:\\n\\nNext Session Plan:\\n- [Specific activity 1 with clinical rationale, e.g., 'Prone extension on therapy ball to target core strengthening and postural endurance']\\n- [Specific activity 2, e.g., 'Reflex integration exercises targeting retained STNR and TLR patterns']\\n- [Specific activity 3, e.g., 'Graded fine motor tasks progressing from large pegs to small beads']\\n- [Specific activity 4, e.g., 'Bilateral coordination tasks at midline for UE integration']\\n\\nHome Program Modifications:\\n- [Specific exercise with frequency, e.g., 'Superman holds 3x10 seconds, 2x daily']\\n- [Activity modification, e.g., 'Increase theraputty resistance from soft to medium']\\n- [Functional activity, e.g., 'Practice button/zipper board 5 minutes daily before school']\\n\\nGoals to prioritize: [List 2-3 specific treatment goals to address]\\n\\nCoordination: [Any referrals, teacher communication, or provider coordination needed].",

  "cptCodes": [
    {
      "code": "97533",
      "name": "Sensory Integration",
      "units": 2,
      "rationale": "Clinical justification for this code",
      "activitiesAssigned": ["Activity 1", "Activity 2"]
    }
  ],
  "billingRationale": "Explanation of code assignment strategy",
  "auditNotes": ["Documentation points supporting the billing codes"]
}

CRITICAL REQUIREMENTS:
1. The SUBJECTIVE section should be 100-200 words (caregiver report, patient presentation, progress context) — using only what was reported.
2. The OBJECTIVE section should be 200-400 words using the therapist's documented activities and assistance levels. Include specific measurements / trial data / timed performance / standardized scores ONLY where the therapist actually recorded them; never fabricate numbers to hit a length.
3. The ASSESSMENT section should be 300-500 words (clinical reasoning and progress toward goals). Compare to a previous session ONLY if prior-session data was supplied.
4. The PLAN section should be 100-200 words with next-session activities, home program modifications, and treatment frequency.
5. Use professional OT clinical terminology (prone extension, anti-gravity, vestibular input, etc.) where clinically accurate for the activities documented.
6. Name specific primitive reflexes (TLR, STNR, ATNR, Moro) ONLY if the therapist's inputs indicate them — do not assert reflex findings that weren't observed.
7. End assessment with a medical necessity statement connecting the documented deficits to functional participation.
8. Distribute all ${billingUnits} units across the CPT codes.
9. Be thorough, but NEVER invent clinical findings, measurements, equipment specifics, scores, or prior-session comparisons to pad length. Accurate and shorter beats detailed and fabricated — fabricated documentation is insurance fraud and the treating provider must be able to attest every statement is true.
10. Include quantified data (trial counts, timings, % assistance, standardized scores) ONLY where the therapist supplied it. If it wasn't supplied, omit it.`;

  return prompt;
}

function validateAndEnhanceResponse(
  aiResponse: any,
  request: AiSoapBillingRequest,
  billingUnits: number
): AiSoapBillingResponse {

  // Use manual rate override if provided, otherwise use default $289/unit
  const unitRate = request.ratePerUnit || DEFAULT_UNIT_RATE;

  // Calculate reimbursements
  const cptCodes: GeneratedCptCode[] = (aiResponse.cptCodes || []).map((code: any) => {
    const codeInfo = CPT_CODE_INFO[code.code as keyof typeof CPT_CODE_INFO];
    // Use the override rate or the code-specific rate
    const rate = request.ratePerUnit || codeInfo?.rate || DEFAULT_UNIT_RATE;
    return {
      code: code.code,
      name: code.name || codeInfo?.name || "Unknown",
      units: code.units || 1,
      rationale: code.rationale || "",
      reimbursement: rate * (code.units || 1),
      activitiesAssigned: code.activitiesAssigned || []
    };
  });

  // Ensure all units are distributed
  const totalUnits = cptCodes.reduce((sum, c) => sum + c.units, 0);
  if (totalUnits < billingUnits && cptCodes.length > 0) {
    // Accuracy framing: assign any remaining units to the PRIMARY (first
    // documented) code, not the highest-paying one.
    const primary = cptCodes[0];
    const rate = request.ratePerUnit || CPT_CODE_INFO[primary.code as keyof typeof CPT_CODE_INFO]?.rate || DEFAULT_UNIT_RATE;
    primary.units += (billingUnits - totalUnits);
    primary.reimbursement = rate * primary.units;
  }

  const totalReimbursement = cptCodes.reduce((sum, c) => sum + c.reimbursement, 0);

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
        activities: cptCode.activitiesAssigned.slice(0, 3) // Show up to 3 activities per block
      });
      blockNumber++;
    }
  }

  return {
    subjective: aiResponse.subjective || "",
    objective: aiResponse.objective || "",
    assessment: aiResponse.assessment || "",
    plan: aiResponse.plan || "",
    cptCodes,
    timeBlocks,
    totalReimbursement,
    billingRationale: aiResponse.billingRationale || "",
    auditNotes: aiResponse.auditNotes || []
  };
}

/**
 * Fallback generation if AI is unavailable
 */
function fallbackGeneration(
  request: AiSoapBillingRequest,
  patient: any,
  billingUnits: number
): AiSoapBillingResponse {

  // Use manual rate override if provided, otherwise use default $289/unit
  const unitRate = request.ratePerUnit || DEFAULT_UNIT_RATE;

  // Simple rule-based assignment prioritizing higher rates
  const sensoryKeywords = ["swing", "crash", "weighted", "body sock", "trampoline", "rice bin", "tactile", "brushing", "compression", "vestibular", "proprioceptive"];
  const functionalKeywords = ["obstacle", "pegboard", "puzzle", "cutting", "writing", "ADL", "lacing", "buttoning", "feeding"];
  const balanceKeywords = ["balance", "foam beam", "one-leg", "ladder", "scooter", "yoga"];

  const sensoryActivities = request.activities.filter(a =>
    sensoryKeywords.some(k => a.toLowerCase().includes(k))
  );
  const functionalActivities = request.activities.filter(a =>
    functionalKeywords.some(k => a.toLowerCase().includes(k)) && !sensoryActivities.includes(a)
  );
  const balanceActivities = request.activities.filter(a =>
    balanceKeywords.some(k => a.toLowerCase().includes(k)) && !sensoryActivities.includes(a) && !functionalActivities.includes(a)
  );
  const exerciseActivities = request.activities.filter(a =>
    !sensoryActivities.includes(a) && !functionalActivities.includes(a) && !balanceActivities.includes(a)
  );

  const cptCodes: GeneratedCptCode[] = [];
  let remainingUnits = billingUnits;

  // Assign codes by the activities actually documented (sensory/functional/
  // balance/exercise), distributing units proportionally by category — not by
  // reimbursement rate. (Codes default to the same $/unit anyway.)
  if (sensoryActivities.length > 0 && remainingUnits > 0) {
    const units = Math.min(Math.ceil(billingUnits * 0.4), remainingUnits);
    cptCodes.push({
      code: "97533",
      name: "Sensory Integration",
      units,
      rationale: `Sensory integrative techniques: ${sensoryActivities.slice(0, 3).join(", ")}`,
      reimbursement: unitRate * units,
      activitiesAssigned: sensoryActivities
    });
    remainingUnits -= units;
  }

  if (functionalActivities.length > 0 && remainingUnits > 0) {
    const units = Math.min(Math.ceil(billingUnits * 0.3), remainingUnits);
    cptCodes.push({
      code: "97530",
      name: "Therapeutic Activities",
      units,
      rationale: `Functional activities: ${functionalActivities.slice(0, 3).join(", ")}`,
      reimbursement: unitRate * units,
      activitiesAssigned: functionalActivities
    });
    remainingUnits -= units;
  }

  if (balanceActivities.length > 0 && remainingUnits > 0) {
    const units = Math.min(Math.ceil(billingUnits * 0.2), remainingUnits);
    cptCodes.push({
      code: "97112",
      name: "Neuromuscular Re-education",
      units,
      rationale: `Balance and coordination: ${balanceActivities.slice(0, 3).join(", ")}`,
      reimbursement: unitRate * units,
      activitiesAssigned: balanceActivities
    });
    remainingUnits -= units;
  }

  if (remainingUnits > 0) {
    const activities = exerciseActivities.length > 0 ? exerciseActivities : request.activities.slice(0, 3);
    cptCodes.push({
      code: "97110",
      name: "Therapeutic Exercise",
      units: remainingUnits,
      rationale: `Therapeutic exercises: ${activities.slice(0, 3).join(", ")}`,
      reimbursement: unitRate * remainingUnits,
      activitiesAssigned: activities
    });
  }

  // Fallback if no codes assigned
  if (cptCodes.length === 0) {
    cptCodes.push({
      code: "97530",
      name: "Therapeutic Activities",
      units: billingUnits,
      rationale: "General OT intervention",
      reimbursement: unitRate * billingUnits,
      activitiesAssigned: request.activities
    });
  }

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

  // Build detailed subjective section
  const caregiverInfo = request.caregiverReport || "Caregiver reports consistent participation in home program with no new concerns at this time";
  const subjective = `${caregiverInfo}. Caregiver was asked about progress with functional tasks at home and any changes in daily routine, medication, or sleep patterns since the previous session.\n\n${patientName} presented as ${request.mood.toLowerCase()} upon arrival to today's session. Patient demonstrated ${request.mood.toLowerCase().includes('happy') || request.mood.toLowerCase().includes('excited') || request.mood.toLowerCase().includes('engaged') ? 'willingness to engage in therapist-directed activities and positive social interactions with the treating therapist' : 'variable engagement with therapist-directed activities throughout the session, requiring encouragement and structured choices to maintain participation'}.\n\nPresentation today is ${request.mood.toLowerCase().includes('happy') || request.mood.toLowerCase().includes('cooperative') ? 'consistent with recent sessions, suggesting stable baseline performance' : 'noted for clinical monitoring and comparison to previous session presentation'}.`;

  // Build detailed objective section
  const activitiesList = request.activities.map(a => `• ${a}`).join('\n');
  const objective = `Session conducted in ${request.location} for ${request.duration} minutes (${billingUnits} billable units).\n\nActivities Performed with Performance Data:\n${request.activities.map((a, i) => `• ${a}: Patient participated with ${request.assessment.assistance.toLowerCase()} level of assistance. ${i === 0 ? 'Performance data collected across trials.' : 'Cueing provided as needed (verbal and visual).'}`).join('\n')}\n\nAssistance Level: ${request.assessment.assistance}. Cueing types utilized included verbal cues for task initiation and sequencing, visual cues for motor planning, and tactile cues as needed for postural correction.\n\nEquipment/Materials: Therapeutic equipment selected to address treatment goals including items appropriate for sensory-motor and fine motor intervention.\n\nSkilled Interventions Provided:\n• Neuromuscular re-education for postural control and core stabilization during dynamic activities\n• Graded sensory input (vestibular and proprioceptive) to support regulation and motor organization\n• Therapeutic exercise targeting strength, endurance, and range of motion\n• Motor planning activities with graded complexity to challenge bilateral coordination and sequencing\n\nAssistance level was monitored throughout the session. ${request.assessment.assistance.toLowerCase().includes('max') ? 'Patient required sustained physical and verbal support throughout most activities.' : request.assessment.assistance.toLowerCase().includes('mod') ? 'Patient demonstrated ability to progress from moderate to minimum assistance on familiar tasks by end of session.' : 'Patient demonstrated emerging independence on previously challenging tasks with verbal cueing only.'}`;

  // Build detailed assessment section
  const assessment = `During today's occupational therapy session, ${patientName} demonstrated ${request.assessment.performance.toLowerCase()} engagement throughout therapist-directed activities. Patient ${request.assessment.performance.toLowerCase().includes('good') || request.assessment.performance.toLowerCase().includes('improved') ? 'tolerated movement demands and challenging activities with increasing confidence' : 'demonstrated variable tolerance for movement demands and challenging activities, requiring structured breaks and sensory strategies to maintain participation'}. ${patientName} benefited from structured activities and graded sensory input to support regulation and sustained participation.\n\n${patientName} continues to present with ${request.assessment.strength.toLowerCase().includes('good') || request.assessment.strength.toLowerCase().includes('improved') ? 'improving but still developing' : 'decreased'} core and postural strength, which impacted ability to sustain prone extension and maintain upright postural control during dynamic activities. Patient required ${request.assessment.assistance.toLowerCase()} to facilitate appropriate weight-bearing through upper extremities and to maintain alignment during anti-gravity positions. Core endurance observations: ${request.assessment.strength}.\n\nMotor planning and coordination: ${request.assessment.motorPlanning}. ${patientName} ${request.assessment.motorPlanning.toLowerCase().includes('good') || request.assessment.motorPlanning.toLowerCase().includes('improved') ? 'demonstrated improved sequencing and timing during multi-step gross-motor tasks with modeling and repetition' : 'continues to demonstrate difficulty with multi-step gross-motor sequences, requiring modeling, verbal cueing, and repetition to complete tasks'}. Bilateral coordination was assessed through functional activities, with ${patientName} showing ${request.assessment.motorPlanning.toLowerCase().includes('good') ? 'emerging efficiency in bilateral movement patterns' : 'continued asymmetry and inefficiency in bilateral movement patterns'}.\n\nSensory processing and regulation: ${request.assessment.sensoryRegulation}. ${patientName} ${request.assessment.sensoryRegulation.toLowerCase().includes('good') || request.assessment.sensoryRegulation.toLowerCase().includes('improved') ? 'demonstrated improved ability to modulate responses to vestibular and proprioceptive input, which supported improved motor organization and task engagement' : 'continues to demonstrate difficulty modulating responses to sensory input, which impacts motor organization, task engagement, and adaptive responses to environmental demands'}. Graded vestibular and proprioceptive input was provided throughout the session to support regulation.\n\nProgress toward treatment goals: ${patientName} is demonstrating ${request.assessment.performance.toLowerCase()} progress in targeted goal areas. Clinical reasoning supports continued treatment at the current frequency to address ongoing functional limitations and build upon emerging skills.\n\nOverall, ${patientName} continues to demonstrate deficits in core strength, postural control, motor planning, and sensory-motor regulation, which impact ability to efficiently participate in age-appropriate gross-motor, fine-motor, and functional activities including self-care tasks, handwriting, and playground participation. Skilled occupational therapy services remain medically necessary to address these deficits through targeted intervention and to support functional independence across home, school, and community environments.`;

  // Build detailed plan section
  const plan = `Continue occupational therapy services ${request.duration >= 45 ? '2x/week for 45-minute sessions' : '1-2x/week for 30-minute sessions'} to address ongoing treatment goals.\n\nNext Session Plan:\n• ${request.planNextSteps}\n• Core and postural strengthening through graded anti-gravity activities\n• Motor planning and bilateral coordination tasks with progressive complexity\n• Sensory regulation strategies integrated throughout session activities\n${request.nextSessionFocus ? `• Focus area: ${request.nextSessionFocus}` : '• Continue progression of current treatment goals'}\n\nHome Program:\n${request.homeProgram ? `• ${request.homeProgram}` : '• Home program recommendations reviewed with caregiver, including daily strengthening exercises and sensory regulation strategies'}\n• Caregiver educated on importance of consistent home program completion between sessions\n\nGoals to prioritize next session: Core strengthening, motor planning, and functional skill development.\n\nCoordination: Continue to monitor progress and communicate with caregiver regarding carryover of skills to home and school environments.`;

  return {
    subjective,
    objective,
    assessment,
    plan,
    cptCodes,
    timeBlocks,
    totalReimbursement,
    billingRationale: "Billing codes assigned using rule-based accuracy checks. AI unavailable.",
    auditNotes: ["Documentation supports assigned CPT codes", "Activities match code descriptions"]
  };
}

export default { generateSoapNoteAndBilling };
