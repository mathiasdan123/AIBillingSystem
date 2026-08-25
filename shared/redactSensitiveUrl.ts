/**
 * Strip credentials out of a URL before it leaves the application.
 *
 * Sentry's beforeSend scrubbed cookies, bodies, query strings and the
 * Authorization header — but not `request.url`. Portal magic links carry the
 * token as a PATH segment (/patient-portal/login/<64 hex>), so a live
 * credential to a patient's chart was being shipped to a vendor that is not
 * covered by the BAA, where anyone with read access could copy it out of an
 * issue and open the chart. Traces were worse: beforeSend only runs on error
 * events, so sampled transactions bypassed the scrubber entirely.
 *
 * Shared between the server and browser bundles so the two cannot drift —
 * a token redacted in one and leaked by the other is the same breach.
 */

/** Path segments that look like a secret rather than an identifier. */
const TOKEN_LIKE_SEGMENT = /^[A-Fa-f0-9]{24,}$/;

/** Query parameters whose VALUE is a credential. */
const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'portaltoken',
  'magiclink',
  'code',
  'key',
  'apikey',
  'secret',
  'signature',
]);

/** Route shapes where the segment AFTER the match is a credential. */
const SECRET_FOLLOWS = ['login', 'join', 'token', 'magic-link', 'reset'];

/**
 * Returns the URL with credential-bearing segments and query values replaced
 * by `[redacted]`. Accepts absolute or relative URLs, and never throws — a
 * redaction helper that can throw would take out the error reporter itself.
 */
export function redactSensitiveUrl(input: string | undefined | null): string {
  if (!input) return '';
  try {
    const hasOrigin = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input);
    const url = new URL(input, hasOrigin ? undefined : 'http://placeholder.invalid');

    const segments = url.pathname.split('/');
    const redactedSegments = segments.map((segment, index) => {
      if (!segment) return segment;
      if (TOKEN_LIKE_SEGMENT.test(segment)) return '[redacted]';
      const previous = segments[index - 1]?.toLowerCase();
      if (previous && SECRET_FOLLOWS.includes(previous)) return '[redacted]';
      return segment;
    });
    url.pathname = redactedSegments.join('/');

    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, '[redacted]');
      }
    }

    return hasOrigin ? url.toString() : `${url.pathname}${url.search}`;
  } catch {
    // Unparseable input: return nothing rather than risk passing a raw
    // credential through.
    return '[unparseable-url-redacted]';
  }
}

/**
 * Sentry transaction names embed the route, so they leak the same way.
 * e.g. "GET /api/patient-portal/login/abc123..."
 */
export function redactTransactionName(name: string | undefined | null): string {
  if (!name) return '';
  const parts = name.split(' ');
  if (parts.length === 2) {
    return `${parts[0]} ${redactSensitiveUrl(parts[1])}`;
  }
  return redactSensitiveUrl(name) || name;
}
