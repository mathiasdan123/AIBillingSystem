/**
 * Notification template routes (admin/billing only).
 *
 * Lets a practice override the default email/SMS templates for appointment
 * reminders, confirmations, and cancellations. One custom template per
 * (practice, notification_type, channel) — upserts on POST/PUT.
 *
 *   GET    /api/notification-templates            — list all for this practice
 *   GET    /api/notification-templates/:type/:ch  — get one (404 = use default)
 *   POST   /api/notification-templates            — upsert
 *   DELETE /api/notification-templates/:id        — soft delete (isActive=false)
 */
import { Router, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import logger from '../services/logger';

const router = Router();

const ALLOWED_TYPES = new Set([
  'appointment_reminder',
  'appointment_confirmation',
  'appointment_cancellation',
]);
const ALLOWED_CHANNELS = new Set(['email', 'sms']);

const isAdminOrBilling = async (req: any, res: Response, next: NextFunction) => {
  try {
    if (!req.user?.claims?.sub) return res.status(401).json({ message: 'Unauthorized' });
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || (user.role !== 'admin' && user.role !== 'billing')) {
      return res.status(403).json({ message: 'Access denied. Admin or billing role required.' });
    }
    next();
  } catch (error) {
    logger.error('notification-templates role check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Failed to verify permissions' });
  }
};

function resolvePracticeId(req: any): number | null {
  const id = req.userPracticeId ?? req.user?.practiceId;
  return typeof id === 'number' ? id : null;
}

router.get('/', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const practiceId = resolvePracticeId(req);
    if (!practiceId) return res.status(400).json({ error: 'No practice context' });
    const templates = await storage.getNotificationTemplates(practiceId);
    res.json(templates);
  } catch (error) {
    logger.error('Error listing notification templates', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

router.get('/:type/:channel', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const practiceId = resolvePracticeId(req);
    if (!practiceId) return res.status(400).json({ error: 'No practice context' });
    const { type, channel } = req.params;
    if (!ALLOWED_TYPES.has(type)) return res.status(400).json({ error: `Unknown notification type "${type}"` });
    if (!ALLOWED_CHANNELS.has(channel)) return res.status(400).json({ error: `Unknown channel "${channel}"` });
    const tmpl = await storage.getNotificationTemplate(practiceId, type, channel);
    if (!tmpl) return res.status(404).json({ error: 'No custom template — using default' });
    res.json(tmpl);
  } catch (error) {
    logger.error('Error fetching notification template', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

router.post('/', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const practiceId = resolvePracticeId(req);
    if (!practiceId) return res.status(400).json({ error: 'No practice context' });
    const { notificationType, channel, subject, body, isActive } = req.body ?? {};
    if (typeof notificationType !== 'string' || !ALLOWED_TYPES.has(notificationType)) {
      return res.status(400).json({ error: `notificationType is required and must be one of: ${Array.from(ALLOWED_TYPES).join(', ')}` });
    }
    if (typeof channel !== 'string' || !ALLOWED_CHANNELS.has(channel)) {
      return res.status(400).json({ error: `channel is required and must be one of: ${Array.from(ALLOWED_CHANNELS).join(', ')}` });
    }
    if (typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }
    const upserted = await storage.upsertNotificationTemplate({
      practiceId,
      notificationType,
      channel,
      subject: channel === 'email' ? (subject ?? null) : null,
      body,
      isActive: isActive !== false,
    } as any);
    res.json(upserted);
  } catch (error) {
    logger.error('Error upserting notification template', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to save template' });
  }
});

router.delete('/:id', isAuthenticated, isAdminOrBilling, async (req: any, res) => {
  try {
    const practiceId = resolvePracticeId(req);
    if (!practiceId) return res.status(400).json({ error: 'No practice context' });
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid template id' });
    const ok = await storage.deleteNotificationTemplate(practiceId, id);
    if (!ok) return res.status(404).json({ error: 'Template not found in this practice' });
    res.json({ success: true });
  } catch (error) {
    logger.error('Error deleting notification template', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

export default router;
