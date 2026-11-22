/**
 * Keying for the site-wide general rate limiter.
 *
 * Before 2026-11-06 the general limiter counted EVERY request (pages, assets
 * and API alike) in one bucket per IP address: 1,000 per 15 minutes. A page
 * such as the dashboard fires 13+ API calls on load, so a reviewer walking
 * 40-50 pages used the whole budget, and a clinic with five staff behind one
 * office router shared a single bucket (~13 requests a minute each). Two
 * prospects demoing from the same office shared one too.
 *
 * The limiter now keys on the browser session when the request carries a
 * VALID server-signed session cookie, and on the client IP otherwise:
 *   - signed-in / demo browsers each get their own, larger bucket;
 *   - anonymous traffic keeps the per-IP bucket, which is what protects
 *     against scraping and abuse;
 *   - a forged or tampered cookie is ignored (signature check against
 *     SESSION_SECRET), so an attacker cannot rotate cookie values to mint
 *     fresh buckets -- they fall back to the IP bucket.
 *
 * The session cookie is parsed here by hand because this limiter is mounted
 * before express-session (which lives in setupAuth, inside registerRoutes),
 * so req.session / req.user are not available yet.
 */

import type { Request } from "express";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { ipKeyGenerator } from "express-rate-limit";

export const SESSION_COOKIE_NAME = "therapybill.sid";

/** Read one cookie from the raw Cookie header without cookie-parser. */
export function readCookie(req: Pick<Request, "headers">, name: string): string | undefined {
  const header = req.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

/**
 * The session id from a valid express-session cookie ("s:<sid>.<sig>"),
 * verified against SESSION_SECRET, or null when absent/invalid.
 */
export function verifiedSessionId(req: Pick<Request, "headers">, secret = process.env.SESSION_SECRET): string | null {
  if (!secret) return null;
  const raw = readCookie(req, SESSION_COOKIE_NAME);
  if (!raw || !raw.startsWith("s:")) return null;
  return unsignCookieValue(raw.slice(2), secret);
}

/**
 * express-session signs the cookie with cookie-signature:
 *   "<sid>." + base64(HMAC-SHA256(secret, sid)) with trailing "=" removed.
 * Re-implemented here (constant-time compare) so this middleware has no
 * dependency on cookie-signature's untyped module.
 */
export function unsignCookieValue(value: string, secret: string): string | null {
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const sid = value.slice(0, dot);
  const given = value.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(sid).digest("base64").replace(/=+$/, "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return sid;
}

/** Rate-limit bucket key: the hashed session id when valid, else the client IP. */
export function generalRateLimitKey(req: Request): string {
  const sid = verifiedSessionId(req);
  if (sid) {
    // Hash so the store never holds raw session ids.
    return "sid:" + createHash("sha256").update(sid).digest("hex").slice(0, 32);
  }
  return "ip:" + ipKeyGenerator(req.ip ?? "", 56);
}

export interface GeneralRateLimitCaps {
  /** Anonymous traffic, per IP (the pre-existing cap). */
  perIp: number;
  /** A browser with a valid session, per session. */
  perSession: number;
}

/** Per-request cap: sessions get the larger budget, anonymous traffic the IP one. */
export function generalRateLimitMax(req: Request, caps: GeneralRateLimitCaps): number {
  return verifiedSessionId(req) ? caps.perSession : caps.perIp;
}
