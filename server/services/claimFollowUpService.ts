/**
 * Claim Follow-Up Service
 *
 * Tracks claims that haven't been paid within expected timeframes
 * and generates follow-up tasks for billing staff.
 */

import { db } from '../db';
import { claims, claimFollowUps, practices, type ClaimFollowUp, type InsertClaimFollowUp } from '../../shared/schema';
import { eq, and, desc, count, inArray } from 'drizzle-orm';
import logger from './logger';

// Aging thresholds in days
const AGING_THRESHOLDS = {
  aging_30: { days: 30, priority: 'medium' as const },
  aging_60: { days: 60, priority: 'high' as const },
  aging_90: { days: 90, priority: 'urgent' as const },
};

type FollowUpType =
  | 'aging_30'
  | 'aging_60'
  | 'aging_90'
  | 'denial_appeal'
  | 'missing_info'
  | 'underpayment'
  // A denied claim reopened to draft for correction: the biller fixes the
  // claim and resubmits (837P frequency 7). Replaces denial_appeal on reopen.
  | 'correction_resubmit';
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
  // Open denial_appeal tasks whose claim has since been reopened to draft.
  // Reopen reclassifies them now (#469); these predate that.
  const staleDenialTaskIds: number[] = [];

  for (const claim of practiceClaims) {
    if (claim.status === 'draft') {
      for (const fu of existingFollowUps) {
        if (fu.claimId === claim.id && fu.followUpType === 'denial_appeal') staleDenialTaskIds.push(fu.id);
      }
    }
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

  if (staleDenialTaskIds.length > 0) {
    await db
      .update(claimFollowUps)
      .set({ followUpType: 'correction_resubmit', updatedAt: now })
      .where(inArray(claimFollowUps.id, staleDenialTaskIds));
    logger.info('Reclassified denial follow-ups on reopened draft claims', { practiceId, count: staleDenialTaskIds.length });
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
 * Runs follow-up generation across every practice. Used by the scheduler as
 * a daily safety net so denials/aging claims always surface in the work
 * queue, even ones the real-time denial pipeline didn't catch (e.g. claims
 * marked denied manually).
 */
export async function generateFollowUpsForAllPractices(): Promise<{
  practices: number;
  followUpsCreated: number;
}> {
  const allPractices = await db.select({ id: practices.id }).from(practices);
  let followUpsCreated = 0;

  for (const practice of allPractices) {
    try {
      const created = await generateFollowUps(practice.id);
      followUpsCreated += created.length;
    } catch (error: any) {
      logger.error('Follow-up generation failed for practice', {
        practiceId: practice.id,
        error: error.message,
      });
    }
  }

  return { practices: allPractices.length, followUpsCreated };
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

export interface FollowUpUpdates {
  status?: FollowUpStatus;
  notes?: string;
  assignedTo?: string | null;
  priority?: FollowUpPriority;
  /** UTC midnight of the chosen calendar day (parseDateOnly); null clears. */
  dueDate?: Date | null;
  /** Hidden from the open queue until this instant; null un-snoozes. */
  snoozedUntil?: Date | null;
  /** Recorded when status becomes 'completed'. */
  completedBy?: string | null;
}

/**
 * Update a follow-up (status, notes, assignment, priority, due date, snooze).
 *
 * Completing an item stamps completedAt/completedBy and clears any snooze;
 * moving it back to pending/in_progress clears both so a reopened item is a
 * clean open item again (QA sweep 2026-11-18 work-queue actions).
 */
export async function updateFollowUp(
  id: number,
  practiceId: number,
  updates: FollowUpUpdates
): Promise<ClaimFollowUp | undefined> {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (updates.status !== undefined) {
    updateData.status = updates.status;
    if (updates.status === 'completed') {
      updateData.completedAt = new Date();
      updateData.completedBy = updates.completedBy ?? null;
      updateData.snoozedUntil = null;
    } else if (updates.status === 'pending' || updates.status === 'in_progress') {
      updateData.completedAt = null;
      updateData.completedBy = null;
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
  if (updates.dueDate !== undefined) {
    updateData.dueDate = updates.dueDate;
  }
  if (updates.snoozedUntil !== undefined) {
    updateData.snoozedUntil = updates.snoozedUntil;
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
 * Mark a follow-up complete, recording who did it.
 */
export async function completeFollowUp(
  id: number,
  practiceId: number,
  completedBy: string | null
): Promise<ClaimFollowUp | undefined> {
  return updateFollowUp(id, practiceId, { status: 'completed', completedBy });
}

/**
 * Hide a follow-up from the open queue until `until` (an instant; the route
 * resolves a calendar day to start-of-day in the practice timezone). The
 * status is untouched so the item comes back exactly as it was.
 */
export async function snoozeFollowUp(
  id: number,
  practiceId: number,
  until: Date | null
): Promise<ClaimFollowUp | undefined> {
  return updateFollowUp(id, practiceId, { snoozedUntil: until });
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

/**
 * Reopen-to-draft handoff (QA 2026-11-18, denial follow-up sweep): the
 * claim's open `denial_appeal` task used to survive the reopen untouched, so
 * Revenue at Risk kept a high-priority "Denial — appeal" item pointing at a
 * draft claim with no appeal path. Reclassify it to `correction_resubmit`
 * (its action link is the claim detail, i.e. the correction draft), keep
 * its priority, and rewrite the notes so the old denial reason travels with
 * the task. Scoped to the caller's practice; returns the rows changed.
 */
export async function reclassifyDenialAppealFollowUps(
  claimId: number,
  practiceId: number,
  ctx: { reason: string; previousDenialReason?: string | null; claimNumber?: string | null },
): Promise<ClaimFollowUp[]> {
  const label = ctx.claimNumber || String(claimId);
  const notes =
    `Claim ${label} reopened to draft for correction: ${ctx.reason}. Fix and resubmit (replacement claim).` +
    (ctx.previousDenialReason ? ` Previous denial reason: ${ctx.previousDenialReason}` : '');
  return db
    .update(claimFollowUps)
    .set({
      followUpType: 'correction_resubmit',
      status: 'pending',
      notes,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(claimFollowUps.claimId, claimId),
        eq(claimFollowUps.practiceId, practiceId),
        eq(claimFollowUps.followUpType, 'denial_appeal'),
        inArray(claimFollowUps.status, ['pending', 'in_progress']),
      ),
    )
    .returning();
}
