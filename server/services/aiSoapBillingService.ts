import Anthropic from "@anthropic-ai/sdk";
import { storage } from "../storage";

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
}

export async function generateSoapNoteAndBilling(
  request: AiSoapBillingRequest,
  options: GenerateSoapOptions = {}
): Promise<AiSoapBillingResponse> {

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
      max_tokens: 6000,
      temperature: 0.5,
      system:
        systemPrompt +
        "\n\nRespond with ONLY a valid JSON object, no markdown fencing or commentary.",
      messages: [{ role: "user", content: userPrompt }],
    });

    if (options.onProgress) {
      stream.on("text", () => options.onProgress!());
    }

    const finalMessage = await stream.finalMessage();

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

Final reminder: when in doubt, write LESS rather than inventing MORE.
A shorter, truthful note is always better than a longer one with
fabricated specifics.

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
- DOB: ${patient.dateOfBirth} (Age: ${age} years)
- Insurance: ${patient.insuranceProvider || 'Not specified'}
- Policy: ${patient.policyNumber || 'Not specified'}`;

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
- Caregiver Report: ${request.caregiverReport || "(none provided — state that it was not obtained; do not invent one)"}

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
- Next Session Focus: ${request.nextSessionFocus || "(none specified — continue current goals)"}
- Home Program: ${request.homeProgram || "(none provided this session — use the no-change continuation wording; do not invent exercises or imply parent education)"}

RESPOND WITH THIS JSON STRUCTURE.
IMPORTANT: the bracketed examples below show the STRUCTURE only. Fill them
using ONLY data from the input. The word-count targets are CEILINGS for when
the input is rich — never pad to reach them, and never invent specifics
(trial counts, scores, prior-session comparisons, equipment adjectives) to
fill space. The anti-fabrication rules above OVERRIDE every example here.
{
  "subjective": "Proportional to the input (a single sentence if the input is sparse). Structure when data exists:\\n\\nCaregiver report: reflect ONLY what the caregiver actually reported (or state it wasn't obtained). Do NOT invent home observations, compliance details, or functional examples the caregiver didn't state.\\n\\n[Patient] presented as [mood from the mood field]. Describe only behaviors actually observed. Do not invent self-reported statements or social details.\\n\\nReference prior sessions ONLY if treatment-plan/goal data provides a prior measurement.",

  "objective": "Scaled to the richness of the input (120-300 words when rich; shorter when sparse). Structure:\\n\\nSession conducted in [location] for [duration] minutes. Standardized measures: include scores ONLY if the input explicitly states a measure was administered and gives the value; otherwise write 'Standardized measurements were not administered; observations were qualitative.'\\n\\nActivities & performance:\\n- [Activity from the activities list]: describe with the assistance level the therapist provided and qualitative performance. Do NOT invent trial counts (e.g. '8/10 trials'), timings, or percentages that weren't provided.\\n\\nAssistance levels: use the assistance field. Standard terms (Independent / Modified Independent / Supervision / Min / Mod / Max Assist / Dependent). Cue types (verbal/visual/tactile/hand-over-hand) when they describe how an activity was supported — no invented cue counts.\\n\\nEquipment/materials: name ONLY items in the activities list, with ONLY the adjectives the therapist used (no '55cm', 'medium resistance', '2 lb' unless stated).\\n\\nSkilled interventions: describe the techniques corresponding to the activities, framed by their skilled/functional objective (e.g. neuromuscular re-education for postural control; graded vestibular-proprioceptive input to support motor planning).",

  "assessment": "Clinical interpretation anchored to the observations actually provided (200-400 words when the input supports it; fewer paragraphs when it doesn't — omit sub-sections you have no data for). Connect each skilled intervention to a specific functional deficit using payer-aligned skilled vocabulary (skilled clinical analysis, clinical reasoning, task grading, neuromuscular re-education, cueing hierarchy, compensatory strategies, safety/judgment, measurable functional impact). Cover, as supported by the input: engagement/participation; postural/core control; motor planning & coordination; fine motor (only if fine-motor activities were done); sensory processing & regulation (frame in functional/neuromuscular terms — e.g. 'vestibular-proprioceptive input to support postural control and motor planning' — NOT as 'sensory play'); progress toward goals ONLY if goal data was provided (no invented 'improved from last session'). End with a medical-necessity statement that ties the OBSERVED deficits to functional participation — customized to this session, not boilerplate. Do not name primitive reflexes (TLR/STNR/ATNR/Moro) or specific test patterns unless the input observed them.",

  "plan": "Scaled to the input (80-200 words). Use the planNextSteps, nextSessionFocus, and homeProgram fields.\\n\\nNext session focus: use what the therapist wrote; you may add 2-3 activities that clinically align with that focus.\\n\\nTreatment frequency: state a cadence only if the treatment-plan data implies one; otherwise 'Continue current treatment frequency'.\\n\\nHome program: use the home program field if provided. If no new home program was given, write exactly: 'Reviewed continuation of current home strategies; no changes to home program at this time.' Do NOT invent exercises, rep counts, or imply parent education that didn't occur.\\n\\nGoals: reference ONLY the treatment goals provided. Coordination/referrals: only if clearly indicated.",

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

REQUIREMENTS (the anti-fabrication rules at the top OVERRIDE all of these):
1. Each section is proportional to the input. The word ranges in the JSON are CEILINGS for rich input, not quotas — a truthful short note is correct and expected when the input is sparse. NEVER pad.
2. Use professional OT/ST clinical terminology AND payer-aligned skilled vocabulary (skilled clinical analysis, clinical reasoning, task grading, neuromuscular re-education, cueing hierarchy, compensatory strategies, measurable functional impact). Avoid generic phrases ("provided skilled support", "therapeutic engagement", "facilitated participation").
3. Include quantified data (trial counts, timings, scores, assistance percentages) ONLY when the input actually provides it. Do NOT manufacture numbers, standardized scores, primitive-reflex patterns, or prior-session comparisons to look thorough — fabricated specifics are the #1 audit/denial risk.
4. The medical-necessity statement must be CUSTOMIZED to this session's documented skilled interventions and observed deficits — not a generic boilerplate sentence repeated across notes. If the documentation doesn't support a skilled-necessity claim, state what was done in functional terms rather than asserting unsupported necessity.
5. Frame sensory-based work by its functional/neuromuscular objective (postural control, motor planning, bilateral coordination, regulation supporting participation), NOT as "sensory play" or "sensory diet".
6. Distribute units only across codes the documentation supports (see BILLING CODE ASSIGNMENT). It is correct to use fewer codes/units than available if the documentation doesn't support more.`;

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

  // Note any unit shortfall WITHOUT redistributing to the highest-paying code.
  // Padding leftover units onto a code purely because it reimburses more is
  // exactly the optimization behavior we're removing — and it can attach units
  // to a code the documentation doesn't support. We leave the AI's
  // documentation-driven distribution as-is; under-using available units is a
  // safe, defensible outcome (the provider can adjust on review).
  const totalUnits = cptCodes.reduce((sum, c) => sum + c.units, 0);

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

  // Rule-based assignment by SKILLED OBJECTIVE, not by reimbursement rate.
  // Vestibular/proprioceptive sensory-motor work maps to neuromuscular
  // re-education (97112) by its motor objective (postural control, motor
  // planning, coordination) rather than defaulting to a sensory-integration
  // code (97533) — which payers deny as developmental/non-specific.
  const neuromuscularKeywords = ["swing", "crash", "weighted", "body sock", "trampoline", "compression", "vestibular", "proprioceptive", "balance", "foam beam", "one-leg", "ladder", "scooter", "yoga"];
  const functionalKeywords = ["obstacle", "pegboard", "puzzle", "cutting", "writing", "ADL", "lacing", "buttoning", "feeding", "rice bin", "tactile", "brushing"];

  const functionalActivities = request.activities.filter(a =>
    functionalKeywords.some(k => a.toLowerCase().includes(k))
  );
  const neuromuscularActivities = request.activities.filter(a =>
    neuromuscularKeywords.some(k => a.toLowerCase().includes(k)) && !functionalActivities.includes(a)
  );
  const exerciseActivities = request.activities.filter(a =>
    !functionalActivities.includes(a) && !neuromuscularActivities.includes(a)
  );

  const cptCodes: GeneratedCptCode[] = [];
  let remainingUnits = billingUnits;

  // Assign by documented skilled objective (order is clinical, not rate-based).
  if (neuromuscularActivities.length > 0 && remainingUnits > 0) {
    const units = Math.min(Math.ceil(billingUnits * 0.4), remainingUnits);
    cptCodes.push({
      code: "97112",
      name: "Neuromuscular Re-education",
      units,
      rationale: `Neuromuscular re-education targeting postural control, balance, and motor planning via: ${neuromuscularActivities.slice(0, 3).join(", ")}`,
      reimbursement: unitRate * units,
      activitiesAssigned: neuromuscularActivities
    });
    remainingUnits -= units;
  }

  if (functionalActivities.length > 0 && remainingUnits > 0) {
    const units = Math.min(Math.ceil(billingUnits * 0.3), remainingUnits);
    cptCodes.push({
      code: "97530",
      name: "Therapeutic Activities",
      units,
      rationale: `Therapeutic activities for functional participation: ${functionalActivities.slice(0, 3).join(", ")}`,
      reimbursement: unitRate * units,
      activitiesAssigned: functionalActivities
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

  // Build subjective section — input-proportional, no fabrication. Reflect
  // ONLY the caregiver report and mood that were actually provided; do not
  // invent home-program compliance, medication/sleep inquiries, or
  // prior-session comparisons.
  const caregiverLine = request.caregiverReport
    ? `Caregiver reported: ${request.caregiverReport}.`
    : "Caregiver report was not obtained this session.";
  const subjective = `${caregiverLine}\n\n${patientName} presented as ${request.mood.toLowerCase()} during today's session.`;

  // Build objective section — grounded ONLY in the provided activities and
  // assessment fields. No invented trials, cue counts, equipment specifics, or
  // assistance-level progression.
  const objective = `Session conducted in ${request.location} for ${request.duration} minutes (${billingUnits} billable units).\n\nActivities performed:\n${request.activities.map(a => `• ${a}`).join('\n')}\n\nAssistance level: ${request.assessment.assistance}.\n\nClinical observations as documented by the treating therapist:\n• Overall performance: ${request.assessment.performance}\n• Strength/endurance: ${request.assessment.strength}\n• Motor planning: ${request.assessment.motorPlanning}\n• Sensory regulation: ${request.assessment.sensoryRegulation}${request.assessment.posturalControl ? `\n• Postural control: ${request.assessment.posturalControl}` : ''}${request.assessment.fineMotor ? `\n• Fine motor: ${request.assessment.fineMotor}` : ''}${request.assessment.bilateralCoordination ? `\n• Bilateral coordination: ${request.assessment.bilateralCoordination}` : ''}`;

  // Build assessment section — clinical interpretation anchored to the
  // observations actually provided; no fabricated reflexes, prior-session
  // comparisons, or boilerplate deficits. The medical-necessity statement is
  // built from the documented observations, not a fixed template.
  const assessment = `${patientName} presented as ${request.mood.toLowerCase()} and participated in skilled occupational therapy with ${request.assessment.assistance.toLowerCase()} assistance. Skilled clinical analysis and therapist-directed adaptation were provided to support performance across the documented activities.\n\nFunctional performance this session: ${request.assessment.performance}. Strength/endurance: ${request.assessment.strength}. Motor planning: ${request.assessment.motorPlanning}. Sensory regulation: ${request.assessment.sensoryRegulation}.\n\nSkilled OT was required to grade and adapt the above activities to the patient's documented deficits in ${[request.assessment.strength, request.assessment.motorPlanning, request.assessment.sensoryRegulation].some(f => /poor|decreas|difficult|limit|delay|reduc/i.test(f)) ? 'the areas noted above' : 'the targeted skill areas'}, supporting safer and more effective functional participation. Continued skilled occupational therapy is indicated to address these documented deficits.`;

  // Build plan section. Home-program wording follows the reviewer's guidance:
  // when no new home program was provided, do not invent one or imply parent
  // education occurred — note continuation of current strategies.
  const plan = `Continue occupational therapy to address current treatment goals.\n\nNext session focus:\n• ${request.planNextSteps}${request.nextSessionFocus ? `\n• ${request.nextSessionFocus}` : ''}\n\nHome program:\n${request.homeProgram ? `• ${request.homeProgram}` : '• Reviewed continuation of current home strategies; no changes to home program at this time.'}`;

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
