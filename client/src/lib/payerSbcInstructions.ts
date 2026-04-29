/**
 * Payer-specific instructions for retrieving Summary of Benefits and Coverage (SBC).
 *
 * Patients have no idea what an "SBC" is or where to find it. The single
 * highest-impact thing we can do to drive upload adoption is tell each
 * patient EXACTLY where to look for their specific insurance company.
 *
 * Matching strategy: case-insensitive substring match against the
 * patient's `insurance_provider` string. Returns the first hit. Falls
 * through to generic instructions when no match.
 *
 * To add a new payer:
 *   1. Find the payer's member portal URL
 *   2. Document the path within the portal (e.g. Plans → Plan Documents)
 *   3. Phone number for member services
 *   4. Add an entry below — match[] should include all common name variants
 *
 * Source URLs verified manually as of April 2026 — they don't change
 * often but if a patient reports broken instructions, update here.
 */

export interface SbcInstructions {
  /** Display name for the carrier */
  payer: string;
  /** Member-portal URL where SBC lives */
  portalUrl: string;
  /** Step-by-step path within the portal */
  pathSteps: string[];
  /** Customer service phone for SBC requests */
  phone?: string;
  /** Alternative document names this carrier might use */
  alternativeNames?: string[];
}

/** Substring patterns matched against insurance_provider, lowercased. */
const PAYER_LOOKUP: Array<{ match: string[]; instructions: SbcInstructions }> = [
  {
    match: ['aetna'],
    instructions: {
      payer: 'Aetna',
      portalUrl: 'https://www.aetna.com/individuals-families/member-rights-resources.html',
      pathSteps: [
        'Log in to aetna.com',
        'Click "My Plan" → "Plan Documents"',
        'Look for "Summary of Benefits and Coverage" (SBC) — download the PDF',
      ],
      phone: '1-800-872-3862',
      alternativeNames: ['Summary of Benefits and Coverage'],
    },
  },
  {
    match: ['united', 'uhc', 'unitedhealthcare', 'unitedhealth'],
    instructions: {
      payer: 'UnitedHealthcare',
      portalUrl: 'https://www.myuhc.com',
      pathSteps: [
        'Log in to myuhc.com',
        'Click "Coverage & Benefits" → "Plan Documents"',
        'Find "Summary of Benefits and Coverage" or "Certificate of Coverage" — download PDF',
      ],
      phone: '1-866-633-2446',
      alternativeNames: ['Certificate of Coverage', 'Evidence of Coverage'],
    },
  },
  {
    match: ['cigna'],
    instructions: {
      payer: 'Cigna',
      portalUrl: 'https://my.cigna.com',
      pathSteps: [
        'Log in to my.cigna.com',
        'Click "Coverage" → "Plan Documents"',
        'Look for "Summary of Benefits and Coverage" — download PDF',
      ],
      phone: '1-800-244-6224',
    },
  },
  {
    match: ['anthem', 'anthem bcbs', 'anthem blue'],
    instructions: {
      payer: 'Anthem Blue Cross Blue Shield',
      portalUrl: 'https://www.anthem.com',
      pathSteps: [
        'Log in to anthem.com',
        'Go to "My Plan" → "Plan Documents"',
        'Download "Summary of Benefits and Coverage" (SBC)',
      ],
      phone: 'See member ID card for state-specific number',
      alternativeNames: ['Certificate of Insurance'],
    },
  },
  {
    match: ['horizon bcbs', 'horizon blue'],
    instructions: {
      payer: 'Horizon BCBS NJ',
      portalUrl: 'https://www.horizonblue.com',
      pathSteps: [
        'Log in to horizonblue.com',
        'Click "My Plan" or "Member Resources"',
        'Find "Summary of Benefits and Coverage" — download PDF',
      ],
      phone: '1-800-355-2583',
    },
  },
  {
    match: ['blue cross', 'blue shield', 'bcbs'],
    instructions: {
      payer: 'Blue Cross Blue Shield',
      portalUrl: 'https://www.bcbs.com/find-my-bcbs-company',
      pathSteps: [
        'Find your local BCBS company (varies by state) at bcbs.com',
        'Log in to your state\'s BCBS member portal',
        'Look under "Plan Documents" or "Benefits" → download "Summary of Benefits and Coverage"',
      ],
      phone: 'See member ID card — phone number varies by state',
    },
  },
  {
    match: ['humana'],
    instructions: {
      payer: 'Humana',
      portalUrl: 'https://www.humana.com',
      pathSteps: [
        'Log in to humana.com',
        'Click "Coverage" → "Plan Documents"',
        'Download "Summary of Benefits and Coverage"',
      ],
      phone: '1-800-457-4708',
    },
  },
  {
    match: ['kaiser'],
    instructions: {
      payer: 'Kaiser Permanente',
      portalUrl: 'https://healthy.kaiserpermanente.org',
      pathSteps: [
        'Log in to kp.org',
        'Click "Coverage & Costs" → "Plan Documents"',
        'Download "Evidence of Coverage" or "Summary of Benefits and Coverage"',
      ],
      phone: '1-800-464-4000',
      alternativeNames: ['Evidence of Coverage'],
    },
  },
  {
    match: ['medicare'],
    instructions: {
      payer: 'Medicare',
      portalUrl: 'https://www.medicare.gov',
      pathSteps: [
        'Log in to medicare.gov',
        'Click "My Account" → "Plan Information"',
        'For Medicare Advantage / Part D, look for "Evidence of Coverage" (EOC)',
        'For Original Medicare, the booklet "Medicare & You" covers the standard benefits',
      ],
      phone: '1-800-633-4227',
      alternativeNames: ['Evidence of Coverage', 'Medicare & You'],
    },
  },
  {
    match: ['tricare'],
    instructions: {
      payer: 'TRICARE',
      portalUrl: 'https://www.tricare.mil',
      pathSteps: [
        'Visit tricare.mil',
        'Click "Plans" → select your specific plan (Prime, Select, etc.)',
        'Download the plan handbook',
      ],
      phone: '1-800-444-5445',
      alternativeNames: ['Plan Handbook'],
    },
  },
];

/**
 * Lookup carrier-specific SBC instructions by insurance provider name.
 * Returns null when no match — caller should show generic instructions.
 */
export function getPayerSbcInstructions(insuranceProvider?: string | null): SbcInstructions | null {
  if (!insuranceProvider) return null;
  const lower = insuranceProvider.toLowerCase();
  for (const entry of PAYER_LOOKUP) {
    if (entry.match.some((m) => lower.includes(m))) {
      return entry.instructions;
    }
  }
  return null;
}

/**
 * Generic fallback when carrier isn't in our lookup. Patients need
 * something actionable even when their carrier isn't recognized.
 */
export const GENERIC_SBC_INSTRUCTIONS = {
  pathSteps: [
    'Log in to your insurance company\'s member portal (URL is on your insurance card)',
    'Look for a section called "Plan Documents", "Benefits", or "Member Resources"',
    'Download the document called "Summary of Benefits and Coverage" (SBC) — usually a PDF',
    'If you can\'t find it online, call the number on the back of your insurance card and request the SBC by email',
  ],
  alternativeNames: ['Summary of Benefits and Coverage', 'Certificate of Coverage', 'Evidence of Coverage', 'Plan Handbook'],
};
