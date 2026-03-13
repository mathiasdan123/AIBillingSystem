/**
 * Audit Report Service
 *
 * Provides querying, filtering, aggregation, and export capabilities
 * for the HIPAA audit log. Used by the audit-reports route module.
 */

import { db } from '../db';
import { auditLog } from '@shared/schema';
import { eq, and, gte, lte, like, sql, desc, count } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

// ── Types ──────────────────────────────────────────────────────────────

export interface AuditLogFilters {
  userId?: string;
  action?: string;        // maps to eventType
  resourceType?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  ipAddress?: string;
  page?: number;
  pageSize?: number;
}

export interface AuditSummary {
  byAction: { action: string; count: number }[];
  byUser: { userId: string; count: number }[];
  byResourceType: { resourceType: string; count: number }[];
  totalEvents: number;
}

export interface UserActivityEntry {
  id: number;
  eventCategory: string;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  details: unknown;
  success: boolean | null;
  createdAt: Date | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

function toDate(v: Date | string): Date {
  return typeof v === 'string' ? new Date(v) : v;
}

function buildConditions(practiceId: number, filters?: AuditLogFilters): SQL[] {
  const conditions: SQL[] = [eq(auditLog.practiceId, practiceId)];

  if (filters?.userId) {
    conditions.push(eq(auditLog.userId, filters.userId));
  }
  if (filters?.action) {
    conditions.push(eq(auditLog.eventType, filters.action));
  }
  if (filters?.resourceType) {
    conditions.push(eq(auditLog.resourceType, filters.resourceType));
  }
  if (filters?.dateFrom) {
    conditions.push(gte(auditLog.createdAt, toDate(filters.dateFrom)));
  }
  if (filters?.dateTo) {
    conditions.push(lte(auditLog.createdAt, toDate(filters.dateTo)));
  }
  if (filters?.ipAddress) {
    conditions.push(like(auditLog.ipAddress, `%${filters.ipAddress}%`));
  }

  return conditions;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Paginated, filterable list of audit log entries for a practice.
 */
export async function getAuditLogs(practiceId: number, filters?: AuditLogFilters) {
  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 50;
  const offset = (page - 1) * pageSize;

  const conditions = buildConditions(practiceId, filters);
  const where = and(...conditions);

  const [rows, totalResult] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: count() })
      .from(auditLog)
      .where(where),
  ]);

  const total = totalResult[0]?.count ?? 0;

  return {
    data: rows,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

/**
 * Aggregate counts by action, user, and resource type for a date range.
 */
export async function getAuditSummary(
  practiceId: number,
  startDate: Date | string,
  endDate: Date | string,
): Promise<AuditSummary> {
  const baseConds = [
    eq(auditLog.practiceId, practiceId),
    gte(auditLog.createdAt, toDate(startDate)),
    lte(auditLog.createdAt, toDate(endDate)),
  ];
  const where = and(...baseConds);

  const [byAction, byUser, byResourceType, totalResult] = await Promise.all([
    db
      .select({ action: auditLog.eventType, count: count() })
      .from(auditLog)
      .where(where)
      .groupBy(auditLog.eventType),
    db
      .select({ userId: auditLog.userId, count: count() })
      .from(auditLog)
      .where(where)
      .groupBy(auditLog.userId),
    db
      .select({ resourceType: auditLog.resourceType, count: count() })
      .from(auditLog)
      .where(where)
      .groupBy(auditLog.resourceType),
    db
      .select({ count: count() })
      .from(auditLog)
      .where(where),
  ]);

  return {
    byAction: byAction.map((r: any) => ({ action: r.action, count: r.count })),
    byUser: byUser.map((r: any) => ({ userId: r.userId ?? 'unknown', count: r.count })),
    byResourceType: byResourceType.map((r: any) => ({
      resourceType: r.resourceType ?? 'unknown',
      count: r.count,
    })),
    totalEvents: totalResult[0]?.count ?? 0,
  };
}

/**
 * All actions by a specific user within a date range, ordered chronologically.
 */
export async function getUserActivityReport(
  userId: string,
  practiceId: number,
  startDate: Date | string,
  endDate: Date | string,
) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.practiceId, practiceId),
        eq(auditLog.userId, userId),
        gte(auditLog.createdAt, toDate(startDate)),
        lte(auditLog.createdAt, toDate(endDate)),
      ),
    )
    .orderBy(desc(auditLog.createdAt));

  return rows;
}

/**
 * PHI-specific access events for HIPAA compliance reporting.
 */
export async function getPhiAccessReport(
  practiceId: number,
  startDate: Date | string,
  endDate: Date | string,
) {
  const rows = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.practiceId, practiceId),
        eq(auditLog.eventCategory, 'phi_access'),
        gte(auditLog.createdAt, toDate(startDate)),
        lte(auditLog.createdAt, toDate(endDate)),
      ),
    )
    .orderBy(desc(auditLog.createdAt));

  return rows;
}

/**
 * Export audit logs as CSV. Returns a string ready to be sent as a response body.
 */
export async function exportAuditLog(
  practiceId: number,
  filters?: AuditLogFilters,
  _format: 'csv' | 'json' = 'csv',
): Promise<string> {
  // Fetch all matching rows (no pagination for export)
  const conditions = buildConditions(practiceId, filters);
  const where = and(...conditions);

  const rows = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt));

  if (_format === 'json') {
    return JSON.stringify(rows, null, 2);
  }

  // CSV
  const headers = [
    'id',
    'eventCategory',
    'eventType',
    'resourceType',
    'resourceId',
    'userId',
    'practiceId',
    'ipAddress',
    'userAgent',
    'details',
    'success',
    'integrityHash',
    'createdAt',
  ];

  const csvRows = rows.map((row: any) =>
    headers
      .map((h) => {
        const val = (row as any)[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(','),
  );

  return [headers.join(','), ...csvRows].join('\n');
}

/**
 * Security-related events: failed logins, MFA events, suspicious activity.
 */
export async function getSecurityEvents(
  practiceId: number,
  startDate: Date | string,
  endDate: Date | string,
) {
  const dateConditions = [
    eq(auditLog.practiceId, practiceId),
    gte(auditLog.createdAt, toDate(startDate)),
    lte(auditLog.createdAt, toDate(endDate)),
  ];

  // Failed logins
  const failedLogins = await db
    .select()
    .from(auditLog)
    .where(
      and(
        ...dateConditions,
        eq(auditLog.eventCategory, 'auth'),
        eq(auditLog.success, false),
      ),
    )
    .orderBy(desc(auditLog.createdAt));

  // MFA events
  const mfaEvents = await db
    .select()
    .from(auditLog)
    .where(
      and(
        ...dateConditions,
        eq(auditLog.resourceType, 'mfa'),
      ),
    )
    .orderBy(desc(auditLog.createdAt));

  // All failed requests (potential suspicious activity)
  const failedRequests = await db
    .select()
    .from(auditLog)
    .where(
      and(
        ...dateConditions,
        eq(auditLog.success, false),
      ),
    )
    .orderBy(desc(auditLog.createdAt));

  return {
    failedLogins,
    mfaEvents,
    failedRequests,
    summary: {
      totalFailedLogins: failedLogins.length,
      totalMfaEvents: mfaEvents.length,
      totalFailedRequests: failedRequests.length,
    },
  };
}
