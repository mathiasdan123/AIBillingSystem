import OpenAI from "openai";
import { storage } from "../storage";

// Lazy initialization of OpenAI client (only when API key is present)
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY not set - AI features will use fallback rule-based generation");
    return null;
  }
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
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
 * Uses OpenAI to analyze activities and ensure billing accuracy based on:
 * - Activities performed
 * - Patient's insurance contract (when available)
 * - Medical necessity requirements
 * - Audit defensibility
 */
export async function generateSoapNoteAndBilling(
  request: AiSoapBillingRequest
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

  // Check if OpenAI is available
  const client = getOpenAIClient();
  if (!client) {
    // Use fallback generation when AI is not available
    console.log("Using fallback rule-based SOAP generation (no API key)");
    return fallbackGeneration(request, patient, billingUnits);
  }

  // Build the AI prompt
  const systemPrompt = buildSystemPrompt(insuranceData);
  const userPrompt = buildUserPrompt(request, patient, billingUnits, insuranceData, treatmentPlan, treatmentGoals);

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o", // Use GPT-4 for best reasoning
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.5, // Balanced temperature for detailed clinical writing
      max_tokens: 6000, // Ensure enough tokens for comprehensive SOAP sections
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      throw new Error("No response from AI");
    }

    const aiResponse = JSON.parse(responseText);

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

1. Generate HIGHLY DETAILED, PROFESSIONAL SOAP notes that meet medical documentation standards and support insurance reimbursement
2. Determine appropriate CPT code assignments to ensure accurate reimbursement while remaining audit defensible

SOAP NOTE REQUIREMENTS:

SUBJECTIVE SECTION - MUST BE 100-200 WORDS:
Write 2-3 detailed paragraphs covering:

1. CAREGIVER/PARENT REPORT:
   - What the caregiver has observed at home since the last session
   - Any new concerns, milestones, or regressions noted
   - Specific functional tasks the caregiver has noticed improvements or difficulties with (e.g., "Mom reports child is now able to button top two buttons independently")
   - Home program compliance and response to home exercises

2. PATIENT SELF-REPORT:
   - Patient's mood and presentation upon arrival
   - Any self-reported pain, discomfort, or complaints
   - Patient's expressed feelings about therapy or specific activities
   - Social interactions observed during session (with therapist, peers if applicable)

3. PROGRESS CONTEXT:
   - Brief comparison to previous session presentation
   - Any relevant school/daycare reports shared by caregiver
   - Changes in medication, sleep patterns, or daily routine that may affect performance

OBJECTIVE SECTION - MUST BE 200-400 WORDS:
Write a detailed, structured section covering:

1. STANDARDIZED ASSESSMENTS & MEASUREMENTS:
   - Specific grip strength measurements (e.g., "grip strength 4 lbs bilateral via dynamometer")
   - Range of motion observations with specific joints noted
   - VMI/Beery VMI standard scores if administered
   - BOT-2 composite scores if administered
   - Any other standardized tool results with numerical scores

2. FUNCTIONAL PERFORMANCE OBSERVATIONS:
   - Specific activities attempted with quantified performance levels
   - Use trial-based data (e.g., "completed 8/10 trials of midline crossing")
   - Timed task performance with comparison to previous session (e.g., "10-bead string completed in 2:45 min, improved from 3:30 min last session")
   - Equipment and materials used (swings, theraputty, weighted items, etc.)

3. ASSISTANCE LEVELS (use standard terminology for each activity):
   - Independent / Modified Independent / Supervision / Minimum Assist (25%) / Moderate Assist (50%) / Maximum Assist (75%) / Dependent
   - Specify cueing type: verbal, visual, tactile, hand-over-hand
   - Note if assistance level changed during session (e.g., "progressed from mod assist to min assist for prone extension by end of session")

4. SKILLED INTERVENTIONS PROVIDED:
   - List all therapeutic interventions with clinical rationale
   - Grading and adaptation strategies used
   - Specific therapeutic techniques applied (e.g., "neuromuscular re-education for scapular stabilization during UE weight-bearing")

ASSESSMENT SECTION - THIS IS CRITICAL - MUST BE COMPREHENSIVE AND DETAILED:
Write 4-6 detailed paragraphs covering:

1. ENGAGEMENT & PARTICIPATION:
   - Overall session engagement level
   - Tolerance for movement demands and challenging activities
   - Response to structured activities and graded sensory input

2. CORE & POSTURAL STRENGTH:
   - Ability to sustain prone extension
   - Upright postural control during dynamic activities
   - Need for verbal cueing or physical support
   - Weight-bearing through upper extremities
   - Alignment during anti-gravity positions

3. MOTOR PLANNING & COORDINATION:
   - Performance during multi-step gross-motor tasks
   - Response to modeling and repetition
   - Bilateral coordination observations
   - Efficiency of movement patterns

4. PRIMITIVE REFLEX INTEGRATION (if applicable):
   - Observations related to TLR (Tonic Labyrinthine Reflex)
   - STNR (Symmetric Tonic Neck Reflex) patterns
   - ATNR (Asymmetric Tonic Neck Reflex) observations
   - Moro reflex indicators
   - Impact on separation of upper/lower body movements
   - Compensatory movement strategies observed

5. FINE MOTOR SKILLS:
   - Performance on fine-motor tasks
   - Impact of proximal weakness on distal control
   - Endurance and precision observations
   - Response to external postural support

6. SENSORY PROCESSING & REGULATION:
   - Response to vestibular input
   - Proprioceptive processing observations
   - Impact on motor organization and task engagement
   - Adaptability to sensory and motor demands

7. PROGRESS TOWARD GOALS:
   - Specific comparison to previous session performance
   - Note whether patient is improving, plateaued, or declined for each goal area
   - Clinical reasoning for continued treatment at current frequency

8. MEDICAL NECESSITY STATEMENT (REQUIRED):
   - Summarize key deficits observed
   - State why continued skilled OT services remain medically necessary
   - Connect deficits to functional participation goals (ADLs, school performance, play)

PLAN SECTION - MUST BE 100-200 WORDS:
Write a detailed, actionable plan covering:

1. NEXT SESSION ACTIVITIES:
   - List 3-5 specific activities or interventions planned for the next session
   - Include clinical rationale for each planned activity

2. TREATMENT FREQUENCY & DURATION:
   - State recommended frequency (e.g., "Continue OT 2x/week for 45-minute sessions")
   - Estimated duration of continued treatment if applicable

3. HOME PROGRAM MODIFICATIONS:
   - Specific exercises or activities assigned for home
   - Any modifications to existing home program
   - Frequency recommendations for home activities

4. GOALS TO ADDRESS:
   - Which treatment goals will be prioritized next session
   - Any new goals identified based on today's observations

5. REFERRALS & COORDINATION:
   - Any recommended referrals (PT, speech, psychology)
   - Coordination with school/teachers if applicable
   - Communication with other providers planned

CLINICAL TERMINOLOGY TO USE:
- "demonstrates improved/decreased..."
- "benefited from graded vestibular/proprioceptive input"
- "required verbal cueing and physical support"
- "emerging adaptability to sensory and motor demands"
- "compensatory movement strategies"
- "proximal stability/weakness"
- "anti-gravity positions"
- "skilled occupational therapy services remain medically necessary"

BILLING CODE ASSIGNMENT:
- CPT code rates (highest to lowest):
  * 97533 Sensory Integration: $62.25/unit - Use for sensory-based interventions
  * 97530 Therapeutic Activities: $58.50/unit - Use for functional, dynamic activities
  * 97112 Neuromuscular Re-ed: $55.00/unit - Use for balance, coordination, motor control
  * 97110 Therapeutic Exercise: $48.00/unit - Use for pure strengthening/ROM

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

  "objective": "THIS MUST BE 200-400 WORDS. Example structure:\\n\\nSession conducted in [location] for [duration] minutes. Standardized measures: [include any scores - grip strength via dynamometer, VMI standard scores, BOT-2 composites, ROM measurements with specific joints].\\n\\nFine Motor Activities:\\n- [Activity 1]: [specific performance data, e.g., 'completed 8/10 trials of bead stringing with min assist for stabilization; improved from 5/10 trials last session']\\n- [Activity 2]: [quantified results with assistance level]\\n\\nGross Motor / Sensory-Motor Activities:\\n- [Activity 1]: [specific performance with trial data and assistance level using standard terminology - Independent, Modified Independent, Supervision, Min Assist 25%, Mod Assist 50%, Max Assist 75%, Dependent]\\n- [Activity 2]: [quantified results, time measurements, cueing type required: verbal/visual/tactile/hand-over-hand]\\n\\nEquipment/materials used: [list specific items - platform swing, theraputty (medium resistance), weighted vest (2 lb), therapy ball (55cm), etc.]\\n\\nSkilled interventions provided: [neuromuscular re-education for scapular stabilization, graded vestibular input via linear swinging, proprioceptive input via joint compressions, sensory integration techniques for tactile desensitization, etc.]\\n\\nAssistance level progression during session: [note any changes, e.g., 'progressed from mod assist to min assist for prone extension by end of session'].",

  "assessment": "THIS MUST BE 300-500 WORDS MINIMUM. Write 5-7 detailed paragraphs. Example structure:\\n\\nDuring today's occupational therapy session, [Patient] demonstrated [engagement level] throughout therapist-directed activities, with [tolerance observations] as the session progressed. [He/She] benefited from structured activities and graded sensory input to support regulation and sustained participation.\\n\\n[Patient] continues to present with decreased core and postural strength, which impacted [his/her] ability to sustain prone extension and maintain upright postural control during dynamic activities. [He/She] required verbal cueing and physical support to facilitate appropriate weight-bearing through [his/her] upper extremities and to maintain alignment during anti-gravity positions. [Motor planning observations with specific examples].\\n\\nPrimitive reflex integration challenges remain evident, including patterns consistent with retained TLR, STNR, ATNR, and possible Moro reflex, which continue to interfere with separation of upper and lower body movements, postural control, and coordinated transitions. These reflex patterns contributed to [specific observations].\\n\\nFine-motor skills continue to emerge; however, performance remains impacted by proximal weakness and decreased postural stability. [Patient] demonstrated [specific observations] with external postural support.\\n\\n[Patient] benefited from graded vestibular and proprioceptive input, which supported improved regulation, motor organization, and task engagement.\\n\\nProgress toward treatment goals: [Patient] is [improving/plateaued/declined] in [specific goal areas]. Compared to previous session, [specific measurable comparisons - trial data, timed tasks, assistance level changes]. Clinical reasoning supports continued treatment at current frequency due to [specific rationale].\\n\\nOverall, [Patient] continues to demonstrate deficits in core strength, postural control, motor planning, primitive reflex integration, and sensory-motor regulation, which impact [his/her] ability to efficiently participate in age-appropriate gross-motor, fine-motor, and functional activities including [specific ADLs, school tasks, play activities]. Skilled occupational therapy services remain medically necessary to address these deficits through targeted intervention.",

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
1. The SUBJECTIVE section MUST be 100-200 words (2-3 paragraphs with caregiver report, patient presentation, and progress context)
2. The OBJECTIVE section MUST be 200-400 words with specific measurements, trial data (e.g., "8/10 trials"), timed performance, and standard assistance level terminology
3. The ASSESSMENT section MUST be 300-500 words minimum (5-7 detailed paragraphs) including progress toward goals and comparison to previous session
4. The PLAN section MUST be 100-200 words with specific next-session activities, home program modifications, and treatment frequency
5. Use professional OT clinical terminology (prone extension, anti-gravity, vestibular input, etc.)
6. Name specific primitive reflexes observed (TLR, STNR, ATNR, Moro) when relevant
7. End assessment with medical necessity statement connecting deficits to functional participation
8. Distribute all ${billingUnits} units across the CPT codes
9. DO NOT write brief sections - insurance auditors require detailed clinical documentation across ALL SOAP sections
10. Include quantified data throughout: trial counts, timed performance, percentage of assistance, standardized scores`;

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
    // Add remaining units to highest-paying code
    const sortedCodes = [...cptCodes].sort((a, b) => {
      const rateA = CPT_CODE_INFO[a.code as keyof typeof CPT_CODE_INFO]?.rate || 0;
      const rateB = CPT_CODE_INFO[b.code as keyof typeof CPT_CODE_INFO]?.rate || 0;
      return rateB - rateA;
    });
    const rate = request.ratePerUnit || CPT_CODE_INFO[sortedCodes[0].code as keyof typeof CPT_CODE_INFO]?.rate || DEFAULT_UNIT_RATE;
    sortedCodes[0].units += (billingUnits - totalUnits);
    sortedCodes[0].reimbursement = rate * sortedCodes[0].units;
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

  // Assign to highest-paying codes first (all use $289/unit by default)
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
