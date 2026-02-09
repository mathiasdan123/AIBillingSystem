/**
 * Stedi Healthcare Clearinghouse Integration
 *
 * Handles:
 * - Eligibility verification (270/271)
 * - Claims submission (837P for professional claims)
 * - Claim status inquiries (276/277)
 * - Electronic remittance advice (835)
 */

// Stedi API base URL
const STEDI_API_BASE = 'https://healthcare.us.stedi.com/2024-04-01';

// Check if Stedi is configured
export function isStediConfigured(): boolean {
  return !!process.env.STEDI_API_KEY;
}

// Get headers for Stedi API requests
function getHeaders(): HeadersInit {
  const apiKey = process.env.STEDI_API_KEY;
  if (!apiKey) {
    throw new Error('STEDI_API_KEY environment variable is not configured');
  }
  return {
    'Authorization': `Key ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

// Payer IDs for common insurance companies
export const PAYER_IDS: Record<string, string> = {
  'aetna': '60054',
  'anthem': '00805',
  'bcbs': '00590', // Varies by state
  'cigna': '62308',
  'humana': '61101',
  'kaiser': '91617',
  'medicare': 'CMS',
  'medicaid': 'SKMED', // Varies by state
  'united': '87726',
  'tricare': '99726',
};

/**
 * Eligibility Verification (270/271)
 * Check if a patient has active insurance coverage
 */
export interface EligibilityRequest {
  // Subscriber (primary insurance holder)
  subscriber: {
    memberId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string; // YYYY-MM-DD
  };
  // Patient (if different from subscriber)
  patient?: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    relationshipToSubscriber: 'self' | 'spouse' | 'child' | 'other';
  };
  // Provider info
  provider: {
    npi: string;
    organizationName?: string;
    firstName?: string;
    lastName?: string;
  };
  // Payer info
  payer: {
    id: string; // Payer ID
    name?: string;
  };
  // Service type codes (optional)
  serviceTypeCodes?: string[];
  // Date of service (optional, defaults to today)
  dateOfService?: string;
}

export interface EligibilityResponse {
  status: 'active' | 'inactive' | 'unknown';
  raw: any;
  planName?: string;
  planNumber?: string;
  groupNumber?: string;
  effectiveDate?: string;
  terminationDate?: string;
  copay?: {
    primary?: number;
    specialist?: number;
    urgentCare?: number;
    emergency?: number;
  };
  deductible?: {
    individual?: number;
    family?: number;
    remaining?: number;
  };
  outOfPocketMax?: {
    individual?: number;
    family?: number;
    remaining?: number;
  };
  coinsurance?: number;
  coverageDetails?: Array<{
    serviceType: string;
    coverage: string;
    inNetwork: boolean;
    limitations?: string;
  }>;
  errors?: string[];
}

export async function checkEligibility(request: EligibilityRequest): Promise<EligibilityResponse> {
  const payload = {
    controlNumber: generateControlNumber(),
    tradingPartnerServiceId: request.payer.id,
    provider: {
      organizationName: request.provider.organizationName,
      npi: request.provider.npi,
      ...(request.provider.firstName && {
        firstName: request.provider.firstName,
        lastName: request.provider.lastName,
      }),
    },
    subscriber: {
      memberId: request.subscriber.memberId,
      firstName: request.subscriber.firstName,
      lastName: request.subscriber.lastName,
      dateOfBirth: request.subscriber.dateOfBirth,
    },
    ...(request.patient && request.patient.relationshipToSubscriber !== 'self' && {
      dependent: {
        firstName: request.patient.firstName,
        lastName: request.patient.lastName,
        dateOfBirth: request.patient.dateOfBirth,
        relationshipCode: getRelationshipCode(request.patient.relationshipToSubscriber),
      },
    }),
    encounter: {
      serviceTypeCodes: request.serviceTypeCodes || ['30'], // 30 = Health Benefit Plan Coverage
      dateOfService: request.dateOfService || new Date().toISOString().split('T')[0],
    },
  };

  try {
    const response = await fetch(`${STEDI_API_BASE}/eligibility-checks`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Stedi eligibility error:', error);
      return {
        status: 'unknown',
        raw: error,
        errors: [error.message || 'Failed to check eligibility'],
      };
    }

    const data = await response.json();
    return parseEligibilityResponse(data);
  } catch (error: any) {
    console.error('Stedi eligibility error:', error);
    return {
      status: 'unknown',
      raw: null,
      errors: [error.message || 'Network error checking eligibility'],
    };
  }
}

/**
 * Claims Submission (837P - Professional)
 */
export interface ClaimSubmission {
  // Claim info
  claimId: string;
  totalAmount: number;
  placeOfService: string; // '11' = office, '12' = home, etc.
  dateOfService: string;

  // Patient info
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    gender: 'M' | 'F' | 'U';
    address: {
      line1: string;
      line2?: string;
      city: string;
      state: string;
      zip: string;
    };
    memberId: string;
  };

  // Subscriber (if different from patient)
  subscriber?: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    memberId: string;
    relationshipToPatient: string;
  };

  // Provider info
  provider: {
    npi: string;
    taxId: string;
    organizationName?: string;
    firstName?: string;
    lastName?: string;
    address: {
      line1: string;
      city: string;
      state: string;
      zip: string;
    };
    taxonomy?: string;
  };

  // Payer info
  payer: {
    id: string;
    name: string;
  };

  // Service lines
  serviceLines: Array<{
    procedureCode: string;
    modifiers?: string[];
    diagnosisCodes: string[];
    amount: number;
    units: number;
    dateOfService: string;
    description?: string;
  }>;

  // Diagnosis codes (ICD-10)
  diagnosisCodes: string[];

  // Prior authorization number (if applicable)
  priorAuthNumber?: string;
}

export interface ClaimSubmissionResponse {
  success: boolean;
  claimId: string;
  stediClaimId?: string;
  status: 'accepted' | 'rejected' | 'pending';
  raw: any;
  errors?: string[];
  warnings?: string[];
}

export async function submitClaim(claim: ClaimSubmission): Promise<ClaimSubmissionResponse> {
  const payload = build837P(claim);

  try {
    const response = await fetch(`${STEDI_API_BASE}/claims`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Stedi claim submission error:', error);
      return {
        success: false,
        claimId: claim.claimId,
        status: 'rejected',
        raw: error,
        errors: [error.message || 'Failed to submit claim'],
      };
    }

    const data = await response.json();
    return {
      success: true,
      claimId: claim.claimId,
      stediClaimId: data.claimId || data.id,
      status: 'accepted',
      raw: data,
    };
  } catch (error: any) {
    console.error('Stedi claim submission error:', error);
    return {
      success: false,
      claimId: claim.claimId,
      status: 'rejected',
      raw: null,
      errors: [error.message || 'Network error submitting claim'],
    };
  }
}

/**
 * Claim Status Inquiry (276/277)
 */
export interface ClaimStatusRequest {
  claimId: string;
  payer: {
    id: string;
  };
  provider: {
    npi: string;
    taxId?: string;
  };
  subscriber: {
    memberId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
  };
  dateOfService: string;
  claimAmount?: number;
}

export interface ClaimStatusResponse {
  claimId: string;
  status: 'pending' | 'paid' | 'denied' | 'rejected' | 'unknown';
  statusCode?: string;
  statusDescription?: string;
  paidAmount?: number;
  paidDate?: string;
  checkNumber?: string;
  denialReason?: string;
  raw: any;
  errors?: string[];
}

export async function checkClaimStatus(request: ClaimStatusRequest): Promise<ClaimStatusResponse> {
  const payload = {
    controlNumber: generateControlNumber(),
    tradingPartnerServiceId: request.payer.id,
    provider: {
      npi: request.provider.npi,
      taxId: request.provider.taxId,
    },
    subscriber: {
      memberId: request.subscriber.memberId,
      firstName: request.subscriber.firstName,
      lastName: request.subscriber.lastName,
      dateOfBirth: request.subscriber.dateOfBirth,
    },
    claimInformation: {
      patientControlNumber: request.claimId,
      dateOfService: request.dateOfService,
      ...(request.claimAmount && { claimAmount: request.claimAmount }),
    },
  };

  try {
    const response = await fetch(`${STEDI_API_BASE}/claim-status`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        claimId: request.claimId,
        status: 'unknown',
        raw: error,
        errors: [error.message || 'Failed to check claim status'],
      };
    }

    const data = await response.json();
    return parseClaimStatusResponse(request.claimId, data);
  } catch (error: any) {
    return {
      claimId: request.claimId,
      status: 'unknown',
      raw: null,
      errors: [error.message || 'Network error checking claim status'],
    };
  }
}

// Helper functions

function generateControlNumber(): string {
  return `${Date.now()}${Math.random().toString(36).substring(2, 8)}`.toUpperCase();
}

function getRelationshipCode(relationship: string): string {
  const codes: Record<string, string> = {
    'self': '18',
    'spouse': '01',
    'child': '19',
    'other': '21',
  };
  return codes[relationship] || '21';
}

function parseEligibilityResponse(data: any): EligibilityResponse {
  // Parse the 271 response from Stedi
  // This is a simplified parser - real implementation would be more comprehensive

  const response: EligibilityResponse = {
    status: 'unknown',
    raw: data,
  };

  try {
    // Check for active coverage
    const benefitsInfo = data.benefitsInformation || [];
    const activeBenefit = benefitsInfo.find((b: any) =>
      b.code === '1' || b.informationCode === 'A' // Active coverage
    );

    if (activeBenefit) {
      response.status = 'active';
    } else {
      const inactiveBenefit = benefitsInfo.find((b: any) =>
        b.code === '6' || b.informationCode === 'I' // Inactive
      );
      if (inactiveBenefit) {
        response.status = 'inactive';
      }
    }

    // Extract plan info
    const planInfo = data.planInformation || {};
    response.planName = planInfo.planName || data.planName;
    response.planNumber = planInfo.planNumber || data.planNumber;
    response.groupNumber = planInfo.groupNumber || data.groupNumber;

    // Extract dates
    response.effectiveDate = data.planDateInformation?.planBegin;
    response.terminationDate = data.planDateInformation?.planEnd;

    // Extract copay info
    const copays: any = {};
    benefitsInfo.forEach((benefit: any) => {
      if (benefit.code === 'B' && benefit.amount) { // Copay
        const serviceType = benefit.serviceTypeCode || benefit.serviceType;
        if (serviceType === '98') copays.primary = benefit.amount; // Professional
        if (serviceType === 'AL') copays.specialist = benefit.amount; // Specialist
        if (serviceType === 'UC') copays.urgentCare = benefit.amount; // Urgent care
        if (serviceType === 'ER') copays.emergency = benefit.amount; // Emergency
      }
    });
    if (Object.keys(copays).length > 0) {
      response.copay = copays;
    }

    // Extract deductible info
    const deductibleBenefit = benefitsInfo.find((b: any) => b.code === 'C');
    if (deductibleBenefit) {
      response.deductible = {
        individual: deductibleBenefit.amount,
        remaining: deductibleBenefit.remainingAmount,
      };
    }

    // Extract out-of-pocket max
    const oopBenefit = benefitsInfo.find((b: any) => b.code === 'G');
    if (oopBenefit) {
      response.outOfPocketMax = {
        individual: oopBenefit.amount,
        remaining: oopBenefit.remainingAmount,
      };
    }

    // Extract coinsurance
    const coinsuranceBenefit = benefitsInfo.find((b: any) => b.code === 'A' && b.percent);
    if (coinsuranceBenefit) {
      response.coinsurance = coinsuranceBenefit.percent;
    }

  } catch (error) {
    console.error('Error parsing eligibility response:', error);
  }

  return response;
}

function parseClaimStatusResponse(claimId: string, data: any): ClaimStatusResponse {
  const response: ClaimStatusResponse = {
    claimId,
    status: 'unknown',
    raw: data,
  };

  try {
    const statusInfo = data.claimStatus || data;
    const statusCode = statusInfo.statusCategoryCode || statusInfo.code;

    // Map status codes
    const statusMap: Record<string, ClaimStatusResponse['status']> = {
      'F1': 'paid',
      'F2': 'paid', // Partial payment
      'A0': 'pending',
      'A1': 'pending',
      'A2': 'pending',
      'A3': 'pending',
      'A4': 'pending',
      'R': 'rejected',
      'D0': 'denied',
    };

    response.status = statusMap[statusCode] || 'unknown';
    response.statusCode = statusCode;
    response.statusDescription = statusInfo.statusDescription || statusInfo.message;

    if (response.status === 'paid') {
      response.paidAmount = statusInfo.paidAmount || statusInfo.amount;
      response.paidDate = statusInfo.paidDate;
      response.checkNumber = statusInfo.checkNumber || statusInfo.referenceNumber;
    }

    if (response.status === 'denied') {
      response.denialReason = statusInfo.denialReason || statusInfo.message;
    }

  } catch (error) {
    console.error('Error parsing claim status response:', error);
  }

  return response;
}

function build837P(claim: ClaimSubmission): any {
  // Build the 837P claim payload for Stedi
  // This is a simplified version - real implementation would be more comprehensive

  return {
    controlNumber: generateControlNumber(),
    tradingPartnerServiceId: claim.payer.id,
    submitter: {
      organizationName: claim.provider.organizationName,
      contactInformation: {
        name: claim.provider.organizationName || `${claim.provider.firstName} ${claim.provider.lastName}`,
        phoneNumber: '0000000000', // Should be from practice settings
      },
    },
    receiver: {
      organizationName: claim.payer.name,
    },
    subscriber: {
      memberId: claim.subscriber?.memberId || claim.patient.memberId,
      firstName: claim.subscriber?.firstName || claim.patient.firstName,
      lastName: claim.subscriber?.lastName || claim.patient.lastName,
      dateOfBirth: claim.subscriber?.dateOfBirth || claim.patient.dateOfBirth,
      address: claim.patient.address,
    },
    ...(claim.subscriber && {
      patient: {
        firstName: claim.patient.firstName,
        lastName: claim.patient.lastName,
        dateOfBirth: claim.patient.dateOfBirth,
        gender: claim.patient.gender,
        address: claim.patient.address,
        relationshipToSubscriberCode: getRelationshipCode(claim.subscriber.relationshipToPatient),
      },
    }),
    billing: {
      npi: claim.provider.npi,
      taxonomyCode: claim.provider.taxonomy || '101YM0800X', // Mental health counselor
      organizationName: claim.provider.organizationName,
      address: claim.provider.address,
      taxId: claim.provider.taxId,
    },
    rendering: {
      npi: claim.provider.npi,
      taxonomyCode: claim.provider.taxonomy || '101YM0800X',
      firstName: claim.provider.firstName,
      lastName: claim.provider.lastName,
    },
    claimInformation: {
      patientControlNumber: claim.claimId,
      claimChargeAmount: claim.totalAmount.toString(),
      placeOfServiceCode: claim.placeOfService,
      claimFrequencyCode: '1', // Original claim
      signatureIndicator: 'Y',
      planParticipationCode: 'A', // Assigned
      releaseOfInformationCode: 'Y',
      diagnosisCodes: claim.diagnosisCodes.map((code, index) => ({
        code,
        type: 'ABK', // ICD-10
        pointer: index + 1,
      })),
      ...(claim.priorAuthNumber && {
        priorAuthorizationNumber: claim.priorAuthNumber,
      }),
    },
    serviceLines: claim.serviceLines.map((line, index) => ({
      serviceLineNumber: index + 1,
      procedureCode: line.procedureCode,
      procedureModifiers: line.modifiers || [],
      chargeAmount: line.amount.toString(),
      unitCount: line.units.toString(),
      serviceDate: line.dateOfService,
      diagnosisCodePointers: line.diagnosisCodes.map((_, i) => i + 1),
      description: line.description,
    })),
  };
}

export default {
  isStediConfigured,
  checkEligibility,
  submitClaim,
  checkClaimStatus,
  PAYER_IDS,
};
