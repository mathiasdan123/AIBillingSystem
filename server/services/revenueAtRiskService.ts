/**
 * Revenue at Risk Service
 *
 * Aggregates the money-at-risk picture into a single payload: dollars tied up
 * in unappealed denials and aging claims, dollars recovered through appeals,
 * and a single prioritized action queue (open follow-ups + ready-to-submit
 * appeals). Backs the Revenue at Risk dashboard.
 */

import { db } from '../db';
import { decryptField } from './phiEncryptionService';
import { claimFollowUps, claims, patients, appeals } from '../../shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { storage } from '../storage';
import { getFollowUpSummary } from './claimFollowUpService';

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface RevenueAtRiskActionItem {
  id: string;
  kind: 'follow_up';
  followUpId: number;
  followUpType: string;
  claimId: number;
  claimNumber: string | null;
  patientName: string | null;
  amount: number;
  priority: string;
  dueDate: string | null;
  notes: string | null;
  /** When present, a ready-to-submit appeal already exists for this claim. */
  appealId?: number;
}

export interface RevenueAtRiskSummary {
  atRisk: {
    deniedAwaitingAppeal: number;
    aging61Plus: number;
    total: number;
  };
  recovered: {
    last90Days: number;
    appealsWon: number;
    successRate: number;
  };
  appeals: {
    pendingSubmission: number;
    pastDeadline: number;
  };
  followUps: {
    total: number;
    byPriority: Record<string, number>;
  };
  actionQueue: RevenueAtRiskActionItem[];
}

export async function getRevenueAtRiskSummary(practiceId: number): Promise<RevenueAtRiskSummary> {
  const [appealsDashboard, arAging, followUpSummary, actionQueue] = await Promise.all([
    storage.getAppealsDashboard(practiceId),
    storage.getDaysInAR(practiceId),
    getFollowUpSummary(practiceId),
    buildActionQueue(practiceId),
  ]);

  // Aging dollars that are genuinely "at risk" — 61+ days unpaid.
  const aging61Plus = arAging.byBucket
    .filter(b => ['61-90', '91-120', '120+'].includes(b.bucket))
    .reduce((sum, b) => sum + b.amount, 0);

  return {
    atRisk: {
      deniedAwaitingAppeal: appealsDashboard.totalDeniedAwaitingAppeal,
      aging61Plus,
      total: appealsDashboard.totalDeniedAwaitingAppeal + aging61Plus,
    },
    recovered: {
      last90Days: appealsDashboard.totalRecovered,
      appealsWon: appealsDashboard.last90DaysWon,
      successRate: appealsDashboard.successRate,
    },
    appeals: {
      pendingSubmission: appealsDashboard.appealsPendingSubmission,
      pastDeadline: appealsDashboard.appealsPastDeadline,
    },
    followUps: {
      total: followUpSummary.total,
      byPriority: followUpSummary.byPriority,
    },
    actionQueue,
  };
}

/**
 * Builds the prioritized action queue: every open follow-up, enriched with
 * claim/patient detail and (for denial appeals) the id of the ready appeal
 * the denial pipeline already drafted.
 */
async function buildActionQueue(practiceId: number): Promise<RevenueAtRiskActionItem[]> {
  const rows = await db
    .select({
      followUpId: claimFollowUps.id,
      followUpType: claimFollowUps.followUpType,
      priority: claimFollowUps.priority,
      dueDate: claimFollowUps.dueDate,
      notes: claimFollowUps.notes,
      claimId: claims.id,
      claimNumber: claims.claimNumber,
      totalAmount: claims.totalAmount,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
    })
    .from(claimFollowUps)
    .innerJoin(claims, eq(claimFollowUps.claimId, claims.id))
    .leftJoin(patients, eq(claims.patientId, patients.id))
    .where(
      and(
        eq(claimFollowUps.practiceId, practiceId),
        inArray(claimFollowUps.status, ['pending', 'in_progress']),
      ),
    );

  // Map claimId -> ready appeal id so denial-appeal items can deep-link.
  const claimIds: number[] = Array.from(new Set(rows.map((r: any) => r.claimId as number)));
  const readyAppealByClaim = new Map<number, number>();
  if (claimIds.length > 0) {
    const readyAppeals = await db
      .select({ id: appeals.id, claimId: appeals.claimId })
      .from(appeals)
      .where(
        and(
          eq(appeals.practiceId, practiceId),
          inArray(appeals.claimId, claimIds),
          eq(appeals.status, 'ready'),
        ),
      );
    for (const a of readyAppeals) {
      if (!readyAppealByClaim.has(a.claimId)) readyAppealByClaim.set(a.claimId, a.id);
    }
  }

  const items: RevenueAtRiskActionItem[] = rows.map((r: any) => ({
    id: `followup-${r.followUpId}`,
    kind: 'follow_up' as const,
    followUpId: r.followUpId,
    followUpType: r.followUpType,
    claimId: r.claimId,
    claimNumber: r.claimNumber,
    patientName:
      r.patientFirstName || r.patientLastName
        ? `${decryptField(r.patientFirstName) ?? ''} ${decryptField(r.patientLastName) ?? ''}`.trim()
        : null,
    amount: Number(r.totalAmount || 0),
    priority: r.priority,
    dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
    notes: r.notes,
    appealId: readyAppealByClaim.get(r.claimId),
  }));

  items.sort((a, b) => {
    const rankDiff = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    if (rankDiff !== 0) return rankDiff;
    const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    return aDue - bDue;
  });

  return items;
}

export default { getRevenueAtRiskSummary };
