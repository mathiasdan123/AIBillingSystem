import type { Request, Response, NextFunction } from "express";
import { sendError, ErrorCodes } from "./errorHandler";

const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Middleware that enforces a request timeout.
 * Skips file upload routes (multipart content-type) since those may legitimately take longer.
 */
export function requestTimeout(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip timeout for multipart/file-upload requests
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/")) {
      return next();
    }

    req.setTimeout(timeoutMs, () => {
      // Only send a response if headers haven't been sent yet
      if (!res.headersSent) {
        sendError(res, 408, ErrorCodes.TIMEOUT, "Request timed out. Please try again.");
      }
    });

    next();
  };
}
