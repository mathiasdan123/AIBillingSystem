/**
 * Request sanitization middleware for enterprise security hardening.
 *
 * - Strips null bytes (\x00) from all string values in body, query, and params
 * - Truncates excessively long string fields (default 10 KB per field)
 * - Logs sanitization events via the structured logger
 *
 * HIPAA / SOC 2 relevance: prevents null-byte injection and oversized-payload attacks
 * that could bypass input validation or cause log-injection issues.
 */

import type { Request, Response, NextFunction } from 'express';
import logger from '../services/logger';

const MAX_FIELD_LENGTH = 10 * 1024; // 10 KB per string field

/**
 * Recursively walk an object tree and sanitize all string values.
 * Returns `true` if any value was modified.
 */
function sanitizeObject(obj: any, path: string, events: string[], depth: number = 0): boolean {
  if (depth > 10 || obj === null || obj === undefined) return false;

  let modified = false;

  if (typeof obj === 'string') {
    // Caller is responsible for assigning the return value
    return false;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') {
        const cleaned = sanitizeString(obj[i], `${path}[${i}]`, events);
        if (cleaned !== obj[i]) {
          obj[i] = cleaned;
          modified = true;
        }
      } else if (typeof obj[i] === 'object' && obj[i] !== null) {
        if (sanitizeObject(obj[i], `${path}[${i}]`, events, depth + 1)) {
          modified = true;
        }
      }
    }
    return modified;
  }

  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    for (const key of keys) {
      const fieldPath = path ? `${path}.${key}` : key;
      const value = obj[key];

      if (typeof value === 'string') {
        const cleaned = sanitizeString(value, fieldPath, events);
        if (cleaned !== value) {
          obj[key] = cleaned;
          modified = true;
        }
      } else if (typeof value === 'object' && value !== null) {
        if (sanitizeObject(value, fieldPath, events, depth + 1)) {
          modified = true;
        }
      }
    }
  }

  return modified;
}

function sanitizeString(value: string, fieldPath: string, events: string[]): string {
  let result = value;

  // Strip null bytes
  if (result.indexOf('\x00') !== -1) {
    result = result.replace(/\x00/g, '');
    events.push(`null_byte_stripped:${fieldPath}`);
  }

  // Truncate excessively long strings
  if (result.length > MAX_FIELD_LENGTH) {
    result = result.slice(0, MAX_FIELD_LENGTH);
    events.push(`truncated:${fieldPath}(${value.length}->${MAX_FIELD_LENGTH})`);
  }

  return result;
}

/**
 * Express middleware that sanitizes request body, query params, and route params.
 */
export function requestSanitizer() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const events: string[] = [];

    if (req.body && typeof req.body === 'object') {
      sanitizeObject(req.body, 'body', events);
    }

    if (req.query && typeof req.query === 'object') {
      sanitizeObject(req.query, 'query', events);
    }

    if (req.params && typeof req.params === 'object') {
      sanitizeObject(req.params, 'params', events);
    }

    if (events.length > 0) {
      logger.warn('Request sanitization applied', {
        method: req.method,
        path: req.path,
        sanitizationEvents: events,
        requestId: (req as any).requestId,
      });
    }

    next();
  };
}
