/**
 * Autonomous support-ticket triage — the 24/7 first responder.
 *
 * Every run (scheduler: every 10 minutes, leader-elected) picks up untriaged
 * open tickets and, per ticket:
 *   1. classifies it (how_to / bug / outage / billing_question /
 *      feature_request / other),
 *   2. drafts a reply grounded in the shared FAQ and a live system-status
 *      snapshot — created as a DRAFT reply (authorType 'agent') that stays
 *      invisible to the reporter until an admin publishes it from the
 *      /support-tickets queue,
 *   3. escalates by email when the ticket reads like "cannot work at all" or
 *      the platform itself is degraded.
 *
 * Poller discipline (same charter as the ERA poller):
 *   - Never rescan: triagedAt is set on every processed ticket, including
 *     parse failures — a broken model response must not burn tokens in a loop.
 *   - Never double-draft: a ticket that already has an agent reply is skipped
 *     (and marked triaged) even if triagedAt was lost.
 *
 * The agent only ever WRITES drafts and internal notes. It changes no
 * user-visible state without a human publish. Severity is never mutated —
 * an urgency disagreement goes in the internal note and the escalation email.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { supportTickets, supportTicketReplies, type SupportTicket } from '@shared/schema';
import { createAiClient, isAiConfigured } from './aiProvider';
import { searchHelp, getSystemStatus, type SystemStatus } from './supportAssistService';
import { addTicketReply } from './supportTicketService';
import logger from './logger';

const TRIAGE_MODEL = process.env.SUPPORT_TRIAGE_MODEL || 'claude-sonnet-4-5';
const MAX_TICKETS_PER_RUN = 10;
const CATEGORIES = new Set([
  'how_to',
  'bug',
  'outage',
  'billing_question',
  'feature_request',
  'other',
]);

export interface TriageSummary {
  scanned: number;
  triaged: number;
  drafted: number;
  escalated: number;
  failures: number;
  skipped?: string;
}

interface TriageVerdict {
  category: string;
  draftReply: string;
  internalNote: string;
  escalate: boolean;
  escalationReason?: string;
}

export async function triageOpenTickets(): Promise<TriageSummary> {
  if (process.env.SUPPORT_TRIAGE_DISABLED === '1') {
    return { scanned: 0, triaged: 0, drafted: 0, escalated: 0, failures: 0, skipped: 'disabled' };
  }
  if (!isAiConfigured()) {
    return { scanned: 0, triaged: 0, drafted: 0, escalated: 0, failures: 0, skipped: 'ai_not_configured' };
  }

  const tickets: SupportTicket[] = await db
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.status, 'open'), isNull(supportTickets.triagedAt)))
    .orderBy(asc(supportTickets.createdAt))
    .limit(MAX_TICKETS_PER_RUN);

  const summary: TriageSummary = {
    scanned: tickets.length,
    triaged: 0,
    drafted: 0,
    escalated: 0,
    failures: 0,
  };
  if (tickets.length === 0) return summary;

  // One status snapshot per run — the point is "was the platform degraded
  // around the time of these tickets", not a per-ticket probe.
  let status: SystemStatus | null = null;
  try {
    status = await getSystemStatus();
  } catch (err) {
    logger.warn('Triage: system status probe failed; proceeding without it', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  for (const ticket of tickets) {
    try {
      const [existingAgentReply] = await db
        .select({ id: supportTicketReplies.id })
        .from(supportTicketReplies)
        .where(
          and(
            eq(supportTicketReplies.ticketId, ticket.id),
            eq(supportTicketReplies.authorType, 'agent')
          )
        )
        .limit(1);

      if (existingAgentReply) {
        // Drafted on a previous run that died before marking — close the loop.
        await markTriaged(ticket, 'other', '[triage] Agent reply already existed; marked triaged to stop rescans.');
        summary.triaged++;
        continue;
      }

      const verdict = await runTriageModel(ticket, status);
      if (!verdict) {
        await markTriaged(ticket, 'other', '[triage] Model response was unparseable; no draft created. A human should look.');
        summary.failures++;
        summary.triaged++;
        continue;
      }

      await markTriaged(
        ticket,
        CATEGORIES.has(verdict.category) ? verdict.category : 'other',
        `[triage] ${verdict.internalNote}`.slice(0, 2000)
      );
      summary.triaged++;

      if (verdict.draftReply && verdict.draftReply.trim().length >= 2) {
        await addTicketReply({
          ticketId: ticket.id,
          practiceId: ticket.practiceId,
          authorType: 'agent',
          body: verdict.draftReply,
          asDraft: true,
        });
        summary.drafted++;
      }

      if (verdict.escalate) {
        await sendEscalationEmail(ticket, verdict, status);
        summary.escalated++;
      }
    } catch (err) {
      // Per-ticket failure never kills the run; the ticket stays untriaged
      // and is retried next cycle (transient DB/AI errors heal themselves).
      summary.failures++;
      logger.error('Triage failed for ticket', {
        ticketId: ticket.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

async function markTriaged(ticket: SupportTicket, category: string, note: string): Promise<void> {
  const notes = ticket.notes ? `${ticket.notes}\n${note}` : note;
  await db
    .update(supportTickets)
    .set({ triageCategory: category, triagedAt: new Date(), notes })
    .where(eq(supportTickets.id, ticket.id));
}

async function runTriageModel(
  ticket: SupportTicket,
  status: SystemStatus | null
): Promise<TriageVerdict | null> {
  const client = createAiClient({
    apiKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
  });

  const faq = searchHelp(ticket.description.slice(0, 500));
  const faqBlock =
    faq.results && faq.results.length > 0
      ? faq.results
          .slice(0, 6)
          .map((r) => `Q: ${r.question}\nA: ${r.answer}`)
          .join('\n\n')
      : '(no relevant FAQ entries found)';

  const statusBlock = status
    ? `overall: ${status.overall}; database: ${status.database.status}; redis: ${status.redis.status}; clearinghouse configured: ${status.clearinghouseConfigured}; catalogs ok: icd10=${status.catalogs.icd10} cpt=${status.catalogs.cpt}; release: ${status.release}`
    : '(status probe unavailable this run)';

  const prompt = `You are the support triage agent for TherapyBill, a therapy practice management platform. A user filed this support ticket. Classify it and draft a first reply for a human admin to review before it is sent.

TICKET #${ticket.id}
Severity chosen by reporter: ${ticket.severity}
Reporter role: ${ticket.userRole ?? 'unknown'}
Filed from page: ${ticket.page ?? 'unknown'}
App release at filing: ${ticket.release ?? 'unknown'}
Source: ${ticket.source}
Description:
${ticket.description.slice(0, 3000)}

RELEVANT FAQ ENTRIES (the product's source of truth — ground your reply in these when they apply):
${faqBlock}

LIVE PLATFORM STATUS (right now, which may be later than the ticket):
${statusBlock}

Reply-drafting rules:
- Address the reporter directly, warmly, and plainly. Sign off as "TherapyBill Support".
- Ground every product claim in the FAQ entries above. If the FAQ does not cover it, say the team is looking into it rather than inventing behavior.
- If the platform status shows a degraded component that plausibly explains the ticket, say so and reassure that it is on our side.
- Never ask the user for passwords or codes. Never include patient information in the reply.
- Do not use hyphens or dashes anywhere in the reply text. Write around them.
- Keep the reply under 150 words.
- If the ticket is really a feature request, thank them, confirm it was logged for the team, and do not promise a timeline.

Escalation: set "escalate" true ONLY if the reporter appears unable to work at all (cannot log in, cannot save clinical notes, money numbers look wrong) or the live status is degraded. Otherwise false.

Respond with ONLY this JSON:
{
  "category": "how_to | bug | outage | billing_question | feature_request | other",
  "draftReply": "the reply text for the reporter",
  "internalNote": "one or two sentences for the admin: what you think is going on, what to check, and whether the reporter's severity seems right",
  "escalate": false,
  "escalationReason": "required if escalate is true, else empty string"
}`;

  const response = await client.messages.create({
    model: TRIAGE_MODEL,
    max_tokens: 1000,
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed.category !== 'string' || typeof parsed.draftReply !== 'string') return null;
    return {
      category: parsed.category,
      draftReply: parsed.draftReply,
      internalNote: typeof parsed.internalNote === 'string' ? parsed.internalNote : '',
      escalate: parsed.escalate === true,
      escalationReason: typeof parsed.escalationReason === 'string' ? parsed.escalationReason : '',
    };
  } catch {
    return null;
  }
}

async function sendEscalationEmail(
  ticket: SupportTicket,
  verdict: TriageVerdict,
  status: SystemStatus | null
): Promise<void> {
  const notifyTo = process.env.SUPPORT_NOTIFY_EMAIL;
  if (!notifyTo) return;
  try {
    const { isEmailConfigured } = await import('../email');
    if (!isEmailConfigured()) return;
    const { sendEmail } = await import('./emailService');
    const reason = verdict.escalationReason || 'Triage flagged this ticket for immediate attention.';
    await sendEmail({
      to: notifyTo,
      subject: `[ESCALATION] Support ticket #${ticket.id} (${verdict.category}, practice ${ticket.practiceId})`,
      html: `<p><strong>Ticket #${ticket.id}</strong> escalated by the triage agent.</p>
<p><strong>Reason:</strong> ${reason.replace(/</g, '&lt;')}</p>
<p><strong>Reporter description:</strong></p>
<p>${ticket.description.slice(0, 2000).replace(/</g, '&lt;')}</p>
<p style="color:#666;font-size:12px">practice ${ticket.practiceId} · severity ${ticket.severity} · page ${ticket.page ?? 'n/a'} · platform ${status?.overall ?? 'unknown'} · a draft reply is waiting in /support-tickets</p>`,
      text: `Ticket #${ticket.id} escalated by the triage agent.\n\nReason: ${reason}\n\n${ticket.description.slice(0, 2000)}\n\npractice ${ticket.practiceId} · severity ${ticket.severity} · platform ${status?.overall ?? 'unknown'}\nA draft reply is waiting in /support-tickets.`,
    });
  } catch (err) {
    logger.warn('Triage escalation email failed (non-blocking)', {
      ticketId: ticket.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
