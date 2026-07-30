/**
 * Regression tests for two bugs found while wiring the staff intake wizard
 * to real consent records:
 *
 * 1. hasRequiredTreatmentConsents/batchGetConsentStatus checked consent
 *    types ('treatment', 'privacy', 'telehealth') that no code has ever
 *    created — real consents ('hipaa_privacy_practices', etc.) always came
 *    back "missing", 403ing every patient who actually completed the real
 *    intake flow. The gate now requires REQUIRED_CONSENT_TYPES
 *    (hipaa_privacy_practices only, per product decision).
 * 2. getActiveConsent/batchGetConsentStatus checked consent.expiresAt, a
 *    field that doesn't exist on the schema (the real column is
 *    expirationDate) — expiration was silently never enforced.
 */
import { describe, it, expect, vi } from 'vitest';

// Chainable thenable mock for Drizzle's select().from().where().orderBy() —
// same pattern used in appealOutcomeLearning.test.ts.
const queue: any[][] = [];

function makeChain() {
  const chain: any = {};
  const passthrough = () => chain;
  chain.select = passthrough;
  chain.from = passthrough;
  chain.where = passthrough;
  chain.orderBy = passthrough;
  chain.then = (resolve: any, reject: any) => {
    try {
      resolve(queue.shift() ?? []);
    } catch (e) {
      reject(e);
    }
  };
  return chain;
}

const chain = makeChain();

vi.mock('../db', () => ({ db: { select: () => chain } }));
vi.mock('../services/phiEncryptionService', () => ({
  encryptPatientRecord: (p: any) => p,
  decryptPatientRecord: (p: any) => p,
  encryptTreatmentSessionRecord: (s: any) => s,
  decryptTreatmentSessionRecord: (s: any) => s,
  decryptField: (v: any) => v,
}));
vi.mock('../services/cacheService', () => ({
  cache: { delPattern: vi.fn() },
  CacheKeys: { analyticsPattern: (id: number) => `analytics:${id}` },
}));

import { hasRequiredTreatmentConsents, batchGetConsentStatus } from '../storage/patients';
import { REQUIRED_CONSENT_TYPES } from '../services/consentTypes';

describe('hasRequiredTreatmentConsents', () => {
  it('requires only hipaa_privacy_practices, not the old treatment/privacy/telehealth strings', () => {
    expect(REQUIRED_CONSENT_TYPES).toEqual(['hipaa_privacy_practices']);
  });

  it('passes for a patient with only hipaa_privacy_practices on file', async () => {
    queue.push([
      { patientId: 1, consentType: 'hipaa_privacy_practices', revokedDate: null, expirationDate: null },
    ]);
    const result = await hasRequiredTreatmentConsents(1);
    expect(result.hasConsent).toBe(true);
    expect(result.missingConsents).toEqual([]);
  });

  it('fails for a patient with only waiver_release/financial_responsibility (no hipaa consent)', async () => {
    queue.push([]); // hasActiveConsent('hipaa_privacy_practices') query comes back empty
    const result = await hasRequiredTreatmentConsents(1);
    expect(result.hasConsent).toBe(false);
    expect(result.missingConsents).toEqual(['hipaa_privacy_practices']);
  });

  it('treats a consent past its expirationDate as inactive (expiresAt typo regression)', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    queue.push([
      { patientId: 1, consentType: 'hipaa_privacy_practices', revokedDate: null, expirationDate: yesterday },
    ]);
    const result = await hasRequiredTreatmentConsents(1);
    expect(result.hasConsent).toBe(false);
  });

  it('treats a consent with a future expirationDate as active', async () => {
    const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    queue.push([
      { patientId: 1, consentType: 'hipaa_privacy_practices', revokedDate: null, expirationDate: nextYear },
    ]);
    const result = await hasRequiredTreatmentConsents(1);
    expect(result.hasConsent).toBe(true);
  });
});

describe('batchGetConsentStatus', () => {
  it('marks a patient with only hipaa_privacy_practices as having consent, and one without it as missing', async () => {
    queue.push([
      { patientId: 1, consentType: 'hipaa_privacy_practices', revokedDate: null, expirationDate: null },
    ]);
    const result = await batchGetConsentStatus([1, 2]);
    expect(result.get(1)?.hasConsent).toBe(true);
    expect(result.get(2)?.hasConsent).toBe(false);
    expect(result.get(2)?.missingConsents).toEqual(['hipaa_privacy_practices']);
  });

  it('excludes an expired hipaa_privacy_practices consent from the active set (expiresAt typo regression)', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    queue.push([
      { patientId: 1, consentType: 'hipaa_privacy_practices', revokedDate: null, expirationDate: yesterday },
    ]);
    const result = await batchGetConsentStatus([1]);
    expect(result.get(1)?.hasConsent).toBe(false);
  });
});
