import type { Request, Response, NextFunction } from "express";
import logger from "../services/logger";

/**
 * API Version Middleware
 *
 * Extracts the API version from the request via:
 *   1. URL prefix: /api/v1/... or /api/v2/...
 *   2. Accept header: application/vnd.therapybill.v1+json
 *   3. Falls back to the configured default version
 *
 * Sets req.apiVersion on the request object and adds version response headers.
 */

// Supported API versions and their status
export interface ApiVersionInfo {
  version: string;
  status: "current" | "deprecated" | "sunset";
  sunsetDate?: string;
  releasedAt: string;
  description: string;
}

export const API_VERSIONS: Record<string, ApiVersionInfo> = {
  v1: {
    version: "v1",
    status: "current",
    releasedAt: "2026-01-01",
    description: "Initial stable API version",
  },
  v2: {
    version: "v2",
    status: "current",
    releasedAt: "2027-01-01",
    description: "Reserved for future use",
  },
};

export const SUPPORTED_VERSIONS = Array.from(Object.keys(API_VERSIONS));
export const LATEST_VERSION = "v1";
export const DEFAULT_VERSION = process.env.API_DEFAULT_VERSION || LATEST_VERSION;

// Accept header pattern: application/vnd.therapybill.v1+json
const ACCEPT_HEADER_REGEX = /application\/vnd\.therapybill\.(v\d+)\+json/;

// URL prefix pattern: /api/v1/... or /api/v2/...
const URL_VERSION_REGEX = /^\/api\/(v\d+)(\/|$)/;

/**
 * Parse the API version from the request.
 * Priority: URL prefix > Accept header > default
 */
function extractVersion(req: Request): { version: string; source: string } {
  // 1. Check URL prefix
  const urlMatch = req.path.match(URL_VERSION_REGEX);
  if (urlMatch) {
    return { version: urlMatch[1], source: "url" };
  }

  // 2. Check Accept header
  const acceptHeader = req.headers.accept || "";
  const acceptMatch = acceptHeader.match(ACCEPT_HEADER_REGEX);
  if (acceptMatch) {
    return { version: acceptMatch[1], source: "header" };
  }

  // 3. Default version
  return { version: DEFAULT_VERSION, source: "default" };
}

/**
 * Middleware that extracts API version and sets response headers.
 */
export function apiVersionMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only apply to /api routes
  if (!req.path.startsWith("/api")) {
    return next();
  }

  const { version, source } = extractVersion(req);

  // Validate the version is supported
  if (!SUPPORTED_VERSIONS.includes(version)) {
    res.status(400).json({
      error: "Unsupported API version",
      message: `Version '${version}' is not supported. Supported versions: ${SUPPORTED_VERSIONS.join(", ")}`,
      supportedVersions: SUPPORTED_VERSIONS,
    });
    return;
  }

  // Set version on request
  (req as any).apiVersion = version;

  const versionInfo = API_VERSIONS[version];

  // Set response headers
  res.setHeader("X-API-Version", version);

  // Add deprecation headers if the version is deprecated
  if (versionInfo && versionInfo.status === "deprecated") {
    res.setHeader("X-API-Deprecation", "true");
    if (versionInfo.sunsetDate) {
      res.setHeader("X-API-Sunset", versionInfo.sunsetDate);
    }
    // Add standard Deprecation header (RFC 8594)
    res.setHeader("Deprecation", "true");

    // Log deprecation warning (once per request, not spammy)
    logger.warn("Deprecated API version used", {
      version,
      source,
      path: req.path,
      method: req.method,
    });
  }

  next();
}

/**
 * Rewrite URLs with version prefix to strip the prefix.
 * This allows /api/v1/patients to be handled by the same router as /api/patients.
 */
export function apiVersionRewrite(req: Request, res: Response, next: NextFunction): void {
  const urlMatch = req.path.match(URL_VERSION_REGEX);
  if (urlMatch) {
    const version = urlMatch[1];
    // Only rewrite for supported versions
    if (SUPPORTED_VERSIONS.includes(version)) {
      // Rewrite /api/v1/foo to /api/foo
      req.url = req.url.replace(`/api/${version}`, "/api");
    }
  }
  next();
}

// Augment Express Request type
declare global {
  namespace Express {
    interface Request {
      apiVersion?: string;
    }
  }
}
