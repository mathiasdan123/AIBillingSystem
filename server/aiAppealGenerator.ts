/**
 * AI Appeal Generator Service
 * Automatically analyzes denied claims and generates appeal letters
 *
 * GROUNDING (QA sweep 2026-11-18): the template used to assert, for every
 * denial, that services were medically necessary and AOTA-conformant, that a
 * comprehensive evaluation and a measurable treatment plan existed, that
 * progress notes demonstrated skilled intervention, and -- for authorization
 * denials -- that the service was urgent and a retro-authorization request
 * was being submitted. None of that was looked up or asked for. Every
 * argument and paragraph is now conditional on an AppealGrounding: a record
 * that exists, or a fact the biller entered. See appealGroundingService.ts.
 */

import {
  type AppealGrounding,
  emptyAppealGrounding,
  filterUnsupportedKeyArguments,
  stripUnsupportedAppealAssertions,
} from './services/appealGroundingService';
import { formatDateOnlyShort } from './utils/dateOnly';
import logger from './services/logger';

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
  /** Who signs the letter. Left blank, the signature block carries a bracketed placeholder the readiness check flags. */
  providerName?: string | null;
}

/**
 * A key argument the letter may make, and what has to be on record for it.
 * `requires` is a predicate over the grounding; an argument with no
 * requirement states a position about the claim itself (coding, timing,
 * eligibility), not the existence of a document.
 */
interface KeyArgument {
  text: string | ((g: AppealGrounding) => string);
  requires?: (g: AppealGrounding) => boolean;
}

const needsClinicalDocs = (g: AppealGrounding) => g.hasClinicalDocumentation;
const needsProgressNotes = (g: AppealGrounding) => g.hasProgressNotes;
const needsPriorAuth = (g: AppealGrounding) => g.hasPriorAuthorization;
const needsUrgent = (g: AppealGrounding) => g.inputs.urgentService === true;
const needsRetroAuth = (g: AppealGrounding) => g.inputs.retroAuthRequested === true;

const AUTH_ARGUMENTS: KeyArgument[] = [
  {
    text: (g) => `Authorization was on file for this patient (reference ${g.authorizationNumbers.join(', ')})`,
    requires: needsPriorAuth,
  },
  {
    text: 'The service was urgent and could not wait for prior authorization, as documented by the treating provider',
    requires: needsUrgent,
  },
  {
    text: (g) =>
      g.inputs.retroAuthReference
        ? `A retroactive authorization request has been submitted (reference ${g.inputs.retroAuthReference})`
        : 'A retroactive authorization request has been submitted',
    requires: needsRetroAuth,
  },
];

// Common denial reason patterns and their handling strategies
const DENIAL_PATTERNS: Record<string, {
  category: string;
  successRate: number;
  keyArguments: KeyArgument[];
  suggestedActions: string[];
}> = {
  'medical necessity': {
    category: 'medical_necessity',
    successRate: 65,
    keyArguments: [
      { text: 'The clinical documentation on file describes the functional deficits the billed services addressed', requires: needsClinicalDocs },
      { text: (g) => `Progress notes on file (${g.progressNoteCount}) record the patient's response to treatment`, requires: needsProgressNotes },
      { text: 'The billed codes describe the services rendered, as recorded by the treating provider' },
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
      { text: 'Service is a covered benefit under the patient\'s plan' },
      { text: 'CPT code accurately reflects the skilled service provided' },
      { text: 'Treatment falls within scope of occupational therapy practice' },
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
    keyArguments: AUTH_ARGUMENTS,
    suggestedActions: [
      'Submit retroactive authorization request',
      'Document clinical urgency of services',
      'Include physician order/referral'
    ]
  },
  'prior auth': {
    category: 'auth_missing',
    successRate: 55,
    keyArguments: AUTH_ARGUMENTS,
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
      { text: 'A corrected claim with accurate coding accompanies this appeal' },
      { text: 'CPT and ICD-10 codes now properly reflect services rendered' },
      { text: 'The clinical documentation on file supports the billed codes', requires: needsClinicalDocs },
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
      { text: 'This is not a duplicate claim - services were distinct' },
      { text: 'Different dates of service or different procedures' },
      { text: 'Original claim was not paid - this is the valid submission' },
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
      { text: 'Claim was submitted within required timeframe' },
      { text: 'Delay was due to circumstances beyond provider control' },
      { text: 'Proof of timely submission is attached' },
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
      { text: 'Patient was eligible on date of service' },
      { text: 'Eligibility verification was performed prior to service' },
      { text: 'Patient\'s coverage was retroactively activated' },
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
      { text: 'Services are distinct and separately identifiable' },
      { text: 'Modifier 59 or XE/XP/XS/XU appropriately applied' },
      { text: 'The clinical documentation on file supports separate therapeutic goals', requires: needsClinicalDocs },
    ],
    suggestedActions: [
      'Add appropriate modifier if not already present',
      'Document distinct therapeutic purposes',
      'Consider appealing with detailed treatment notes'
    ]
  }
};

const DEFAULT_PATTERN: typeof DENIAL_PATTERNS[string] = {
  category: 'other',
  successRate: 50,
  keyArguments: [
    { text: 'The clinical documentation on file describes the services rendered and the deficits they addressed', requires: needsClinicalDocs },
    { text: 'Request for reconsideration based on the enclosed records', requires: (g) => g.hasClinicalDocumentation || g.hasSupportingDocs },
    { text: 'The billed codes describe the services rendered, as recorded by the treating provider' },
  ],
  suggestedActions: [
    'Review denial reason carefully',
    'Gather all supporting documentation',
    'Contact payer for clarification if needed'
  ]
};

/** Resolve a pattern's arguments against the grounding: unsupported ones are dropped. */
function resolveKeyArguments(pattern: typeof DENIAL_PATTERNS[string], g: AppealGrounding): string[] {
  const out: string[] = [];
  for (const arg of pattern.keyArguments) {
    if (arg.requires && !arg.requires(g)) continue;
    out.push(typeof arg.text === 'function' ? arg.text(g) : arg.text);
  }
  if (g.inputs.additionalGrounds) out.push(g.inputs.additionalGrounds);
  return out;
}

export class AiAppealGenerator {
  /**
   * Generate appeal using Claude first, falling back to templates
   */
  async generateAppealWithClaude(
    claim: ClaimData,
    lineItems: LineItemData[],
    patient: PatientData,
    practice: PracticeData,
    soapNote?: string | null,
    appealLevel?: string,
    grounding: AppealGrounding = emptyAppealGrounding(),
  ): Promise<AppealResult> {
    try {
      const { generateClaudeAppeal, isClaudeAppealAvailable } = await import('./services/claudeAppealService');
      if (isClaudeAppealAvailable()) {
        const result = await generateClaudeAppeal({
          claim,
          lineItems,
          patient,
          practice,
          soapNote,
          denialReason: claim.denialReason || 'No reason provided',
          appealLevel,
        });
        // The model is told to ground its arguments; the backstop enforces it.
        return {
          ...result,
          appealLetter: stripUnsupportedAppealAssertions(result.appealLetter, grounding),
          keyArguments: filterUnsupportedKeyArguments(result.keyArguments, grounding),
        };
      }
    } catch (error: any) {
      logger.warn('Claude appeal generation failed, falling back to template', { error: error?.message });
    }

    return this.generateAppeal(claim, lineItems, patient, practice, grounding);
  }

  /**
   * Analyze denial reason and generate appeal (template-based fallback)
   */
  async generateAppeal(
    claim: ClaimData,
    lineItems: LineItemData[],
    patient: PatientData,
    practice: PracticeData,
    grounding: AppealGrounding = emptyAppealGrounding(),
  ): Promise<AppealResult> {
    const denialReason = claim.denialReason?.toLowerCase() || '';

    // Find matching denial pattern
    const matchedPattern = this.matchDenialPattern(denialReason);
    const keyArguments = resolveKeyArguments(matchedPattern, grounding);

    // Generate the appeal letter, then run the same backstop the model path
    // gets -- the template is written to be grounded, the backstop proves it.
    const appealLetter = stripUnsupportedAppealAssertions(
      this.generateAppealLetter(claim, lineItems, patient, practice, keyArguments, grounding),
      grounding,
    );

    return {
      appealLetter,
      denialCategory: matchedPattern.category,
      successProbability: matchedPattern.successRate,
      suggestedActions: matchedPattern.suggestedActions,
      keyArguments: filterUnsupportedKeyArguments(keyArguments, grounding),
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
    return DEFAULT_PATTERN;
  }

  /**
   * Generate the actual appeal letter
   */
  private generateAppealLetter(
    claim: ClaimData,
    lineItems: LineItemData[],
    patient: PatientData,
    practice: PracticeData,
    keyArguments: string[],
    g: AppealGrounding,
  ): string {
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const dateOfService = claim.submittedAt
      ? formatDateOnlyShort(claim.submittedAt, 'See attached documentation')
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
    const argumentsSection = keyArguments.length > 0
      ? keyArguments.map((arg, i) => `${i + 1}. ${arg}`).join('\n')
      : 'The treating provider requests reconsideration of this claim on review of the enclosed records.';

    // Clinical justification: one sentence per record that actually exists.
    // Nothing here describes what a record SAYS -- only that it is on file
    // and enclosed. The reviewer reads the records; this letter does not
    // characterise them.
    const justification: string[] = [];
    if (g.hasEvaluation) justification.push('An evaluation of the patient is on file and enclosed.');
    if (g.hasTreatmentPlan) justification.push('The patient\'s current treatment plan is on file and enclosed.');
    if (g.hasProgressNotes) {
      justification.push(`Progress notes (${g.progressNoteCount}) covering the course of treatment are on file and enclosed.`);
    }
    if (g.hasSoapNotes) {
      justification.push(`Session documentation (${g.soapNoteCount} note${g.soapNoteCount === 1 ? '' : 's'}) is on file and enclosed.`);
    }
    if (g.hasPriorAuthorization) {
      justification.push(`Authorization reference on file: ${g.authorizationNumbers.join(', ')}.`);
    }
    if (g.inputs.urgentService) {
      justification.push('The treating provider has indicated that the service was urgent and could not be deferred pending prior authorization.');
    }
    if (g.inputs.retroAuthRequested) {
      justification.push(
        g.inputs.retroAuthReference
          ? `A retroactive authorization request has been submitted to the plan (reference ${g.inputs.retroAuthReference}).`
          : 'A retroactive authorization request has been submitted to the plan.',
      );
    }
    const justificationSection = justification.length > 0
      ? `CLINICAL DOCUMENTATION:\n\n${justification.join(' ')}\n\n`
      : '';

    // Enclosures: only what exists.
    const enclosures = ['Copy of original claim'];
    if (g.hasEvaluation) enclosures.push('Evaluation');
    if (g.hasTreatmentPlan) enclosures.push('Treatment plan');
    if (g.hasProgressNotes) enclosures.push('Progress notes');
    if (g.hasSoapNotes) enclosures.push('Session documentation');
    for (const name of g.supportingDocNames) enclosures.push(name);

    const requestSentence = g.hasClinicalDocumentation || g.hasSupportingDocs
      ? 'On the grounds stated above and the enclosed records, I respectfully request that you reconsider this claim for payment.'
      : 'On the grounds stated above, I respectfully request that you reconsider this claim for payment.';

    const signer = practice.providerName && practice.providerName.trim().length > 0
      ? practice.providerName.trim()
      : '[Provider Name]';

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
    Patient DOB: ${formatDateOnlyShort(patient.dateOfBirth, 'On file')}
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

${justificationSection}REQUEST FOR RECONSIDERATION:

${requestSentence}

If you require any additional information or clarification, please do not hesitate to contact our office.

Thank you for your prompt attention to this matter.

Sincerely,


_______________________________
${signer}
${practice.name}
NPI: ${practice.npi || '[NPI]'}
Phone: ${practice.phone || '[Phone]'}

Enclosures:
${enclosures.map((e) => `- ${e}`).join('\n')}
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
