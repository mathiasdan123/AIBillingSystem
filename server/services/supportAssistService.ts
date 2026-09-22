/**
 * Support-assist backend for Blanche's tech-support tools.
 *
 * Three read-only capabilities that turn Blanche into first-line support:
 *   - searchHelp:        query the shared FAQ (shared/help-content.ts)
 *   - listUserTickets:   let a user see their own support tickets (admins see
 *                        the whole practice's)
 *   - getSystemStatus:   the same signals as /api/health + /api/health/data,
 *                        condensed, so Blanche can answer "is it me or is the
 *                        site down?" from data instead of guessing
 *
 * Everything here is PHI-free by construction: FAQ text, ticket rows (which
 * contain user-written problem descriptions but no patient data fields), and
 * infrastructure booleans/latencies.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  supportTickets,
  supportTicketReplies,
  type SupportTicket,
  type SupportTicketReply,
} from '@shared/schema';
import { helpSections, filterHelpSections, type HelpSection } from '@shared/help-content';

// ── FAQ search ────────────────────────────────────────────────────────

export interface HelpSearchResult {
  section: string;
  question: string;
  answer: string;
}

const MAX_HELP_RESULTS = 12;

/**
 * Search the FAQ. Empty query returns the table of contents (section titles +
 * item counts) so Blanche can tell the user what topics exist.
 */
export function searchHelp(query: string): {
  results?: HelpSearchResult[];
  sections?: { title: string; items: number }[];
  truncated?: boolean;
} {
  const q = (query ?? '').trim();
  if (!q) {
    return {
      sections: helpSections.map((s) => ({ title: s.title, items: s.items.length })),
    };
  }
  const flatten = (sections: HelpSection[]): HelpSearchResult[] =>
    sections.flatMap((s) =>
      s.items.map((i) => ({ section: s.title, question: i.question, answer: i.answer }))
    );

  let matches = flatten(filterHelpSections(helpSections, q));

  // Substring match found nothing — retry per-word so multi-word questions
  // like "reset my mfa device" still hit the "I lost my MFA device" item.
  if (matches.length === 0) {
    const words = q.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    if (words.length > 0) {
      const scored = flatten(helpSections)
        .map((item) => {
          const hay = `${item.section} ${item.question} ${item.answer}`.toLowerCase();
          const score = words.filter((w) => hay.includes(w)).length;
          return { item, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      matches = scored.map((x) => x.item);
    }
  }

  return {
    results: matches.slice(0, MAX_HELP_RESULTS),
    truncated: matches.length > MAX_HELP_RESULTS,
  };
}

// ── Ticket visibility ─────────────────────────────────────────────────

export interface TicketReplySummary {
  from: 'you' | 'support';
  body: string;
  at: Date | null;
}

export interface TicketSummary {
  id: number;
  severity: string;
  status: string;
  description: string;
  source: string;
  page: string | null;
  notes: string | null;
  createdAt: Date | null;
  resolvedAt: Date | null;
  replies: TicketReplySummary[];
}

const TICKET_STATUSES = new Set(['open', 'in_progress', 'resolved']);
const MAX_TICKETS = 20;

/**
 * List support tickets visible to this user. Non-admins see only tickets they
 * filed themselves; admins see every ticket in their practice. Always
 * practice-scoped — platform-wide visibility is deliberately NOT offered here
 * (that's the admin HTTP surface's job, not the chat's).
 */
export async function listUserTickets(opts: {
  userId: string | null;
  practiceId: number;
  isAdmin: boolean;
  status?: string;
}): Promise<TicketSummary[]> {
  const conditions = [eq(supportTickets.practiceId, opts.practiceId)];
  if (!opts.isAdmin) {
    if (!opts.userId) return []; // anonymous/demo sessions have no ticket history
    conditions.push(eq(supportTickets.userId, opts.userId));
  }
  if (opts.status && TICKET_STATUSES.has(opts.status)) {
    conditions.push(eq(supportTickets.status, opts.status));
  }
  const rows: SupportTicket[] = await db
    .select()
    .from(supportTickets)
    .where(and(...conditions))
    .orderBy(desc(supportTickets.createdAt))
    .limit(MAX_TICKETS);

  // Published replies only — agent drafts stay invisible until an admin
  // publishes them from /support-tickets, and this chat surface is exactly
  // where that boundary matters.
  const repliesByTicket = new Map<number, TicketReplySummary[]>();
  if (rows.length > 0) {
    const replyRows: SupportTicketReply[] = await db
      .select()
      .from(supportTicketReplies)
      .where(
        and(
          inArray(supportTicketReplies.ticketId, rows.map((t) => t.id)),
          eq(supportTicketReplies.status, 'published')
        )
      )
      .orderBy(asc(supportTicketReplies.createdAt));
    for (const r of replyRows) {
      const list = repliesByTicket.get(r.ticketId) ?? [];
      list.push({
        from: r.authorType === 'user' ? 'you' : 'support',
        body: r.body.length > 500 ? `${r.body.slice(0, 500)}…` : r.body,
        at: r.publishedAt ?? r.createdAt,
      });
      repliesByTicket.set(r.ticketId, list);
    }
  }

  return rows.map((t) => ({
    id: t.id,
    severity: t.severity,
    status: t.status,
    description: t.description.length > 300 ? `${t.description.slice(0, 300)}…` : t.description,
    source: t.source,
    page: t.page,
    notes: t.notes,
    createdAt: t.createdAt,
    resolvedAt: t.resolvedAt,
    replies: repliesByTicket.get(t.id) ?? [],
  }));
}

// ── System status ─────────────────────────────────────────────────────

export interface SystemStatus {
  overall: 'healthy' | 'degraded';
  release: string;
  uptimeSeconds: number;
  database: { status: string; latencyMs?: number };
  redis: { status: string };
  clearinghouseConfigured: boolean;
  catalogs: { icd10: boolean; cpt: boolean };
}

/**
 * Condensed health snapshot mirroring /api/health + /api/health/data. Kept as
 * live checks (not a cached copy of the endpoints) so a chat question runs the
 * same probes the monitors do.
 */
export async function getSystemStatus(): Promise<SystemStatus> {
  const { storage } = await import('../storage');
  const { getRedisClient, isRedisReady } = await import('./redisClient');
  const { isStediConfigured } = await import('./stediService');

  const database: SystemStatus['database'] = { status: 'unhealthy' };
  try {
    const start = Date.now();
    await storage.getAllPracticeIds();
    database.status = 'healthy';
    database.latencyMs = Date.now() - start;
  } catch {
    /* stays unhealthy */
  }

  let redisStatus = 'not_configured';
  const redisClient = getRedisClient();
  if (redisClient !== null) {
    if (isRedisReady()) {
      try {
        await redisClient.ping();
        redisStatus = 'healthy';
      } catch {
        redisStatus = 'unhealthy';
      }
    } else {
      redisStatus = 'unhealthy';
    }
  }

  const catalogs = { icd10: false, cpt: false };
  try {
    catalogs.icd10 = (await storage.getIcd10Codes()).length > 0;
  } catch { /* stays false */ }
  try {
    catalogs.cpt = (await storage.getCptCodes()).length > 0;
  } catch { /* stays false */ }

  const clearinghouseConfigured = isStediConfigured();

  const overall =
    database.status === 'healthy' &&
    redisStatus !== 'unhealthy' &&
    clearinghouseConfigured &&
    catalogs.icd10 &&
    catalogs.cpt
      ? 'healthy'
      : 'degraded';

  return {
    overall,
    release: process.env.RELEASE_SHA || 'unknown',
    uptimeSeconds: Math.round(process.uptime()),
    database,
    redis: { status: redisStatus },
    clearinghouseConfigured,
    catalogs,
  };
}
