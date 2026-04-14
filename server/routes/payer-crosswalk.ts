/**
 * Payer Crosswalk Routes
 *
 * Handles CRUD operations for the payer crosswalk table,
 * which maps insurance sub-plans/subsidiaries to their correct
 * trading partner IDs for claim submission routing.
 */

import { Router } from 'express';
import { isAuthenticated } from '../replitAuth';
import { getDb } from '../db';
import { payerCrosswalk } from '@shared/schema';
import { eq, ilike, or, desc } from 'drizzle-orm';
import logger from '../services/logger';

const router = Router();

// GET /api/admin/payer-crosswalk - List all crosswalk entries
router.get('/', isAuthenticated, async (req: any, res) => {
  try {
    const db = await getDb();
    const { search } = req.query;

    let entries;
    if (search && typeof search === 'string') {
      const pattern = `%${search}%`;
      entries = await db
        .select()
        .from(payerCrosswalk)
        .where(
          or(
            ilike(payerCrosswalk.parentPayerName, pattern),
            ilike(payerCrosswalk.subPlanName, pattern),
            ilike(payerCrosswalk.tradingPartnerId, pattern),
          )
        )
        .orderBy(desc(payerCrosswalk.createdAt));
    } else {
      entries = await db
        .select()
        .from(payerCrosswalk)
        .orderBy(desc(payerCrosswalk.createdAt));
    }

    res.json(entries);
  } catch (error: any) {
    logger.error('Error fetching payer crosswalk entries', { error: error.message });
    res.status(500).json({ message: 'Failed to fetch payer crosswalk entries' });
  }
});

// POST /api/admin/payer-crosswalk - Create a new crosswalk entry
router.post('/', isAuthenticated, async (req: any, res) => {
  try {
    const db = await getDb();
    const {
      parentPayerName,
      subPlanName,
      subPlanKeywords,
      tradingPartnerId,
      stediPayerId,
      state,
      notes,
      isActive,
    } = req.body;

    if (!parentPayerName || !subPlanName || !tradingPartnerId) {
      return res.status(400).json({
        message: 'parentPayerName, subPlanName, and tradingPartnerId are required',
      });
    }

    const [entry] = await db
      .insert(payerCrosswalk)
      .values({
        parentPayerName,
        subPlanName,
        subPlanKeywords: subPlanKeywords || [],
        tradingPartnerId,
        stediPayerId: stediPayerId || null,
        state: state || null,
        notes: notes || null,
        isActive: isActive !== undefined ? isActive : true,
      })
      .returning();

    logger.info('Payer crosswalk entry created', {
      id: entry.id,
      parentPayerName,
      subPlanName,
      tradingPartnerId,
    });

    res.status(201).json(entry);
  } catch (error: any) {
    logger.error('Error creating payer crosswalk entry', { error: error.message });
    res.status(500).json({ message: 'Failed to create payer crosswalk entry' });
  }
});

// PUT /api/admin/payer-crosswalk/:id - Update a crosswalk entry
router.put('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const db = await getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid ID' });
    }

    const {
      parentPayerName,
      subPlanName,
      subPlanKeywords,
      tradingPartnerId,
      stediPayerId,
      state,
      notes,
      isActive,
    } = req.body;

    const updateData: Record<string, any> = {};
    if (parentPayerName !== undefined) updateData.parentPayerName = parentPayerName;
    if (subPlanName !== undefined) updateData.subPlanName = subPlanName;
    if (subPlanKeywords !== undefined) updateData.subPlanKeywords = subPlanKeywords;
    if (tradingPartnerId !== undefined) updateData.tradingPartnerId = tradingPartnerId;
    if (stediPayerId !== undefined) updateData.stediPayerId = stediPayerId;
    if (state !== undefined) updateData.state = state;
    if (notes !== undefined) updateData.notes = notes;
    if (isActive !== undefined) updateData.isActive = isActive;

    const [updated] = await db
      .update(payerCrosswalk)
      .set(updateData)
      .where(eq(payerCrosswalk.id, id))
      .returning();

    if (!updated) {
      return res.status(404).json({ message: 'Crosswalk entry not found' });
    }

    logger.info('Payer crosswalk entry updated', { id, ...updateData });
    res.json(updated);
  } catch (error: any) {
    logger.error('Error updating payer crosswalk entry', { error: error.message });
    res.status(500).json({ message: 'Failed to update payer crosswalk entry' });
  }
});

// DELETE /api/admin/payer-crosswalk/:id - Delete a crosswalk entry
router.delete('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const db = await getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid ID' });
    }

    const [deleted] = await db
      .delete(payerCrosswalk)
      .where(eq(payerCrosswalk.id, id))
      .returning();

    if (!deleted) {
      return res.status(404).json({ message: 'Crosswalk entry not found' });
    }

    logger.info('Payer crosswalk entry deleted', { id, subPlanName: deleted.subPlanName });
    res.json({ message: 'Crosswalk entry deleted', id });
  } catch (error: any) {
    logger.error('Error deleting payer crosswalk entry', { error: error.message });
    res.status(500).json({ message: 'Failed to delete payer crosswalk entry' });
  }
});

export default router;
