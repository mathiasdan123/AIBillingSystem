/**
 * PayerDataSource — vendor-agnostic adapter for patient-authorized payer data.
 *
 * This is the clean "portal access" seam for the payer-advocacy wedge ("Sheer
 * for practices"). It models how we retrieve a patient's coverage + claims +
 * explanation-of-benefit data DIRECTLY from their health plan, with the
 * patient's authorization — WITHOUT ever handling the patient's payer-portal
 * password.
 *
 * The real mechanism is the CMS-mandated payer Patient Access API (HL7 FHIR,
 * CMS-9115-F): the patient authenticates at their OWN payer via OAuth and we
 * receive a token — never a credential. In practice this is reached through a
 * FHIR aggregator (Flexpa, 1upHealth, Particle, ...). We deliberately keep the
 * concrete vendor BEHIND this interface so:
 *   - we can build the consent/intake/UI plumbing now, before signing a vendor;
 *   - the Flexpa-vs-1upHealth cost decision (flat annual vs per-patient) can be
 *     made later based on real patient-connection volume;
 *   - swapping or adding a vendor is an adapter change, not a rewrite.
 *
 * SECURITY CONTRACT: an implementation must NEVER persist a patient's payer
 * portal username/password. Only OAuth tokens (access/refresh), scoped to the
 * patient's authorization and revocable. Tokens are PHI-adjacent — encrypt at
 * rest via phiEncryptionService when a real adapter is built.
 *
 * Today this ships as the interface + a NullPayerDataSource that throws
 * "not configured", so calling code can be written and tested against the
 * contract before any vendor exists.
 */

/** Normalized coverage record (subset of FHIR Coverage we care about). */
export interface PayerCoverage {
  payerName: string;
  memberId: string;
  groupNumber?: string;
  planName?: string;
  planType?: string; // HMO | PPO | EPO | ...
  subscriberName?: string;
  employerName?: string;
  effectiveDate?: string; // ISO date
  terminationDate?: string; // ISO date
  status?: string; // active | inactive | ...
  raw?: unknown; // original FHIR resource, for audit / re-parse
}

/** Normalized explanation-of-benefit / claim line (subset of FHIR EOB). */
export interface PayerExplanationOfBenefit {
  claimId: string;
  serviceDate?: string; // ISO date
  providerName?: string;
  cptCode?: string;
  billedAmount?: number;
  allowedAmount?: number;
  paidAmount?: number;
  patientResponsibility?: number;
  adjustmentReasonCodes?: string[]; // CARC
  remarkCodes?: string[]; // RARC
  status?: string; // paid | denied | partial | ...
  raw?: unknown;
}

/** Result of starting a patient authorization flow. */
export interface PayerAuthInit {
  /** URL to redirect the patient to (their payer's OAuth screen). */
  authorizationUrl: string;
  /** Opaque state we must verify on callback (CSRF protection). */
  state: string;
}

/** Result of completing a patient authorization flow. */
export interface PayerConnection {
  /** Aggregator/payer connection id we can use for subsequent fetches. */
  connectionId: string;
  payerName?: string;
  /** When this authorization expires, if known (ISO). */
  expiresAt?: string;
}

/**
 * The adapter contract. A concrete FHIR-aggregator implementation
 * (FlexpaPayerDataSource, OneUpPayerDataSource, ...) implements this.
 */
export interface PayerDataSource {
  /** Human-readable adapter name, for logging/telemetry. */
  readonly vendor: string;

  /** True when the adapter has the config/keys it needs to operate. */
  isConfigured(): boolean;

  /**
   * Begin a patient-authorized connection. Returns a URL to redirect the
   * patient to their payer's OAuth screen. We never see their password.
   */
  beginConnection(params: {
    practiceId: number;
    patientId: number;
    /** Where the payer should redirect after the patient authorizes. */
    redirectUri: string;
  }): Promise<PayerAuthInit>;

  /**
   * Complete the OAuth handshake from the payer's redirect. Returns a durable
   * connection handle. The implementation persists tokens (encrypted) keyed by
   * the connection — callers store only the returned connectionId.
   */
  completeConnection(params: {
    code: string;
    state: string;
    expectedState: string;
  }): Promise<PayerConnection>;

  /** Fetch the patient's coverage record(s) for an established connection. */
  fetchCoverage(connectionId: string): Promise<PayerCoverage[]>;

  /**
   * Fetch the patient's explanation-of-benefit / claim history. Optional date
   * window (ISO dates) to limit the pull.
   */
  fetchExplanationOfBenefits(
    connectionId: string,
    opts?: { since?: string; until?: string },
  ): Promise<PayerExplanationOfBenefit[]>;

  /** Revoke a connection (patient withdrew authorization). Best-effort. */
  revokeConnection(connectionId: string): Promise<void>;
}

/** Thrown when no payer data source is configured. */
export class PayerDataSourceNotConfiguredError extends Error {
  constructor(op: string) {
    super(
      `PayerDataSource not configured (attempted: ${op}). No FHIR aggregator ` +
        `(e.g. Flexpa / 1upHealth) has been wired yet — this is the vendor-` +
        `agnostic seam only.`,
    );
    this.name = 'PayerDataSourceNotConfiguredError';
  }
}

/**
 * Default no-op adapter. Lets calling code, routes, and tests be written
 * against the contract before any vendor is signed. Every data call throws
 * the not-configured error; `isConfigured()` is false so callers can branch.
 */
export class NullPayerDataSource implements PayerDataSource {
  readonly vendor = 'null';

  isConfigured(): boolean {
    return false;
  }

  async beginConnection(): Promise<PayerAuthInit> {
    throw new PayerDataSourceNotConfiguredError('beginConnection');
  }

  async completeConnection(): Promise<PayerConnection> {
    throw new PayerDataSourceNotConfiguredError('completeConnection');
  }

  async fetchCoverage(): Promise<PayerCoverage[]> {
    throw new PayerDataSourceNotConfiguredError('fetchCoverage');
  }

  async fetchExplanationOfBenefits(): Promise<PayerExplanationOfBenefit[]> {
    throw new PayerDataSourceNotConfiguredError('fetchExplanationOfBenefits');
  }

  async revokeConnection(): Promise<void> {
    throw new PayerDataSourceNotConfiguredError('revokeConnection');
  }
}

/**
 * Resolve the active payer data source. Today always returns the Null adapter;
 * when a vendor is chosen, construct + return it here (gated on env keys).
 * Centralizing resolution means routes/services call getPayerDataSource()
 * without knowing the vendor.
 */
export function getPayerDataSource(): PayerDataSource {
  // Future: if (process.env.FLEXPA_API_KEY) return new FlexpaPayerDataSource();
  // Future: if (process.env.ONEUP_CLIENT_ID) return new OneUpPayerDataSource();
  return new NullPayerDataSource();
}
