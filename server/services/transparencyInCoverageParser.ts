/**
 * Transparency-in-Coverage (TiC) rate parser.
 *
 * Part of the payer-advocacy wedge ("Sheer for practices"). The CMS
 * Transparency in Coverage rule requires payers to publish machine-readable
 * files (MRFs) of their in-network negotiated rates. Those rates are the
 * ground truth for "what SHOULD this payer have paid" — which is exactly what
 * underpayment detection needs.
 *
 * Flow: TiC in-network-rate JSON  ->  normalize to fee-schedule rows
 *       (practiceId, payerName, cptCode, expectedReimbursement, effectiveDate)
 *       ->  feeSchedules table  ->  underpaymentAnalyzer  ->  Recovery Ledger.
 *
 * SCOPE (foundation slice): this module is the PURE PARSER/NORMALIZER. It takes
 * already-loaded TiC in-network objects and returns fee-schedule-insert rows,
 * filtered to the CPT codes and payer we care about. It deliberately does NOT
 * download the MRFs — those files are often multi-GB per payer and acquiring/
 * streaming them is a separate operational job (table-of-contents resolution +
 * gzip streaming) to be built when we wire a real payer feed. Keeping the
 * parser pure means it is fully unit-testable with no network or DB.
 *
 * TiC in-network-rate shape (subset we consume):
 *   {
 *     negotiated_rates: [{
 *       negotiated_prices: [{
 *         negotiated_type: "negotiated" | "fee schedule" | "percentage" | ...,
 *         negotiated_rate: 183.42,
 *         billing_code_modifier?: string[],
 *         expiration_date?: "2026-12-31",
 *         service_code?: string[]
 *       }],
 *       provider_groups?: [...]
 *     }],
 *     billing_code: "97530",
 *     billing_code_type: "CPT",
 *     billing_code_type_version?: "2026",
 *     name?: "Therapeutic activities",
 *     negotiation_arrangement?: "ffs"
 *   }
 */

/** A single in-network-rate object from a TiC MRF (subset). */
export interface TicInNetworkRate {
  billing_code?: string;
  billing_code_type?: string; // "CPT" | "HCPCS" | ...
  name?: string;
  negotiated_rates?: Array<{
    negotiated_prices?: Array<{
      negotiated_type?: string;
      negotiated_rate?: number;
      billing_code_modifier?: string[];
      expiration_date?: string;
      service_code?: string[];
    }>;
  }>;
}

/** Normalized fee-schedule row ready for the feeSchedules table. */
export interface NormalizedTicRate {
  payerName: string;
  cptCode: string;
  description?: string;
  /** Negotiated rate → expectedReimbursement on the fee schedule. */
  expectedReimbursement: number;
  /** Modifiers attached to this price, if any (e.g. ['GO','GP']). */
  modifiers?: string[];
  effectiveDate: string; // ISO date
  expirationDate?: string; // ISO date
}

export interface TicParseOptions {
  /** The payer these rates belong to (TiC files are per-payer). */
  payerName: string;
  /** Only keep these CPT codes (e.g. our OT + ST set). Empty = keep all. */
  cptAllowlist?: string[];
  /** Effective date to stamp rows with (ISO). Defaults to caller-supplied. */
  effectiveDate: string;
  /**
   * Which negotiated_type values to accept. TiC includes several; for
   * fee-for-service underpayment comparison we want fixed-dollar rates, not
   * percentage-of-billed. Defaults to dollar-amount types.
   */
  acceptTypes?: string[];
}

const DEFAULT_ACCEPT_TYPES = ['negotiated', 'fee schedule', 'derived'];

/**
 * Normalize a batch of TiC in-network-rate objects into fee-schedule rows.
 * Pure: no network, no DB. One input billing_code can yield multiple rows
 * (different modifier combinations / negotiated prices); we keep the LOWEST
 * negotiated rate per (cptCode, modifier-set) as the conservative "expected"
 * floor — underpayment is only flagged when paid falls below even that.
 */
export function normalizeTicRates(
  rates: TicInNetworkRate[],
  opts: TicParseOptions,
): NormalizedTicRate[] {
  const allow = opts.cptAllowlist && opts.cptAllowlist.length > 0
    ? new Set(opts.cptAllowlist)
    : null;
  const acceptTypes = new Set(
    (opts.acceptTypes && opts.acceptTypes.length > 0 ? opts.acceptTypes : DEFAULT_ACCEPT_TYPES).map(
      (t) => t.toLowerCase(),
    ),
  );

  // key = cptCode + '|' + sorted-modifiers  ->  best (lowest) row
  const best = new Map<string, NormalizedTicRate>();

  for (const item of rates) {
    if (!item || typeof item !== 'object') continue;
    const cpt = item.billing_code?.trim();
    if (!cpt) continue;
    // Only CPT/HCPCS billing codes (therapy is CPT). Skip others.
    const codeType = (item.billing_code_type || 'CPT').toUpperCase();
    if (codeType !== 'CPT' && codeType !== 'HCPCS') continue;
    if (allow && !allow.has(cpt)) continue;

    for (const nr of item.negotiated_rates || []) {
      for (const price of nr.negotiated_prices || []) {
        const type = (price.negotiated_type || '').toLowerCase();
        if (!acceptTypes.has(type)) continue;
        const rate = price.negotiated_rate;
        if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) continue;

        const modifiers = Array.isArray(price.billing_code_modifier)
          ? price.billing_code_modifier.filter((m) => typeof m === 'string' && m.trim())
          : undefined;
        const modKey = (modifiers ?? []).slice().sort().join(',');
        const key = `${cpt}|${modKey}`;

        const candidate: NormalizedTicRate = {
          payerName: opts.payerName,
          cptCode: cpt,
          description: item.name,
          expectedReimbursement: rate,
          modifiers: modifiers && modifiers.length > 0 ? modifiers : undefined,
          effectiveDate: opts.effectiveDate,
          expirationDate:
            typeof price.expiration_date === 'string' ? price.expiration_date : undefined,
        };

        const existing = best.get(key);
        if (!existing || candidate.expectedReimbursement < existing.expectedReimbursement) {
          best.set(key, candidate);
        }
      }
    }
  }

  return Array.from(best.values());
}

/**
 * OT + ST CPT codes we currently care about (initial scope is OT + speech
 * therapy). Used as the default allowlist so TiC ingestion only pulls the
 * rates relevant to underpayment detection for our disciplines.
 */
export const OT_ST_CPT_CODES: string[] = [
  // Occupational therapy
  '97165', '97166', '97167', '97168', // OT eval / re-eval
  '97110', '97112', '97530', '97533', '97535', '97537', // OT treatment
  '97150', // group therapeutic
  // Speech-language therapy
  '92507', '92508', // speech/language treatment (individual / group)
  '92521', '92522', '92523', '92524', // speech eval components
  '92526', // swallowing/feeding treatment
  '92610', // swallowing eval
];
