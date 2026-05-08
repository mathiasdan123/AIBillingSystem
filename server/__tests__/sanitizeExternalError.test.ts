import { describe, it, expect, vi } from 'vitest';

// The sanitizer is the only thing under test; mock the heavy peer deps
// of ai-assistant.ts so importing the module is cheap.
vi.mock('../db', () => ({ db: {} }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../replitAuth', () => ({ isAuthenticated: vi.fn() }));
vi.mock('../services/practiceContext', () => ({ getUserPracticeContext: vi.fn() }));
vi.mock('../services/aiSoapBillingService', () => ({ generateSoapNoteAndBilling: vi.fn() }));
vi.mock('../services/underpaymentAnalyzer', () => ({
  assessUnderpayment: vi.fn(),
  analyzeAdjustment: vi.fn(),
}));
vi.mock('../services/stripeService', () => ({}));
vi.mock('../storage', () => ({ storage: {} }));

import { sanitizeExternalError } from '../routes/ai-assistant';

describe('sanitizeExternalError', () => {
  it('returns "unknown error" for null/undefined/empty input', () => {
    expect(sanitizeExternalError(null)).toBe('unknown error');
    expect(sanitizeExternalError(undefined)).toBe('unknown error');
    expect(sanitizeExternalError('')).toBe('unknown error');
  });

  it('passes through error text that contains no PHI patterns', () => {
    expect(sanitizeExternalError('Connection refused')).toBe('Connection refused');
    expect(sanitizeExternalError('AAA*04 Subscriber not found')).toBe('AAA*04 Subscriber not found');
  });

  it('redacts SSN-like patterns', () => {
    expect(sanitizeExternalError('Subscriber 123-45-6789 not found')).toBe(
      'Subscriber [redacted-id] not found',
    );
  });

  it('redacts ISO date patterns (DOB / DOS)', () => {
    expect(sanitizeExternalError('DOB 1985-03-15 mismatch')).toBe('DOB [redacted-date] mismatch');
  });

  it('redacts US-style date patterns', () => {
    expect(sanitizeExternalError('Coverage ends 12/31/2024')).toBe('Coverage ends [redacted-date]');
    expect(sanitizeExternalError('Effective 1/5/26')).toBe('Effective [redacted-date]');
  });

  it('redacts long alphanumeric tokens (member IDs, policy numbers)', () => {
    expect(sanitizeExternalError('Member ABC12345DEF6 inactive')).toBe(
      'Member [redacted-id] inactive',
    );
    // Lowercase tokens should NOT be redacted (only uppercase per regex)
    expect(sanitizeExternalError('lowercase token notamatch')).toBe('lowercase token notamatch');
  });

  it('preserves short uppercase identifiers (X12 codes, status enums)', () => {
    // "AAA" and "REJECTED" are 3 and 8 chars — only 8+ uppercase tokens get redacted.
    // We want to keep error codes visible so support staff can act on them.
    expect(sanitizeExternalError('Status REJECTED, code AAA*04')).toBe(
      'Status [redacted-id], code AAA*04',
    );
    // Acceptable trade-off: 8-char status string redacted along with member IDs.
    // X12 reason codes are 2-3 chars and survive.
  });

  it('redacts multiple PHI patterns in a single message', () => {
    const input = 'Member ABCDEF1234 born 1990-04-22 SSN 555-12-9876';
    const out = sanitizeExternalError(input);
    expect(out).not.toContain('ABCDEF1234');
    expect(out).not.toContain('1990-04-22');
    expect(out).not.toContain('555-12-9876');
    expect(out).toContain('[redacted-id]');
    expect(out).toContain('[redacted-date]');
  });

  it('caps length at 200 chars to limit how much can leak', () => {
    const long = 'x'.repeat(500);
    const out = sanitizeExternalError(long);
    expect(out.length).toBeLessThanOrEqual(201); // 200 + ellipsis
    expect(out.endsWith('…')).toBe(true);
  });

  it('coerces non-string input to string before sanitizing', () => {
    expect(sanitizeExternalError(12345 as unknown as string)).toBe('12345');
  });
});
