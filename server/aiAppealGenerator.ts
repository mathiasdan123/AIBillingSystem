/**
 * AI Appeal Generator Service
 * Automatically analyzes denied claims and generates appeal letters
 */

export interface AppealResult {
  appealLetter: string;
  denialCategory: string;
  successProbability: number;
  suggestedActions: string[];
  keyArguments: string[];
  generatedAt: Date;
}

interface ClaimData {
  id: number;
  claimNumber: string | null;
  totalAmount: string;
  denialReason: string | null;
  submittedAt: Date | null;
}

interface PatientData {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  insuranceProvider: string | null;
  insuranceId: string | null;
}

interface LineItemData {
  cptCode?: { code: string; description: string };
  icd10Code?: { code: string; description: string };
  units: number;
  amount: string;
}

interface PracticeData {
  name: string;
  npi: string | null;
  address: string | null;
  phone: string | null;
}

// Common denial reason patterns and their handling strategies
const DENIAL_PATTERNS: Record<string, {
  category: string;
  successRate: number;
  keyArguments: string[];
  suggestedActions: string[];
}> = {
  'medical necessity': {
    category: 'medical_necessity',
    successRate: 65,
    keyArguments: [
      'Treatment aligns with established AOTA practice guidelines for occupational therapy',
      'Documented functional deficits require skilled therapeutic intervention',
      'Patient demonstrated measurable progress toward functional goals',
      'Services were provided at the appropriate level of care'
    ],
    suggestedActions: [
      'Include detailed functional outcome measures',
      'Attach progress notes showing improvement',
      'Reference Medicare LCD/NCD guidelines',
      'Document specific ADL limitations addressed'
    ]
  },
  'not covered': {
    category: 'coverage',
    successRate: 45,
    keyArguments: [
      'Service is a covered benefit under the patient\'s plan',
      'CPT code accurately reflects the skilled service provided',
      'Treatment falls within scope of occupational therapy practice'
    ],
    suggestedActions: [
      'Verify patient benefits and coverage details',
      'Request copy of plan\'s coverage policy',
      'Consider alternative CPT code if applicable'
    ]
  },
  'authorization': {
    category: 'auth_missing',
    successRate: 55,
    keyArguments: [
      'Authorization was obtained prior to service (if applicable)',
      'Services were emergent/urgent and required immediate intervention',
      'Retroactive authorization request is being submitted'
    ],
    suggestedActions: [
      'Submit retroactive authorization request',
      'Document clinical urgency of services',
      'Include physician order/referral'
    ]
  },
  'prior auth': {
    category: 'auth_missing',
    successRate: 55,
    keyArguments: [
      'Authorization was obtained prior to service (if applicable)',
      'Services were emergent/urgent and required immediate intervention',
      'Retroactive authorization request is being submitted'
    ],
    suggestedActions: [
      'Submit retroactive authorization request',
      'Document clinical urgency of services',
      'Include physician order/referral'
    ]
  },
  'coding': {
    category: 'coding_error',
    successRate: 70,
    keyArguments: [
      'Corrected claim with accurate coding is attached',
      'CPT and ICD-10 codes now properly reflect services rendered',
      'Documentation supports medical necessity for billed codes'
    ],
    suggestedActions: [
      'Review and correct CPT/ICD-10 codes',
      'Ensure modifier usage is appropriate',
      'Verify units billed match documentation'
    ]
  },
  'duplicate': {
    category: 'duplicate_claim',
    successRate: 40,
    keyArguments: [
      'This is not a duplicate claim - services were distinct',
      'Different dates of service or different procedures',
      'Original claim was not paid - this is the valid submission'
    ],
    suggestedActions: [
      'Provide documentation showing distinct services',
      'Include timeline of all related claims',
      'Request status of original claim if unpaid'
    ]
  },
  'timely filing': {
    category: 'timely_filing',
    successRate: 35,
    keyArguments: [
      'Claim was submitted within required timeframe',
      'Delay was due to circumstances beyond provider control',
      'Proof of timely submission is attached'
    ],
    suggestedActions: [
      'Gather proof of original submission date',
      'Document any payer delays or system issues',
      'Check if exception applies (coordination of benefits, etc.)'
    ]
  },
  'eligibility': {
    category: 'eligibility',
    successRate: 30,
    keyArguments: [
      'Patient was eligible on date of service',
      'Eligibility verification was performed prior to service',
      'Patient\'s coverage was retroactively activated'
    ],
    suggestedActions: [
      'Verify patient eligibility for date of service',
      'Contact patient about insurance status',
      'Bill patient directly if truly ineligible'
    ]
  },
  'bundled': {
    category: 'bundling',
    successRate: 50,
    keyArguments: [
      'Services are distinct and separately identifiable',
      'Modifier 59 or XE/XP/XS/XU appropriately applied',
      'Documentation supports separate therapeutic goals'
    ],
    suggestedActions: [
      'Add appropriate modifier if not already present',
      'Document distinct therapeutic purposes',
      'Consider appealing with detailed treatment notes'
    ]
  }
};

export class AiAppealGenerator {
  /**
   * Analyze denial reason and generate appeal
   */
  async generateAppeal(
    claim: ClaimData,
    lineItems: LineItemData[],
    patient: PatientData,
    practice: PracticeData
  ): Promise<AppealResult> {
    const denialReason = claim.denialReason?.toLowerCase() || '';

    // Find matching denial pattern
    const matchedPattern = this.matchDenialPattern(denialReason);

    // Generate the appeal letter
    const appealLetter = this.generateAppealLetter(
      claim,
      lineItems,
      patient,
      practice,
      matchedPattern
    );

    return {
      appealLetter,
      denialCategory: matchedPattern.category,
      successProbability: matchedPattern.successRate,
      suggestedActions: matchedPattern.suggestedActions,
      keyArguments: matchedPattern.keyArguments,
      generatedAt: new Date(),
    };
  }

  /**
   * Match denial reason to known patterns
   */
  private matchDenialPattern(denialReason: string): typeof DENIAL_PATTERNS[string] {
    // Check each pattern for a match
    for (const [keyword, pattern] of Object.entries(DENIAL_PATTERNS)) {
      if (denialReason.includes(keyword)) {
        return pattern;
      }
    }

    // Default pattern for unknown denials
    return {
      category: 'other',
      successRate: 50,
      keyArguments: [
        'Services rendered were medically necessary and appropriate',
        'Documentation supports the clinical need for treatment',
        'Request for reconsideration based on attached clinical records'
      ],
      suggestedActions: [
        'Review denial reason carefully',
        'Gather all supporting documentation',
        'Contact payer for clarification if needed'
      ]
    };
  }

  /**
   * Generate the actual appeal letter
   */
  private generateAppealLetter(
    claim: ClaimData,
    lineItems: LineItemData[],
    patient: PatientData,
    practice: PracticeData,
    pattern: typeof DENIAL_PATTERNS[string]
  ): string {
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const dateOfService = claim.submittedAt
      ? new Date(claim.submittedAt).toLocaleDateString('en-US')
      : 'See attached documentation';

    // Build CPT codes list
    const cptCodesList = lineItems
      .filter(item => item.cptCode)
      .map(item => `${item.cptCode!.code} - ${item.cptCode!.description} (${item.units} unit${item.units > 1 ? 's' : ''})`)
      .join('\n    ');

    // Build ICD-10 codes list
    const icd10CodesList = lineItems
      .filter(item => item.icd10Code)
      .map(item => `${item.icd10Code!.code} - ${item.icd10Code!.description}`)
      .filter((value, index, self) => self.indexOf(value) === index) // Remove duplicates
      .join('\n    ');

    // Build key arguments section
    const argumentsSection = pattern.keyArguments
      .map((arg, i) => `${i + 1}. ${arg}`)
      .join('\n');

    const letter = `
${practice.name}
${practice.address || '[Practice Address]'}
${practice.phone || '[Practice Phone]'}
NPI: ${practice.npi || '[NPI Number]'}

${today}

Claims Review Department
${patient.insuranceProvider || '[Insurance Company]'}
[Insurance Address]

RE: APPEAL OF DENIED CLAIM
    Patient Name: ${patient.firstName} ${patient.lastName}
    Patient DOB: ${patient.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString('en-US') : 'On file'}
    Member ID: ${patient.insuranceId || 'On file'}
    Claim Number: ${claim.claimNumber || 'See attached'}
    Date of Service: ${dateOfService}
    Billed Amount: $${claim.totalAmount}
    Denial Reason: ${claim.denialReason || 'Not specified'}

Dear Claims Review Department,

I am writing to formally appeal the denial of the above-referenced claim for occupational therapy services provided to ${patient.firstName} ${patient.lastName}.

SERVICES PROVIDED:
    ${cptCodesList || 'See attached claim'}

DIAGNOSIS CODES:
    ${icd10CodesList || 'See attached documentation'}

GROUNDS FOR APPEAL:

${argumentsSection}

CLINICAL JUSTIFICATION:

The occupational therapy services provided were medically necessary to address the patient's functional limitations and improve their ability to perform activities of daily living. Treatment was provided in accordance with the American Occupational Therapy Association (AOTA) practice guidelines and was appropriate for the patient's diagnosis and functional status.

The patient's treatment plan was developed based on a comprehensive evaluation and targeted specific, measurable goals. Progress notes document the patient's response to treatment and demonstrate skilled therapeutic intervention was required to achieve functional outcomes.

REQUEST FOR RECONSIDERATION:

Based on the clinical documentation and the grounds stated above, I respectfully request that you reconsider this claim for payment. All supporting documentation, including evaluation notes, treatment records, and progress notes, are available upon request.

If you require any additional information or clarification, please do not hesitate to contact our office.

Thank you for your prompt attention to this matter.

Sincerely,


_______________________________
Provider Name
${practice.name}
NPI: ${practice.npi || '[NPI]'}
Phone: ${practice.phone || '[Phone]'}

Enclosures:
- Copy of original claim
- Clinical documentation
- Progress notes
- Treatment plan
`.trim();

    return letter;
  }

  /**
   * Get category-specific tips for the appeal
   */
  getCategoryTips(category: string): string[] {
    const tips: Record<string, string[]> = {
      medical_necessity: [
        'Include standardized assessment scores (e.g., FIM, Barthel Index)',
        'Document specific functional limitations and how they impact daily life',
        'Show progression from evaluation to current status',
        'Reference peer-reviewed literature supporting intervention'
      ],
      coverage: [
        'Obtain a copy of the member\'s Summary of Benefits',
        'Cite specific policy language supporting coverage',
        'Request a peer-to-peer review if available'
      ],
      auth_missing: [
        'Document the clinical urgency that prevented prior authorization',
        'Include any communication with the payer regarding authorization',
        'Submit retroactive authorization request simultaneously'
      ],
      coding_error: [
        'Double-check all codes against current year\'s CPT/ICD-10 manuals',
        'Verify modifier usage follows payer-specific guidelines',
        'Consider whether a different code better describes the service'
      ],
      duplicate_claim: [
        'Provide a claims timeline showing all submissions',
        'Document what makes this claim distinct from others',
        'Include any Explanation of Benefits (EOB) from related claims'
      ],
      timely_filing: [
        'Gather electronic submission confirmations or certified mail receipts',
        'Document any payer system issues or delays',
        'Check if coordination of benefits extends the filing deadline'
      ],
      eligibility: [
        'Verify eligibility through the payer portal for the exact date of service',
        'Check if the patient had other coverage that should be billed first',
        'Contact the patient to confirm their insurance status at time of service'
      ],
      bundling: [
        'Document the distinct therapeutic purpose of each service',
        'Use appropriate modifiers (59, XE, XP, XS, XU)',
        'Cite CCI edits and applicable exceptions'
      ],
      other: [
        'Request a detailed explanation of the denial reason',
        'Ask for a peer-to-peer review with the medical director',
        'Consider escalating to a formal grievance if initial appeal fails'
      ]
    };

    return tips[category] || tips.other;
  }
}

export const appealGenerator = new AiAppealGenerator();
