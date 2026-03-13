/**
 * Practice Management Routes
 *
 * Handles:
 * - GET /api/practices/:id - Get practice by ID
 * - PATCH /api/practices/:id - Update practice settings
 * - GET /api/practices/:id/public-info - Get public practice info (for consent forms)
 */

import { Router } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

// Get practice by ID
router.get('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = parseInt(req.params.id);
    const practice = await storage.getPractice(practiceId);
    if (!practice) {
      return res.status(404).json({ message: "Practice not found" });
    }
    res.json(practice);
  } catch (error) {
    logger.error("Error fetching practice", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to fetch practice" });
  }
});

// Update practice settings
router.patch('/:id', isAuthenticated, async (req: any, res) => {
  try {
    const practiceId = parseInt(req.params.id);
    const updates = req.body;

    // Remove any undefined or null values
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined && v !== null)
    );

    const practice = await storage.updatePractice(practiceId, cleanUpdates);
    if (!practice) {
      return res.status(404).json({ message: "Practice not found" });
    }
    res.json(practice);
  } catch (error) {
    logger.error("Error updating practice", { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: "Failed to update practice" });
  }
});

// Get practice info for consent forms (public - needed for intake)
router.get('/:id/public-info', async (req: any, res) => {
  try {
    const practice = await storage.getPractice(parseInt(req.params.id));
    if (!practice) {
      return res.status(404).json({ message: 'Practice not found' });
    }

    // Return only public info needed for consent forms
    res.json({
      id: practice.id,
      name: practice.name,
      address: practice.address,
      phone: practice.phone,
      email: practice.email,
      npi: practice.npi,
      brandLogoUrl: practice.brandLogoUrl,
      brandPrimaryColor: practice.brandPrimaryColor,
      brandPrivacyPolicyUrl: practice.brandPrivacyPolicyUrl,
    });
  } catch (error) {
    logger.error('Error fetching practice info', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to fetch practice info' });
  }
});

export default router;
