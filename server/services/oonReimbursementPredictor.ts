// Out-of-Network Reimbursement Predictor
// MVP implementation using Medicare rates and payer-specific multipliers
// Similar to Sheer Health's prediction model

export interface OONPredictionInput {
  cptCode: string;
  insuranceProvider: string;
  zipCode: string;
  billedAmount: number;
  planType?: 'PPO' | 'HMO' | 'EPO' | 'POS' | 'HDHP' | 'unknown';
  deductibleMet?: boolean;
  deductibleRemaining?: number;
  coinsuranceOverride?: number; // If known from eligibility check
  providerCredential?: string; // PhD, LCSW, LMFT, etc.
}

export interface OONPrediction {
  estimatedAllowedAmount: number;
  estimatedReimbursement: number;
  estimatedPatientResponsibility: number;
  balanceBillAmount: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  methodology: 'medicare_multiplier' | 'ucr_estimate' | 'historical_data' | 'payer_specific';
  dataPoints: number;
  range: {
    low: number;
    high: number;
  };
  breakdown: {
    medicareRate: number;
    multiplierUsed: number;
    coinsurancePercent: number;
    deductibleApplied: number;
  };
  recommendations: string[];
}

// 2024/2025 Medicare Physician Fee Schedule rates for mental health CPT codes
// Source: CMS Medicare Physician Fee Schedule (national average, non-facility)
const MEDICARE_RATES: Record<string, number> = {
  // Mental Health Therapy Codes
  '90832': 68.00,   // Psychotherapy, 30 minutes
  '90834': 101.00,  // Psychotherapy, 45 minutes (most common)
  '90837': 134.00,  // Psychotherapy, 60 minutes
  '90839': 155.00,  // Psychotherapy for crisis, first 60 minutes
  '90840': 75.00,   // Psychotherapy for crisis, each additional 30 minutes
  '90846': 105.00,  // Family psychotherapy without patient
  '90847': 108.00,  // Family psychotherapy with patient
  '90853': 32.00,   // Group psychotherapy

  // Psychiatric Evaluation
  '90791': 175.00,  // Psychiatric diagnostic evaluation
  '90792': 195.00,  // Psychiatric diagnostic evaluation with medical services

  // E/M with Psychotherapy Add-ons
  '90833': 55.00,   // Psychotherapy add-on, 30 minutes (with E/M)
  '90836': 85.00,   // Psychotherapy add-on, 45 minutes (with E/M)
  '90838': 110.00,  // Psychotherapy add-on, 60 minutes (with E/M)

  // Health & Behavior Codes (often used in therapy)
  '96156': 48.00,   // Health behavior assessment
  '96158': 48.00,   // Health behavior intervention, first 30 min
  '96159': 24.00,   // Health behavior intervention, each additional 15 min

  // Psychological Testing
  '96130': 120.00,  // Psychological testing evaluation, first hour
  '96131': 95.00,   // Psychological testing evaluation, additional hour
  '96136': 65.00,   // Psychological test administration, first 30 min
  '96137': 55.00,   // Psychological test administration, additional 30 min

  // Occupational Therapy Codes (for OT practices)
  '97165': 145.00,  // OT evaluation, low complexity
  '97166': 195.00,  // OT evaluation, moderate complexity
  '97167': 260.00,  // OT evaluation, high complexity
  '97168': 85.00,   // OT re-evaluation
  '97110': 38.00,   // Therapeutic exercises (per 15 min)
  '97112': 42.00,   // Neuromuscular re-education (per 15 min)
  '97116': 35.00,   // Gait training (per 15 min)
  '97140': 40.00,   // Manual therapy (per 15 min)
  '97530': 45.00,   // Therapeutic activities (per 15 min)
  '97535': 42.00,   // Self-care/home management training (per 15 min)
  '97542': 35.00,   // Wheelchair management training (per 15 min)
  '97750': 38.00,   // Physical performance test (per 15 min)

  // Speech Therapy Codes
  '92521': 95.00,   // Evaluation of speech fluency
  '92522': 95.00,   // Evaluation of speech sound production
  '92523': 175.00,  // Evaluation of speech sound production with language
  '92524': 85.00,   // Behavioral/qualitative analysis of voice
  '92507': 45.00,   // Speech/language treatment (per 15 min)
};

// Payer-specific multipliers based on research
// These represent typical OON allowed amounts as a multiple of Medicare
interface PayerConfig {
  multiplier: { low: number; mid: number; high: number };
  typicalCoinsurance: number;
  typicalDeductible: number;
  notes: string;
}

const PAYER_CONFIGS: Record<string, PayerConfig> = {
  'aetna': {
    multiplier: { low: 1.3, mid: 1.5, high: 1.8 },
    typicalCoinsurance: 30,
    typicalDeductible: 2000,
    notes: 'Uses UCR-based methodology, moderate OON coverage'
  },
  'anthem': {
    multiplier: { low: 1.4, mid: 1.6, high: 1.9 },
    typicalCoinsurance: 30,
    typicalDeductible: 2500,
    notes: 'BCBS affiliate, generally good OON coverage'
  },
  'bcbs': {
    multiplier: { low: 1.4, mid: 1.6, high: 2.0 },
    typicalCoinsurance: 20,
    typicalDeductible: 2500,
    notes: 'Varies significantly by state, generally favorable'
  },
  'cigna': {
    multiplier: { low: 1.2, mid: 1.4, high: 1.7 },
    typicalCoinsurance: 40,
    typicalDeductible: 3500,
    notes: 'Often uses Medicare-based calculations, higher coinsurance'
  },
  'uhc': {
    multiplier: { low: 1.3, mid: 1.5, high: 1.8 },
    typicalCoinsurance: 40,
    typicalDeductible: 3000,
    notes: 'UnitedHealthcare uses Optum data, variable by plan'
  },
  'united': {
    multiplier: { low: 1.3, mid: 1.5, high: 1.8 },
    typicalCoinsurance: 40,
    typicalDeductible: 3000,
    notes: 'UnitedHealthcare uses Optum data, variable by plan'
  },
  'humana': {
    multiplier: { low: 1.2, mid: 1.4, high: 1.6 },
    typicalCoinsurance: 35,
    typicalDeductible: 2500,
    notes: 'More restrictive OON benefits, often Medicare Advantage'
  },
  'kaiser': {
    multiplier: { low: 1.0, mid: 1.2, high: 1.4 },
    typicalCoinsurance: 50,
    typicalDeductible: 5000,
    notes: 'Limited OON benefits, HMO-focused'
  },
  'tricare': {
    multiplier: { low: 1.1, mid: 1.15, high: 1.2 },
    typicalCoinsurance: 25,
    typicalDeductible: 1000,
    notes: 'Military insurance, uses CHAMPUS rates (close to Medicare)'
  },
  'medicare': {
    multiplier: { low: 1.0, mid: 1.0, high: 1.0 },
    typicalCoinsurance: 20,
    typicalDeductible: 240,
    notes: 'Uses Medicare fee schedule directly'
  },
  'default': {
    multiplier: { low: 1.2, mid: 1.4, high: 1.6 },
    typicalCoinsurance: 30,
    typicalDeductible: 2500,
    notes: 'Industry average estimates'
  }
};

// Geographic adjustment factors by region (simplified)
// Full implementation would use CMS locality codes
const GEOGRAPHIC_ADJUSTMENTS: Record<string, number> = {
  // High cost areas
  '100': 1.15, // NYC
  '101': 1.12, // Long Island
  '902': 1.18, // San Francisco
  '903': 1.15, // Los Angeles
  '900': 1.12, // California general
  '200': 1.05, // DC area
  '021': 1.10, // Boston
  // Default adjustments by first digit
  '0': 1.05,  // Northeast
  '1': 1.03,  // Northeast
  '2': 1.00,  // Mid-Atlantic
  '3': 0.98,  // Southeast
  '4': 0.95,  // Midwest
  '5': 0.97,  // South
  '6': 0.96,  // South/Southwest
  '7': 0.95,  // Southwest
  '8': 0.98,  // Mountain
  '9': 1.08,  // West Coast
};

function normalizePayerName(payer: string): string {
  const normalized = payer.toLowerCase().trim().replace(/[^a-z]/g, '');

  if (normalized.includes('aetna')) return 'aetna';
  if (normalized.includes('anthem')) return 'anthem';
  if (normalized.includes('bluecross') || normalized.includes('bcbs') || normalized.includes('blueshield')) return 'bcbs';
  if (normalized.includes('cigna') || normalized.includes('evernorth')) return 'cigna';
  if (normalized.includes('united') || normalized.includes('uhc') || normalized.includes('optum')) return 'uhc';
  if (normalized.includes('humana')) return 'humana';
  if (normalized.includes('kaiser')) return 'kaiser';
  if (normalized.includes('tricare')) return 'tricare';
  if (normalized.includes('medicare')) return 'medicare';

  return 'default';
}

function getGeographicAdjustment(zipCode: string): number {
  if (!zipCode || zipCode.length < 3) return 1.0;

  const prefix = zipCode.substring(0, 3);
  const firstDigit = zipCode.charAt(0);

  return GEOGRAPHIC_ADJUSTMENTS[prefix] || GEOGRAPHIC_ADJUSTMENTS[firstDigit] || 1.0;
}

function getMedicareRate(cptCode: string): number | null {
  return MEDICARE_RATES[cptCode] || null;
}

export function predictOONReimbursement(input: OONPredictionInput): OONPrediction {
  const {
    cptCode,
    insuranceProvider,
    zipCode,
    billedAmount,
    planType = 'unknown',
    deductibleMet = true, // Assume met for simplicity
    deductibleRemaining = 0,
    coinsuranceOverride,
    providerCredential
  } = input;

  const recommendations: string[] = [];

  // Step 1: Get Medicare rate as baseline
  const medicareRate = getMedicareRate(cptCode);

  if (!medicareRate) {
    recommendations.push(`CPT code ${cptCode} not in our database. Using billed amount as estimate basis.`);
    // Fallback: estimate based on typical OON allowed percentages
    return createFallbackPrediction(input);
  }

  // Step 2: Apply geographic adjustment
  const geoAdjustment = getGeographicAdjustment(zipCode);
  const adjustedMedicareRate = medicareRate * geoAdjustment;

  // Step 3: Get payer configuration
  const normalizedPayer = normalizePayerName(insuranceProvider);
  const payerConfig = PAYER_CONFIGS[normalizedPayer] || PAYER_CONFIGS['default'];

  // Step 4: Calculate allowed amount range
  const allowedAmountLow = adjustedMedicareRate * payerConfig.multiplier.low;
  const allowedAmountMid = adjustedMedicareRate * payerConfig.multiplier.mid;
  const allowedAmountHigh = adjustedMedicareRate * payerConfig.multiplier.high;

  // Step 5: Determine coinsurance
  const coinsurancePercent = coinsuranceOverride ?? payerConfig.typicalCoinsurance;

  // Step 6: Calculate deductible impact
  let deductibleApplied = 0;
  let effectiveAllowedForReimbursement = allowedAmountMid;

  if (!deductibleMet && deductibleRemaining > 0) {
    deductibleApplied = Math.min(deductibleRemaining, allowedAmountMid);
    effectiveAllowedForReimbursement = Math.max(0, allowedAmountMid - deductibleApplied);
    recommendations.push(`Deductible of $${deductibleRemaining.toFixed(2)} may apply to this service.`);
  }

  // Step 7: Calculate reimbursement
  const insurancePaysBeforeCoinsurance = effectiveAllowedForReimbursement;
  const patientCoinsurance = insurancePaysBeforeCoinsurance * (coinsurancePercent / 100);
  const insuranceReimbursement = insurancePaysBeforeCoinsurance - patientCoinsurance;

  // Step 8: Calculate balance bill (what patient owes beyond insurance allowed)
  const balanceBill = Math.max(0, billedAmount - allowedAmountMid);

  // Step 9: Total patient responsibility
  const totalPatientResponsibility = patientCoinsurance + balanceBill + deductibleApplied;

  // Step 10: Determine confidence level
  let confidenceLevel: 'high' | 'medium' | 'low' = 'medium';

  if (normalizedPayer !== 'default' && medicareRate) {
    confidenceLevel = 'medium';
    if (['bcbs', 'aetna', 'cigna', 'uhc'].includes(normalizedPayer)) {
      confidenceLevel = 'high';
    }
  } else {
    confidenceLevel = 'low';
    recommendations.push('Limited data for this payer. Estimates may vary significantly.');
  }

  // Step 11: Generate recommendations
  if (balanceBill > billedAmount * 0.3) {
    recommendations.push(`Consider reducing your fee to $${Math.round(allowedAmountHigh)} to minimize patient balance billing.`);
  }

  if (coinsurancePercent >= 40) {
    recommendations.push('High coinsurance plan - patient may benefit from superbill for HSA/FSA reimbursement.');
  }

  if (billedAmount < allowedAmountMid) {
    recommendations.push(`Your charge ($${billedAmount}) is below the estimated allowed amount. Consider increasing to $${Math.round(allowedAmountMid)}.`);
  }

  // Payer-specific recommendations
  recommendations.push(payerConfig.notes);

  return {
    estimatedAllowedAmount: Math.round(allowedAmountMid * 100) / 100,
    estimatedReimbursement: Math.round(insuranceReimbursement * 100) / 100,
    estimatedPatientResponsibility: Math.round(totalPatientResponsibility * 100) / 100,
    balanceBillAmount: Math.round(balanceBill * 100) / 100,
    confidenceLevel,
    methodology: 'medicare_multiplier',
    dataPoints: 0, // MVP doesn't use historical data yet
    range: {
      low: Math.round((allowedAmountLow * (1 - coinsurancePercent / 100)) * 100) / 100,
      high: Math.round((allowedAmountHigh * (1 - coinsurancePercent / 100)) * 100) / 100
    },
    breakdown: {
      medicareRate: adjustedMedicareRate,
      multiplierUsed: payerConfig.multiplier.mid,
      coinsurancePercent,
      deductibleApplied
    },
    recommendations
  };
}

function createFallbackPrediction(input: OONPredictionInput): OONPrediction {
  const { billedAmount, insuranceProvider } = input;

  // Industry average: OON allowed is typically 60-80% of billed amount
  const estimatedAllowed = billedAmount * 0.7;
  const coinsurance = 30;
  const reimbursement = estimatedAllowed * (1 - coinsurance / 100);
  const balanceBill = billedAmount - estimatedAllowed;

  return {
    estimatedAllowedAmount: Math.round(estimatedAllowed * 100) / 100,
    estimatedReimbursement: Math.round(reimbursement * 100) / 100,
    estimatedPatientResponsibility: Math.round((billedAmount - reimbursement) * 100) / 100,
    balanceBillAmount: Math.round(balanceBill * 100) / 100,
    confidenceLevel: 'low',
    methodology: 'ucr_estimate',
    dataPoints: 0,
    range: {
      low: Math.round(reimbursement * 0.7 * 100) / 100,
      high: Math.round(reimbursement * 1.3 * 100) / 100
    },
    breakdown: {
      medicareRate: 0,
      multiplierUsed: 0,
      coinsurancePercent: coinsurance,
      deductibleApplied: 0
    },
    recommendations: [
      'CPT code not found in database - using industry estimates.',
      'Actual reimbursement may vary significantly.',
      'Consider verifying benefits with the insurance company.'
    ]
  };
}

// Batch prediction for multiple CPT codes (e.g., full session billing)
export function predictMultipleOON(
  cptCodes: string[],
  insuranceProvider: string,
  zipCode: string,
  billedAmounts: Record<string, number>,
  options?: Partial<OONPredictionInput>
): {
  predictions: Record<string, OONPrediction>;
  totals: {
    totalBilled: number;
    totalEstimatedReimbursement: number;
    totalPatientResponsibility: number;
    overallConfidence: 'high' | 'medium' | 'low';
  };
} {
  const predictions: Record<string, OONPrediction> = {};

  let totalBilled = 0;
  let totalReimbursement = 0;
  let totalPatientResp = 0;
  let confidenceScores: number[] = [];

  for (const cptCode of cptCodes) {
    const billedAmount = billedAmounts[cptCode] || 0;

    const prediction = predictOONReimbursement({
      cptCode,
      insuranceProvider,
      zipCode,
      billedAmount,
      ...options
    });

    predictions[cptCode] = prediction;
    totalBilled += billedAmount;
    totalReimbursement += prediction.estimatedReimbursement;
    totalPatientResp += prediction.estimatedPatientResponsibility;
    confidenceScores.push(prediction.confidenceLevel === 'high' ? 3 : prediction.confidenceLevel === 'medium' ? 2 : 1);
  }

  const avgConfidence = confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length;
  const overallConfidence: 'high' | 'medium' | 'low' =
    avgConfidence >= 2.5 ? 'high' : avgConfidence >= 1.5 ? 'medium' : 'low';

  return {
    predictions,
    totals: {
      totalBilled: Math.round(totalBilled * 100) / 100,
      totalEstimatedReimbursement: Math.round(totalReimbursement * 100) / 100,
      totalPatientResponsibility: Math.round(totalPatientResp * 100) / 100,
      overallConfidence
    }
  };
}

// Get supported payers list
export function getSupportedPayers(): { name: string; config: PayerConfig }[] {
  return Object.entries(PAYER_CONFIGS)
    .filter(([key]) => key !== 'default')
    .map(([name, config]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      config
    }));
}

// Get supported CPT codes
export function getSupportedCPTCodes(): { code: string; medicareRate: number }[] {
  return Object.entries(MEDICARE_RATES).map(([code, rate]) => ({
    code,
    medicareRate: rate
  }));
}

export default {
  predictOONReimbursement,
  predictMultipleOON,
  getSupportedPayers,
  getSupportedCPTCodes
};
