import Anthropic from "@anthropic-ai/sdk";
import { transcribeAudioBase64 } from "./voiceService";
import { optimizeBillingCodes } from "./aiBillingOptimizer";

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set - session recording AI disabled');
    return null;
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

export interface SessionRecordingData {
  audioBase64: string;
  mimeType: string;
  patientId: number;
  patientName: string;
  therapistName: string;
  sessionDuration: number; // in minutes
  insuranceName?: string;
  diagnosis?: string;
  sessionType?: string; // e.g., "occupational therapy", "physical therapy"
}

export interface ExtractedSessionData {
  transcription: string;
  soapNote: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  };
  interventions: string[];
  patientMood: string;
  progressNotes: string;
  homeProgram: string;
  billingRecommendation?: {
    lineItems: Array<{
      cptCode: string;
      description: string;
      units: number;
      reasoning: string;
    }>;
    totalUnits: number;
    estimatedAmount: number;
    complianceScore: number;
    notes: string;
  };
}

/**
 * Process a recorded therapy session:
 * 1. Transcribe the audio
 * 2. Extract SOAP note components from the conversation
 * 3. Generate billing recommendations
 */
export async function processSessionRecording(
  data: SessionRecordingData
): Promise<ExtractedSessionData> {

  // Step 1: Transcribe the audio
  console.log("Transcribing session recording...");
  const transcriptionResult = await transcribeAudioBase64(
    data.audioBase64,
    data.mimeType
  );

  if (!transcriptionResult.success) {
    throw new Error(`Transcription failed: ${transcriptionResult.error}`);
  }

  const transcription = transcriptionResult.text;
  console.log(`Transcription complete: ${transcription.length} characters`);

  // Step 2: Extract SOAP note from transcription using AI
  console.log("Extracting SOAP note from transcription...");
  const extractedData = await extractSoapFromTranscription(
    transcription,
    data
  );

  return extractedData;
}

/**
 * Extract structured SOAP note data from a therapy session transcription
 */
async function extractSoapFromTranscription(
  transcription: string,
  sessionData: SessionRecordingData
): Promise<ExtractedSessionData> {

  const prompt = `You are an expert therapy documentation specialist. Analyze this therapy session transcription and extract a complete SOAP note.

SESSION INFORMATION:
- Patient: ${sessionData.patientName}
- Therapist: ${sessionData.therapistName}
- Duration: ${sessionData.sessionDuration} minutes
- Session Type: ${sessionData.sessionType || "Therapy session"}
${sessionData.diagnosis ? `- Diagnosis: ${sessionData.diagnosis}` : ""}

TRANSCRIPTION:
${transcription}

Extract the following from the conversation. Listen for:
- Patient/caregiver reports about symptoms, concerns, progress (Subjective)
- Therapist observations, activities performed, patient responses (Objective)
- Clinical reasoning, progress toward goals, functional improvements (Assessment)
- Next steps, home program, future session plans (Plan)

RESPOND WITH THIS EXACT JSON STRUCTURE:
{
  "soapNote": {
    "subjective": "Patient/caregiver reports... Include any complaints, concerns, or progress reports mentioned. If the patient is a child, include caregiver observations.",
    "objective": "Detailed documentation of activities performed, duration, patient response, assistance levels, and measurable observations. Be specific about what interventions were provided.",
    "assessment": "Clinical interpretation of the session. Include progress toward goals, functional improvements or barriers, and medical necessity justification.",
    "plan": "Treatment plan including frequency, next session focus, home program recommendations, and any follow-up needed."
  },
  "interventions": ["List", "of", "specific", "interventions", "performed"],
  "patientMood": "Brief description of patient's mood/affect during session",
  "progressNotes": "Summary of progress observed this session",
  "homeProgram": "Home exercise/activity recommendations given"
}

IMPORTANT DOCUMENTATION GUIDELINES:
- Use professional clinical terminology
- Be specific and measurable where possible
- Include assistance levels (independent, minimal, moderate, maximum)
- Document any safety concerns or precautions
- Ensure medical necessity is evident
- If information is not mentioned in the transcription, make reasonable clinical inferences based on the session type and activities`;

  try {
    const client = getAnthropic();
    if (!client) {
      throw new Error("Anthropic not configured");
    }
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      temperature: 0.3,
      system:
        "You are an expert therapy documentation specialist. Extract accurate clinical documentation from therapy session transcriptions. Respond with ONLY a valid JSON object, no markdown fencing or commentary.",
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const content = textBlock?.text;
    if (!content) {
      throw new Error("No response from AI");
    }

    const jsonMatch =
      content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content;
    const extracted = JSON.parse(jsonStr);

    // Now get billing recommendations based on the extracted data
    let billingRecommendation = undefined;

    try {
      // Get CPT codes from storage (we'll pass this from the route)
      // For now, use a simplified approach
      const billingResult = await generateBillingFromSOAP(
        extracted.soapNote,
        extracted.interventions,
        sessionData.sessionDuration,
        sessionData.insuranceName || "Unknown"
      );
      billingRecommendation = billingResult;
    } catch (billingError) {
      console.error("Billing accuracy review error:", billingError);
    }

    return {
      transcription,
      soapNote: extracted.soapNote,
      interventions: extracted.interventions || [],
      patientMood: extracted.patientMood || "Cooperative",
      progressNotes: extracted.progressNotes || "",
      homeProgram: extracted.homeProgram || "",
      billingRecommendation
    };

  } catch (error) {
    console.error("SOAP extraction error:", error);

    // Return basic structure with transcription
    return {
      transcription,
      soapNote: {
        subjective: "See transcription for patient/caregiver reports.",
        objective: `${sessionData.sessionDuration}-minute therapy session conducted. See transcription for activities performed.`,
        assessment: "Session completed. Review transcription for clinical details.",
        plan: "Continue plan of care as established."
      },
      interventions: [],
      patientMood: "Not documented",
      progressNotes: "Review transcription",
      homeProgram: ""
    };
  }
}

/**
 * Generate billing recommendations from SOAP note content
 */
async function generateBillingFromSOAP(
  soapNote: { subjective: string; objective: string; assessment: string; plan: string },
  interventions: string[],
  duration: number,
  insuranceName: string
): Promise<{
  lineItems: Array<{
    cptCode: string;
    description: string;
    units: number;
    reasoning: string;
  }>;
  totalUnits: number;
  estimatedAmount: number;
  complianceScore: number;
  notes: string;
}> {

  const prompt = `You are a medical billing expert. Based on this therapy SOAP note, recommend optimal CPT codes.

SESSION DURATION: ${duration} minutes (${Math.floor(duration / 15)} billable 15-minute units)
INSURANCE: ${insuranceName}

SOAP NOTE:
Subjective: ${soapNote.subjective}
Objective: ${soapNote.objective}
Assessment: ${soapNote.assessment}
Plan: ${soapNote.plan}

INTERVENTIONS PERFORMED:
${interventions.map(i => `- ${i}`).join('\n')}

Common therapy CPT codes:
- 97110: Therapeutic exercises (strength, ROM, flexibility)
- 97112: Neuromuscular reeducation (balance, coordination, posture)
- 97140: Manual therapy (mobilization, manipulation)
- 97530: Therapeutic activities (functional tasks)
- 97533: Sensory integration techniques
- 97535: Self-care/home management training
- 97542: Wheelchair management training
- 97150: Therapeutic procedure, group

Select the most appropriate codes based on the documented interventions. Each code should reflect distinct services provided.

RESPOND WITH JSON:
{
  "lineItems": [
    {
      "cptCode": "97110",
      "description": "Therapeutic exercises",
      "units": 1,
      "reasoning": "Why this code applies"
    }
  ],
  "totalUnits": 4,
  "estimatedAmount": 1156.00,
  "complianceScore": 95,
  "notes": "Overall billing strategy explanation"
}`;

  const client = getAnthropic();
  if (!client) {
    throw new Error("Anthropic not configured");
  }
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    temperature: 0.3,
    system:
      "You are a medical billing compliance expert. Recommend accurate, defensible billing codes. Return ONLY a valid JSON object with no markdown fencing or commentary.",
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  const content = textBlock?.text;
  if (!content) {
    throw new Error("No billing response");
  }

  const jsonMatch =
    content.match(/```json\n?([\s\S]*?)\n?```/) || content.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content;
  return JSON.parse(jsonStr);
}

/**
 * Process transcription text directly (for manual paste or re-processing)
 */
export async function processTranscriptionText(
  transcription: string,
  sessionData: Omit<SessionRecordingData, 'audioBase64' | 'mimeType'>
): Promise<ExtractedSessionData> {
  return extractSoapFromTranscription(transcription, sessionData as SessionRecordingData);
}
