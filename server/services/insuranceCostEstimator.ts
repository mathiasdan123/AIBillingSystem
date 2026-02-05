import OpenAI from "openai";
import { storage } from "../storage";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Your standard session rate
const STANDARD_SESSION_RATE = 300;

export interface InsuranceRateData {
  insuranceProvider: string;
  cptCode: string;
  inNetworkRate: number | null;
  outOfNetworkRate: number | null;
  deductibleApplies: boolean;
  coinsurancePercent: number;
  copayAmount: number | null;
}

export interface PatientCostEstimate {
  sessionRate: number;              // Your $300 charge
  cptCodes: Array<{
    code: string;
    description: string;
    units: number;
    billedAmount: number;
    expectedReimbursement: number;
    insuranceRate: number | null;
  }>;
  totalBilledAmount: number;        // What you bill insurance
  expectedInsurancePayment: number; // What insurance will pay
  patientResponsibility: number;    // What patient owes
  breakdown: {
    coinsurance: number;            // Patient's coinsurance portion
    copay: number;                  // Flat copay if applicable
    deductibleNote: string;         // Note about deductible
    balanceBilling: number;         // Difference between your rate and insurance payment
  };
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
}

export interface ContractParseResult {
  insuranceProvider: string;
  rates: Array<{
    cptCode: string;
    inNetworkRate: number | null;
    outOfNetworkRate: number | null;
    notes: string;
  }>;
  generalTerms: {
    deductibleApplies: boolean;
    typicalCoinsurance: number;
    copayAmount: number | null;
    priorAuthRequired: boolean;
    visitLimits: string | null;
  };
  parsingNotes: string[];
}

/**
 * Estimate patient out-of-pocket cost for a therapy session
 */
export async function estimatePatientCost(
  patientId: number,
  cptCodes: Array<{ code: string; units: number; description?: string }>,
  sessionRate: number = STANDARD_SESSION_RATE
): Promise<PatientCostEstimate> {

  // Get patient's insurance
  const patient = await storage.getPatient(patientId);
  if (!patient) {
    throw new Error("Patient not found");
  }

  const insuranceProvider = patient.insuranceProvider || "Unknown";
  const notes: string[] = [];
  let confidence: 'high' | 'medium' | 'low' = 'high';

  // Get CPT code info
  const allCptCodes = await storage.getCptCodes();

  // Calculate for each CPT code
  const codeEstimates = await Promise.all(
    cptCodes.map(async (code) => {
      const cptInfo = allCptCodes.find((c: any) => c.code === code.code);
      const baseRate = parseFloat(cptInfo?.baseRate || '289');
      const billedAmount = baseRate * code.units;

      // Get insurance rate for this code
      const insuranceRate = await storage.getInsuranceRateByCode(insuranceProvider, code.code);

      let expectedReimbursement = 0;
      let rateUsed: number | null = null;

      if (insuranceRate && insuranceRate.inNetworkRate) {
        rateUsed = parseFloat(insuranceRate.inNetworkRate.toString());
        expectedReimbursement = rateUsed * code.units;
      } else {
        // No specific rate found - estimate at 60% of billed
        expectedReimbursement = billedAmount * 0.6;
        confidence = 'medium';
        notes.push(`No specific rate found for ${code.code} - using 60% estimate`);
      }

      return {
        code: code.code,
        description: code.description || cptInfo?.description || '',
        units: code.units,
        billedAmount,
        expectedReimbursement,
        insuranceRate: rateUsed,
      };
    })
  );

  // Calculate totals
  const totalBilledAmount = codeEstimates.reduce((sum, c) => sum + c.billedAmount, 0);
  let expectedInsurancePayment = codeEstimates.reduce((sum, c) => sum + c.expectedReimbursement, 0);

  // Get default coinsurance/copay from first rate found
  const firstRate = await storage.getInsuranceRateByCode(insuranceProvider, cptCodes[0]?.code || '97110');
  const coinsurancePercent = firstRate?.coinsurancePercent
    ? parseFloat(firstRate.coinsurancePercent.toString())
    : 20;
  const copayAmount = firstRate?.copayAmount
    ? parseFloat(firstRate.copayAmount.toString())
    : 0;
  const deductibleApplies = firstRate?.deductibleApplies ?? true;

  // Calculate patient's coinsurance portion
  const coinsurance = expectedInsurancePayment * (coinsurancePercent / 100);

  // Adjust insurance payment for coinsurance
  expectedInsurancePayment = expectedInsurancePayment - coinsurance;

  // Calculate balance billing (difference between your rate and insurance allowed)
  const balanceBilling = Math.max(0, sessionRate - expectedInsurancePayment - coinsurance - copayAmount);

  // Total patient responsibility
  const patientResponsibility = coinsurance + copayAmount + balanceBilling;

  // Deductible note
  let deductibleNote = '';
  if (deductibleApplies) {
    deductibleNote = 'Deductible may apply if not yet met. Patient responsibility could be higher.';
    if (confidence === 'high') confidence = 'medium';
    notes.push('Deductible status unknown - estimate assumes deductible is met');
  } else {
    deductibleNote = 'Deductible does not typically apply to this service.';
  }

  return {
    sessionRate,
    cptCodes: codeEstimates,
    totalBilledAmount,
    expectedInsurancePayment,
    patientResponsibility: Math.max(0, Math.min(patientResponsibility, sessionRate)),
    breakdown: {
      coinsurance,
      copay: copayAmount,
      deductibleNote,
      balanceBilling,
    },
    confidence,
    notes,
  };
}

/**
 * Parse an insurance contract document to extract rates
 */
export async function parseInsuranceContract(
  contractText: string,
  insuranceProvider: string
): Promise<ContractParseResult> {

  const prompt = `You are an expert at parsing healthcare insurance contracts and fee schedules.

Analyze this insurance contract/fee schedule and extract the reimbursement rates for therapy CPT codes.

INSURANCE PROVIDER: ${insuranceProvider}

CONTRACT TEXT:
${contractText}

Extract the following information:
1. Reimbursement rates for each CPT code mentioned (especially 97110, 97112, 97140, 97530, 97533, 97535)
2. Whether deductible applies
3. Typical coinsurance percentage
4. Any copay amounts
5. Prior authorization requirements
6. Visit limits

RESPOND WITH THIS JSON STRUCTURE:
{
  "rates": [
    {
      "cptCode": "97110",
      "inNetworkRate": 85.50,
      "outOfNetworkRate": 60.00,
      "notes": "Per 15-minute unit"
    }
  ],
  "generalTerms": {
    "deductibleApplies": true,
    "typicalCoinsurance": 20,
    "copayAmount": null,
    "priorAuthRequired": false,
    "visitLimits": "30 visits per year"
  },
  "parsingNotes": ["Note about anything unclear or assumptions made"]
}

If a rate is not specified, use null. Be precise with the numbers found in the document.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an expert at parsing healthcare insurance contracts. Extract accurate rate information. Return only valid JSON."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    const parsed = JSON.parse(content);

    return {
      insuranceProvider,
      rates: parsed.rates || [],
      generalTerms: parsed.generalTerms || {
        deductibleApplies: true,
        typicalCoinsurance: 20,
        copayAmount: null,
        priorAuthRequired: false,
        visitLimits: null,
      },
      parsingNotes: parsed.parsingNotes || [],
    };

  } catch (error) {
    console.error("Contract parsing error:", error);
    return {
      insuranceProvider,
      rates: [],
      generalTerms: {
        deductibleApplies: true,
        typicalCoinsurance: 20,
        copayAmount: null,
        priorAuthRequired: false,
        visitLimits: null,
      },
      parsingNotes: ["Failed to parse contract - please enter rates manually"],
    };
  }
}

/**
 * Save parsed contract rates to the database
 */
export async function saveContractRates(
  parseResult: ContractParseResult
): Promise<{ saved: number; errors: string[] }> {
  const errors: string[] = [];
  let saved = 0;

  for (const rate of parseResult.rates) {
    try {
      await storage.upsertInsuranceRate({
        insuranceProvider: parseResult.insuranceProvider,
        cptCode: rate.cptCode,
        inNetworkRate: rate.inNetworkRate?.toString() || null,
        outOfNetworkRate: rate.outOfNetworkRate?.toString() || null,
        deductibleApplies: parseResult.generalTerms.deductibleApplies,
        coinsurancePercent: parseResult.generalTerms.typicalCoinsurance?.toString() || "20",
        copayAmount: parseResult.generalTerms.copayAmount?.toString() || null,
      });
      saved++;
    } catch (error) {
      errors.push(`Failed to save rate for ${rate.cptCode}: ${error}`);
    }
  }

  return { saved, errors };
}

/**
 * Get a quick estimate for a patient without detailed CPT codes
 * Uses average rates for the insurance
 */
export async function getQuickEstimate(
  insuranceProvider: string,
  sessionDurationMinutes: number = 45,
  sessionRate: number = STANDARD_SESSION_RATE
): Promise<{
  estimatedInsurancePayment: number;
  estimatedPatientResponsibility: number;
  confidence: 'high' | 'medium' | 'low';
  notes: string;
}> {

  // Get all rates for this insurance
  const rates = await storage.getInsuranceRates(insuranceProvider);

  if (rates.length === 0) {
    // No rates - use industry average (60% reimbursement)
    const estimatedPayment = sessionRate * 0.6;
    return {
      estimatedInsurancePayment: estimatedPayment,
      estimatedPatientResponsibility: sessionRate - estimatedPayment,
      confidence: 'low',
      notes: `No specific rates found for ${insuranceProvider}. Using industry average estimate.`,
    };
  }

  // Calculate average rate per 15-min unit
  const avgRate = rates.reduce((sum, r) => {
    return sum + (parseFloat(r.inNetworkRate?.toString() || '0') || 0);
  }, 0) / rates.length;

  // Estimate units based on duration
  const units = Math.floor(sessionDurationMinutes / 15);
  let estimatedPayment = avgRate * units;

  // Apply coinsurance (use first rate's coinsurance)
  const coinsurancePercent = parseFloat(rates[0]?.coinsurancePercent?.toString() || '20');
  const coinsurance = estimatedPayment * (coinsurancePercent / 100);
  estimatedPayment = estimatedPayment - coinsurance;

  // Calculate patient responsibility (including balance billing to reach session rate)
  const patientResponsibility = Math.max(0, sessionRate - estimatedPayment);

  return {
    estimatedInsurancePayment: Math.round(estimatedPayment * 100) / 100,
    estimatedPatientResponsibility: Math.round(patientResponsibility * 100) / 100,
    confidence: 'medium',
    notes: `Based on ${rates.length} rate(s) on file for ${insuranceProvider}. ${coinsurancePercent}% coinsurance applied.`,
  };
}
