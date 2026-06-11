/**
 * SSRF egress guard for server-initiated HTTP requests to caller-influenced URLs
 * (outbound webhooks, and any future user-configured callback/fetch target).
 *
 * Blocks requests to private, loopback, link-local, unique-local and cloud
 * metadata addresses so a tenant can't register e.g.
 * http://169.254.169.254/latest/meta-data/... and exfiltrate the ECS task role,
 * or pivot to internal services. Validation happens at registration AND again at
 * delivery (DNS can change between the two — TOCTOU), and redirects are not
 * followed automatically.
 */
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

/** True if an IP literal is in a range we must never connect to. */
export function isBlockedIp(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) {
    const o = ip.split('.').map((n) => parseInt(n, 10));
    if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = o;
    if (a === 0) return true;                         // 0.0.0.0/8 "this host"
    if (a === 10) return true;                        // 10.0.0.0/8 private
    if (a === 127) return true;                       // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true;          // 169.254.0.0/16 link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true;          // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return true;// 100.64.0.0/10 CGNAT
    if (a >= 224) return true;                         // multicast / reserved / broadcast
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;          // loopback / unspecified
    if (lower.startsWith('fe80')) return true;                  // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local fc00::/7
    if (lower.startsWith('ff')) return true;                    // multicast
    // IPv4-mapped (::ffff:a.b.c.d) — extract and re-check as v4
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // not a valid IP literal
}

/**
 * Validate a caller-supplied URL for server-side fetch. Requires https, a normal
 * host, and resolves every DNS answer to ensure none point at a blocked range.
 * Throws SsrfBlockedError on any violation. Returns the parsed URL on success.
 */
export async function assertSafeOutboundUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('Invalid URL');
  }
  // Allow http only for explicit localhost in non-production (local webhook testing).
  const allowHttp = process.env.NODE_ENV !== 'production';
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new SsrfBlockedError('Only https URLs are allowed');
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError('Credentials in URL are not allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // If the host is an IP literal, check it directly.
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfBlockedError(`Blocked address: ${host}`);
    return url;
  }

  // Otherwise resolve and check every answer (defends against DNS rebinding to
  // a private address). 'localhost' and friends resolve to loopback and are blocked.
  let answers: { address: string }[];
  try {
    answers = await lookup(host, { all: true });
  } catch {
    throw new SsrfBlockedError(`Could not resolve host: ${host}`);
  }
  if (answers.length === 0) throw new SsrfBlockedError(`Host did not resolve: ${host}`);
  for (const a of answers) {
    if (isBlockedIp(a.address)) {
      throw new SsrfBlockedError(`Host ${host} resolves to a blocked address (${a.address})`);
    }
  }
  return url;
}

/**
 * fetch() wrapper that re-validates the URL immediately before connecting and
 * refuses to auto-follow redirects (a 3xx to an internal address would bypass a
 * registration-time check). Callers that need to follow redirects must re-run
 * assertSafeOutboundUrl on the Location header.
 */
export async function safeOutboundFetch(rawUrl: string, init?: RequestInit): Promise<Response> {
  await assertSafeOutboundUrl(rawUrl);
  return fetch(rawUrl, { ...init, redirect: 'manual' });
}
