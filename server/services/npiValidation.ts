/**
 * NPI validation + NPPES registry lookup (Phase 1 — multi-practice enrollment).
 *
 * Two layers:
 *   1. `isValidNpi` — offline structural check. An NPI is 10 digits whose
 *      last digit is a Luhn check digit computed over "80840" + the first
 *      9 digits (the 80840 prefix is the NPI's ISO issuer identifier).
 *      This catches typos and the universal dummy NPI 1234567890 without a
 *      network round-trip.
 *   2. `lookupNpi` — online confirmation against the public NPPES registry
 *      (no auth required). Confirms the NPI is real and returns the
 *      registered name/address/taxonomy so the UI can offer to autofill and
 *      flag mismatches before we ever submit an enrollment.
 *
 * Used by the provider-profile route to gate enrollment submission: a
 * structurally-invalid or unregistered NPI must never reach Stedi.
 */

import logger from './logger';

const NPI_ISSUER_PREFIX = '80840';

/** Luhn check digit for a base numeric string (no check digit included). */
function luhnCheckDigit(base: string): number {
  let sum = 0;
  let double = true; // rightmost base digit is doubled first
  for (let i = base.length - 1; i >= 0; i--) {
    let d = base.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Structural NPI validation (offline). Returns true only for a 10-digit
 * value whose Luhn check digit is correct. Rejects 1234567890.
 */
export function isValidNpi(npi: string | null | undefined): boolean {
  const s = String(npi ?? '').replace(/\D/g, '');
  if (!/^\d{10}$/.test(s)) return false;
  const base = NPI_ISSUER_PREFIX + s.slice(0, 9);
  return luhnCheckDigit(base) === Number(s[9]);
}

export interface NpiLookupResult {
  found: boolean;
  npi: string;
  enumerationType?: 'NPI-1' | 'NPI-2'; // NPI-1 individual, NPI-2 organization
  name?: string;
  taxonomyCode?: string;
  taxonomyDesc?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  error?: string;
}

/**
 * Confirm an NPI against the public NPPES registry and return registered
 * details. Network/parse failures are returned as { found:false, error }
 * rather than thrown — the caller decides whether to hard-block or warn.
 */
export async function lookupNpi(
  npi: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NpiLookupResult> {
  const s = String(npi ?? '').replace(/\D/g, '');
  if (!isValidNpi(s)) {
    return { found: false, npi: s, error: 'invalid_npi_format' };
  }
  try {
    const url = `https://npiregistry.cms.hhs.gov/api/?version=2.1&number=${s}`;
    const resp = await fetchImpl(url, { method: 'GET' });
    if (!resp.ok) {
      return { found: false, npi: s, error: `nppes_http_${resp.status}` };
    }
    const data: any = await resp.json().catch(() => ({}));
    return parseNppesResponse(s, data);
  } catch (err: any) {
    logger.warn('NPPES lookup failed', { npi: s, error: err?.message || String(err) });
    return { found: false, npi: s, error: 'nppes_unreachable' };
  }
}

/** Pure parser for an NPPES API response — exported for unit testing. */
export function parseNppesResponse(npi: string, data: any): NpiLookupResult {
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  if ((data?.result_count ?? results.length) === 0 || results.length === 0) {
    return { found: false, npi, error: 'not_registered' };
  }
  const r = results[0];
  const enumerationType = r?.enumeration_type as 'NPI-1' | 'NPI-2' | undefined;
  const basic = r?.basic ?? {};
  const name =
    enumerationType === 'NPI-2'
      ? basic.organization_name
      : [basic.first_name, basic.last_name].filter(Boolean).join(' ') || undefined;

  // Prefer the LOCATION address; fall back to first address.
  const addresses: any[] = Array.isArray(r?.addresses) ? r.addresses : [];
  const loc =
    addresses.find((a) => a?.address_purpose === 'LOCATION') || addresses[0] || {};
  const address = {
    street: [loc.address_1, loc.address_2].filter(Boolean).join(', ') || undefined,
    city: loc.city || undefined,
    state: loc.state || undefined,
    zip: loc.postal_code ? String(loc.postal_code).slice(0, 5) : undefined,
  };

  const taxonomies: any[] = Array.isArray(r?.taxonomies) ? r.taxonomies : [];
  const primaryTax = taxonomies.find((t) => t?.primary) || taxonomies[0] || {};

  return {
    found: true,
    npi,
    enumerationType,
    name,
    taxonomyCode: primaryTax.code || undefined,
    taxonomyDesc: primaryTax.desc || undefined,
    address,
  };
}
