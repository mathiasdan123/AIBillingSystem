import type { Request, Response, NextFunction } from "express";
import logger from "../services/logger";

// Standard error codes
export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  TIMEOUT: "TIMEOUT",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Send a standardized error response.
 * Never exposes internal error details to the client.
 */
export function sendError(
  res: Response,
  statusCode: number,
  code: ErrorCode,
  message: string,
  details?: any,
) {
  const body: { success: false; error: { code: string; message: string; details?: any } } = {
    success: false,
    error: { code, message },
  };
  if (details !== undefined) {
    body.error.details = details;
  }
  return res.status(statusCode).json(body);
}

/**
 * Global Express error-handling middleware.
 * Must be registered AFTER all routes so it catches unhandled errors.
 */
export function globalErrorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const requestId =
    (req as any).requestId ||
    (req.headers["x-request-id"] as string) ||
    "unknown";

  // Determine status and code
  const status = err.status || err.statusCode || 500;
  let code: ErrorCode = ErrorCodes.INTERNAL_ERROR;
  if (status === 400) code = ErrorCodes.VALIDATION_ERROR;
  else if (status === 401) code = ErrorCodes.UNAUTHORIZED;
  else if (status === 403) code = ErrorCodes.FORBIDDEN;
  else if (status === 404) code = ErrorCodes.NOT_FOUND;
  else if (status === 408) code = ErrorCodes.TIMEOUT;
  else if (status === 429) code = ErrorCodes.RATE_LIMITED;

  // Log full error internally
  logger.error("Unhandled error", {
    requestId,
    method: req.method,
    path: req.path,
    statusCode: status,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });

  // Public-safe message — never leak internal details in production
  const publicMessage =
    status >= 500
      ? "An internal error occurred. Please try again later."
      : err.message || "An error occurred.";

  sendError(res, status, code, publicMessage);
}
