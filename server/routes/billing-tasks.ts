import { Router } from 'express';
import { db } from '../db';
import { claims, claimFollowUps, appeals, claimStatusChecks, patients } from '@shared/schema';
import { eq, and, desc, sql, lt, gte } from 'drizzle-orm';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import logger from '../services/logger';

const router = Router();

interface BillingTask {
  id: string;
  type: 'denied_claim' | 'aging_claim' | 'upcoming_deadline' | 'status_change';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  amount: number;
  patientName: string;
  claimNumber: string;
  dueDate: Date | null;
  status: string;
  createdAt: Date;
}

// GET /api/billing-tasks - Returns unified list of all billing tasks
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const practiceId = user.practiceId || 1;
    const tasks: BillingTask[] = [];

    // 1. Denied claims needing appeal
    const deniedClaims = await db
      .select({
        id: claims.id,
        claimNumber: claims.claimNumber,
        totalAmount: claims.totalAmount,
        status: claims.status,
        submittedAt: claims.submittedAt,
        patientId: claims.patientId,
      })
      .from(claims)
      .where(
        and(
          eq(claims.practiceId, practiceId),
          eq(claims.status, 'denied')
        )
      )
      .orderBy(desc(claims.submittedAt));

    // Get patient names for denied claims
    const deniedPatientIds = deniedClaims.map((c: any) => c.patientId).filter(Boolean);
    const deniedPatients = deniedPatientIds.length > 0
      ? await db.select().from(patients).where(sql`${patients.id} IN ${sql.raw(`(${deniedPatientIds.join(',')})`)}}`)
      : [];
    const deniedPatientMap = new Map<number, string>(deniedPatients.map((p: any) => [p.id, `${p.firstName} ${p.lastName}`]));

    for (const claim of deniedClaims) {
      // Estimate deadline: 180 days from submission (or 90 days if we don't have exact date)
      const deadlineBase = claim.submittedAt ? new Date(claim.submittedAt) : new Date();
      const appealDeadline = new Date(deadlineBase.getTime() + 180 * 24 * 60 * 60 * 1000);

      tasks.push({
        id: `denied-${claim.id}`,
        type: 'denied_claim',
        priority: 'high',
        title: `Denied Claim - ${claim.claimNumber || 'N/A'}`,
        description: 'Claim denied by payer. Review and consider filing an appeal.',
        amount: parseFloat(claim.totalAmount || '0'),
        patientName: deniedPatientMap.get(claim.patientId) || 'Unknown Patient',
        claimNumber: claim.claimNumber || 'N/A',
        dueDate: appealDeadline,
        status: 'pending',
        createdAt: claim.submittedAt || new Date(),
      });
    }

    // 2. Pending follow-ups (aging claims)
    const pendingFollowUps = await db
      .select({
        id: claimFollowUps.id,
        claimId: claimFollowUps.claimId,
        followUpType: claimFollowUps.followUpType,
        status: claimFollowUps.status,
        priority: claimFollowUps.priority,
        createdAt: claimFollowUps.createdAt,
        dueDate: claimFollowUps.dueDate,
      })
      .from(claimFollowUps)
      .where(
        and(
          eq(claimFollowUps.practiceId, practiceId),
          eq(claimFollowUps.status, 'pending')
        )
      )
      .orderBy(desc(claimFollowUps.createdAt));

    // Get claim details for follow-ups
    const followUpClaimIds = pendingFollowUps.map((f: any) => f.claimId);
    const followUpClaims = followUpClaimIds.length > 0
      ? await db.select().from(claims).where(sql`${claims.id} IN ${sql.raw(`(${followUpClaimIds.join(',')})`)}}`)
      : [];
    const followUpClaimMap = new Map<number, any>(followUpClaims.map((c: any) => [c.id, c]));

    // Get patient names for follow-ups
    const followUpPatientIds = followUpClaims.map((c: any) => c.patientId).filter(Boolean);
    const followUpPatients = followUpPatientIds.length > 0
      ? await db.select().from(patients).where(sql`${patients.id} IN ${sql.raw(`(${followUpPatientIds.join(',')})`)}}`)
      : [];
    const followUpPatientMap = new Map<number, string>(followUpPatients.map((p: any) => [p.id, `${p.firstName} ${p.lastName}`]));

    for (const followUp of pendingFollowUps) {
      const claim = followUpClaimMap.get(followUp.claimId);
      if (claim) {
        // Map followUpType to display label
        const agingLabel = followUp.followUpType?.includes('aging_90') ? '90+' :
                          followUp.followUpType?.includes('aging_60') ? '60-89' :
                          followUp.followUpType?.includes('aging_30') ? '30-59' : followUp.followUpType;

        const priority = (followUp.priority as 'high' | 'medium' | 'low') || 'medium';

        tasks.push({
          id: `aging-${followUp.id}`,
          type: 'aging_claim',
          priority,
          title: `${agingLabel} Day Follow-up - ${claim.claimNumber || 'N/A'}`,
          description: `Claim follow-up required. Type: ${followUp.followUpType || 'aging'}`,
          amount: parseFloat(claim.totalAmount || '0'),
          patientName: followUpPatientMap.get(claim.patientId) || 'Unknown Patient',
          claimNumber: claim.claimNumber || 'N/A',
          dueDate: followUp.dueDate || null,
          status: 'pending',
          createdAt: followUp.createdAt || new Date(),
        });
      }
    }

    // 3. Appeals with upcoming deadlines (< 14 days)
    const fourteenDaysFromNow = new Date();
    fourteenDaysFromNow.setDate(fourteenDaysFromNow.getDate() + 14);
    const fourteenDaysFromNowStr = fourteenDaysFromNow.toISOString().split('T')[0]; // YYYY-MM-DD format

    const upcomingDeadlines = await db
      .select({
        id: appeals.id,
        claimId: appeals.claimId,
        deadlineDate: appeals.deadlineDate,
        status: appeals.status,
        createdAt: appeals.createdAt,
        appealedAmount: appeals.appealedAmount,
      })
      .from(appeals)
      .where(
        and(
          eq(appeals.practiceId, practiceId),
          sql`${appeals.status} IN ('draft', 'pending')`,
          lt(appeals.deadlineDate, fourteenDaysFromNowStr)
        )
      )
      .orderBy(appeals.deadlineDate);

    // Get claim details for appeals
    const appealClaimIds = upcomingDeadlines.map((a: any) => a.claimId);
    const appealClaims = appealClaimIds.length > 0
      ? await db.select().from(claims).where(sql`${claims.id} IN ${sql.raw(`(${appealClaimIds.join(',')})`)}}`)
      : [];
    const appealClaimMap = new Map<number, any>(appealClaims.map((c: any) => [c.id, c]));

    // Get patient names for appeals
    const appealPatientIds = appealClaims.map((c: any) => c.patientId).filter(Boolean);
    const appealPatients = appealPatientIds.length > 0
      ? await db.select().from(patients).where(sql`${patients.id} IN ${sql.raw(`(${appealPatientIds.join(',')})`)}}`)
      : [];
    const appealPatientMap = new Map<number, string>(appealPatients.map((p: any) => [p.id, `${p.firstName} ${p.lastName}`]));

    for (const appeal of upcomingDeadlines) {
      const claim = appealClaimMap.get(appeal.claimId);
      if (claim && appeal.deadlineDate) {
        const daysUntilDeadline = Math.ceil((new Date(appeal.deadlineDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const priority = daysUntilDeadline <= 7 ? 'high' : 'medium';

        tasks.push({
          id: `deadline-${appeal.id}`,
          type: 'upcoming_deadline',
          priority,
          title: `Appeal Deadline Approaching - ${claim.claimNumber || 'N/A'}`,
          description: `Appeal deadline in ${daysUntilDeadline} days. ${appeal.status === 'draft' ? 'Complete and submit appeal.' : 'Monitor appeal status.'}`,
          amount: parseFloat(appeal.appealedAmount || '0'),
          patientName: appealPatientMap.get(claim.patientId) || 'Unknown Patient',
          claimNumber: claim.claimNumber || 'N/A',
          dueDate: new Date(appeal.deadlineDate),
          status: appeal.status || 'pending',
          createdAt: appeal.createdAt || new Date(),
        });
      }
    }

    // 4. Recent status changes from automated detection (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentStatusChanges = await db
      .select({
        id: claimStatusChecks.id,
        claimId: claimStatusChecks.claimId,
        previousStatus: claimStatusChecks.previousStatus,
        newStatus: claimStatusChecks.newStatus,
        createdAt: claimStatusChecks.createdAt,
      })
      .from(claimStatusChecks)
      .where(
        and(
          eq(claimStatusChecks.practiceId, practiceId),
          gte(claimStatusChecks.createdAt, sevenDaysAgo)
        )
      )
      .orderBy(desc(claimStatusChecks.createdAt));

    // Get claim details for status changes
    const statusChangeClaimIds = recentStatusChanges.map((s: any) => s.claimId);
    const statusChangeClaims = statusChangeClaimIds.length > 0
      ? await db.select().from(claims).where(sql`${claims.id} IN ${sql.raw(`(${statusChangeClaimIds.join(',')})`)}}`)
      : [];
    const statusChangeClaimMap = new Map<number, any>(statusChangeClaims.map((c: any) => [c.id, c]));

    // Get patient names for status changes
    const statusChangePatientIds = statusChangeClaims.map((c: any) => c.patientId).filter(Boolean);
    const statusChangePatients = statusChangePatientIds.length > 0
      ? await db.select().from(patients).where(sql`${patients.id} IN ${sql.raw(`(${statusChangePatientIds.join(',')})`)}}`)
      : [];
    const statusChangePatientMap = new Map<number, string>(statusChangePatients.map((p: any) => [p.id, `${p.firstName} ${p.lastName}`]));

    for (const statusChange of recentStatusChanges) {
      const claim = statusChangeClaimMap.get(statusChange.claimId);
      if (claim) {
        const priority = statusChange.newStatus === 'denied' ? 'high' : 'low';
        tasks.push({
          id: `status-${statusChange.id}`,
          type: 'status_change',
          priority,
          title: `Status Change: ${statusChange.previousStatus || 'unknown'} → ${statusChange.newStatus || 'unknown'}`,
          description: `Claim ${claim.claimNumber || 'N/A'} status changed from ${statusChange.previousStatus || 'unknown'} to ${statusChange.newStatus || 'unknown'}.`,
          amount: parseFloat(claim.totalAmount || '0'),
          patientName: statusChangePatientMap.get(claim.patientId) || 'Unknown Patient',
          claimNumber: claim.claimNumber || 'N/A',
          dueDate: null,
          status: statusChange.newStatus || 'unknown',
          createdAt: statusChange.createdAt || new Date(),
        });
      }
    }

    // Sort tasks by priority (high -> medium -> low) and then by createdAt
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    tasks.sort((a, b) => {
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    res.json(tasks);
  } catch (error) {
    logger.error('Error fetching billing tasks', { error });
    res.status(500).json({ error: 'Failed to fetch billing tasks' });
  }
});

// GET /api/billing-tasks/summary - Returns aggregate counts
router.get('/summary', isAuthenticated, async (req: any, res) => {
  try {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const practiceId = user.practiceId || 1;

    // Count denied claims
    const deniedClaimsResult = await db
      .select({
        count: sql<number>`count(*)::int`,
        totalAmount: sql<string>`COALESCE(sum(${claims.totalAmount}::numeric), 0)`,
      })
      .from(claims)
      .where(
        and(
          eq(claims.practiceId, practiceId),
          eq(claims.status, 'denied')
        )
      );

    const deniedClaimsCount = deniedClaimsResult[0]?.count || 0;
    const totalAtRisk = parseFloat(deniedClaimsResult[0]?.totalAmount || '0');

    // Count aging claims (pending follow-ups)
    const agingClaimsResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(claimFollowUps)
      .where(
        and(
          eq(claimFollowUps.practiceId, practiceId),
          eq(claimFollowUps.status, 'pending')
        )
      );

    const agingClaimsCount = agingClaimsResult[0]?.count || 0;

    // Count upcoming deadlines (< 14 days)
    const fourteenDaysFromNow = new Date();
    fourteenDaysFromNow.setDate(fourteenDaysFromNow.getDate() + 14);
    const fourteenDaysFromNowStr = fourteenDaysFromNow.toISOString().split('T')[0]; // YYYY-MM-DD format

    const upcomingDeadlinesResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(appeals)
      .where(
        and(
          eq(appeals.practiceId, practiceId),
          sql`${appeals.status} IN ('draft', 'pending')`,
          lt(appeals.deadlineDate, fourteenDaysFromNowStr)
        )
      );

    const upcomingDeadlinesCount = upcomingDeadlinesResult[0]?.count || 0;

    // Total tasks = denied claims + aging claims + upcoming deadlines
    const totalTasks = deniedClaimsCount + agingClaimsCount + upcomingDeadlinesCount;

    res.json({
      totalTasks,
      deniedClaims: deniedClaimsCount,
      agingClaims: agingClaimsCount,
      upcomingDeadlines: upcomingDeadlinesCount,
      totalAtRisk,
    });
  } catch (error) {
    logger.error('Error fetching billing tasks summary', { error });
    res.status(500).json({ error: 'Failed to fetch billing tasks summary' });
  }
});

// POST /api/billing-tasks/:id/snooze - Marks a follow-up as dismissed/snoozed
router.post('/:id/snooze', isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const practiceId = user.practiceId || 1;

    // Extract the actual ID from the prefixed task ID
    // Format: "aging-123" or "denied-456" or "deadline-789" or "status-012"
    const [taskType, taskId] = id.split('-');

    if (taskType !== 'aging') {
      return res.status(400).json({ error: 'Only aging claim follow-ups can be snoozed' });
    }

    const followUpId = parseInt(taskId, 10);
    if (isNaN(followUpId)) {
      return res.status(400).json({ error: 'Invalid task ID' });
    }

    // Update the follow-up status to 'dismissed'
    const result = await db
      .update(claimFollowUps)
      .set({ status: 'dismissed', completedAt: new Date() })
      .where(
        and(
          eq(claimFollowUps.id, followUpId),
          eq(claimFollowUps.practiceId, practiceId),
          eq(claimFollowUps.status, 'pending')
        )
      )
      .returning();

    if (result.length === 0) {
      return res.status(404).json({ error: 'Follow-up not found or already dismissed' });
    }

    logger.info('Follow-up snoozed', { followUpId, practiceId, userId });

    res.json({ success: true, followUp: result[0] });
  } catch (error) {
    logger.error('Error snoozing follow-up', { error, taskId: req.params.id });
    res.status(500).json({ error: 'Failed to snooze follow-up' });
  }
});

export default router;
