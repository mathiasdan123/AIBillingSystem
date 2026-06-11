import { describe, it, expect } from 'vitest';
import { isBlockedIp, assertSafeOutboundUrl, SsrfBlockedError } from '../utils/ssrf';

describe('SSRF guard', () => {
  describe('isBlockedIp', () => {
    it('blocks loopback, private, link-local, CGNAT, metadata', () => {
      for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255',
        '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1']) {
        expect(isBlockedIp(ip), ip).toBe(true);
      }
    });
    it('blocks IPv6 loopback/link-local/ULA and v4-mapped private', () => {
      for (const ip of ['::1', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
        expect(isBlockedIp(ip), ip).toBe(true);
      }
    });
    it('allows normal public addresses', () => {
      for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
        expect(isBlockedIp(ip), ip).toBe(false);
      }
    });
  });

  describe('assertSafeOutboundUrl', () => {
    it('rejects the AWS metadata endpoint', async () => {
      await expect(assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/'))
        .rejects.toBeInstanceOf(SsrfBlockedError);
    });
    it('rejects loopback by IP', async () => {
      await expect(assertSafeOutboundUrl('https://127.0.0.1/hook')).rejects.toBeInstanceOf(SsrfBlockedError);
    });
    it('rejects localhost (resolves to loopback)', async () => {
      await expect(assertSafeOutboundUrl('https://localhost/hook')).rejects.toBeInstanceOf(SsrfBlockedError);
    });
    it('rejects credentials in URL', async () => {
      await expect(assertSafeOutboundUrl('https://user:pass@example.com/hook')).rejects.toBeInstanceOf(SsrfBlockedError);
    });
    it('rejects non-http(s) schemes', async () => {
      await expect(assertSafeOutboundUrl('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfBlockedError);
    });
    it('accepts a public https URL', async () => {
      const url = await assertSafeOutboundUrl('https://example.com/webhook');
      expect(url.hostname).toBe('example.com');
    });
  });
});
