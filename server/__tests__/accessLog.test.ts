import { describe, expect, it } from 'vitest';
import { accessLogLine, safeResponseCode } from '../utils/accessLog';

describe('safeResponseCode', () => {
  it('accepts constant-shaped codes', () => {
    expect(safeResponseCode({ code: 'MFA_VERIFICATION_REQUIRED' })).toBe('MFA_VERIFICATION_REQUIRED');
    expect(safeResponseCode({ code: 'MFA_SETUP_REQUIRED' })).toBe('MFA_SETUP_REQUIRED');
  });

  it('rejects anything not shaped like a constant (the PHI guard)', () => {
    expect(safeResponseCode({ code: 'patient John Smith' })).toBeUndefined();
    expect(safeResponseCode({ code: 'token=abc123def' })).toBeUndefined();
    expect(safeResponseCode({ code: 'x'.repeat(60) })).toBeUndefined();
    expect(safeResponseCode({ code: 'lowercase_code' })).toBeUndefined();
    expect(safeResponseCode({ code: 42 })).toBeUndefined();
    expect(safeResponseCode({ message: 'no code field' })).toBeUndefined();
    expect(safeResponseCode('a string body')).toBeUndefined();
    expect(safeResponseCode(null)).toBeUndefined();
  });
});

describe('accessLogLine', () => {
  it('appends the code for 4xx responses', () => {
    expect(accessLogLine('GET', '/api/patients', 403, 12, 'MFA_VERIFICATION_REQUIRED')).toBe(
      'GET /api/patients 403 in 12ms [MFA_VERIFICATION_REQUIRED]',
    );
  });

  it('never appends a code on success responses', () => {
    expect(accessLogLine('GET', '/api/patients', 200, 12, 'SOME_CODE')).toBe(
      'GET /api/patients 200 in 12ms',
    );
  });

  it('omits the suffix when there is no code', () => {
    expect(accessLogLine('POST', '/api/claims', 403, 5)).toBe('POST /api/claims 403 in 5ms');
  });
});
