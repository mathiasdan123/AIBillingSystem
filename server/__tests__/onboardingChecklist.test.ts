import { describe, it, expect } from 'vitest';
import { isRenderingClinician } from '../services/onboardingChecklist';

describe('isRenderingClinician', () => {
  it('counts a user with the therapist role', () => {
    expect(isRenderingClinician({ role: 'therapist' })).toBe(true);
  });

  it('counts an admin who has an individual NPI (owner = clinician, solo practice)', () => {
    expect(isRenderingClinician({ role: 'admin', npiNumber: '1023896321' })).toBe(true);
  });

  it('counts an admin who has a license number or clinical credentials', () => {
    expect(isRenderingClinician({ role: 'admin', licenseNumber: 'LIC-123' })).toBe(true);
    expect(isRenderingClinician({ role: 'admin', credentials: 'OTR/L' })).toBe(true);
  });

  it('counts encrypted (ciphertext) NPI/license values — presence only, no decryption', () => {
    expect(
      isRenderingClinician({ role: 'admin', npiNumber: '{"ciphertext":"ab","iv":"cd","tag":"ef"}' }),
    ).toBe(true);
  });

  it('does NOT count a billing-only admin with no clinical identity', () => {
    expect(isRenderingClinician({ role: 'admin' })).toBe(false);
    expect(isRenderingClinician({ role: 'billing', npiNumber: null, licenseNumber: '' })).toBe(false);
  });

  it('treats whitespace-only plaintext credentials as absent', () => {
    // `credentials` is plaintext, so the predicate's `.trim()` genuinely filters
    // it. (npiNumber/licenseNumber arrive as ciphertext in prod and can never be
    // whitespace-only — the encryptor maps '' to null — so they're presence-only.)
    expect(isRenderingClinician({ role: 'admin', credentials: '   ' })).toBe(false);
  });
});
