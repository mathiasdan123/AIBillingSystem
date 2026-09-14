/**
 * Support ticket intake — the tracked queue behind the in-app "Report a
 * problem" button and Blanche's report_issue tool. Every ticket carries the
 * diagnostic context (user, practice, role, route, release, user agent) so
 * the reporter never has to describe their environment.
 *
 * Notification goes to SUPPORT_NOTIFY_EMAIL when configured; a missing or
 * failing email never blocks ticket creation — the DB row IS the queue.
 */
import { db } from '../db';
import { supportTickets, type SupportTicket } from '@shared/schema';
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
