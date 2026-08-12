/**
 * Tests for name-based trading partner resolution
 * (server/payer-integrations/adapters/payers/StediAdapter.ts).
 *
 * Regression cover for 2026-08-12: the map key 'blue_cross' contained an
 * underscore, but the matcher strips every non-letter from the payer name
 * before substring-matching — so that key could never match anything, and
 * every spelled-out Blue Cross plan failed eligibility with "No trading
 * partner ID found", even when spelled perfectly.
 */

import { describe, it, expect } from 'vitest';
import { resolveTradingPartnerIdByName } from '../payer-integrations/adapters/payers/StediAdapter';

describe('resolveTradingPartnerIdByName', () => {
  it('resolves spelled-out Blue Cross names (the 2026-08-12 failure)', () => {
    // The exact string from the production error toast.
    expect(resolveTradingPartnerIdByName('BLUE CROSS BLUE SHIELD')).toBe('00050');
    expect(resolveTradingPartnerIdByName('Blue Cross Blue Shield')).toBe('00050');
    expect(resolveTradingPartnerIdByName('BlueCross BlueShield')).toBe('00050');
  });

  it('routes Horizon to Horizon BCBS NJ, not generic BCBS', () => {
    // Verified against Stedi's payer registry (stediId NRHDN, payer 22099).
    expect(resolveTradingPartnerIdByName('Horizon Blue Cross Blue Shield of New Jersey')).toBe('22099');
    expect(resolveTradingPartnerIdByName('Horizon BCBSNJ')).toBe('22099');
  });

  it('still resolves the abbreviation and other majors', () => {
    expect(resolveTradingPartnerIdByName('BCBS')).toBe('00050');
    expect(resolveTradingPartnerIdByName('Aetna')).toBe('60054');
    expect(resolveTradingPartnerIdByName('UnitedHealthcare')).toBe('87726');
    expect(resolveTradingPartnerIdByName('Cigna Healthcare')).toBe('62308');
  });

  it('is insensitive to case, spacing, and punctuation', () => {
    expect(resolveTradingPartnerIdByName('  aEtNa!  ')).toBe('60054');
    expect(resolveTradingPartnerIdByName('U.H.C.')).toBe('87726');
  });

  it('returns null for unknown payers rather than guessing', () => {
    expect(resolveTradingPartnerIdByName('Oscar Health')).toBeNull();
    expect(resolveTradingPartnerIdByName('')).toBeNull();
  });

  it('every map key is matchable: letters only', async () => {
    // The invariant whose violation caused the outage. A key with any
    // non-letter can never match a normalized name; fail loudly if one
    // sneaks back in.
    const src = await import('fs').then((fs) =>
      fs.readFileSync('server/payer-integrations/adapters/payers/StediAdapter.ts', 'utf8')
    );
    const mapBlock = src.match(/TRADING_PARTNER_MAP[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? '';
    const keys = [...mapBlock.matchAll(/'([^']+)':/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      expect(key, `map key '${key}' contains non-letters and can never match`).toMatch(/^[a-z]+$/);
    }
  });
});
