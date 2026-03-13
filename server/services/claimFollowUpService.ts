/**
 * Claim Follow-Up Service
 *
 * Tracks claims that haven't been paid within expected timeframes
 * and generates follow-up tasks for billing staff.
 */

import { db } from '../db';
import { claims, claimFollowUps, type ClaimFollowUp, type InsertClaimFollowUp } from '../../shared/schema';
import { eq, and, desc, count, inArray } from 'drizzle-orm';
import logger from './logger';

// Aging thresholds in days
const AGING_THRESHOLDS = {
  aging_30: { days: 30, priority: 'medium' as const },
  aging_60: { days: 60, priority: 'high' as const },
  aging_90: { days: 90, priority: 'urgent' as const },
};

type FollowUpType = 'aging_30' | 'aging_60' | 'aging_90' | 'denial_appeal' | 'missing_info';
type FollowUpStatus = 'pending' | 'in_progress' | 'completed' | 'dismissed';
type FollowUpPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface FollowUpFilters {
  status?: FollowUpStatus;
  priority?: FollowUpPriority;
  followUpType?: FollowUpType;
  assignedTo?: string;
}

export interface FollowUpSummary {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  total: number;
}

/**
 * Scans claims for a practice and creates follow-up tasks for:
 * - Claims submitted >30 days ago without payment (medium priority)
 * - Claims submitted >60 days ago without payment (high priority)
 * - Claims submitted >90 days ago without payment (urgent priority)
 * - Denied claims needing appeal (high priority)
 */
export async function generateFollowUps(practiceId: number): Promise<ClaimFollowUp[]> {
  const now = new Date();
  const practiceClaims = await db
    .select()
    .from(claims)
    .where(eq(claims.practiceId, practiceId));

  // Get existing active follow-ups for this practice to avoid duplicates
  const existingFollowUps = await db
    .select()
    .from(claimFollowUps)
    .where(
      and(
        eq(claimFollowUps.practiceId, practiceId),
        inArray(claimFollowUps.status, ['pending', 'in_progress'])
      )
    );

  // Build a set of existing follow-up keys (claimId + type) for dedup
  const existingKeys = new Set<string>();
  for (const fu of existingFollowUps) {
    existingKeys.add(`${fu.claimId}:${fu.followUpType}`);
  }

  const newFollowUps: InsertClaimFollowUp[] = [];

  for (const claim of practiceClaims) {
    // Check denied claims needing appeal
    if (claim.status === 'denied') {
      const key = `${claim.id}:denial_appeal`;
      if (!existingKeys.has(key)) {
        const dueDate = new Date(now);
        dueDate.setDate(dueDate.getDate() + 14); // 14 days to file appeal
        newFollowUps.push({
          claimId: claim.id,
          practiceId,
          followUpType: 'denial_appeal',
          status: 'pending',
          priority: 'high',
          notes: `Claim ${claim.claimNumber || claim.id} denied${claim.denialReason ? `: ${claim.denialReason}` : ''}. Review for appeal.`,
          dueDate,
        });
      }
      continue;
    }

    // Check aging for submitted (unpaid) claims
    if (claim.status === 'submitted' && claim.submittedAt) {
      const submittedDate = new Date(claim.submittedAt);
      const daysSinceSubmission = Math.floor(
        (now.getTime() - submittedDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Determine the highest applicable aging tier
      let applicableType: FollowUpType | null = null;
      let applicablePriority: FollowUpPriority = 'medium';

      if (daysSinceSubmission >= AGING_THRESHOLDS.aging_90.days) {
        applicableType = 'aging_90';
        applicablePriority = AGING_THRESHOLDS.aging_90.priority;
      } else if (daysSinceSubmission >= AGING_THRESHOLDS.aging_60.days) {
        applicableType = 'aging_60';
        applicablePriority = AGING_THRESHOLDS.aging_60.priority;
      } else if (daysSinceSubmission >= AGING_THRESHOLDS.aging_30.days) {
        applicableType = 'aging_30';
        applicablePriority = AGING_THRESHOLDS.aging_30.priority;
      }

      if (applicableType) {
        const key = `${claim.id}:${applicableType}`;
        if (!existingKeys.has(key)) {
          const dueDate = new Date(now);
          dueDate.setDate(dueDate.getDate() + 7); // 7 days to follow up
          newFollowUps.push({
            claimId: claim.id,
            practiceId,
            followUpType: applicableType,
            status: 'pending',
            priority: applicablePriority,
            notes: `Claim ${claim.claimNumber || claim.id} submitted ${daysSinceSubmission} days ago without payment. Follow up with payer.`,
            dueDate,
          });
        }
      }
    }
  }

  if (newFollowUps.length === 0) {
    logger.info('No new follow-ups to generate', { practiceId });
    return [];
  }

  const inserted = await db
    .insert(claimFollowUps)
    .values(newFollowUps)
    .returning();

  logger.info(`Generated ${inserted.length} claim follow-ups`, { practiceId });
  return inserted;
}

/**
 * List follow-ups for a practice with optional filters.
 */
export async function getFollowUps(
  practiceId: number,
  filters?: FollowUpFilters
): Promise<ClaimFollowUp[]> {
  const conditions = [eq(claimFollowUps.practiceId, practiceId)];

  if (filters?.status) {
    conditions.push(eq(claimFollowUps.status, filters.status));
  }
  if (filters?.priority) {
    conditions.push(eq(claimFollowUps.priority, filters.priority));
  }
  if (filters?.followUpType) {
    conditions.push(eq(claimFollowUps.followUpType, filters.followUpType));
  }
  if (filters?.assignedTo) {
    conditions.push(eq(claimFollowUps.assignedTo, filters.assignedTo));
  }

  return await db
    .select()
    .from(claimFollowUps)
    .where(and(...conditions))
    .orderBy(desc(claimFollowUps.createdAt));
}

/**
 * Update a follow-up (status, notes, assignment).
 */
export async function updateFollowUp(
  id: number,
  practiceId: number,
  updates: {
    status?: FollowUpStatus;
    notes?: string;
    assignedTo?: string | null;
    priority?: FollowUpPriority;
  }
): Promise<ClaimFollowUp | undefined> {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (updates.status !== undefined) {
    updateData.status = updates.status;
    if (updates.status === 'completed') {
      updateData.completedAt = new Date();
    }
  }
  if (updates.notes !== undefined) {
    updateData.notes = updates.notes;
  }
  if (updates.assignedTo !== undefined) {
    updateData.assignedTo = updates.assignedTo;
  }
  if (updates.priority !== undefined) {
    updateData.priority = updates.priority;
  }

  const [updated] = await db
    .update(claimFollowUps)
    .set(updateData)
    .where(
      and(
        eq(claimFollowUps.id, id),
        eq(claimFollowUps.practiceId, practiceId)
      )
    )
    .returning();

  return updated;
}

/**
 * Get summary counts of follow-ups by status and priority.
 */
export async function getFollowUpSummary(practiceId: number): Promise<FollowUpSummary> {
  const [statusCounts, priorityCounts] = await Promise.all([
    db
      .select({ status: claimFollowUps.status, count: count() })
      .from(claimFollowUps)
      .where(eq(claimFollowUps.practiceId, practiceId))
      .groupBy(claimFollowUps.status),
    db
      .select({ priority: claimFollowUps.priority, count: count() })
      .from(claimFollowUps)
      .where(eq(claimFollowUps.practiceId, practiceId))
      .groupBy(claimFollowUps.priority),
  ]);

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of statusCounts) {
    const key = row.status || 'unknown';
    byStatus[key] = Number(row.count);
    total += Number(row.count);
  }

  const byPriority: Record<string, number> = {};
  for (const row of priorityCounts) {
    const key = row.priority || 'unknown';
    byPriority[key] = Number(row.count);
  }

  return { byStatus, byPriority, total };
}

/**
 * Mark a follow-up as dismissed.
 */
export async function dismissFollowUp(
  id: number,
  practiceId: number
): Promise<ClaimFollowUp | undefined> {
  return updateFollowUp(id, practiceId, { status: 'dismissed' });
}
