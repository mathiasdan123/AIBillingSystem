/**
 * Authorization Service
 *
 * Manages treatment authorizations (insurance pre-authorizations)
 * for therapy sessions. Tracks authorized vs. used units, expiration,
 * and provides utilization summaries.
 */

import { eq, and, sql, desc, gte, lte } from 'drizzle-orm';
import {
  treatmentAuthorizations,
  type InsertTreatmentAuthorization,
  type TreatmentAuthorization,
} from '@shared/schema';
import { db } from '../db';
import logger from './logger';

export interface AuthorizationCreateData {
  patientId: number;
  insuranceId?: number;
  authorizationNumber?: string;
  diagnosisCode?: string;
  cptCode?: string;
  authorizedUnits: number;
  startDate: string;
  endDate: string;
  status?: string;
  requestedDate?: string;
  approvedDate?: string;
  deniedReason?: string;
  notes?: string;
}

export interface AuthorizationFilters {
  patientId?: number;
  status?: string;
  expiringSoon?: boolean; // auths expiring within 14 days
}

export interface AuthorizationUtilizationSummary {
  totalActive: number;
  nearingExhaustion: number; // >80% used
  expiringSoon: number; // within 14 days
}

/**
 * Create a new treatment authorization.
 */
export async function createAuthorization(
  practiceId: number,
  data: AuthorizationCreateData,
): Promise<TreatmentAuthorization> {
  const insertData: InsertTreatmentAuthorization = {
    practiceId,
    patientId: data.patientId,
    insuranceId: data.insuranceId ?? null,
    authorizationNumber: data.authorizationNumber ?? null,
    diagnosisCode: data.diagnosisCode ?? null,
    cptCode: data.cptCode ?? null,
    authorizedUnits: data.authorizedUnits,
    usedUnits: 0,
    startDate: data.startDate,
    endDate: data.endDate,
    status: data.status ?? 'pending',
    requestedDate: data.requestedDate ?? null,
    approvedDate: data.approvedDate ?? null,
    deniedReason: data.deniedReason ?? null,
    notes: data.notes ?? null,
  };

  const [authorization] = await db
    .insert(treatmentAuthorizations)
    .values(insertData)
    .returning();

  logger.info('Treatment authorization created', {
    authorizationId: authorization.id,
    practiceId,
    patientId: data.patientId,
    authorizedUnits: data.authorizedUnits,
  });

  return authorization;
}

/**
 * List authorizations for a practice with optional filters.
 */
export async function getAuthorizations(
  practiceId: number,
  filters?: AuthorizationFilters,
): Promise<TreatmentAuthorization[]> {
  const conditions = [eq(treatmentAuthorizations.practiceId, practiceId)];

  if (filters?.patientId) {
    conditions.push(eq(treatmentAuthorizations.patientId, filters.patientId));
  }
  if (filters?.status) {
    conditions.push(eq(treatmentAuthorizations.status, filters.status));
  }
  if (filters?.expiringSoon) {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 14);
    const futureDateStr = futureDate.toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];
    conditions.push(lte(treatmentAuthorizations.endDate, futureDateStr));
    conditions.push(gte(treatmentAuthorizations.endDate, todayStr));
    conditions.push(eq(treatmentAuthorizations.status, 'active'));
  }

  const results = await db
    .select()
    .from(treatmentAuthorizations)
    .where(and(...conditions))
    .orderBy(desc(treatmentAuthorizations.endDate));

  return results;
}

/**
 * Get a single authorization by ID scoped to a practice.
 */
export async function getAuthorization(
  id: number,
  practiceId: number,
): Promise<TreatmentAuthorization | null> {
  const [authorization] = await db
    .select()
    .from(treatmentAuthorizations)
    .where(
      and(
        eq(treatmentAuthorizations.id, id),
        eq(treatmentAuthorizations.practiceId, practiceId),
      ),
    );

  return authorization ?? null;
}

/**
 * Update authorization fields.
 */
export async function updateAuthorization(
  id: number,
  practiceId: number,
  updates: Partial<AuthorizationCreateData>,
): Promise<TreatmentAuthorization> {
  const existing = await getAuthorization(id, practiceId);
  if (!existing) {
    throw new Error(`Authorization ${id} not found for practice ${practiceId}`);
  }

  const setData: Record<string, any> = { updatedAt: new Date() };

  if (updates.patientId !== undefined) setData.patientId = updates.patientId;
  if (updates.insuranceId !== undefined) setData.insuranceId = updates.insuranceId;
  if (updates.authorizationNumber !== undefined) setData.authorizationNumber = updates.authorizationNumber;
  if (updates.diagnosisCode !== undefined) setData.diagnosisCode = updates.diagnosisCode;
  if (updates.cptCode !== undefined) setData.cptCode = updates.cptCode;
  if (updates.authorizedUnits !== undefined) setData.authorizedUnits = updates.authorizedUnits;
  if (updates.startDate !== undefined) setData.startDate = updates.startDate;
  if (updates.endDate !== undefined) setData.endDate = updates.endDate;
  if (updates.status !== undefined) setData.status = updates.status;
  if (updates.requestedDate !== undefined) setData.requestedDate = updates.requestedDate;
  if (updates.approvedDate !== undefined) setData.approvedDate = updates.approvedDate;
  if (updates.deniedReason !== undefined) setData.deniedReason = updates.deniedReason;
  if (updates.notes !== undefined) setData.notes = updates.notes;

  const [updated] = await db
    .update(treatmentAuthorizations)
    .set(setData)
    .where(
      and(
        eq(treatmentAuthorizations.id, id),
        eq(treatmentAuthorizations.practiceId, practiceId),
      ),
    )
    .returning();

  logger.info('Treatment authorization updated', {
    authorizationId: id,
    practiceId,
  });

  return updated;
}

/**
 * Increment used units for an authorization.
 * Auto-sets status to 'exhausted' if usedUnits >= authorizedUnits.
 */
export async function incrementUsedUnits(
  id: number,
  practiceId: number,
  units: number = 1,
): Promise<TreatmentAuthorization> {
  const existing = await getAuthorization(id, practiceId);
  if (!existing) {
    throw new Error(`Authorization ${id} not found for practice ${practiceId}`);
  }

  if (existing.status !== 'active') {
    throw new Error(`Authorization ${id} is not active (status: ${existing.status})`);
  }

  const newUsedUnits = existing.usedUnits + units;
  const newStatus = newUsedUnits >= existing.authorizedUnits ? 'exhausted' : 'active';

  const [updated] = await db
    .update(treatmentAuthorizations)
    .set({
      usedUnits: newUsedUnits,
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(treatmentAuthorizations.id, id),
        eq(treatmentAuthorizations.practiceId, practiceId),
      ),
    )
    .returning();

  logger.info('Treatment authorization units incremented', {
    authorizationId: id,
    practiceId,
    unitsAdded: units,
    newUsedUnits,
    newStatus,
  });

  return updated;
}

/**
 * Get authorizations expiring within N days (default 14).
 */
export async function getExpiringAuthorizations(
  practiceId: number,
  daysAhead: number = 14,
): Promise<TreatmentAuthorization[]> {
  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + daysAhead);

  const todayStr = today.toISOString().split('T')[0];
  const futureDateStr = futureDate.toISOString().split('T')[0];

  const results = await db
    .select()
    .from(treatmentAuthorizations)
    .where(
      and(
        eq(treatmentAuthorizations.practiceId, practiceId),
        eq(treatmentAuthorizations.status, 'active'),
        gte(treatmentAuthorizations.endDate, todayStr),
        lte(treatmentAuthorizations.endDate, futureDateStr),
      ),
    )
    .orderBy(treatmentAuthorizations.endDate);

  return results;
}

/**
 * Get utilization summary for a practice.
 * Returns counts of: total active, nearing exhaustion (>80% used), expiring soon (14 days).
 */
export async function getAuthorizationUtilization(
  practiceId: number,
): Promise<AuthorizationUtilizationSummary> {
  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + 14);

  const todayStr = today.toISOString().split('T')[0];
  const futureDateStr = futureDate.toISOString().split('T')[0];

  // Get all active authorizations for this practice
  const activeAuths = await db
    .select()
    .from(treatmentAuthorizations)
    .where(
      and(
        eq(treatmentAuthorizations.practiceId, practiceId),
        eq(treatmentAuthorizations.status, 'active'),
      ),
    );

  const totalActive = activeAuths.length;

  let nearingExhaustion = 0;
  let expiringSoon = 0;

  for (const auth of activeAuths) {
    // Check if >80% used
    if (auth.authorizedUnits > 0 && auth.usedUnits / auth.authorizedUnits > 0.8) {
      nearingExhaustion++;
    }

    // Check if expiring within 14 days
    if (auth.endDate >= todayStr && auth.endDate <= futureDateStr) {
      expiringSoon++;
    }
  }

  return {
    totalActive,
    nearingExhaustion,
    expiringSoon,
  };
}
