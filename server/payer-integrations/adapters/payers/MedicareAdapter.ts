import type {
  NormalizedEligibility,
  NormalizedBenefits,
  NormalizedClaimsHistory,
  PayerCredential,
} from '@shared/schema';
import type { PayerRequestContext, PayerResponse } from '../../interfaces/IPayerAdapter';
import { PayerMemberNotFoundError, PayerInvalidRequestError } from '../../interfaces/IPayerAdapter';
import { BasePayerAdapter } from '../BasePayerAdapter';
import { credentialManager, type OAuthCredentials } from '../../payerCredentialManager';

// CMS Blue Button 2.0 API base URLs
const SANDBOX_BASE_URL = 'https://sandbox.bluebutton.cms.gov';
const PRODUCTION_BASE_URL = 'https://api.bluebutton.cms.gov';

export class MedicareAdapter extends BasePayerAdapter {
  readonly payerCode = 'MEDICARE';
  readonly apiType = 'fhir_r4' as const;

  private baseUrl: string;

  constructor(useSandbox: boolean = true) {
    super();
    this.baseUrl = useSandbox ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL;
  }

  async authenticate(credentials: PayerCredential): Promise<{
    success: boolean;
    token?: string;
    expiresAt?: Date;
    error?: string;
  }> {
    try {
      const credData = credentialManager.decrypt(credentials) as OAuthCredentials;

      if (credData.type !== 'oauth_client') {
        return { success: false, error: 'Invalid credential type for Medicare' };
      }

      // CMS Blue Button uses OAuth 2.0
      const tokenEndpoint = `${this.baseUrl}/v2/o/token/`;

      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credData.clientId,
        client_secret: credData.clientSecret,
      });

      const response = await this.fetchWithRetry(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `Token request failed: ${errorText}` };
      }

      const tokenData = await response.json();

      return {
        success: true,
        token: tokenData.access_token,
        expiresAt: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      };
    }
  }

  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'down';
    latencyMs: number;
    message?: string;
  }> {
    const start = Date.now();

    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });

      const latencyMs = Date.now() - start;

      if (response.ok) {
        return { status: 'healthy', latencyMs };
      } else if (response.status < 500) {
        return { status: 'degraded', latencyMs, message: `HTTP ${response.status}` };
      } else {
        return { status: 'down', latencyMs, message: `HTTP ${response.status}` };
      }
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async checkEligibility(
    context: PayerRequestContext
  ): Promise<PayerResponse<NormalizedEligibility>> {
    const requestId = this.generateRequestId();
    const start = Date.now();

    try {
      const token = await this.ensureAuthenticated(context.credentials);

      // Search for patient by Medicare Beneficiary Identifier (MBI)
      const patientSearchUrl = new URL(`${this.baseUrl}/v2/fhir/Patient`);
      patientSearchUrl.searchParams.set('identifier', context.memberId);

      const patientResponse = await this.fetchWithRetry(patientSearchUrl.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/fhir+json',
        },
      });

      const responseTimeMs = Date.now() - start;

      if (!patientResponse.ok) {
        if (patientResponse.status === 404) {
          throw new PayerMemberNotFoundError(this.payerCode, context.memberId);
        }
        const errorText = await patientResponse.text();
        return this.createErrorResponse(
          'API_ERROR',
          `Medicare API error: ${errorText}`,
          responseTimeMs,
          { status: patientResponse.status },
          requestId
        );
      }

      const bundle = await patientResponse.json();

      if (!bundle.entry || bundle.entry.length === 0) {
        throw new PayerMemberNotFoundError(this.payerCode, context.memberId);
      }

      const patient = bundle.entry[0].resource;

      // Get coverage information
      const coverageUrl = new URL(`${this.baseUrl}/v2/fhir/Coverage`);
      coverageUrl.searchParams.set('beneficiary', `Patient/${patient.id}`);

      const coverageResponse = await this.fetchWithRetry(coverageUrl.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/fhir+json',
        },
      });

      const coverageBundle = await coverageResponse.json();
      const coverage = coverageBundle.entry?.[0]?.resource;

      // Normalize the eligibility data
      const eligibility: NormalizedEligibility = this.normalizeEligibility(patient, coverage);

      return this.createSuccessResponse(
        eligibility,
        { patient, coverage },
        Date.now() - start,
        requestId
      );
    } catch (error) {
      const responseTimeMs = Date.now() - start;

      if (error instanceof PayerMemberNotFoundError) {
        return this.createErrorResponse(
          'MEMBER_NOT_FOUND',
          error.message,
          responseTimeMs,
          undefined,
          requestId
        );
      }

      return this.createErrorResponse(
        'UNKNOWN_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
        responseTimeMs,
        undefined,
        requestId
      );
    }
  }

  async getBenefits(
    context: PayerRequestContext
  ): Promise<PayerResponse<NormalizedBenefits>> {
    const requestId = this.generateRequestId();
    const start = Date.now();

    try {
      const token = await this.ensureAuthenticated(context.credentials);

      // For Medicare, benefits are typically retrieved from ExplanationOfBenefit resources
      const eobUrl = new URL(`${this.baseUrl}/v2/fhir/ExplanationOfBenefit`);
      eobUrl.searchParams.set('patient', context.memberId);
      eobUrl.searchParams.set('_count', '1'); // Just get one to extract benefit info

      const eobResponse = await this.fetchWithRetry(eobUrl.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/fhir+json',
        },
      });

      const responseTimeMs = Date.now() - start;

      if (!eobResponse.ok) {
        return this.createErrorResponse(
          'API_ERROR',
          'Failed to retrieve benefits',
          responseTimeMs,
          undefined,
          requestId
        );
      }

      const eobBundle = await eobResponse.json();

      // Medicare typically has Part A and Part B deductibles
      const benefits: NormalizedBenefits = {
        deductible: {
          individual: 233, // 2024 Part B deductible (would come from API in production)
          family: 233,
          individualMet: 0, // Would calculate from EOBs
          familyMet: 0,
        },
        outOfPocketMax: {
          individual: 8850, // Would come from plan details
          family: 8850,
          individualMet: 0,
          familyMet: 0,
        },
        copay: 0, // Medicare Part B typically has 20% coinsurance
        coinsurance: 20,
        priorAuthRequired: false,
        referralRequired: false,
      };

      return this.createSuccessResponse(
        benefits,
        eobBundle,
        responseTimeMs,
        requestId
      );
    } catch (error) {
      return this.createErrorResponse(
        'UNKNOWN_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
        Date.now() - start,
        undefined,
        requestId
      );
    }
  }

  async getClaimsHistory(
    context: PayerRequestContext,
    options?: { startDate?: string; endDate?: string }
  ): Promise<PayerResponse<NormalizedClaimsHistory>> {
    const requestId = this.generateRequestId();
    const start = Date.now();

    try {
      const token = await this.ensureAuthenticated(context.credentials);

      // Get ExplanationOfBenefit resources (claims history)
      const eobUrl = new URL(`${this.baseUrl}/v2/fhir/ExplanationOfBenefit`);
      eobUrl.searchParams.set('patient', context.memberId);

      if (options?.startDate) {
        eobUrl.searchParams.set('service-date', `ge${options.startDate}`);
      }
      if (options?.endDate) {
        eobUrl.searchParams.set('service-date', `le${options.endDate}`);
      }

      const eobResponse = await this.fetchWithRetry(eobUrl.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/fhir+json',
        },
      });

      const responseTimeMs = Date.now() - start;

      if (!eobResponse.ok) {
        return this.createErrorResponse(
          'API_ERROR',
          'Failed to retrieve claims history',
          responseTimeMs,
          undefined,
          requestId
        );
      }

      const eobBundle = await eobResponse.json();

      const claimsHistory = this.normalizeClaimsHistory(eobBundle);

      return this.createSuccessResponse(
        claimsHistory,
        eobBundle,
        responseTimeMs,
        requestId
      );
    } catch (error) {
      return this.createErrorResponse(
        'UNKNOWN_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
        Date.now() - start,
        undefined,
        requestId
      );
    }
  }

  supportsCapability(
    capability: 'eligibility' | 'benefits' | 'claims_history' | 'prior_auth'
  ): boolean {
    // Medicare Blue Button supports all except prior auth through this interface
    return ['eligibility', 'benefits', 'claims_history'].includes(capability);
  }

  // Helper: Normalize FHIR Patient/Coverage to NormalizedEligibility
  private normalizeEligibility(
    patient: any,
    coverage?: any
  ): NormalizedEligibility {
    const now = new Date();
    const startDate = coverage?.period?.start || now.toISOString().split('T')[0];
    const endDate = coverage?.period?.end;

    // Determine plan type from coverage type
    let planType = 'Medicare';
    if (coverage?.type?.coding) {
      const coding = coverage.type.coding[0];
      if (coding.code === 'PART-A') planType = 'Medicare Part A';
      else if (coding.code === 'PART-B') planType = 'Medicare Part B';
      else if (coding.code === 'PART-D') planType = 'Medicare Part D';
    }

    return {
      isEligible: !endDate || new Date(endDate) > now,
      effectiveDate: startDate,
      terminationDate: endDate,
      planName: planType,
      planType: 'Medicare',
      memberId: patient.identifier?.find((id: any) => id.system?.includes('mbi'))?.value || '',
      groupNumber: coverage?.subscriberId,
      coverageLevel: 'individual',
      networkStatus: 'in_network', // Medicare doesn't have traditional networks
    };
  }

  // Helper: Normalize FHIR EOB Bundle to NormalizedClaimsHistory
  private normalizeClaimsHistory(eobBundle: any): NormalizedClaimsHistory {
    const claims: NormalizedClaimsHistory['claims'] = [];
    let totalPaid = 0;

    if (eobBundle.entry) {
      for (const entry of eobBundle.entry) {
        const eob = entry.resource;

        const billedAmount = this.parseAmount(
          eob.total?.find((t: any) => t.category?.coding?.[0]?.code === 'submitted')?.amount?.value
        );
        const allowedAmount = this.parseAmount(
          eob.total?.find((t: any) => t.category?.coding?.[0]?.code === 'eligible')?.amount?.value
        );
        const paidAmount = this.parseAmount(
          eob.total?.find((t: any) => t.category?.coding?.[0]?.code === 'benefit')?.amount?.value
        );

        totalPaid += paidAmount;

        claims.push({
          claimNumber: eob.identifier?.[0]?.value || eob.id,
          dateOfService: eob.billablePeriod?.start || eob.created,
          provider: eob.provider?.display || 'Unknown Provider',
          serviceType: eob.type?.coding?.[0]?.display || 'Medical Service',
          billedAmount,
          allowedAmount,
          paidAmount,
          patientResponsibility: allowedAmount - paidAmount,
          status: eob.status || 'unknown',
        });
      }
    }

    return {
      claims,
      totalClaims: claims.length,
      totalPaid,
    };
  }
}

// Export singleton instance for sandbox testing
export const medicareAdapter = new MedicareAdapter(true);
