import { describe, it, expect } from 'vitest';
import {
  normalizePayerName,
  scoreNameMatch,
  pickBestMatch,
} from '../services/payerMappingService';
import type { PayerSearchResult } from '../services/stediService';

function payer(partial: Partial<PayerSearchResult>): PayerSearchResult {
  return {
    payerId: '00000',
    displayName: '',
    aliases: [],
    operatingStates: [],
    coverageTypes: [],
    transactionSupport: {},
    ...partial,
  };
}

describe('normalizePayerName', () => {
  it('lowercases, trims, and collapses whitespace/punctuation', () => {
    expect(normalizePayerName('  Aetna,  Inc. ')).toBe('aetna');
    expect(normalizePayerName('UnitedHealthcare')).toBe('unitedhealthcare');
  });

  it('expands common abbreviations to a canonical form', () => {
    expect(normalizePayerName('BCBS')).toBe('blue cross blue shield');
    expect(normalizePayerName('UHC')).toBe('unitedhealthcare');
    expect(normalizePayerName('BC/BS of NJ')).toBe('blue cross blue shield nj');
  });

  it('strips generic noise words (insurance, inc, of, the)', () => {
    expect(normalizePayerName('The Cigna Insurance Company')).toBe('cigna');
    expect(normalizePayerName('Horizon Blue Cross Blue Shield of New Jersey')).toBe(
      'horizon blue cross blue shield new jersey',
    );
  });

  it('returns empty string for nullish/blank input', () => {
    expect(normalizePayerName(null)).toBe('');
    expect(normalizePayerName(undefined)).toBe('');
    expect(normalizePayerName('   ')).toBe('');
  });

  it('normalizes differently-spelled variants of the same payer identically', () => {
    expect(normalizePayerName('blue-cross blueshield')).toBe(normalizePayerName('BCBS'));
  });

  it('keeps "health plan" so regional plans stay distinct (no collision)', () => {
    expect(normalizePayerName('Health Plan of San Mateo')).toBe('health plan san mateo');
    expect(normalizePayerName('The Health Plan')).toBe('health plan');
    expect(normalizePayerName('Health Plan of San Mateo')).not.toBe(
      normalizePayerName('Health Plan of Nevada'),
    );
  });

  it('never collapses a non-empty name to empty (falls back to expanded form)', () => {
    // "Insurance Company Inc" is all noise words — must not become "".
    expect(normalizePayerName('Insurance Company Inc')).not.toBe('');
  });
});

describe('scoreNameMatch', () => {
  it('scores an exact normalized match as 1', () => {
    expect(scoreNameMatch('Aetna', payer({ displayName: 'Aetna' }))).toBe(1);
  });

  it('scores containment BELOW the auto-accept bar (sub-plan must be reviewed)', () => {
    // "Aetna" vs "Aetna Better Health" (a Medicaid sub-plan) must not auto-accept.
    const score = scoreNameMatch('Aetna', payer({ displayName: 'Aetna Better Health' }));
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.85);
  });

  it('does not auto-accept a sub-plan whose query has extra qualifier tokens', () => {
    // "Cigna Behavioral Health" must NOT silently resolve to plain "Cigna".
    const score = scoreNameMatch('Cigna Behavioral Health', payer({ displayName: 'Cigna' }));
    expect(score).toBeLessThan(0.85);
  });

  it('considers aliases, not just displayName', () => {
    const score = scoreNameMatch('UHC', payer({ displayName: 'UnitedHealthcare', aliases: ['UHC'] }));
    expect(score).toBe(1); // UHC normalizes to unitedhealthcare === displayName
  });

  it('rewards partial token overlap below containment', () => {
    const score = scoreNameMatch(
      'Empire Blue Cross',
      payer({ displayName: 'Anthem Blue Cross Blue Shield' }),
    );
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.85);
  });

  it('scores an unrelated payer as 0', () => {
    expect(scoreNameMatch('Aetna', payer({ displayName: 'Kaiser Permanente' }))).toBe(0);
  });

  it('returns 0 for empty query', () => {
    expect(scoreNameMatch('', payer({ displayName: 'Aetna' }))).toBe(0);
  });
});

describe('pickBestMatch', () => {
  it('returns the highest-scoring candidate', () => {
    const results = [
      payer({ payerId: '1', displayName: 'Aetna Better Health' }),
      payer({ payerId: '2', displayName: 'Aetna' }),
      payer({ payerId: '3', displayName: 'Cigna' }),
    ];
    const best = pickBestMatch('Aetna', results);
    expect(best?.match.payerId).toBe('2');
    expect(best?.score).toBe(1);
  });

  it('returns null for an empty result set', () => {
    expect(pickBestMatch('Aetna', [])).toBeNull();
  });

  it('breaks score ties toward the base plan (fewer tokens), deterministically', () => {
    // Both score 0.8 (containment of "anthem"); the base plan must win even
    // though the sub-plan is listed first.
    const results = [
      payer({ payerId: 'sub', displayName: 'Anthem Blue Cross Partnership Plan' }),
      payer({ payerId: 'base', displayName: 'Anthem Blue Cross' }),
    ];
    const best = pickBestMatch('Anthem', results);
    expect(best?.match.payerId).toBe('base');
  });
});
