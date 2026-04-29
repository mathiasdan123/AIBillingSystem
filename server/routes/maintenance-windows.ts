/**
 * Maintenance Window Routes
 *
 * Admins post scheduled-maintenance banners that surface in-app to users
 * during a defined time window. NULL practiceId = system-wide banner.
 *
 * Endpoints:
 *  - GET    /api/maintenance-windows/active   (auth)  — currently-active windows for user's practice
 *  - GET    /api/maintenance-windows          (admin) — list all windows
 *  - POST   /api/maintenance-windows          (admin) — create
 *  - PATCH  /api/maintenance-windows/:id      (admin) — edit
 *  - DELETE /api/maintenance-windows/:id      (admin) — delete
 *
 * Security: messages are rendered to all users — no PHI permitted.
 */

import { Router, type Response } from 'express';
import { and, desc, eq, isNull, lte, gte, or } from 'drizzle-orm';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';
import { db } from '../db';
import { maintenanceWindows, insertMaintenanceWindowSchema } from '@shared/schema';

const router = Router();

const safeErrorResponse = (res: Response, statusCode: number, publicMessage: string, error?: any) => {
  if (error) {
    logger.error(publicMessage, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
  return res.status(statusCode).json({ message: publicMessage });
};

const requireAdmin = (req: any, res: Response, next: () => void) => {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// GET /active — currently-active windows for the user's practice
// Returns system-wide windows (practiceId IS NULL) plus windows scoped to
// the user's practice, where NOW() is between startsAt and endsAt.
router.get('/active', isAuthenticated, async (req: any, res: Response) => {
  try {
    const userPracticeId: number | undefined = req.userPracticeId ?? undefined;
    const now = new Date();

    const practiceFilter = userPracticeId
      ? or(isNull(maintenanceWindows.practiceId), eq(maintenanceWindows.practiceId, userPracticeId))
      : isNull(maintenanceWindows.practiceId);

    const rows = await db
      .select()
      .from(maintenanceWindows)
      .where(
        and(
          practiceFilter,
          lte(maintenanceWindows.startsAt, now),
          gte(maintenanceWindows.endsAt, now),
        ),
      )
      .orderBy(desc(maintenanceWindows.severity), maintenanceWindows.endsAt);

    res.json(rows);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch active maintenance windows', error);
  }
});

// GET / — list all windows (admin only)
router.get('/', isAuthenticated, requireAdmin, async (_req: any, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(maintenanceWindows)
      .orderBy(desc(maintenanceWindows.startsAt));
    res.json(rows);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch maintenance windows', error);
  }
});

// POST / — create a new window (admin only)
router.post('/', isAuthenticated, requireAdmin, async (req: any, res: Response) => {
  try {
    const userId: string | undefined = req.user?.claims?.sub;

    const parsed = insertMaintenanceWindowSchema.safeParse({
      ...req.body,
      // Coerce ISO date strings to Date for timestamp columns
      startsAt: req.body?.startsAt ? new Date(req.body.startsAt) : undefined,
      endsAt: req.body?.endsAt ? new Date(req.body.endsAt) : undefined,
      createdBy: userId,
    });

    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid maintenance window payload',
        errors: parsed.error.flatten(),
      });
    }

    const data = parsed.data;
    if (data.endsAt <= data.startsAt) {
      return res.status(400).json({ message: 'endsAt must be after startsAt' });
    }
    if (!['info', 'warning', 'critical'].includes(data.severity ?? 'info')) {
      return res.status(400).json({ message: 'severity must be info, warning, or critical' });
    }

    const [created] = await db.insert(maintenanceWindows).values(data).returning();
    logger.info('Maintenance window created', { id: created.id, createdBy: userId });
    res.status(201).json(created);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to create maintenance window', error);
  }
});

// PATCH /:id — update a window (admin only)
router.patch('/:id', isAuthenticated, requireAdmin, async (req: any, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid maintenance window ID' });
    }

    const updates: Record<string, unknown> = {};
    const allowed = ['practiceId', 'message', 'severity', 'startsAt', 'endsAt', 'dismissible'];
    for (const key of allowed) {
      if (key in (req.body ?? {})) {
        if (key === 'startsAt' || key === 'endsAt') {
          updates[key] = req.body[key] ? new Date(req.body[key]) : null;
        } else {
          updates[key] = req.body[key];
        }
      }
    }

    if (
      updates.severity !== undefined &&
      !['info', 'warning', 'critical'].includes(updates.severity as string)
    ) {
      return res.status(400).json({ message: 'severity must be info, warning, or critical' });
    }

    if (
      updates.startsAt instanceof Date &&
      updates.endsAt instanceof Date &&
      (updates.endsAt as Date) <= (updates.startsAt as Date)
    ) {
      return res.status(400).json({ message: 'endsAt must be after startsAt' });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No updatable fields provided' });
    }

    updates.updatedAt = new Date();

    const [updated] = await db
      .update(maintenanceWindows)
      .set(updates as any)
      .where(eq(maintenanceWindows.id, id))
      .returning();

    if (!updated) {
      return res.status(404).json({ message: 'Maintenance window not found' });
    }

    res.json(updated);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to update maintenance window', error);
  }
});

// DELETE /:id — delete a window (admin only)
router.delete('/:id', isAuthenticated, requireAdmin, async (req: any, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid maintenance window ID' });
    }

    const [deleted] = await db
      .delete(maintenanceWindows)
      .where(eq(maintenanceWindows.id, id))
      .returning();

    if (!deleted) {
      return res.status(404).json({ message: 'Maintenance window not found' });
    }

    logger.info('Maintenance window deleted', { id });
    res.json({ success: true });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to delete maintenance window', error);
  }
});

export default router;
