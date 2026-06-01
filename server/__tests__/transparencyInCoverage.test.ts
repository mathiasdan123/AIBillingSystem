import { describe, it, expect } from 'vitest';
import {
  normalizeTicRates,
  OT_ST_CPT_CODES,
  type TicInNetworkRate,
} from '../services/transparencyInCoverageParser';

const opts = { payerName: 'Aetna', effectiveDate: '2026-01-01' };

describe('Transparency-in-Coverage rate parser', () => {
  it('normalizes a basic in-network rate to a fee-schedule row', () => {
    const rates: TicInNetworkRate[] = [
      {
        billing_code: '97530',
        billing_code_type: 'CPT',
        name: 'Therapeutic activities',
        negotiated_rates: [
          { negotiated_prices: [{ negotiated_type: 'negotiated', negotiated_rate: 45.5 }] },
        ],
      },
    ];
    const out = normalizeTicRates(rates, opts);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      payerName: 'Aetna',
      cptCode: '97530',
      expectedReimbursement: 45.5,
      effectiveDate: '2026-01-01',
    });
  });

  it('keeps the LOWEST negotiated rate per code+modifier (conservative floor)', () => {
    const rates: TicInNetworkRate[] = [
      {
        billing_code: '97110',
        billing_code_type: 'CPT',
        negotiated_rates: [
          {
            negotiated_prices: [
              { negotiated_type: 'negotiated', negotiated_rate: 40 },
              { negotiated_type: 'negotiated', negotiated_rate: 32 },
              { negotiated_type: 'negotiated', negotiated_rate: 38 },
            ],
          },
        ],
      },
    ];
    const out = normalizeTicRates(rates, opts);
    expect(out).toHaveLength(1);
    expect(out[0].expectedReimbursement).toBe(32);
  });

  it('separates rows by modifier set', () => {
    const rates: TicInNetworkRate[] = [
      {
        billing_code: '92507',
        billing_code_type: 'CPT',
        negotiated_rates: [
          {
            negotiated_prices: [
              { negotiated_type: 'negotiated', negotiated_rate: 80, billing_code_modifier: ['GN'] },
              { negotiated_type: 'negotiated', negotiated_rate: 75 },
            ],
          },
        ],
      },
    ];
    const out = normalizeTicRates(rates, opts);
    expect(out).toHaveLength(2);
    const gn = out.find((r) => r.modifiers?.includes('GN'));
    expect(gn?.expectedReimbursement).toBe(80);
  });

  it('rejects percentage and zero/invalid rates', () => {
    const rates: TicInNetworkRate[] = [
      {
        billing_code: '97535',
        billing_code_type: 'CPT',
        negotiated_rates: [
          {
            negotiated_prices: [
              { negotiated_type: 'percentage', negotiated_rate: 65 },
              { negotiated_type: 'negotiated', negotiated_rate: 0 },
              { negotiated_type: 'negotiated', negotiated_rate: -5 },
            ],
          },
        ],
      },
    ];
    expect(normalizeTicRates(rates, opts)).toHaveLength(0);
  });

  it('applies a CPT allowlist', () => {
    const rates: TicInNetworkRate[] = [
      { billing_code: '97530', billing_code_type: 'CPT', negotiated_rates: [{ negotiated_prices: [{ negotiated_type: 'negotiated', negotiated_rate: 45 }] }] },
      { billing_code: '99213', billing_code_type: 'CPT', negotiated_rates: [{ negotiated_prices: [{ negotiated_type: 'negotiated', negotiated_rate: 90 }] }] },
    ];
    const out = normalizeTicRates(rates, { ...opts, cptAllowlist: ['97530'] });
    expect(out).toHaveLength(1);
    expect(out[0].cptCode).toBe('97530');
  });

  it('skips non-CPT/HCPCS billing code types', () => {
    const rates: TicInNetworkRate[] = [
      { billing_code: 'ABC', billing_code_type: 'CDT', negotiated_rates: [{ negotiated_prices: [{ negotiated_type: 'negotiated', negotiated_rate: 50 }] }] },
    ];
    expect(normalizeTicRates(rates, opts)).toHaveLength(0);
  });

  it('OT_ST_CPT_CODES covers core OT + ST codes and excludes PT-only/E&M', () => {
    expect(OT_ST_CPT_CODES).toContain('97165'); // OT eval
    expect(OT_ST_CPT_CODES).toContain('92507'); // speech treatment
    expect(OT_ST_CPT_CODES).not.toContain('99213'); // office E&M
    expect(OT_ST_CPT_CODES).not.toContain('97161'); // PT eval (out of scope)
  });
});
