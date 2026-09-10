/**
 * Anthem is state-specific in Stedi's registry — there is no single "Anthem"
 * payer. The crosswalk therefore carries one row per Anthem state entity plus
 * a New York fallback row whose keywords include plain "anthem" (Wonder Kids,
 * the only Anthem-billing practice today, bills Anthem BCBS of New York).
 *
 * That mix only works because resolvePayerId picks the MOST SPECIFIC
 * crosswalk match, not the first row scanned: with first-match-wins the
 * fallback's generic "anthem" keyword would swallow "Anthem BCBS of Indiana"
 * and route another state's plan to New York. These tests pin the specificity
 * rule and the normalization that lets abbreviation variants ("Anthem BCBS of
 * Ohio" vs "Anthem Blue Cross Blue Shield Ohio") resolve identically.
 *
 * Background: the original seed mapped Anthem to 00805, which Stedi resolves
 * to Excellus BCBS of NY — a different payer. The canonical rows tested here
 * replaced it.
 */
import { describe, it, expect, vi } from 'vitest';
import { ANTHEM_CROSSWALK_ROWS } from '../data/anthemCrosswalk';

const CROSSWALK_ROWS = ANTHEM_CROSSWALK_ROWS.map((r, i) => ({ id: i + 1, ...r }));

vi.mock('../db', () => {
  const db: any = {
    select: () => ({ from: () => ({ where: async () => CROSSWALK_ROWS }) }),
  };
  return { db, getDb: async () => db };
});

import { resolvePayerId, normalizePayerNameForMatch } from '../services/stediService';

describe('normalizePayerNameForMatch', () => {
  it('expands BCBS variants and drops of/the', () => {
    expect(normalizePayerNameForMatch('Anthem BCBS of Indiana')).toBe('anthem blue cross blue shield indiana');
    expect(normalizePayerNameForMatch('Anthem BlueCross BlueShield Indiana')).toBe('anthem blue cross blue shield indiana');
    expect(normalizePayerNameForMatch('  The Empire BCBS ')).toBe('empire blue cross blue shield');
    expect(normalizePayerNameForMatch(null)).toBe('');
  });
});

describe('Anthem crosswalk routing', () => {
  const route = (plan: string) => resolvePayerId(plan, plan, null);

  it('routes unqualified Anthem names to the New York fallback (803)', async () => {
    for (const plan of ['Anthem', 'Anthem BCBS', 'Anthem Blue Cross', 'Empire BCBS']) {
      const r = await route(plan);
      expect(r.routingSource).toBe('crosswalk');
      expect(r.tradingPartnerId).toBe('803');
      expect(r.matchedSubPlan).toBe('Anthem BCBS of New York');
    }
  });

  it('routes state-qualified names to that state, not the generic fallback', async () => {
    const cases: Array<[string, string]> = [
      ['Anthem BCBS of Indiana', '130'],
      ['Anthem Blue Cross Blue Shield of Indiana', '130'],
      ['Anthem Indiana', '130'],
      ['Anthem Blue Cross of California', '040'],
      ['Anthem Blue Cross and Blue Shield Wisconsin', '450'],
      ['Anthem BCBS Ohio', '00834'],
      ['Anthem Blue Cross Blue Shield of New York', '803'],
    ];
    for (const [plan, payerId] of cases) {
      const r = await route(plan);
      expect(r.routingSource).toBe('crosswalk');
      expect(r.tradingPartnerId).toBe(payerId);
    }
  });

  it('never routes Anthem to 00805 (Excellus BCBS of NY)', async () => {
    for (const row of ANTHEM_CROSSWALK_ROWS) {
      expect(row.tradingPartnerId).not.toBe('00805');
      expect(row.stediPayerId).not.toBe('00805');
    }
    const r = await route('Anthem BCBS');
    expect(r.tradingPartnerId).not.toBe('00805');
  });

  it('falls through to the static map for non-crosswalk payers', async () => {
    const r = await resolvePayerId('cigna', null, null);
    expect(r.routingSource).toBe('static_map');
    expect(r.tradingPartnerId).toBe('62308');
  });
});
