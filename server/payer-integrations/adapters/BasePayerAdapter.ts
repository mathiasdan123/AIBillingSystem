// @ts-ignore
import { v4 as uuidv4 } from 'uuid';
import type {
  NormalizedEligibility,
  NormalizedBenefits,
  NormalizedClaimsHistory,
  NormalizedPriorAuth,
  PayerCredential,
} from '@shared/schema';
import type {
  IPayerAdapter,
  PayerRequestContext,
  PayerResponse,
} from '../interfaces/IPayerAdapter';
import {
  PayerAdapterError,
  PayerServiceUnavailableError,
} from '../interfaces/IPayerAdapter';

export abstract class BasePayerAdapter implements IPayerAdapter {
  abstract readonly payerCode: string;
  abstract readonly apiType: 'edi_270' | 'fhir_r4' | 'proprietary';

  protected cachedToken?: {
    token: string;
    expiresAt: Date;
  };

  // Abstract methods that must be implemented by subclasses
  abstract authenticate(credentials: PayerCredential): Promise<{
    success: boolean;
    token?: string;
    expiresAt?: Date;
    error?: string;
  }>;

  abstract healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'down';
    latencyMs: number;
    message?: string;
  }>;

  // Default implementations (can be overridden)
  async checkEligibility(
    context: PayerRequestContext
  ): Promise<PayerResponse<NormalizedEligibility>> {
    return this.notImplementedResponse('eligibility');
  }

  async getBenefits(
    context: PayerRequestContext
  ): Promise<PayerResponse<NormalizedBenefits>> {
    return this.notImplementedResponse('benefits');
  }

  async getClaimsHistory(
    context: PayerRequestContext,
    options?: { startDate?: string; endDate?: string }
  ): Promise<PayerResponse<NormalizedClaimsHistory>> {
    return this.notImplementedResponse('claims_history');
  }

  async checkPriorAuth(
    context: PayerRequestContext,
    serviceCode: string
  ): Promise<PayerResponse<NormalizedPriorAuth>> {
    return this.notImplementedResponse('prior_auth');
  }

  supportsCapability(
    capability: 'eligibility' | 'benefits' | 'claims_history' | 'prior_auth'
  ): boolean {
    // Default: only eligibility is supported
    return capability === 'eligibility';
  }

  // Helper methods for subclasses
  protected generateRequestId(): string {
    return uuidv4();
  }

  protected async measureResponseTime<T>(
    operation: () => Promise<T>
  ): Promise<{ result: T; responseTimeMs: number }> {
    const start = Date.now();
    const result = await operation();
    const responseTimeMs = Date.now() - start;
    return { result, responseTimeMs };
  }

  protected createSuccessResponse<T>(
    data: T,
    rawResponse: unknown,
    responseTimeMs: number,
    requestId?: string
  ): PayerResponse<T> {
    return {
      success: true,
      data,
      rawResponse,
      responseTimeMs,
      requestId: requestId || this.generateRequestId(),
    };
  }

  protected createErrorResponse<T>(
    code: string,
    message: string,
    responseTimeMs: number,
    details?: unknown,
    requestId?: string
  ): PayerResponse<T> {
    return {
      success: false,
      error: { code, message, details },
      responseTimeMs,
      requestId: requestId || this.generateRequestId(),
    };
  }

  protected notImplementedResponse<T>(capability: string): PayerResponse<T> {
    return this.createErrorResponse(
      'NOT_IMPLEMENTED',
      `${capability} is not implemented for ${this.payerCode}`,
      0
    );
  }

  protected isTokenValid(): boolean {
    if (!this.cachedToken) return false;
    // Consider token invalid 5 minutes before actual expiry
    const buffer = 5 * 60 * 1000;
    return this.cachedToken.expiresAt.getTime() - buffer > Date.now();
  }

  protected async ensureAuthenticated(credentials: PayerCredential): Promise<string> {
    if (this.isTokenValid() && this.cachedToken) {
      return this.cachedToken.token;
    }

    const authResult = await this.authenticate(credentials);
    if (!authResult.success || !authResult.token) {
      throw new PayerAdapterError(
        authResult.error || 'Authentication failed',
        'AUTH_FAILED',
        this.payerCode
      );
    }

    this.cachedToken = {
      token: authResult.token,
      expiresAt: authResult.expiresAt || new Date(Date.now() + 3600000), // Default 1 hour
    };

    return this.cachedToken.token;
  }

  // HTTP helper with retry logic
  protected async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries: number = 3,
    retryDelayMs: number = 1000
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(30000), // 30 second timeout
        });

        // Don't retry on client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          return response;
        }

        // Retry on server errors (5xx) and network issues
        if (response.ok || response.status < 500) {
          return response;
        }

        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      // Wait before retrying (exponential backoff)
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelayMs * Math.pow(2, attempt))
        );
      }
    }

    throw new PayerServiceUnavailableError(
      this.payerCode,
      lastError?.message || 'Service unavailable after retries'
    );
  }

  // Date formatting helpers
  protected formatDateYYYYMMDD(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toISOString().split('T')[0].replace(/-/g, '');
  }

  protected formatDateISO(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toISOString().split('T')[0];
  }

  // Parse common response formats
  protected parseAmount(value: string | number | undefined | null): number {
    if (value === undefined || value === null) return 0;
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return isNaN(num) ? 0 : num;
  }

  protected parseBoolean(value: string | boolean | undefined | null): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return ['true', 'yes', '1', 'y'].includes(value.toLowerCase());
    }
    return false;
  }
}
