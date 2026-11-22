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
import { eq, and, inArray, notInArray, or, isNull, lte, gt, gte } from 'drizzle-orm';
import { storage } from '../storage';
import { getFollowUpSummary } from './claimFollowUpService';
import { getBusinessTimeZone, zonedDateString } from '../utils/timezone';

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
  /** When present, an unresolved appeal already exists for this claim (ready first, else the latest). */
  appealId?: number;
  /** That appeal's status (draft / ready / submitted) and payer filing deadline (YYYY-MM-DD), if any. */
  appealStatus: string | null;
  appealDeadline: string | null;
  /** The claim's current status, so a stale denial item on a reopened draft reads as a correction. */
  claimStatus: string | null;
  /** Open item whose due day is before today (practice calendar). */
  overdue: boolean;
  status: string;
  /** ISO instant the item is hidden until (snoozed view only), else null. */
  snoozedUntil: string | null;
  completedAt: string | null;
}

/**
 * Which slice of the follow-up queue to return (QA sweep 2026-11-18):
 *  - open:      pending/in_progress, not currently snoozed (the default)
 *  - snoozed:   pending/in_progress with snoozedUntil in the future
 *  - completed: status completed, most recent first (last 90 days)
 */
export type QueueView = 'open' | 'snoozed' | 'completed';
export const QUEUE_VIEWS: QueueView[] = ['open', 'snoozed', 'completed'];

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
    /** Open queue items past their due day. Distinct from appeals.pastDeadline (payer filing deadlines). */
    overdue: number;
  };
  actionQueue: RevenueAtRiskActionItem[];
}

/**
 * What the queue shows for a follow-up, given the claim it points at. A
 * `denial_appeal` task on a claim that has since been reopened to draft is
 * a correction task: reopen reclassifies it (#469), but items reopened
 * before that shipped still carry the old type (QA demo pass 2026-11-19:
 * draft DEMO-2-1005 listed as a denial).
 */
export function presentFollowUpType(followUpType: string, claimStatus: string | null | undefined): string {
  if (followUpType === 'denial_appeal' && claimStatus === 'draft') return 'correction_resubmit';
  return followUpType;
}

const DENIAL_TYPES = new Set(['denial_appeal', 'correction_resubmit']);

/**
 * Headline figures derived from the OPEN queue, so the cards can never
 * contradict the list beneath them (QA demo pass 2026-11-19: "Total at Risk
 * $0" above a queue listing $150 and $216 denials, "Past Deadline 0" above
 * a past-due item). Open denials: each claim once, whatever its follow-up
 * type, as long as the task is a denial or a correction after a denial.
 */
export function summarizeOpenQueue(items: Pick<RevenueAtRiskActionItem, 'claimId' | 'followUpType' | 'amount' | 'overdue'>[]): {
  openDenials: number;
  overdue: number;
} {
  const seen = new Set<number>();
  let openDenials = 0;
  let overdue = 0;
  for (const item of items) {
    if (item.overdue) overdue++;
    if (!DENIAL_TYPES.has(item.followUpType) || seen.has(item.claimId)) continue;
    seen.add(item.claimId);
    openDenials += Number(item.amount || 0);
  }
  return { openDenials, overdue };
}

/** True when the stored due day (UTC midnight of a calendar day) is before today in the practice zone. */
export function isPastDue(dueDate: Date | string | null | undefined, today = zonedDateString(new Date(), getBusinessTimeZone())): boolean {
  if (!dueDate) return false;
  const day = (dueDate instanceof Date ? dueDate.toISOString() : String(dueDate)).slice(0, 10);
  return day < today;
}

export async function getRevenueAtRiskSummary(
  practiceId: number,
  options: { queue?: QueueView } = {},
): Promise<RevenueAtRiskSummary> {
  const view = options.queue ?? 'open';
  const [appealsDashboard, arAging, followUpSummary, actionQueue] = await Promise.all([
    storage.getAppealsDashboard(practiceId),
    storage.getDaysInAR(practiceId),
    getFollowUpSummary(practiceId),
    buildActionQueue(practiceId, view),
  ]);
  // The headline cards always describe the OPEN queue, whichever slice the
  // page is looking at.
  const openQueue = view === 'open' ? actionQueue : await buildActionQueue(practiceId, 'open');
  const { openDenials, overdue } = summarizeOpenQueue(openQueue);

  // Aging dollars that are genuinely "at risk" — 61+ days unpaid.
  const aging61Plus = arAging.byBucket
    .filter(b => ['61-90', '91-120', '120+'].includes(b.bucket))
    .reduce((sum, b) => sum + b.amount, 0);

  return {
    atRisk: {
      // Dollars on open denial / correction tasks (the queue's own figure),
      // not only claims still in status 'denied' with no appeal row: a claim
      // in appeal or reopened for correction is still unpaid money at risk.
      deniedAwaitingAppeal: openDenials,
      aging61Plus,
      total: openDenials + aging61Plus,
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
      overdue,
    },
    actionQueue,
  };
}

/**
 * Builds the prioritized action queue: every open follow-up, enriched with
 * claim/patient detail and (for denial appeals) the id of the ready appeal
 * the denial pipeline already drafted.
 */
export async function buildActionQueue(
  practiceId: number,
  view: QueueView = 'open',
): Promise<RevenueAtRiskActionItem[]> {
  const now = new Date();
  const viewCondition =
    view === 'completed'
      ? and(
          eq(claimFollowUps.status, 'completed'),
          gte(claimFollowUps.completedAt, new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)),
        )
      : view === 'snoozed'
        ? and(
            inArray(claimFollowUps.status, ['pending', 'in_progress']),
            gt(claimFollowUps.snoozedUntil, now),
          )
        : and(
            inArray(claimFollowUps.status, ['pending', 'in_progress']),
            // A snooze that has elapsed is the same as no snooze.
            or(isNull(claimFollowUps.snoozedUntil), lte(claimFollowUps.snoozedUntil, now)),
          );
  const rows = await db
    .select({
      followUpId: claimFollowUps.id,
      followUpType: claimFollowUps.followUpType,
      priority: claimFollowUps.priority,
      dueDate: claimFollowUps.dueDate,
      notes: claimFollowUps.notes,
      status: claimFollowUps.status,
      snoozedUntil: claimFollowUps.snoozedUntil,
      completedAt: claimFollowUps.completedAt,
      claimId: claims.id,
      claimNumber: claims.claimNumber,
      claimStatus: claims.status,
      totalAmount: claims.totalAmount,
      patientFirstName: patients.firstName,
      patientLastName: patients.lastName,
    })
    .from(claimFollowUps)
    .innerJoin(claims, eq(claimFollowUps.claimId, claims.id))
    .leftJoin(patients, eq(claims.patientId, patients.id))
    .where(and(eq(claimFollowUps.practiceId, practiceId), viewCondition));

  // Map claimId -> the unresolved appeal (ready first, else the latest) so a
  // denial item deep-links to it and shows the payer's filing deadline next
  // to the task's own due date (QA demo pass 2026-11-19: the queue said
  // "due 11/16/2026" while Appeals said 1/16/2027 for the same claim; both
  // are real, the task's act-by day and the payer deadline).
  const claimIds: number[] = Array.from(new Set(rows.map((r: any) => r.claimId as number)));
  const appealByClaim = new Map<number, { id: number; status: string; deadlineDate: string | null }>();
  if (claimIds.length > 0) {
    const openAppeals = await db
      .select({ id: appeals.id, claimId: appeals.claimId, status: appeals.status, deadlineDate: appeals.deadlineDate })
      .from(appeals)
      .where(
        and(
          eq(appeals.practiceId, practiceId),
          inArray(appeals.claimId, claimIds),
          notInArray(appeals.status, ['won', 'lost', 'partial']),
        ),
      );
    for (const a of openAppeals) {
      const current = appealByClaim.get(a.claimId);
      if (!current || (a.status === 'ready' && current.status !== 'ready') || (current.status !== 'ready' && a.id > current.id)) {
        appealByClaim.set(a.claimId, { id: a.id, status: a.status, deadlineDate: a.deadlineDate ? String(a.deadlineDate).slice(0, 10) : null });
      }
    }
  }

  const today = zonedDateString(now, getBusinessTimeZone());
  const items: RevenueAtRiskActionItem[] = rows.map((r: any) => {
    const appeal = appealByClaim.get(r.claimId);
    return {
      id: `followup-${r.followUpId}`,
      kind: 'follow_up' as const,
      followUpId: r.followUpId,
      followUpType: presentFollowUpType(r.followUpType, r.claimStatus),
      claimId: r.claimId,
      claimNumber: r.claimNumber,
      claimStatus: r.claimStatus ?? null,
      patientName:
        r.patientFirstName || r.patientLastName
          ? `${decryptField(r.patientFirstName) ?? ''} ${decryptField(r.patientLastName) ?? ''}`.trim()
          : null,
      amount: Number(r.totalAmount || 0),
      priority: r.priority,
      dueDate: r.dueDate ? new Date(r.dueDate).toISOString() : null,
      overdue: view !== 'completed' && isPastDue(r.dueDate, today),
      notes: r.notes,
      appealId: appeal?.id,
      appealStatus: appeal?.status ?? null,
      appealDeadline: appeal?.deadlineDate ?? null,
      status: r.status,
      snoozedUntil: r.snoozedUntil ? new Date(r.snoozedUntil).toISOString() : null,
      completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
    };
  });

  if (view === 'completed') {
    items.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    return items;
  }

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
