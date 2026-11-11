/**
 * General rate limiter keying (2026-11-06). One 1,000-request bucket per IP
 * for every request on the site meant an office of five behind one router
 * shared a single budget, and a reviewer walking the pages hit 429 within
 * minutes. Valid session cookies now get their own, larger bucket; forged
 * cookies and anonymous traffic stay on the per-IP bucket.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import cookieSignature from 'cookie-signature';
import {
  SESSION_COOKIE_NAME,
  readCookie,
  verifiedSessionId,
  generalRateLimitKey,
  generalRateLimitMax,
} from '../middleware/generalRateLimitKey';

const SECRET = 'test-session-secret-at-least-32-chars-long';
const caps = { perIp: 1000, perSession: 4000 };

function reqWith(cookieHeader: string | undefined, ip = '203.0.113.7'): any {
  return { headers: cookieHeader === undefined ? {} : { cookie: cookieHeader }, ip };
}
function signedCookie(sid: string, secret = SECRET): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent('s:' + cookieSignature.sign(sid, secret))}`;
}

describe('readCookie', () => {
  it('finds the named cookie among others and URL-decodes it', () => {
    const req = reqWith(`a=1; ${SESSION_COOKIE_NAME}=s%3Aabc.def; b=2`);
    expect(readCookie(req, SESSION_COOKIE_NAME)).toBe('s:abc.def');
    expect(readCookie(req, 'missing')).toBeUndefined();
  });
});

describe('verifiedSessionId', () => {
  it('returns the session id for a cookie signed with the real secret', () => {
    expect(verifiedSessionId(reqWith(signedCookie('session-123')), SECRET)).toBe('session-123');
  });

  it('rejects a cookie signed with another secret, a tampered cookie, and no cookie', () => {
    expect(verifiedSessionId(reqWith(signedCookie('session-123', 'other-secret')), SECRET)).toBeNull();
    const tampered = signedCookie('session-123').replace('session-123', 'session-999');
    expect(verifiedSessionId(reqWith(tampered), SECRET)).toBeNull();
    expect(verifiedSessionId(reqWith(undefined), SECRET)).toBeNull();
    expect(verifiedSessionId(reqWith(`${SESSION_COOKIE_NAME}=not-signed`), SECRET)).toBeNull();
  });

  it('never trusts a cookie when no secret is configured', () => {
    expect(verifiedSessionId(reqWith(signedCookie('session-123')), undefined)).toBeNull();
  });
});

describe('generalRateLimitKey / generalRateLimitMax', () => {
  let prev: string | undefined;
  beforeAll(() => { prev = process.env.SESSION_SECRET; process.env.SESSION_SECRET = SECRET; });
  afterAll(() => { if (prev === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = prev; });

  it('gives each valid session its own bucket and the larger cap', () => {
    const a = reqWith(signedCookie('sess-a'));
    const b = reqWith(signedCookie('sess-b'));
    expect(generalRateLimitKey(a)).toMatch(/^sid:[0-9a-f]{32}$/);
    expect(generalRateLimitKey(a)).not.toBe(generalRateLimitKey(b));
    expect(generalRateLimitKey(a)).not.toContain('sess-a'); // hashed, never raw
    expect(generalRateLimitMax(a, caps)).toBe(4000);
  });

  it('puts two browsers on the same IP in different buckets, and anonymous traffic on the IP bucket', () => {
    const office1 = reqWith(signedCookie('therapist-1'), '198.51.100.4');
    const office2 = reqWith(signedCookie('therapist-2'), '198.51.100.4');
    const anon = reqWith(undefined, '198.51.100.4');
    expect(generalRateLimitKey(office1)).not.toBe(generalRateLimitKey(office2));
    expect(generalRateLimitKey(anon)).toBe('ip:198.51.100.4');
    expect(generalRateLimitMax(anon, caps)).toBe(1000);
  });

  it('sends a forged cookie to the IP bucket with the IP cap (no bucket minting)', () => {
    const forged = reqWith(`${SESSION_COOKIE_NAME}=${encodeURIComponent('s:forged.abcdef')}`, '198.51.100.9');
    expect(generalRateLimitKey(forged)).toBe('ip:198.51.100.9');
    expect(generalRateLimitMax(forged, caps)).toBe(1000);
  });
});
