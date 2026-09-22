/**
 * Support ticket intake — the tracked queue behind the in-app "Report a
 * problem" button and Blanche's report_issue tool. Every ticket carries the
 * diagnostic context (user, practice, role, route, release, user agent) so
 * the reporter never has to describe their environment.
 *
 * Notification goes to SUPPORT_NOTIFY_EMAIL when configured; a missing or
 * failing email never blocks ticket creation — the DB row IS the queue.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import {
  supportTickets,
  supportTicketReplies,
  type SupportTicket,
  type SupportTicketReply,
} from '@shared/schema';
import logger from './logger';

export interface CreateTicketInput {
  practiceId: number;
  userId?: string;
  userRole?: string;
  severity?: string;
  description: string;
  page?: string;
  release?: string;
  userAgent?: string;
  source?: 'app' | 'blanche';
}

const SEVERITIES = new Set(['urgent', 'normal', 'low']);

export async function createSupportTicket(input: CreateTicketInput): Promise<SupportTicket> {
  const description = (input.description ?? '').trim().slice(0, 5000);
  if (description.length < 5) {
    throw new Error('Please describe the problem (a sentence is plenty).');
  }

  const [ticket] = await db
    .insert(supportTickets)
    .values({
      practiceId: input.practiceId,
      userId: input.userId ?? null,
      userRole: input.userRole ?? null,
      severity: SEVERITIES.has(input.severity ?? '') ? input.severity! : 'normal',
      description,
      page: input.page?.slice(0, 300) ?? null,
      release: input.release?.slice(0, 64) ?? process.env.RELEASE_SHA?.slice(0, 64) ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      source: input.source === 'blanche' ? 'blanche' : 'app',
    })
    .returning();

  // Fire-and-forget notification — the row is already the source of truth.
  const notifyTo = process.env.SUPPORT_NOTIFY_EMAIL;
  if (notifyTo) {
    try {
      const { isEmailConfigured } = await import('../email');
      if (isEmailConfigured()) {
        const { sendEmail } = await import('./emailService');
        await sendEmail({
          to: notifyTo,
          subject: `[${ticket!.severity.toUpperCase()}] Support ticket #${ticket!.id} (practice ${ticket!.practiceId}, via ${ticket!.source})`,
          html: `<p><strong>Ticket #${ticket!.id}</strong> — ${ticket!.severity}, via ${ticket!.source}</p>
<p>${description.replace(/</g, '&lt;')}</p>
<p style="color:#666;font-size:12px">practice ${ticket!.practiceId} · user ${ticket!.userId ?? 'n/a'} (${ticket!.userRole ?? 'n/a'}) · page ${ticket!.page ?? 'n/a'} · release ${ticket!.release ?? 'n/a'}</p>`,
          text: `Ticket #${ticket!.id} [${ticket!.severity}] via ${ticket!.source}\n\n${description}\n\npractice ${ticket!.practiceId} · user ${ticket!.userId ?? 'n/a'} · page ${ticket!.page ?? 'n/a'} · release ${ticket!.release ?? 'n/a'}`,
        });
      }
    } catch (err) {
      logger.warn('Support ticket email notification failed (non-blocking)', {
        ticketId: ticket!.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Support ticket created', {
    ticketId: ticket!.id,
    practiceId: ticket!.practiceId,
    severity: ticket!.severity,
    source: ticket!.source,
  });
  return ticket!;
}

// ── Reply thread ──────────────────────────────────────────────────────
//
// Replies carry the human-approval gate for the autonomous support agent:
// authorType 'agent' rows are created as status 'draft' and stay invisible to
// the reporter until an admin publishes them. 'user' and 'staff' replies are
// born published.

export interface AddReplyInput {
  ticketId: number;
  practiceId: number;
  authorType: 'user' | 'staff' | 'agent';
  authorUserId?: string;
  body: string;
  /** Only meaningful for authorType 'agent'; others are always published. */
  asDraft?: boolean;
}

export async function addTicketReply(input: AddReplyInput): Promise<SupportTicketReply> {
  const body = (input.body ?? '').trim().slice(0, 5000);
  if (body.length < 2) {
    throw new Error('Reply text is required.');
  }
  const isDraft = input.authorType === 'agent' && input.asDraft !== false;
  const [reply] = await db
    .insert(supportTicketReplies)
    .values({
      ticketId: input.ticketId,
      practiceId: input.practiceId,
      authorType: input.authorType,
      authorUserId: input.authorUserId ?? null,
      body,
      status: isDraft ? 'draft' : 'published',
      publishedAt: isDraft ? null : new Date(),
    })
    .returning();
  logger.info('Support ticket reply added', {
    ticketId: input.ticketId,
    replyId: reply!.id,
    authorType: input.authorType,
    status: reply!.status,
  });
  return reply!;
}

/**
 * Replies for one ticket, oldest first. includeDrafts is the admin view;
 * reporters only ever see published replies.
 */
export async function listTicketReplies(
  ticketId: number,
  opts: { includeDrafts: boolean }
): Promise<SupportTicketReply[]> {
  const conditions = [eq(supportTicketReplies.ticketId, ticketId)];
  if (!opts.includeDrafts) {
    conditions.push(eq(supportTicketReplies.status, 'published'));
  }
  return db
    .select()
    .from(supportTicketReplies)
    .where(and(...conditions))
    .orderBy(asc(supportTicketReplies.createdAt));
}

/**
 * Publish an agent draft (optionally with the admin's edits). Returns null if
 * the reply doesn't exist, isn't a draft, or belongs to another practice —
 * the route turns that into a 404.
 */
export async function publishTicketReply(opts: {
  replyId: number;
  practiceId: number | null; // null = platform admin, any practice
  editedBody?: string;
}): Promise<SupportTicketReply | null> {
  const [existing] = await db
    .select()
    .from(supportTicketReplies)
    .where(eq(supportTicketReplies.id, opts.replyId));
  if (!existing || existing.status !== 'draft') return null;
  if (opts.practiceId !== null && existing.practiceId !== opts.practiceId) return null;
  const body = (opts.editedBody ?? '').trim();
  const [updated] = await db
    .update(supportTicketReplies)
    .set({
      body: body.length >= 2 ? body.slice(0, 5000) : existing.body,
      status: 'published',
      publishedAt: new Date(),
    })
    .where(eq(supportTicketReplies.id, opts.replyId))
    .returning();
  logger.info('Support ticket reply published', {
    ticketId: existing.ticketId,
    replyId: opts.replyId,
    edited: body.length >= 2 && body !== existing.body,
  });
  return updated ?? null;
}

/** Discard an agent draft an admin rejected. Same not-found semantics as publish. */
export async function discardDraftReply(opts: {
  replyId: number;
  practiceId: number | null;
}): Promise<boolean> {
  const [existing] = await db
    .select()
    .from(supportTicketReplies)
    .where(eq(supportTicketReplies.id, opts.replyId));
  if (!existing || existing.status !== 'draft') return false;
  if (opts.practiceId !== null && existing.practiceId !== opts.practiceId) return false;
  await db.delete(supportTicketReplies).where(eq(supportTicketReplies.id, opts.replyId));
  logger.info('Support ticket draft reply discarded', {
    ticketId: existing.ticketId,
    replyId: opts.replyId,
  });
  return true;
}
