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
  if (path.match(/\/api\/breach/)) {
    return { resourceType: 'breach_notification', eventCategory: 'admin' };
  }

  // PHI routes - HIPAA requires logging all access to protected health information
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
  if (path.match(/\/api\/insurance/) || path.match(/\/api\/eligibility/)) {
    return { resourceType: 'insurance', eventCategory: 'phi_access' };
  }
  if (path.match(/\/api\/patient-consents/)) {
    return { resourceType: 'consent', eventCategory: 'phi_access' };
  }
  if (path.match(/\/api\/patient-rights/)) {
    return { resourceType: 'patient_rights', eventCategory: 'phi_access' };
  }
  if (path.match(/\/api\/ai\/(generate-soap|transcribe)/)) {
    return { resourceType: 'ai_phi_processing', eventCategory: 'phi_access' };
  }
  if (path.match(/\/api\/voice/)) {
    return { resourceType: 'voice_recording', eventCategory: 'phi_access' };
  }
  if (path.match(/\/api\/tts/)) {
    return { resourceType: 'text_to_speech', eventCategory: 'phi_access' };
  }
  if (path.match(/\/api\/appeals/)) {
    return { resourceType: 'appeal', eventCategory: 'phi_access' };
  }

  // Export routes - HIPAA requires logging data exports
  if (path.match(/\/export/)) {
    return { resourceType: 'export', eventCategory: 'data_export' };
  }

  // Analytics - may contain aggregated PHI
  if (path.match(/\/api\/analytics/)) {
    return { resourceType: 'analytics', eventCategory: 'reporting' };
  }

  // Payment routes - PCI compliance
  if (path.match(/\/api\/(stripe|payments|billing)/)) {
    return { resourceType: 'payment', eventCategory: 'financial' };
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
  const practiceId = (req as any).authorizedPracticeId || (req as any).userPracticeId || null;
  const ipAddress = req.ip || req.socket.remoteAddress || 'unknown';
  const userAgent = req.get('user-agent') || 'unknown';
  const classification = classifyRoute(method, path);
  const eventType = getEventType(method);
  const resourceId = extractResourceId(path);

  // HIPAA: Log PHI access with additional context
  const isPHIAccess = classification.eventCategory === 'phi_access';

  // Capture the response to log success/failure
  const originalEnd = res.end;
  res.end = function (this: Response, ...args: any[]) {
    const success = res.statusCode >= 200 && res.statusCode < 400;
    const duration = Date.now() - startTime;

    // Build detailed audit record
    const auditDetails: Record<string, any> = {
      method,
      path,
      statusCode: res.statusCode,
      duration,
    };

    // HIPAA: Add additional context for PHI access
    if (isPHIAccess) {
      auditDetails.phiAccessType = eventType;
      auditDetails.resourceAccessed = classification.resourceType;
      auditDetails.accessReason = 'treatment'; // Default; could be enhanced with request context
      auditDetails.queryParams = Object.keys(req.query || {});
    }

    // Fire-and-forget audit log insert
    db.insert(auditLog).values({
      eventCategory: classification.eventCategory,
      eventType,
      resourceType: classification.resourceType,
      resourceId,
      userId,
      practiceId,
      ipAddress,
      userAgent,
      details: auditDetails,
      success,
    }).catch((err: any) => {
      logger.error('Failed to write audit log', { error: err.message, path, method });
    });

    // HIPAA: Log PHI access to application logs as well for redundancy
    if (isPHIAccess && success) {
      logger.info('PHI Access', {
        userId,
        practiceId,
        action: eventType,
        resource: classification.resourceType,
        resourceId,
        ipAddress,
        timestamp: new Date().toISOString(),
      });
    }

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
