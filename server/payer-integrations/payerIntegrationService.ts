import type {
  PatientInsuranceAuthorization,
  PayerIntegration,
  Patient,
  Practice,
  InsuranceDataCache,
  NormalizedEligibility,
  NormalizedBenefits,
  NormalizedClaimsHistory,
  NormalizedPriorAuth,
} from '@shared/schema';
import { storage } from '../storage';
import { credentialManager } from './payerCredentialManager';
import type { IPayerAdapter, PayerRequestContext, PayerResponse } from './interfaces/IPayerAdapter';
import { PayerAdapterError } from './interfaces/IPayerAdapter';
import { MedicareAdapter } from './adapters/payers/MedicareAdapter';

// Adapter registry
const adapterRegistry: Map<string, IPayerAdapter> = new Map();

// Register available adapters
function registerAdapter(adapter: IPayerAdapter): void {
  adapterRegistry.set(adapter.payerCode, adapter);
}

// Initialize default adapters
registerAdapter(new MedicareAdapter(true)); // Sandbox mode for now

export type DataType = 'eligibility' | 'benefits' | 'claims_history' | 'prior_auth';

export interface FetchDataOptions {
  forceRefresh?: boolean;
  cacheExpiryHours?: number;
}

export interface FetchDataResult<T> {
  success: boolean;
  data?: T;
  cached: boolean;
  cachedAt?: Date;
  error?: string;
  responseTimeMs?: number;
}

export class PayerIntegrationService {
  /**
   * Get an adapter for a specific payer
   */
  getAdapter(payerCode: string): IPayerAdapter | undefined {
    return adapterRegistry.get(payerCode);
  }

  /**
   * Get all registered payer codes
   */
  getAvailablePayers(): string[] {
    return Array.from(adapterRegistry.keys());
  }

  /**
   * Fetch insurance data for a patient with authorization
   */
  async fetchInsuranceData(
    authorization: PatientInsuranceAuthorization,
    dataType: DataType,
    options: FetchDataOptions = {}
  ): Promise<FetchDataResult<any>> {
    const { forceRefresh = false, cacheExpiryHours = 24 } = options;

    // Check if authorization is valid
    if (authorization.status !== 'authorized') {
      return { success: false, cached: false, error: 'Authorization is not active' };
    }

    // Check if the requested data type is within the authorized scopes
    const scopes = authorization.scopes as string[];
    if (!scopes.includes(dataType)) {
      return { success: false, cached: false, error: `Data type '${dataType}' not authorized` };
    }

    // Get patient details
    const patient = await storage.getPatient(authorization.patientId);
    if (!patient) {
      return { success: false, cached: false, error: 'Patient not found' };
    }

    // Get practice details
    const practice = await storage.getPractice(authorization.practiceId);
    if (!practice) {
      return { success: false, cached: false, error: 'Practice not found' };
    }

    // Check cache first (unless forceRefresh)
    if (!forceRefresh) {
      const cached = await storage.getCachedInsuranceData(patient.id, dataType);
      if (cached && cached.status === 'success' && !cached.isStale) {
        const expiresAt = cached.expiresAt ? new Date(cached.expiresAt) : null;
        if (expiresAt && expiresAt > new Date()) {
          return {
            success: true,
            data: cached.normalizedData,
            cached: true,
            cachedAt: cached.fetchedAt ? new Date(cached.fetchedAt) : undefined,
          };
        }
      }
    }

    // Determine which payer to use based on patient's insurance
    const payerCode = this.mapInsuranceToPayerCode(patient.insuranceProvider);
    if (!payerCode) {
      return {
        success: false,
        cached: false,
        error: `Unsupported insurance provider: ${patient.insuranceProvider}`,
      };
    }

    // Get the adapter
    const adapter = this.getAdapter(payerCode);
    if (!adapter) {
      return {
        success: false,
        cached: false,
        error: `No adapter available for payer: ${payerCode}`,
      };
    }

    // Check if adapter supports the requested capability
    if (!adapter.supportsCapability(dataType)) {
      return {
        success: false,
        cached: false,
        error: `Payer ${payerCode} does not support ${dataType}`,
      };
    }

    // Get payer integration configuration
    const payerIntegration = await storage.getPayerIntegrationByCode(payerCode);
    if (!payerIntegration) {
      return {
        success: false,
        cached: false,
        error: `Payer integration not configured for: ${payerCode}`,
      };
    }

    // Get credentials
    const credentialResult = await credentialManager.getCredentials(
      practice.id,
      payerIntegration.id
    );
    if (!credentialResult) {
      return {
        success: false,
        cached: false,
        error: `No valid credentials for ${payerCode}. Please configure payer credentials.`,
      };
    }

    // Build request context
    const context: PayerRequestContext = {
      practiceId: practice.id,
      patientId: patient.id,
      memberId: patient.insuranceId || '',
      dateOfBirth: patient.dateOfBirth || '',
      firstName: patient.firstName,
      lastName: patient.lastName,
      payerIntegration,
      credentials: credentialResult.credential,
    };

    // Fetch data from payer
    let response: PayerResponse<any>;
    try {
      switch (dataType) {
        case 'eligibility':
          response = await adapter.checkEligibility(context);
          break;
        case 'benefits':
          response = await adapter.getBenefits(context);
          break;
        case 'claims_history':
          response = await adapter.getClaimsHistory(context);
          break;
        case 'prior_auth':
          response = await adapter.checkPriorAuth(context, '');
          break;
        default:
          return { success: false, cached: false, error: `Unknown data type: ${dataType}` };
      }
    } catch (error) {
      // Record credential error if applicable
      if (error instanceof PayerAdapterError && error.code === 'AUTH_FAILED') {
        await credentialManager.recordError(
          credentialResult.credential.id,
          error.message
        );
      }

      return {
        success: false,
        cached: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Record successful credential usage
    if (response.success) {
      await credentialManager.recordUsage(credentialResult.credential.id);
    }

    // Cache the result
    const cacheExpiresAt = new Date(Date.now() + cacheExpiryHours * 60 * 60 * 1000);
    await storage.cacheInsuranceData({
      practiceId: practice.id,
      patientId: patient.id,
      authorizationId: authorization.id,
      payerIntegrationId: payerIntegration.id,
      dataType,
      rawResponse: response.rawResponse || null,
      normalizedData: response.data || null,
      status: response.success ? 'success' : 'error',
      errorMessage: response.error?.message || null,
      errorCode: response.error?.code || null,
      fetchedAt: new Date(),
      expiresAt: cacheExpiresAt,
      isStale: false,
      requestId: response.requestId,
      responseTimeMs: response.responseTimeMs,
    });

    // Log the data access
    await storage.createAuditLogEntry({
      practiceId: practice.id,
      patientId: patient.id,
      authorizationId: authorization.id,
      actorType: 'system',
      actorId: 'payer_integration_service',
      eventType: 'data_accessed',
      dataType,
      eventDetails: {
        payerCode,
        responseTimeMs: response.responseTimeMs,
        success: response.success,
      },
      success: response.success,
      errorMessage: response.error?.message,
    });

    if (response.success) {
      return {
        success: true,
        data: response.data,
        cached: false,
        responseTimeMs: response.responseTimeMs,
      };
    } else {
      return {
        success: false,
        cached: false,
        error: response.error?.message || 'Unknown error',
        responseTimeMs: response.responseTimeMs,
      };
    }
  }

  /**
   * Fetch all authorized data types for a patient
   */
  async fetchAllAuthorizedData(
    authorization: PatientInsuranceAuthorization,
    options: FetchDataOptions = {}
  ): Promise<Map<DataType, FetchDataResult<any>>> {
    const results = new Map<DataType, FetchDataResult<any>>();
    const scopes = authorization.scopes as string[];

    // Fetch each authorized data type
    const fetchPromises = scopes.map(async (scope) => {
      if (['eligibility', 'benefits', 'claims_history', 'prior_auth'].includes(scope)) {
        const result = await this.fetchInsuranceData(
          authorization,
          scope as DataType,
          options
        );
        results.set(scope as DataType, result);
      }
    });

    await Promise.all(fetchPromises);

    return results;
  }

  /**
   * Map insurance provider name to payer code
   */
  private mapInsuranceToPayerCode(insuranceProvider: string | null): string | null {
    if (!insuranceProvider) return null;

    const provider = insuranceProvider.toLowerCase();

    // Medicare
    if (provider.includes('medicare')) {
      return 'MEDICARE';
    }

    // Future: Add more mappings as adapters are implemented
    // if (provider.includes('united') || provider.includes('uhc')) {
    //   return 'UHC';
    // }
    // if (provider.includes('aetna')) {
    //   return 'AETNA';
    // }
    // if (provider.includes('cigna')) {
    //   return 'CIGNA';
    // }
    // if (provider.includes('anthem') || provider.includes('blue cross')) {
    //   return 'ANTHEM';
    // }

    return null;
  }

  /**
   * Check health of all payer integrations
   */
  async checkAllPayerHealth(): Promise<
    Map<
      string,
      { status: 'healthy' | 'degraded' | 'down'; latencyMs: number; message?: string }
    >
  > {
    const results = new Map();

    for (const [payerCode, adapter] of adapterRegistry) {
      try {
        const health = await adapter.healthCheck();
        results.set(payerCode, health);

        // Update health status in database
        const integration = await storage.getPayerIntegrationByCode(payerCode);
        if (integration) {
          await storage.updatePayerIntegration(integration.id, {
            lastHealthCheck: new Date(),
            healthStatus: health.status,
          });
        }
      } catch (error) {
        results.set(payerCode, {
          status: 'down',
          latencyMs: 0,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  }

  /**
   * Refresh stale cache data for a patient
   */
  async refreshStaleData(patientId: number): Promise<void> {
    // Get all authorizations for the patient
    const authorizations = await storage.getPatientAuthorizations(patientId);

    for (const auth of authorizations) {
      if (auth.status === 'authorized') {
        await this.fetchAllAuthorizedData(auth, { forceRefresh: true });
      }
    }
  }

  /**
   * Get cached data for display
   */
  async getCachedDataForPatient(
    patientId: number,
    dataTypes?: DataType[]
  ): Promise<Map<DataType, any>> {
    const results = new Map<DataType, any>();
    const types: DataType[] = dataTypes || [
      'eligibility',
      'benefits',
      'claims_history',
      'prior_auth',
    ];

    for (const dataType of types) {
      const cached = await storage.getCachedInsuranceData(patientId, dataType);
      if (cached && cached.status === 'success' && cached.normalizedData) {
        results.set(dataType, cached.normalizedData);
      }
    }

    return results;
  }
}

// Export singleton instance
export const payerIntegrationService = new PayerIntegrationService();
