/**
 * URLs leaving the app must not carry credentials.
 *
 * Sentry's beforeSend scrubbed cookies, bodies, query strings and the
 * Authorization header — but not request.url. Portal magic links carry the
 * token as a PATH segment, so a live 30-day credential to a patient's chart
 * was shipped to a vendor outside the BAA, where anyone with Sentry read
 * access could copy it out of an issue and open the chart. Performance traces
 * were worse: beforeSend runs on error events only, so sampled transactions
 * bypassed the scrubber completely.
 */
import { describe, it, expect } from 'vitest';
import { redactSensitiveUrl, redactTransactionName } from '@shared/redactSensitiveUrl';

const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

describe('redactSensitiveUrl', () => {
  it('redacts a portal magic-link token from the path', () => {
    const out = redactSensitiveUrl(`https://app.therapybillai.com/api/patient-portal/login/${TOKEN}`);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain('[redacted]');
  });

  it('redacts the client-side magic-link route too', () => {
    expect(redactSensitiveUrl(`/portal/login/${TOKEN}`)).not.toContain(TOKEN);
  });

  it('redacts a telehealth join code — anonymous access to a live session', () => {
    const out = redactSensitiveUrl('/api/public/telehealth/join/ABC123');
    expect(out).not.toContain('ABC123');
  });

  it('redacts a token passed as a query value', () => {
    const out = redactSensitiveUrl(`/patient-portal?token=${TOKEN}`);
    expect(out).not.toContain(TOKEN);
    // The parameter is still visible as context; only the value goes.
    expect(out).toContain('token=');
  });

  it('leaves ordinary paths and identifiers intact', () => {
    expect(redactSensitiveUrl('/api/patients/42')).toBe('/api/patients/42');
    expect(redactSensitiveUrl('/api/claims?status=denied')).toBe('/api/claims?status=denied');
  });

  it('does not mistake a short numeric id for a secret', () => {
    expect(redactSensitiveUrl('/api/appointments/1234')).toContain('1234');
  });

  it('never throws on junk, so it cannot take out the error reporter', () => {
    expect(() => redactSensitiveUrl('::::not a url::::')).not.toThrow();
    expect(redactSensitiveUrl(undefined)).toBe('');
    expect(redactSensitiveUrl(null)).toBe('');
  });
});

describe('redactTransactionName', () => {
  it('redacts the route embedded in a transaction name', () => {
    const out = redactTransactionName(`GET /api/patient-portal/login/${TOKEN}`);
    expect(out).not.toContain(TOKEN);
    expect(out.startsWith('GET ')).toBe(true);
  });

  it('leaves a parameterised route alone', () => {
    expect(redactTransactionName('GET /api/patients/:id')).toBe('GET /api/patients/:id');
  });
});
