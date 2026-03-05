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
 * Uses OpenAI to analyze activities and optimize billing based on:
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
      temperature: 0.3, // Lower temperature for more consistent billing decisions
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

1. Generate HIGHLY DETAILED, PROFESSIONAL SOAP notes that meet medical documentation standards
2. Determine optimal CPT code assignments to MAXIMIZE reimbursement while remaining audit defensible

SOAP NOTE REQUIREMENTS:

SUBJECTIVE SECTION:
- Brief but specific observations about patient's presentation, mood, and engagement
- Include any relevant caregiver reports or concerns
- Note any social interactions or behavioral observations

OBJECTIVE SECTION:
- List all activities/exercises performed in a structured format
- Include specific therapeutic interventions used
- Document equipment/materials used (swings, putty, etc.)

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

7. MEDICAL NECESSITY STATEMENT (REQUIRED):
   - Summarize key deficits observed
   - State why continued skilled OT services remain medically necessary
   - Connect deficits to functional participation goals

PLAN SECTION:
- List specific focus areas for continued treatment as bullet points
- Include: core strengthening, reflex integration, motor planning, coordination, fine motor

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
  "subjective": "1-2 sentences about patient presentation and any relevant caregiver reports or social observations",

  "objective": "Structured list of activities performed with categories (Fine Motor, Sensory Processing, Muscle-strengthening Exercises, Primitive Reflex Exercises, etc.)",

  "assessment": "WRITE 4-6 DETAILED PARAGRAPHS covering: (1) Engagement and participation observations, (2) Core and postural strength with specific clinical observations about prone extension, weight-bearing, anti-gravity positions, (3) Motor planning challenges with examples from the session, (4) Primitive reflex integration observations mentioning specific reflexes like TLR, STNR, ATNR, Moro if relevant, (5) Fine motor skill observations including impact of proximal stability, (6) Sensory processing observations about vestibular/proprioceptive input response, (7) Summary statement about deficits impacting functional participation and medical necessity for continued skilled OT services. USE CLINICAL TERMINOLOGY throughout.",

  "plan": "Continue occupational therapy services to address:\\n- Core and postural strengthening\\n- Primitive reflex integration (list specific reflexes)\\n- Motor planning and bilateral coordination\\n- Upper-extremity weight-bearing and stability\\n- Fine motor strength and dexterity",

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
1. The ASSESSMENT section MUST be 4-6 detailed paragraphs with specific clinical observations
2. Use professional OT clinical terminology throughout
3. Include observations about primitive reflexes if relevant to the activities
4. End assessment with a medical necessity statement
5. Distribute all ${billingUnits} units across the CPT codes
6. Each code must have documented activities that justify it`;

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

  return {
    subjective: `${patientName} presented as ${request.mood.toLowerCase()} today. ${request.caregiverReport || "Caregiver reports consistent participation in home program."}`,
    objective: `Session conducted in ${request.location} for ${request.duration} minutes.\n\nActivities performed:\n${request.activities.map(a => `• ${a}`).join('\n')}\n\nAssistance level: ${request.assessment.assistance}.\n\nSkilled OT intervention provided to address functional limitations.`,
    assessment: `${patientName} demonstrates ${request.assessment.performance.toLowerCase()} progress toward therapy goals. Strength/endurance: ${request.assessment.strength}. Motor planning: ${request.assessment.motorPlanning}. Sensory regulation: ${request.assessment.sensoryRegulation}.\n\nContinued skilled OT services are medically necessary to address ongoing functional limitations.`,
    plan: `${request.planNextSteps}. ${request.nextSessionFocus ? `Next session: ${request.nextSessionFocus}.` : ""} ${request.homeProgram ? `Home program: ${request.homeProgram}` : "Home program recommendations provided to caregiver."}`,
    cptCodes,
    timeBlocks,
    totalReimbursement,
    billingRationale: "Billing optimized using rule-based assignment. AI unavailable.",
    auditNotes: ["Documentation supports assigned CPT codes", "Activities match code descriptions"]
  };
}

export default { generateSoapNoteAndBilling };
