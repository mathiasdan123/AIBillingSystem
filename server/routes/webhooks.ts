/**
 * Webhook Management Routes
 *
 * Handles:
 * - GET /api/webhooks - List webhook endpoints for the practice
 * - POST /api/webhooks - Register a new webhook endpoint
 * - DELETE /api/webhooks/:id - Delete a webhook endpoint
 *
 * All routes require authentication.
 */

import { Router, type Response } from 'express';
import { isAuthenticated } from '../replitAuth';
import {
  registerWebhook,
  listWebhooks,
  deleteWebhook,
  WEBHOOK_EVENT_TYPES,
} from '../services/webhookService';
import type { WebhookEndpoint } from '../../shared/schema';
import logger from '../services/logger';

const router = Router();

// Helper to get authorized practiceId from request
const getAuthorizedPracticeId = (req: any): number => {
  if (req.authorizedPracticeId) {
    return req.authorizedPracticeId;
  }

  const userPracticeId = req.userPracticeId;
  const userRole = req.userRole;
  const requestedPracticeId = req.query.practiceId
    ? parseInt(req.query.practiceId as string)
    : undefined;

  if (userRole === 'admin') {
    return requestedPracticeId || userPracticeId || 1;
  }

  if (!userPracticeId) {
    throw new Error('User not assigned to a practice. Contact administrator.');
  }

  if (requestedPracticeId && requestedPracticeId !== userPracticeId) {
    logger.warn(
      `Practice access restricted: User requested practice ${requestedPracticeId} but assigned to ${userPracticeId}`,
    );
    return userPracticeId;
  }

  return userPracticeId;
};

// GET /api/webhooks - List webhook endpoints
router.get('/webhooks', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const webhooks = await listWebhooks(practiceId);
    // Do not expose secrets in the response
    const sanitized = webhooks.map((wh: WebhookEndpoint) => ({
      id: wh.id,
      practiceId: wh.practiceId,
      url: wh.url,
      events: wh.events,
      isActive: wh.isActive,
      createdAt: wh.createdAt,
      updatedAt: wh.updatedAt,
    }));
    res.json(sanitized);
  } catch (error) {
    logger.error('Failed to list webhooks', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to list webhooks' });
  }
});

// POST /api/webhooks - Register a new webhook endpoint
router.post('/webhooks', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const { url, secret, events } = req.body;

    // Validate required fields
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ message: 'url is required and must be a string' });
    }

    if (!secret || typeof secret !== 'string') {
      return res.status(400).json({ message: 'secret is required and must be a string' });
    }

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ message: 'events must be a non-empty array' });
    }

    // Validate event types
    const validEvents = WEBHOOK_EVENT_TYPES as readonly string[];
    const invalidEvents = events.filter((e: string) => !validEvents.includes(e));
    if (invalidEvents.length > 0) {
      return res.status(400).json({
        message: `Invalid event types: ${invalidEvents.join(', ')}`,
        validEvents: WEBHOOK_EVENT_TYPES,
      });
    }

    const endpoint = await registerWebhook(practiceId, url, secret, events);

    // Return without secret
    res.status(201).json({
      id: endpoint.id,
      practiceId: endpoint.practiceId,
      url: endpoint.url,
      events: endpoint.events,
      isActive: endpoint.isActive,
      createdAt: endpoint.createdAt,
      updatedAt: endpoint.updatedAt,
    });
  } catch (error) {
    logger.error('Failed to register webhook', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to register webhook' });
  }
});

// DELETE /api/webhooks/:id - Delete a webhook endpoint
router.delete('/webhooks/:id', isAuthenticated, async (req: any, res: Response) => {
  try {
    const practiceId = getAuthorizedPracticeId(req);
    const id = parseInt(req.params.id);

    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid webhook ID' });
    }

    const deleted = await deleteWebhook(id, practiceId);

    if (!deleted) {
      return res.status(404).json({ message: 'Webhook endpoint not found' });
    }

    res.json({ message: 'Webhook endpoint deleted' });
  } catch (error) {
    logger.error('Failed to delete webhook', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to delete webhook' });
  }
});

export default router;
