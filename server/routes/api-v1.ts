import { Router, type Request, type Response } from "express";
import { API_VERSIONS, SUPPORTED_VERSIONS, LATEST_VERSION, DEFAULT_VERSION } from "../middleware/apiVersion";

/**
 * API v1 Router
 *
 * Provides versioned API information endpoints:
 *   GET /api/versions      - List all API versions with status
 *   GET /api/v1/info       - v1 API information
 *
 * The actual v1 route mounting is handled in server/routes.ts via the
 * apiVersionRewrite middleware, which strips /api/v1/ prefixes so that
 * /api/v1/* and /api/* both resolve to the same handlers.
 */

const router = Router();

/**
 * GET /versions
 * Returns available API versions with their status.
 */
router.get("/versions", (_req: Request, res: Response) => {
  const versions = Array.from(Object.values(API_VERSIONS)).map((v) => ({
    version: v.version,
    status: v.status,
    releasedAt: v.releasedAt,
    description: v.description,
    sunsetDate: v.sunsetDate || null,
    url: `/api/${v.version}/`,
  }));

  res.json({
    versions,
    current: LATEST_VERSION,
    default: DEFAULT_VERSION,
    supportedVersions: SUPPORTED_VERSIONS,
  });
});

/**
 * GET /v1/info
 * Returns v1 API information.
 */
router.get("/v1/info", (_req: Request, res: Response) => {
  const v1Info = API_VERSIONS["v1"];

  // List of known endpoint groups in v1
  const endpointGroups = [
    { prefix: "/api/auth", description: "Authentication & user management" },
    { prefix: "/api/patients", description: "Patient CRUD & insurance" },
    { prefix: "/api/claims", description: "Claims management & submission" },
    { prefix: "/api/appointments", description: "Scheduling & reminders" },
    { prefix: "/api/soap-notes", description: "Clinical documentation" },
    { prefix: "/api/analytics", description: "Dashboard KPIs & revenue" },
    { prefix: "/api/billing", description: "Billing & payments" },
    { prefix: "/api/practices", description: "Practice management" },
    { prefix: "/api/telehealth", description: "Telehealth sessions" },
    { prefix: "/api/messages", description: "Secure messaging" },
    { prefix: "/api/appeals", description: "Claims appeals" },
    { prefix: "/api/surveys", description: "Patient surveys" },
    { prefix: "/api/waitlist", description: "Waitlist management" },
    { prefix: "/api/reviews", description: "Reviews & feedback" },
    { prefix: "/api/locations", description: "Multi-location support" },
    { prefix: "/api/sso", description: "Single sign-on (SAML/OIDC)" },
    { prefix: "/api/remittance", description: "ERA/835 processing" },
    { prefix: "/api/payer-contracts", description: "Payer contract management" },
    { prefix: "/api/ai-insights", description: "AI-powered insights" },
    { prefix: "/api/reports", description: "Custom reports" },
    { prefix: "/api/export", description: "Data export" },
    { prefix: "/api/onboarding", description: "Practice onboarding" },
    { prefix: "/api/admin", description: "Admin endpoints" },
    { prefix: "/api/public", description: "Public portal & booking" },
  ];

  res.json({
    version: v1Info.version,
    status: v1Info.status,
    releasedAt: v1Info.releasedAt,
    description: v1Info.description,
    endpointGroups,
    endpointGroupCount: endpointGroups.length,
    documentation: "/api-docs",
    versioningInfo: {
      urlPrefix: "/api/v1/",
      acceptHeader: "application/vnd.therapybill.v1+json",
      note: "Both /api/* and /api/v1/* resolve to the same v1 endpoints.",
    },
  });
});

export default router;
