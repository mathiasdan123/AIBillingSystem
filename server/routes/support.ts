/**
 * Support Routes
 *
 * - POST  /api/support/report                        - File a problem report (any authenticated user)
 * - GET   /api/support/reports                       - List tickets (admin; platform admin sees all practices)
 * - PATCH /api/support/reports/:id                   - Update status/notes (admin)
 * - GET   /api/support/reports/:id/replies           - Reply thread (reporter sees published; admin also sees agent drafts)
 * - POST  /api/support/reports/:id/replies           - Add a reply (reporter follow-up or admin/staff answer)
 * - POST  /api/support/replies/:replyId/publish      - Publish an agent draft, optionally edited (admin)
 * - DELETE /api/support/replies/:replyId             - Discard an agent draft (admin)
 */
import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { isAuthenticated } from '../replitAuth';
import { storage } from '../storage';
import { db } from '../db';
import { supportTickets, type SupportTicket } from '@shared/schema';
import {
  createSupportTicket,
  addTicketReply,
  listTicketReplies,
  publishTicketReply,
  discardDraftReply,
} from '../services/supportTicketService';
import logger from '../services/logger';

/**
 * Load a ticket the caller may see: admins reach any ticket in their practice
 * (platform admins any practice), everyone else only tickets they filed.
 * Returns null when out of scope — routes answer 404, never 403, so ticket
 * ids don't leak existence across practices.
 */
async function loadVisibleTicket(req: any, ticketId: number): Promise<{ ticket: SupportTicket; user: any; isAdmin: boolean } | null> {
  if (!Number.isInteger(ticketId)) return null;
  const user = await storage.getUser(req.user.claims.sub);
  if (!user) return null;
  const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId));
  if (!ticket) return null;
  const isAdmin = user.role === 'admin';
  if (req.isPlatformAdmin) return { ticket, user, isAdmin: true };
  if (ticket.practiceId !== user.practiceId) return null;
  if (!isAdmin && ticket.userId !== user.id) return null;
  return { ticket, user, isAdmin };
}

const router = Router();

router.post('/report', isAuthenticated, async (req: any, res) => {
  try {
    const user = await storage.getUser(req.user.claims.sub);
    if (!user?.practiceId) {
      return res.status(400).json({ message: 'Your account is not assigned to a practice.' });
    }
    const { description, severity, page, release, userAgent } = req.body ?? {};
    const ticket = await createSupportTicket({
      practiceId: user.practiceId,
      userId: user.id,
      userRole: user.role ?? undefined,
      severity,
      description: String(description ?? ''),
      page: typeof page === 'string' ? page : undefined,
      release: typeof release === 'string' ? release : undefined,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      source: 'app',
    });
    res.status(201).json({ id: ticket.id, message: 'Report received — thank you.' });
  } catch (error: any) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('describe the problem')) {
      return res.status(400).json({ message: msg });
    }
    logger.error('Support report failed', { error: msg });
    res.status(500).json({ message: 'Could not file the report. Please try again.' });
  }
});

router.get('/reports', isAuthenticated, async (req: any, res) => {
  try {
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin role required.' });
    }
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const conditions = [] as any[];
    if (!req.isPlatformAdmin && user.practiceId) {
      conditions.push(eq(supportTickets.practiceId, user.practiceId));
    }
    if (status) conditions.push(eq(supportTickets.status, status));
    const rows: SupportTicket[] = await db
      .select()
      .from(supportTickets)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(supportTickets.createdAt))
      .limit(200);
    res.json(rows);
  } catch (error) {
    logger.error('Support list failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load reports' });
  }
});

router.patch('/reports/:id', isAuthenticated, async (req: any, res) => {
  try {
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin role required.' });
    }
    const id = parseInt(req.params.id, 10);
    const { status, notes } = req.body ?? {};
    if (status && !['open', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const [existing] = await db.select().from(supportTickets).where(eq(supportTickets.id, id));
    if (!existing) return res.status(404).json({ message: 'Ticket not found' });
    if (!req.isPlatformAdmin && existing.practiceId !== user.practiceId) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    await db
      .update(supportTickets)
      .set({
        status: status ?? existing.status,
        notes: typeof notes === 'string' ? notes : existing.notes,
        resolvedAt: status === 'resolved' ? new Date() : existing.resolvedAt,
      })
      .where(eq(supportTickets.id, id));
    res.json({ ok: true });
  } catch (error) {
    logger.error('Support update failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to update report' });
  }
});

router.get('/reports/:id/replies', isAuthenticated, async (req: any, res) => {
  try {
    const found = await loadVisibleTicket(req, parseInt(req.params.id, 10));
    if (!found) return res.status(404).json({ message: 'Ticket not found' });
    const replies = await listTicketReplies(found.ticket.id, { includeDrafts: found.isAdmin });
    res.json({ ticket: found.ticket, replies });
  } catch (error) {
    logger.error('Support replies list failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to load replies' });
  }
});

router.post('/reports/:id/replies', isAuthenticated, async (req: any, res) => {
  try {
    const found = await loadVisibleTicket(req, parseInt(req.params.id, 10));
    if (!found) return res.status(404).json({ message: 'Ticket not found' });
    const reply = await addTicketReply({
      ticketId: found.ticket.id,
      practiceId: found.ticket.practiceId,
      authorType: found.isAdmin ? 'staff' : 'user',
      authorUserId: found.user.id,
      body: String(req.body?.body ?? ''),
    });
    res.status(201).json(reply);
  } catch (error: any) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Reply text')) {
      return res.status(400).json({ message: msg });
    }
    logger.error('Support reply failed', { error: msg });
    res.status(500).json({ message: 'Failed to add reply' });
  }
});

router.post('/replies/:replyId/publish', isAuthenticated, async (req: any, res) => {
  try {
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin role required.' });
    }
    const published = await publishTicketReply({
      replyId: parseInt(req.params.replyId, 10),
      practiceId: req.isPlatformAdmin ? null : user.practiceId ?? -1,
      editedBody: typeof req.body?.body === 'string' ? req.body.body : undefined,
    });
    if (!published) return res.status(404).json({ message: 'Draft not found' });
    res.json(published);
  } catch (error) {
    logger.error('Support draft publish failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to publish draft' });
  }
});

router.delete('/replies/:replyId', isAuthenticated, async (req: any, res) => {
  try {
    const user = await storage.getUser(req.user.claims.sub);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin role required.' });
    }
    const ok = await discardDraftReply({
      replyId: parseInt(req.params.replyId, 10),
      practiceId: req.isPlatformAdmin ? null : user.practiceId ?? -1,
    });
    if (!ok) return res.status(404).json({ message: 'Draft not found' });
    res.json({ ok: true });
  } catch (error) {
    logger.error('Support draft discard failed', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ message: 'Failed to discard draft' });
  }
});

export default router;
