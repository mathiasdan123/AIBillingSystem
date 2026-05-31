/**
 * Stedi Enrollment Sync Service
 *
 * Pulls Stedi's source-of-truth enrollment list and reconciles it with
 * our local `payer_enrollments` table. Today TherapyBill's table can
 * diverge from what Stedi actually has enrolled — operators add an
 * enrollment on Stedi's UI but forget to mirror locally, or a Stedi-side
 * approval lands without us updating our state. This service closes that
 * gap so `/stedi-readiness` reflects reality.
 *
 * Behavior
 * - Per-practice: pulls the practice's Stedi API key (per-practice
 *   override else env var, via getStediApiKeyForPractice).
 * - Hits Stedi's enrollment listing endpoint. Stedi groups enrollments
 *   by transaction type (eligibility / claim submission / ERA / claim
 *   status); we normalize to our 3-value transactionType enum
 *   (eligibility | claims | era — claim status maps to 'claims').
 * - Maps Stedi status → our 4-value enum (see mapStediStatus).
 * - Upsert by (practiceId, payerName, transactionType). Existing rows
 *   keep their `notes` field — only Stedi-authoritative fields get
 *   overwritten (status, payerId, approvedAt, rejectedAt, rejectionReason).
 * - Tolerant of drift: local rows with no Stedi counterpart are LEFT
 *   ALONE (operators may track pre-application state locally). We never
 *   delete on the local side.
 * - Tolerant of Stedi errors per-practice — one bad practice doesn't
 *   abort the whole sync.
 *
 * Pure mapping + normalization logic lives in stediEnrollmentMappers
 * (db-free, unit-tested); re-exported here for back-compat.
 */

import { storage } from '../storage';
import logger from './logger';
import { getStediApiKeyForPractice } from './stediService';
import { db } from '../db';
import { payerEnrollments, type PayerEnrollment } from '@shared/schema';
import { and, eq } from 'drizzle-orm';
import { ENROLLMENT_API_BASE } from './stediEnrollmentService';
import {
  type LocalEnrollmentStatus,
  type LocalTransactionType,
  type StediEnrollmentRow,
  mapStediStatus,
  mapStediTransactionType,
  mapStediTransactionKey,
  normalizeStediResponse,
} from './stediEnrollmentMappers';

// Legacy healthcare base, kept only as a secondary probe fallback.
const STEDI_API_BASE = 'https://healthcare.us.stedi.com/2024-04-01';

// Re-export pure mappers/types so existing importers keep working.
export {
  mapStediStatus,
  mapStediTransactionType,
  mapStediTransactionKey,
  normalizeStediResponse,
};
export type { LocalEnrollmentStatus, LocalTransactionType, StediEnrollmentRow };

export interface SyncPracticeSummary {
  practiceId: number;
  pulled: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: Array<{ message: string }>;
}

export interface SyncRunSummary {
  startedAt: string;
  finishedAt: string;
  practices: SyncPracticeSummary[];
  totals: {
    pulled: number;
    inserted: number;
    updated: number;
    unchanged: number;
    errors: number;
  };
}

// Test seam — lets unit tests inject a fake fetch / storage without
// going through real network or real DB.
export interface SyncDeps {
  fetchEnrollments: (apiKey: string) => Promise<StediEnrollmentRow[]>;
  storage: typeof storage;
  db: typeof db;
}

/**
 * Default fetch implementation. Calls Stedi's enrollment list endpoint.
 *
 * Probes the confirmed canonical enrollments endpoint first, falling back
 * to older shapes. 404 / 401 / empty-array are treated as a clean no-op so
 * sandbox accounts (or accounts where this API isn't enabled yet) don't
 * spam the logs.
 */
async function defaultFetchEnrollments(apiKey: string): Promise<StediEnrollmentRow[]> {
  const candidates = [
    // Confirmed canonical enrollments endpoint (2026-05-30).
    `${ENROLLMENT_API_BASE}/enrollments`,
    // Legacy fallbacks (older accounts / probing).
    `${STEDI_API_BASE}/enrollments`,
    `https://api.stedi.com/healthcare/enrollments`,
  ];

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      // 404 → endpoint not available on this account tier. Try next.
      if (response.status === 404) continue;
      // 401/403 → bad key or scope. Surface as a thrown error.
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Stedi enrollment API auth failed (${response.status})`);
      }
      if (!response.ok) {
        throw new Error(`Stedi enrollment API returned ${response.status}`);
      }

      const data = await response.json().catch(() => ({}));
      return normalizeStediResponse(data);
    } catch (err: any) {
      // Network-level failure → log and try next candidate.
      logger.warn('Stedi enrollment endpoint probe failed', {
        url,
        error: err?.message || String(err),
      });
    }
  }

  // Every candidate failed or 404'd — treat as "no enrollments to sync".
  return [];
}

const defaultDeps = (): SyncDeps => ({
  fetchEnrollments: defaultFetchEnrollments,
  storage,
  db,
});

/**
 * Determine whether an incoming Stedi row materially changes the local
 * row. Lets us count `unchanged` accurately and avoid useless writes.
 */
function isUnchanged(local: PayerEnrollment, incoming: StediEnrollmentRow): boolean {
  return (
    local.status === incoming.status &&
    (local.payerId ?? null) === (incoming.payerId ?? null) &&
    (local.rejectionReason ?? null) === (incoming.rejectionReason ?? null)
  );
}

async function syncPractice(
  practiceId: number,
  deps: SyncDeps,
): Promise<SyncPracticeSummary> {
  const summary: SyncPracticeSummary = {
    practiceId,
    pulled: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    errors: [],
  };

  let apiKey: string;
  try {
    const resolved = await getStediApiKeyForPractice(practiceId);
    apiKey = resolved.apiKey;
  } catch (err: any) {
    const msg = err?.message || String(err);
    logger.warn('Stedi enrollment sync: no API key for practice', {
      practiceId,
      error: msg,
    });
    summary.errors.push({ message: `no_api_key: ${msg}` });
    return summary;
  }

  let incoming: StediEnrollmentRow[];
  try {
    incoming = await deps.fetchEnrollments(apiKey);
  } catch (err: any) {
    const msg = err?.message || String(err);
    logger.warn('Stedi enrollment sync: fetch failed', {
      practiceId,
      error: msg,
    });
    summary.errors.push({ message: `fetch_failed: ${msg}` });
    return summary;
  }

  summary.pulled = incoming.length;
  if (incoming.length === 0) {
    // Sandbox / not-yet-enabled / empty account — clean no-op.
    logger.info('Stedi enrollment sync: nothing to reconcile', { practiceId });
    return summary;
  }

  const now = new Date();
  for (const row of incoming) {
    try {
      const [existing] = await deps.db
        .select()
        .from(payerEnrollments)
        .where(
          and(
            eq(payerEnrollments.practiceId, practiceId),
            eq(payerEnrollments.payerName, row.payerName),
            eq(payerEnrollments.transactionType, row.transactionType),
          ),
        )
        .limit(1);

      if (!existing) {
        await deps.db.insert(payerEnrollments).values({
          practiceId,
          payerName: row.payerName,
          payerId: row.payerId ?? null,
          transactionType: row.transactionType,
          status: row.status,
          approvedAt: row.approvedAt ?? (row.status === 'enrolled' ? now : null),
          rejectedAt: row.rejectedAt ?? (row.status === 'rejected' ? now : null),
          rejectionReason: row.rejectionReason ?? null,
          // notes intentionally left null — operators own this field.
        });
        summary.inserted++;
        continue;
      }

      if (isUnchanged(existing, row)) {
        summary.unchanged++;
        continue;
      }

      // Update only Stedi-authoritative fields. `notes` is operator-owned
      // and we never blow it away from a sync.
      await deps.db
        .update(payerEnrollments)
        .set({
          status: row.status,
          payerId: row.payerId ?? existing.payerId,
          approvedAt:
            row.approvedAt ??
            (row.status === 'enrolled' && existing.status !== 'enrolled'
              ? now
              : existing.approvedAt),
          rejectedAt:
            row.rejectedAt ??
            (row.status === 'rejected' && existing.status !== 'rejected'
              ? now
              : existing.rejectedAt),
          rejectionReason: row.rejectionReason ?? existing.rejectionReason,
          updatedAt: now,
        })
        .where(eq(payerEnrollments.id, existing.id));
      summary.updated++;
    } catch (err: any) {
      const msg = err?.message || String(err);
      logger.error('Stedi enrollment sync: per-row failure', {
        practiceId,
        payerName: row.payerName,
        transactionType: row.transactionType,
        error: msg,
      });
      summary.errors.push({
        message: `row_failed (${row.payerName} / ${row.transactionType}): ${msg}`,
      });
    }
  }

  logger.info('Stedi enrollment sync: practice complete', {
    practiceId,
    pulled: summary.pulled,
    inserted: summary.inserted,
    updated: summary.updated,
    unchanged: summary.unchanged,
    errors: summary.errors.length,
  });

  return summary;
}

/**
 * Run the Stedi enrollment sync. If `practiceId` is supplied, syncs
 * only that practice (manual-trigger endpoint). Otherwise iterates
 * every practice (cron).
 */
export async function syncStediEnrollments(
  opts: { practiceId?: number } = {},
  injectedDeps?: Partial<SyncDeps>,
): Promise<SyncRunSummary> {
  const deps: SyncDeps = { ...defaultDeps(), ...(injectedDeps || {}) };
  const startedAt = new Date();

  logger.info('Stedi enrollment sync starting', {
    practiceId: opts.practiceId,
  });

  let practiceIds: number[];
  if (opts.practiceId != null) {
    practiceIds = [opts.practiceId];
  } else {
    try {
      practiceIds = await deps.storage.getAllPracticeIds();
    } catch (err: any) {
      logger.error('Stedi enrollment sync: failed to enumerate practices', {
        error: err?.message || String(err),
      });
      practiceIds = [];
    }
  }

  const practiceSummaries: SyncPracticeSummary[] = [];
  for (const pid of practiceIds) {
    try {
      practiceSummaries.push(await syncPractice(pid, deps));
    } catch (err: any) {
      logger.error('Stedi enrollment sync: practice-level failure', {
        practiceId: pid,
        error: err?.message || String(err),
      });
      practiceSummaries.push({
        practiceId: pid,
        pulled: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        errors: [{ message: err?.message || String(err) }],
      });
    }
  }

  const totals = practiceSummaries.reduce(
    (acc, p) => {
      acc.pulled += p.pulled;
      acc.inserted += p.inserted;
      acc.updated += p.updated;
      acc.unchanged += p.unchanged;
      acc.errors += p.errors.length;
      return acc;
    },
    { pulled: 0, inserted: 0, updated: 0, unchanged: 0, errors: 0 },
  );

  const finishedAt = new Date();
  const result: SyncRunSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    practices: practiceSummaries,
    totals,
  };

  logger.info('Stedi enrollment sync completed', {
    practicesProcessed: practiceSummaries.length,
    totals,
  });

  return result;
}
