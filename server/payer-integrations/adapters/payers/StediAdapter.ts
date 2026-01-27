import logger from '../../../services/logger';
import type { NormalizedEligibility, NormalizedBenefits } from '@shared/schema';

const STEDI_API_URL = 'https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3';

// Trading partner service IDs for major payers
const TRADING_PARTNER_MAP: Record<string, string> = {
  'aetna': '60054',
  'anthem': '00025',
  'bcbs': '00050',
  'blue_cross': '00050',
  'cigna': '62308',
  'humana': '61101',
  'kaiser': '94135',
  'united': '87726',
  'unitedhealthcare': '87726',
  'uhc': '87726',
  'medicare': 'CMS',
  'medicaid': 'SKMD0',
  'tricare': '99726',
};

export interface StediEligibilityRequest {
  controlNumber: string;
  tradingPartnerServiceId: string;
  provider: {
    organizationName: string;
    npi: string;
  };
  subscriber: {
    memberId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string; // YYYYMMDD
    groupNumber?: string;
  };
  encounter: {
    serviceTypeCodes: string[];
    dateRange?: {
      startDate: string;
      endDate: string;
    };
  };
}

export interface StediEligibilityResponse {
  controlNumber: string;
  tradingPartnerServiceId: string;
  provider: any;
  subscriber: any;
  planInformation?: any[];
  benefitsInformation?: any[];
  errors?: any[];
}

export class StediAdapter {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async checkEligibility(params: {
    providerNpi: string;
    providerName: string;
    memberFirstName: string;
    memberLastName: string;
    memberDob: string; // YYYY-MM-DD
    memberId: string;
    groupNumber?: string;
    payerName: string;
    tradingPartnerServiceId?: string;
  }): Promise<{ eligibility: NormalizedEligibility; benefits: NormalizedBenefits; raw: any }> {
    const tradingPartnerId = params.tradingPartnerServiceId ||
      this.resolveTradingPartnerId(params.payerName);

    if (!tradingPartnerId) {
      throw new Error(`No trading partner ID found for payer: ${params.payerName}`);
    }

    const controlNumber = this.generateControlNumber();
    const dobFormatted = params.memberDob.replace(/-/g, '');

    const request: StediEligibilityRequest = {
      controlNumber,
      tradingPartnerServiceId: tradingPartnerId,
      provider: {
        organizationName: params.providerName,
        npi: params.providerNpi,
      },
      subscriber: {
        memberId: params.memberId,
        firstName: params.memberFirstName,
        lastName: params.memberLastName,
        dateOfBirth: dobFormatted,
        groupNumber: params.groupNumber,
      },
      encounter: {
        serviceTypeCodes: ['30'], // Health Benefit Plan Coverage (OT-relevant)
      },
    };

    logger.info('Stedi eligibility request', {
      controlNumber,
      tradingPartnerId,
      providerNpi: params.providerNpi,
    });

    try {
      const response = await fetch(STEDI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Key ${this.apiKey}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error('Stedi API error', {
          status: response.status,
          body: errorBody,
          controlNumber,
        });
        throw new Error(`Stedi API returned ${response.status}: ${errorBody}`);
      }

      const rawResponse: StediEligibilityResponse = await response.json();

      logger.info('Stedi eligibility response received', {
        controlNumber,
        hasErrors: !!rawResponse.errors?.length,
      });

      if (rawResponse.errors && rawResponse.errors.length > 0) {
        logger.warn('Stedi response contains errors', {
          errors: rawResponse.errors,
          controlNumber,
        });
      }

      const eligibility = this.parseEligibility(rawResponse, params);
      const benefits = this.parseBenefits(rawResponse);

      return { eligibility, benefits, raw: rawResponse };
    } catch (error: any) {
      logger.error('Stedi eligibility check failed', {
        error: error.message,
        controlNumber,
      });
      throw error;
    }
  }

  private parseEligibility(response: StediEligibilityResponse, params: any): NormalizedEligibility {
    const subscriber = response.subscriber || {};
    const planInfo = response.planInformation?.[0] || {};

    // Determine status from benefits information
    let status: 'active' | 'inactive' | 'unknown' = 'unknown';
    const benefits = response.benefitsInformation || [];

    for (const benefit of benefits) {
      if (benefit.code === '1' || benefit.informationCode === 'Active Coverage') {
        status = 'active';
        break;
      }
      if (benefit.code === '6' || benefit.informationCode === 'Inactive') {
        status = 'inactive';
        break;
      }
    }

    return {
      isEligible: status === 'active',
      effectiveDate: this.parseDateField(planInfo.planDate || planInfo.effectiveDate) || '',
      terminationDate: this.parseDateField(planInfo.terminationDate) || undefined,
      planName: planInfo.planDescription || planInfo.insuranceType || '',
      planType: planInfo.insuranceType || '',
      memberId: subscriber.memberId || params.memberId,
      groupNumber: subscriber.groupNumber || params.groupNumber || undefined,
      coverageLevel: 'individual',
      networkStatus: 'in_network',
    };
  }

  private parseBenefits(response: StediEligibilityResponse): NormalizedBenefits {
    const benefits = response.benefitsInformation || [];
    let copay = 0;
    let coinsurance = 0;
    let deductibleIndividual = 0;
    let deductibleFamily = 0;
    let deductibleIndividualMet = 0;
    let deductibleFamilyMet = 0;
    let oopIndividual = 0;
    let oopFamily = 0;
    let oopIndividualMet = 0;
    let oopFamilyMet = 0;
    let visitsAllowed: number | undefined;
    let visitsUsed: number | undefined;
    let priorAuthRequired = false;
    let referralRequired = false;

    for (const benefit of benefits) {
      const code = benefit.code;
      const amount = parseFloat(benefit.benefitAmount || '0');
      const percent = parseFloat(benefit.benefitPercent || '0');

      // Only process in-network benefits by default
      if (benefit.inPlanNetworkIndicator === 'N') continue;

      switch (code) {
        case 'B': // Co-Payment
          if (amount > 0) copay = amount;
          break;
        case 'A': // Co-Insurance
          if (percent > 0) coinsurance = percent;
          break;
        case 'C': // Deductible
          if (amount > 0) deductibleIndividual = amount;
          break;
        case 'G': // Out of Pocket Maximum
          if (amount > 0) oopIndividual = amount;
          break;
        case 'F': // Limitations
          if (benefit.quantityQualifier === 'VS') {
            visitsAllowed = parseInt(benefit.quantity || '0');
          }
          break;
        case 'CB': // Authorization Required
          priorAuthRequired = true;
          break;
      }
    }

    return {
      deductible: {
        individual: deductibleIndividual,
        family: deductibleFamily,
        individualMet: deductibleIndividualMet,
        familyMet: deductibleFamilyMet,
      },
      outOfPocketMax: {
        individual: oopIndividual,
        family: oopFamily,
        individualMet: oopIndividualMet,
        familyMet: oopFamilyMet,
      },
      copay,
      coinsurance,
      visitsAllowed,
      visitsUsed,
      priorAuthRequired,
      referralRequired,
    };
  }

  private resolveTradingPartnerId(payerName: string): string | null {
    const normalized = payerName.toLowerCase().replace(/[^a-z]/g, '');
    for (const [key, id] of Object.entries(TRADING_PARTNER_MAP)) {
      if (normalized.includes(key)) return id;
    }
    return null;
  }

  private generateControlNumber(): string {
    return `TB${Date.now()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  }

  private parseDateField(dateStr: string | undefined | null): string | null {
    if (!dateStr) return null;
    // Handle YYYYMMDD format
    if (dateStr.length === 8 && !dateStr.includes('-')) {
      return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
    }
    return dateStr;
  }

  // Health check - test connection to Stedi
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      // Simple connectivity test - Stedi doesn't have a dedicated health endpoint
      // so we check if we can reach the API with an invalid but well-formed request
      const response = await fetch(STEDI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Key ${this.apiKey}`,
        },
        body: JSON.stringify({
          controlNumber: 'HEALTHCHECK',
          tradingPartnerServiceId: '00000',
          provider: { organizationName: 'Test', npi: '0000000000' },
          subscriber: { memberId: 'TEST', firstName: 'Test', lastName: 'Test', dateOfBirth: '19900101' },
          encounter: { serviceTypeCodes: ['30'] },
        }),
      });

      // A 400/422 means the API is reachable (bad request is expected for test data)
      // A 401 means bad API key
      // A 5xx means service issue
      if (response.status === 401) {
        return { healthy: false, message: 'Invalid API key' };
      }
      if (response.status >= 500) {
        return { healthy: false, message: `Stedi service error: ${response.status}` };
      }
      return { healthy: true, message: 'Connected to Stedi API' };
    } catch (error: any) {
      return { healthy: false, message: `Connection failed: ${error.message}` };
    }
  }
}
