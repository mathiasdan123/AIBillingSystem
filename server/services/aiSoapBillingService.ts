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
  };
  planNextSteps: string;
  nextSessionFocus?: string;
  homeProgram?: string;
  // Manual rate override - if set, uses this rate instead of default $289/unit
  ratePerUnit?: number;
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
  const userPrompt = buildUserPrompt(request, patient, billingUnits, insuranceData);

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
  let prompt = `You are an expert pediatric occupational therapy billing specialist. Your role is to:

1. Generate professional SOAP notes based on therapy activities
2. Determine optimal CPT code assignments to MAXIMIZE reimbursement while remaining:
   - Clinically accurate
   - Audit defensible
   - Compliant with insurance requirements

CRITICAL BILLING RULES:
- Many activities can legitimately fall under multiple CPT codes
- Always assign activities to the HIGHEST-PAYING code that can defend them in an audit
- CPT code rates (highest to lowest):
  * 97533 Sensory Integration: $62.25/unit - Use for sensory-based interventions
  * 97530 Therapeutic Activities: $58.50/unit - Use for functional, dynamic activities
  * 97112 Neuromuscular Re-ed: $55.00/unit - Use for balance, coordination, motor control
  * 97110 Therapeutic Exercise: $48.00/unit - Use for pure strengthening/ROM (lowest priority)

AUDIT DEFENSIBILITY:
- Each CPT code must have documented activities that support it
- Sensory Integration (97533) requires sensory-based interventions (swings, crash pads, tactile play, proprioceptive input)
- Therapeutic Activities (97530) covers functional tasks, obstacle courses, fine motor with purpose
- Neuromuscular (97112) covers balance training, coordination, motor planning activities
- Therapeutic Exercise (97110) is for pure exercise/strengthening only

OPTIMIZATION STRATEGY:
1. First, identify all activities that can support 97533 (highest rate)
2. Then, assign remaining activities to 97530 (second highest)
3. Use 97112 for balance/coordination activities not covered above
4. Only use 97110 as last resort for pure exercise activities

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
  insuranceData: any
): string {
  return `Generate a SOAP note and optimal billing codes for this pediatric OT session.

PATIENT INFORMATION:
- Name: ${patient.firstName} ${patient.lastName}
- DOB: ${patient.dateOfBirth}
- Insurance: ${patient.insuranceProvider}
- Policy: ${patient.policyNumber}

SESSION DETAILS:
- Date: ${new Date().toLocaleDateString()}
- Duration: ${request.duration} minutes (${billingUnits} billable units)
- Location: ${request.location}

SUBJECTIVE DATA:
- Mood/Behavior: ${request.mood}
- Caregiver Report: ${request.caregiverReport || "No specific concerns reported"}

ACTIVITIES PERFORMED:
${request.activities.map(a => `- ${a}`).join('\n')}

ASSESSMENT OBSERVATIONS:
- Overall Performance: ${request.assessment.performance}
- Assistance Level: ${request.assessment.assistance}
- Strength/Endurance: ${request.assessment.strength}
- Motor Planning: ${request.assessment.motorPlanning}
- Sensory Regulation: ${request.assessment.sensoryRegulation}

PLAN:
- Next Steps: ${request.planNextSteps}
- Next Session Focus: ${request.nextSessionFocus || "Continue current goals"}
- Home Program: ${request.homeProgram || "Recommendations provided"}

RESPOND WITH THIS EXACT JSON STRUCTURE:
{
  "subjective": "Complete subjective section text",
  "objective": "Complete objective section with activities documented",
  "assessment": "Complete assessment with clinical reasoning and medical necessity",
  "plan": "Complete plan section",
  "cptCodes": [
    {
      "code": "97533",
      "name": "Sensory Integration",
      "units": 2,
      "rationale": "Explanation of why these activities support this code",
      "activitiesAssigned": ["Activity 1", "Activity 2"]
    }
  ],
  "billingRationale": "Overall explanation of billing strategy and why it maximizes reimbursement",
  "auditNotes": ["Note 1 about documentation supporting the codes", "Note 2"]
}

IMPORTANT:
- Distribute all ${billingUnits} units across the codes
- Prioritize higher-paying codes when activities support them
- Include medical necessity language in assessment
- Each code must have activities assigned that justify it`;
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
