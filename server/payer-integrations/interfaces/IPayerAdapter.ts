import type {
  NormalizedEligibility,
  NormalizedBenefits,
  NormalizedClaimsHistory,
  NormalizedPriorAuth,
  PayerIntegration,
  PayerCredential,
} from '@shared/schema';

export interface PayerRequestContext {
  practiceId: number;
  patientId: number;
  memberId: string;
  dateOfBirth: string;
  firstName: string;
  lastName: string;
  payerIntegration: PayerIntegration;
  credentials: PayerCredential;
  requestId?: string;
}

export interface PayerResponse<T> {
  success: boolean;
  data?: T;
  rawResponse?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  responseTimeMs: number;
  requestId: string;
}

export interface IPayerAdapter {
  // Adapter identification
  readonly payerCode: string;
  readonly apiType: 'edi_270' | 'fhir_r4' | 'proprietary';

  // Authentication
  authenticate(credentials: PayerCredential): Promise<{
    success: boolean;
    token?: string;
    expiresAt?: Date;
    error?: string;
  }>;

  // Health check
  healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'down';
    latencyMs: number;
    message?: string;
  }>;

  // Data retrieval methods
  checkEligibility(context: PayerRequestContext): Promise<PayerResponse<NormalizedEligibility>>;

  getBenefits(context: PayerRequestContext): Promise<PayerResponse<NormalizedBenefits>>;

  getClaimsHistory(
    context: PayerRequestContext,
    options?: { startDate?: string; endDate?: string }
  ): Promise<PayerResponse<NormalizedClaimsHistory>>;

  checkPriorAuth(
    context: PayerRequestContext,
    serviceCode: string
  ): Promise<PayerResponse<NormalizedPriorAuth>>;

  // Capability check
  supportsCapability(capability: 'eligibility' | 'benefits' | 'claims_history' | 'prior_auth'): boolean;
}

// Base error class for payer adapter errors
export class PayerAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly payerCode: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'PayerAdapterError';
  }
}

export class PayerAuthenticationError extends PayerAdapterError {
  constructor(payerCode: string, message: string, details?: unknown) {
    super(message, 'AUTH_FAILED', payerCode, details);
    this.name = 'PayerAuthenticationError';
  }
}

export class PayerRateLimitError extends PayerAdapterError {
  constructor(payerCode: string, retryAfterSeconds?: number) {
    super(
      `Rate limit exceeded${retryAfterSeconds ? `. Retry after ${retryAfterSeconds} seconds` : ''}`,
      'RATE_LIMITED',
      payerCode,
      { retryAfterSeconds }
    );
    this.name = 'PayerRateLimitError';
  }
}

export class PayerServiceUnavailableError extends PayerAdapterError {
  constructor(payerCode: string, message: string) {
    super(message, 'SERVICE_UNAVAILABLE', payerCode);
    this.name = 'PayerServiceUnavailableError';
  }
}

export class PayerInvalidRequestError extends PayerAdapterError {
  constructor(payerCode: string, message: string, details?: unknown) {
    super(message, 'INVALID_REQUEST', payerCode, details);
    this.name = 'PayerInvalidRequestError';
  }
}

export class PayerMemberNotFoundError extends PayerAdapterError {
  constructor(payerCode: string, memberId: string) {
    super(`Member not found: ${memberId}`, 'MEMBER_NOT_FOUND', payerCode, { memberId });
    this.name = 'PayerMemberNotFoundError';
  }
}
