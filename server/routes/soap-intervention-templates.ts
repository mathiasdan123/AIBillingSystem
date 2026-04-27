/**
 * SOAP Intervention Templates Routes
 *
 * The activity-picker library on the SOAP note form. System defaults
 * (practice_id IS NULL) are shared by every practice and seeded on
 * boot. Practices can:
 *   - Add custom rows (POST)
 *   - Hide a system default for their practice (PATCH a copy that
 *     overrides isActive=false; system row itself is never touched)
 *   - Edit / delete their own custom rows (PATCH / DELETE)
 *
 * GET returns a merged, deduplicated list scoped to the practice:
 * system defaults + practice's custom rows, with the practice's
 * isActive override applied if any.
 */

import { Router, type Response } from 'express';
import { eq, and, or, isNull, sql } from 'drizzle-orm';
import { isAuthenticated } from '../replitAuth';
import { db, dbReady } from '../db';
import { soapInterventionTemplates } from '@shared/schema';
import logger from '../services/logger';

const router = Router();

const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) return req.authorizedPracticeId;
  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;
  if (userRole === 'admin') return requestedPracticeId || userPracticeId || 1;
  if (!userPracticeId) {
    throw new Error('User not assigned to a practice. Contact administrator.');
  }
  return requestedPracticeId && requestedPracticeId === userPracticeId
    ? requestedPracticeId
    : userPracticeId;
};

const safeErrorResponse = (res: Response, statusCode: number, msg: string, error?: any) => {
  if (error) {
    logger.error(msg, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return res.status(statusCode).json({ message: msg });
};

/**
 * GET / — merged list scoped to the practice.
 * Returns: { categories: [{ category, items: [{id, name, description, isCustom, isActive}] }] }
 * Only isActive=true items are included by default; pass ?includeInactive=true for admin views.
 */
router.get('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const includeInactive = req.query.includeInactive === 'true';

    // System defaults (practice_id NULL) + practice's own rows.
    const rows = await db
      .select()
      .from(soapInterventionTemplates)
      .where(
        or(
          isNull(soapInterventionTemplates.practiceId),
          eq(soapInterventionTemplates.practiceId, practiceId)
        )
      )
      .orderBy(soapInterventionTemplates.category, soapInterventionTemplates.sortOrder, soapInterventionTemplates.name);

    const filtered = includeInactive ? rows : rows.filter((r: any) => r.isActive !== false);

    // Group by category preserving order from sortOrder.
    const byCategory = new Map<string, any[]>();
    for (const r of filtered) {
      if (!byCategory.has(r.category)) byCategory.set(r.category, []);
      byCategory.get(r.category)!.push({
        id: r.id,
        name: r.name,
        description: r.description,
        isCustom: r.isCustom,
        isActive: r.isActive,
        sortOrder: r.sortOrder,
      });
    }
    const categories = Array.from(byCategory.entries()).map(([category, items]) => ({
      category,
      items,
    }));
    res.json({ categories });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to fetch intervention templates', error);
  }
});

/**
 * POST / — add a practice-custom intervention.
 * Body: { category, name, description? }
 */
router.post('/', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const { category, name, description } = req.body || {};
    if (!category || !name) {
      return res.status(400).json({ message: 'category and name are required.' });
    }
    const [created] = await db
      .insert(soapInterventionTemplates)
      .values({
        practiceId,
        category: String(category).trim().slice(0, 80),
        name: String(name).trim().slice(0, 200),
        description: description ? String(description).trim() : null,
        isCustom: true,
        isActive: true,
        sortOrder: 9999, // append to end of category
      })
      .returning();
    res.json(created);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to add intervention', error);
  }
});

/**
 * PATCH /:id — edit a practice-owned custom intervention, or toggle
 * isActive on a practice-owned row (e.g. to hide a system default a
 * practice doesn't use; the practice creates a "shadow" row first via
 * POST with the same name and then disables it).
 */
router.patch('/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid id' });

    const [existing] = await db
      .select()
      .from(soapInterventionTemplates)
      .where(eq(soapInterventionTemplates.id, id))
      .limit(1);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    if (existing.practiceId !== practiceId) {
      return res.status(403).json({ message: 'Cannot edit a system default. Add a practice-specific override instead.' });
    }

    const updates: any = {};
    if (typeof req.body?.name === 'string') updates.name = req.body.name.trim().slice(0, 200);
    if (typeof req.body?.category === 'string') updates.category = req.body.category.trim().slice(0, 80);
    if (typeof req.body?.description === 'string' || req.body?.description === null) {
      updates.description = req.body.description?.trim() ?? null;
    }
    if (typeof req.body?.isActive === 'boolean') updates.isActive = req.body.isActive;
    if (typeof req.body?.sortOrder === 'number') updates.sortOrder = req.body.sortOrder;
    updates.updatedAt = new Date();

    const [updated] = await db
      .update(soapInterventionTemplates)
      .set(updates)
      .where(eq(soapInterventionTemplates.id, id))
      .returning();
    res.json(updated);
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to update intervention', error);
  }
});

/** DELETE /:id — only practice-owned rows. System defaults can't be deleted. */
router.delete('/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    await dbReady;
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: 'Invalid id' });

    const [existing] = await db
      .select()
      .from(soapInterventionTemplates)
      .where(eq(soapInterventionTemplates.id, id))
      .limit(1);
    if (!existing) return res.status(404).json({ message: 'Not found' });
    if (existing.practiceId !== practiceId) {
      return res.status(403).json({ message: 'Cannot delete a system default.' });
    }
    await db.delete(soapInterventionTemplates).where(eq(soapInterventionTemplates.id, id));
    res.json({ success: true });
  } catch (error) {
    safeErrorResponse(res, 500, 'Failed to delete intervention', error);
  }
});

export default router;
