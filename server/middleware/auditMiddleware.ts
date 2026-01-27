import type { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { auditLog } from '@shared/schema';
import logger from '../services/logger';

// Map route patterns to resource types and event categories
interface RouteClassification {
  resourceType: string;
  eventCategory: string;
}

function classifyRoute(method: string, path: string): RouteClassification {
  // Auth routes
  if (path.match(/\/api\/(login|logout|callback|auth)/)) {
    return { resourceType: 'auth', eventCategory: 'auth' };
  }
  if (path.match(/\/api\/mfa/)) {
    return { resourceType: 'mfa', eventCategory: 'auth' };
  }

  // Admin routes
  if (path.match(/\/api\/users/) || path.match(/\/api\/setup/) || path.match(/\/api\/invites/)) {
    return { resourceType: 'user', eventCategory: 'admin' };
  }
  if (path.match(/\/api\/admin/)) {
    return { resourceType: 'admin', eventCategory: 'admin' };
  }
  if (path.match(/\/api\/baa/)) {
    return { resourceType: 'baa', eventCategory: 'admin' };
  }

  // PHI routes
  if (path.match(/\/api\/patients/)) {
    return { resourceType: 'patient', eventCategory: 'phi_access' };
  }
  if (path.match(/\/api\/soap-notes/)) {
    return { resourceType: 'soap_note', eventCategory: 'phi_access' };
  }
  if (path.match(/\/api\/sessions/)) {
    return { resourceType: 'treatment_session', eventCategory: 'phi_access' };
  }
  if (path.match(/\/api\/claims/)) {
    return { resourceType: 'claim', eventCategory: 'phi_access' };
  }
  if (path.match(/\/api\/insurance/)) {
    return { resourceType: 'insurance', eventCategory: 'phi_access' };
  }

  // Export routes
  if (path.match(/\/export/)) {
    return { resourceType: 'export', eventCategory: 'data_export' };
  }

  return { resourceType: 'system', eventCategory: 'system' };
}

function getEventType(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET': return 'view';
    case 'POST': return 'create';
    case 'PUT':
    case 'PATCH': return 'update';
    case 'DELETE': return 'delete';
    default: return 'unknown';
  }
}

function extractResourceId(path: string): string | null {
  // Match patterns like /api/patients/123 or /api/claims/456/appeals
  const match = path.match(/\/api\/\w+\/(\d+)/);
  return match ? match[1] : null;
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();
  const { method, path } = req;

  // Skip non-API routes and health checks
  if (!path.startsWith('/api') || path === '/api/health') {
    return next();
  }

  const user = (req as any).user;
  const userId = user?.claims?.sub || user?.id || null;
  const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = req.get('user-agent') || 'unknown';
  const classification = classifyRoute(method, path);
  const eventType = getEventType(method);
  const resourceId = extractResourceId(path);

  // Capture the response to log success/failure
  const originalEnd = res.end;
  res.end = function (this: Response, ...args: any[]) {
    const success = res.statusCode >= 200 && res.statusCode < 400;
    const duration = Date.now() - startTime;

    // Fire-and-forget audit log insert
    db.insert(auditLog).values({
      eventCategory: classification.eventCategory,
      eventType,
      resourceType: classification.resourceType,
      resourceId,
      userId,
      practiceId: null, // Could be extracted from user context
      ipAddress,
      userAgent,
      details: {
        method,
        path,
        statusCode: res.statusCode,
        duration,
      },
      success,
    }).catch((err: any) => {
      logger.error('Failed to write audit log', { error: err.message, path, method });
    });

    return originalEnd.apply(this, args as any);
  } as any;

  next();
}

// Utility to log specific audit events programmatically
export async function logAuditEvent(params: {
  eventCategory: string;
  eventType: string;
  resourceType?: string;
  resourceId?: string;
  userId?: string;
  practiceId?: number;
  ipAddress?: string;
  details?: Record<string, any>;
  success?: boolean;
}) {
  try {
    await db.insert(auditLog).values({
      eventCategory: params.eventCategory,
      eventType: params.eventType,
      resourceType: params.resourceType || null,
      resourceId: params.resourceId || null,
      userId: params.userId || null,
      practiceId: params.practiceId || null,
      ipAddress: params.ipAddress || null,
      userAgent: null,
      details: params.details || null,
      success: params.success ?? true,
    });
  } catch (err: any) {
    logger.error('Failed to write audit log event', { error: err.message });
  }
}
