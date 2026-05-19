/**
 * AI Assistant Routes
 *
 * Handles:
 * - POST /api/ai/assistant - Chat with AI billing assistant
 * - GET /api/ai/assistant/status - Check if AI assistant is available
 */

import { Router, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { storage } from '../storage';
import { isAuthenticated } from '../replitAuth';
import { getUserPracticeContext } from '../services/practiceContext';
import { generateSoapNoteAndBilling } from '../services/aiSoapBillingService';
import { assessUnderpayment, analyzeAdjustment } from '../services/underpaymentAnalyzer';
import * as stripeService from '../services/stripeService';
import { db } from '../db';
import { getRedisClient, isRedisReady } from '../services/redisClient';
import {
  remittanceAdvice,
  remittanceLineItems,
  claims,
  feeSchedules,
  patients,
  patientPlanDocuments,
  patientPlanBenefits,
  appeals,
  insurances,
  appointments,
  soapNotes,
  treatmentSessions,
  users,
} from '@shared/schema';
import { eq, and, desc, sql, ilike, lte, gte, isNotNull, inArray, isNull, or } from 'drizzle-orm';
import logger from '../services/logger';

const router = Router();

// ---------------------------------------------------------------------------
// Cost Optimization #1: Smart Model Routing
// Use cheaper Haiku for simple queries, Sonnet for complex ones
// ---------------------------------------------------------------------------
const MODEL_HAIKU = 'claude-haiku-4-20250414';
const MODEL_SONNET = 'claude-sonnet-4-20250514';

// Tools that require Sonnet's stronger reasoning capabilities
const SONNET_TOOLS = new Set([
  'create_patient',
  'submit_claim',
  'generate_soap_note',
  'draft_appeal_letter',
  'suggest_claim_correction',
  'create_appointment',
  'reschedule_appointment',
  'cancel_appointment',
  'batch_eligibility_check',
  'bulk_eligibility_by_filter',
  'review_underpayments',
  'draft_underpayment_dispute',
  'send_patient_portal_invite',
  'send_appointment_reminder',
  'check_claim_status',
  'create_patient_invoice',
  'send_patient_payment_link',
  'summarize_recent_eobs',
  'check_plan_document_status',
  'get_appeal_outcomes',
  'get_provider_productivity',
]);

/**
 * Phase 4 — Tools that MUTATE real practice data and must require an explicit
 * user confirmation step before executing. The web chat surfaces a proposal
 * card; the user clicks Confirm or Cancel.
 *
 * Adding a new mutation tool? Put it in here. Drafts/reads/queries do NOT
 * belong (e.g. draft_appeal_letter returns text without persisting; it stays
 * auto-execute). When in doubt, add it — the worst case is one extra click.
 */
const MUTATION_TOOLS = new Set<string>([
  'create_patient',
  'create_appointment',
  'reschedule_appointment',
  'cancel_appointment',
  'send_patient_portal_invite',
  'send_appointment_reminder',
  'submit_claim',
  'create_patient_invoice',
  'send_patient_payment_link',
  'generate_soap_note',
  // Phase 5 — demo / practice mode
  'enable_demo_mode',
  'clear_demo_data',
  // Phase 5.1 — flip the is_demo flag on existing rows
  'mark_patients_as_demo',
  'unmark_demo_patients',
]);

/**
 * One-line, plain-English summary of what a proposed mutation will do.
 * Surfaced on the proposal card so the user knows what they're approving
 * without having to read the raw JSON args. Keep it specific and concrete —
 * "Send portal invite to Jane Doe (jane@example.com)" beats "Send portal
 * invite". Falls back to a generic phrasing if args don't include a name.
 */
export function summarizeProposal(toolName: string, args: Record<string, any>): string {
  const name = (() => {
    if (args.firstName || args.lastName) {
      return `${args.firstName ?? ''} ${args.lastName ?? ''}`.trim();
    }
    if (args.patientName) return String(args.patientName);
    return null;
  })();
  switch (toolName) {
    case 'create_patient':
      return name ? `Create patient ${name}` : 'Create a new patient';
    case 'create_appointment':
      return `Create an appointment${args.startTime ? ` at ${args.startTime}` : ''}${name ? ` for ${name}` : ''}`;
    case 'reschedule_appointment':
      return `Reschedule appointment ${args.appointmentId ?? ''} to ${args.newStartTime ?? 'a new time'}`.trim();
    case 'cancel_appointment':
      return `Cancel appointment ${args.appointmentId ?? ''}${args.reason ? ` (reason: ${args.reason})` : ''}`.trim();
    case 'send_patient_portal_invite':
      return `Send portal invite${name ? ` to ${name}` : ''}${args.email ? ` (${args.email})` : ''}`;
    case 'send_appointment_reminder':
      return `Send appointment reminder${args.appointmentId ? ` for #${args.appointmentId}` : ''} via ${args.channel ?? 'email'}`;
    case 'submit_claim':
      return `Submit claim${args.claimId ? ` #${args.claimId}` : ''} to the clearinghouse`;
    case 'create_patient_invoice':
      return `Create invoice${args.amount ? ` for $${args.amount}` : ''}${name ? ` to ${name}` : ''}`;
    case 'send_patient_payment_link':
      return `Send payment link${name ? ` to ${name}` : ''}${args.amount ? ` for $${args.amount}` : ''}`;
    case 'generate_soap_note':
      return `Generate & save SOAP note${name ? ` for ${name}` : ''}`;
    case 'enable_demo_mode':
      return 'Enable demo mode (creates 8 DEMO- patients, 5 appointments across yesterday/today/tomorrow, and 5 claims across draft/submitted/paid/denied/held — enough variety to demo the full revenue cycle)';
    case 'clear_demo_data':
      return 'Clear recent demo data for this practice (rows from the last 14 days only — permanent showcase patients hand-tagged via mark_patients_as_demo are preserved). Irreversible.';
    case 'mark_patients_as_demo': {
      const ids = Array.isArray(args.patientIds) ? args.patientIds : [];
      return `Mark ${ids.length} patient${ids.length === 1 ? '' : 's'} as demo (also cascades to their appointments + claims so the firewall is consistent)`;
    }
    case 'unmark_demo_patients': {
      const ids = Array.isArray(args.patientIds) ? args.patientIds : [];
      return `Un-mark ${ids.length} patient${ids.length === 1 ? '' : 's'} so they're real data again (also clears the demo flag on their appointments + claims)`;
    }
    default:
      return `Run ${toolName}`;
  }
}

/**
 * In-memory proposal store. Keyed by random uuid. TTL of 5 minutes — older
 * entries are cleared on each access. Per-process; on multi-task ECS the
 * confirm request must land on the same task. ALB session affinity isn't
 * configured today; the in-memory fallback below would 404 a Confirm landing
 * on a different task than the original chat message. Redis path fixes that —
 * any task can read/delete any proposal because the store is shared.
 *
 * Production runs 2 ECS tasks behind ALB. Without affinity, the first message
 * lands on task A (creates proposal in A's memory) and the Confirm click lands
 * on task B (which doesn't have it → 404). This was a real bug observed in prod
 * 2026-05-18. Redis fixes it.
 *
 * Falls back to in-memory Map when Redis isn't configured (local dev, tests).
 */
interface StoredProposal {
  id: string;
  userId: string | undefined;
  practiceId: number;
  toolName: string;
  args: Record<string, any>;
  summary: string;
  createdAt: number;
}
const PROPOSAL_TTL_MS = 5 * 60_000;
const PROPOSAL_TTL_S = PROPOSAL_TTL_MS / 1000;
const PROPOSAL_REDIS_PREFIX = 'blanche:proposal:';
const proposalStore = new Map<string, StoredProposal>();

function pruneStaleProposals() {
  // Only relevant for the in-memory fallback; Redis handles TTL natively.
  const cutoff = Date.now() - PROPOSAL_TTL_MS;
  proposalStore.forEach((p, id) => {
    if (p.createdAt < cutoff) proposalStore.delete(id);
  });
}

async function createProposal(opts: Omit<StoredProposal, 'id' | 'createdAt' | 'summary'> & { summary?: string }): Promise<StoredProposal> {
  pruneStaleProposals();
  const id = (globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`) as string;
  const proposal: StoredProposal = {
    id,
    userId: opts.userId,
    practiceId: opts.practiceId,
    toolName: opts.toolName,
    args: opts.args,
    summary: opts.summary ?? summarizeProposal(opts.toolName, opts.args),
    createdAt: Date.now(),
  };
  try {
    if (isRedisReady()) {
      const redis = getRedisClient()!;
      await redis.set(
        PROPOSAL_REDIS_PREFIX + id,
        JSON.stringify(proposal),
        'EX',
        PROPOSAL_TTL_S,
      );
      return proposal;
    }
  } catch (err) {
    logger.warn('Redis proposal store failed; falling back to in-memory', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  proposalStore.set(id, proposal);
  return proposal;
}

async function takeProposal(id: string): Promise<StoredProposal | null> {
  try {
    if (isRedisReady()) {
      const redis = getRedisClient()!;
      // Use GETDEL when available (Redis 6.2+) for atomicity; fall back to
      // GET then DEL on older Redis. A double-confirm race window of <1ms is
      // acceptable — second call sees null on the GET.
      const key = PROPOSAL_REDIS_PREFIX + id;
      let raw: string | null;
      try {
        raw = await (redis as any).getdel(key);
      } catch {
        raw = await redis.get(key);
        if (raw) await redis.del(key);
      }
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StoredProposal;
      } catch {
        return null;
      }
    }
  } catch (err) {
    logger.warn('Redis proposal lookup failed; falling back to in-memory', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  pruneStaleProposals();
  const proposal = proposalStore.get(id);
  if (!proposal) return null;
  proposalStore.delete(id);
  return proposal;
}

/**
 * Hallucinated-success detector (Layer 2 of the Phase 4 trust defense).
 *
 * Two categories of "you shouldn't say that" patterns:
 *
 * STRONG_SUCCESS_PATTERNS — asserts an action was completed. e.g. "I've marked
 * them", "Successfully created", "Done!", "- Marked all 7", "✅ patients...".
 * These are dangerous because they misrepresent state. Flag both when no tool
 * was called (pure hallucination) AND when a tool WAS called but the action
 * is only queued, not executed.
 *
 * THEATRE_PATTERNS — cringe enthusiasm openers. "Perfect!", "Great!",
 * "Excellent!". Not lies, but violate the rule against premature celebration.
 * Flag only when no tool was called (so they're load-bearing on a non-action).
 * Tolerate when a tool was called (system prompt should discourage them, but
 * a warning every time Blanche says "Perfect!" while correctly queuing would
 * be over-warning).
 *
 * Heuristic, not a parser — over-flag in the STRONG category is acceptable;
 * under-flag is the failure mode being guarded against.
 *
 * Returns the matched example phrase, or null.
 */
type DetectorMode = 'strong-only' | 'all';

const STRONG_SUCCESS_PATTERNS: Array<{ re: RegExp; example: string }> = [
  // Past-tense action verbs in first-person.
  { re: /\bi['']?ve\s+(?:marked|created|sent|submitted|charged|cancelled|canceled|deleted|cleared|scheduled|rescheduled|updated|saved|added|flagged|tagged|invited|generated)/, example: "I've marked" },
  { re: /\bi\s+(?:marked|created|sent|submitted|charged|cancelled|canceled|deleted|cleared|scheduled|rescheduled|updated|saved|added|flagged|tagged|invited|generated)\s+(?!.*\bif\b)/, example: 'I marked' },
  // "Successfully X-ed" framing.
  { re: /\bsuccessfully\s+(?:marked|created|sent|submitted|charged|cancelled|canceled|deleted|cleared|scheduled|rescheduled|updated|saved|added|flagged|tagged|invited|generated|completed)/, example: 'successfully marked' },
  // "All set" / "All done" / "Done!" closers — only when standalone.
  { re: /^\s*(?:all\s+(?:set|done)|done!?|that['']?s\s+(?:done|all\s+set))(?:\s|[.!])/m, example: 'Done!' },
  // Bullet-list of past-tense items framed as completion. Verb must be FIRST
  // word of bullet content (so "- Janet needs to be created" doesn't match).
  { re: /(?:^|\n)\s*[-*•]\s*(?:\*\*)?(?:marked|tagged|flagged|created|sent|submitted|cancelled|canceled|deleted|cleared|scheduled|rescheduled|updated|saved|added|invited|generated)\b/im, example: '- Marked ...' },
  // ASCII check-mark "what was done" lists.
  { re: /(?:^|\n)\s*(?:✅|☑|✓)\s+(?:all|the)?\s*(?:these\s+)?(?:patients|claims|appointments|records|items)/m, example: '✅ patients ...' },
];

const THEATRE_PATTERNS: Array<{ re: RegExp; example: string }> = [
  // Premature-celebration openers. Line-start only (not anywhere in text).
  { re: /(?:^|\n)\s*(?:perfect[!.]|all\s+set[!.])\s/m, example: 'Perfect!' },
  { re: /(?:^|\n)\s*(?:great[!.]|excellent[!.]|awesome[!.]|fantastic[!.])\s/m, example: 'Great!' },
];

export function detectSuccessClaim(text: string, mode: DetectorMode = 'all'): string | null {
  if (!text) return null;
  // Strip markdown emphasis so "**Done!**" matches "done!".
  const normalized = text.toLowerCase().replace(/[*_`]/g, '');
  for (const { re, example } of STRONG_SUCCESS_PATTERNS) {
    if (re.test(normalized)) return example;
  }
  if (mode === 'all') {
    for (const { re, example } of THEATRE_PATTERNS) {
      if (re.test(normalized)) return example;
    }
  }
  return null;
}

/**
 * If Claude's final response misrepresents state, prepend a warning to the
 * user. Two distinct misrepresentation cases:
 *
 * 1. No mutation tool called, success language present → pure hallucination.
 *    Warning: "I may have skipped a tool call. Nothing actually changed."
 * 2. Mutation tool called, STRONG success language present → premature
 *    completion claim. The action is queued for Confirm, not executed yet.
 *    Warning: "I used past-tense language but the action isn't done yet —
 *    click Confirm on the card to actually run it."
 *
 * Mild theatre openers ("Perfect!") with a tool call do NOT warn — they're
 * just cringe and the system prompt is the primary defense for those.
 */
export function augmentIfHallucinatedSuccess(
  text: string,
  mutationsCalledCount: number,
): string {
  if (mutationsCalledCount > 0) {
    // Tool WAS called. Only flag STRONG success claims (not theatre openers).
    const matched = detectSuccessClaim(text, 'strong-only');
    if (!matched) return text;
    return (
      `⚠️ **Heads up — I used past-tense language for an action that hasn't run yet.** ` +
      `My phrasing (e.g. "${matched}") could read as "done," but the action is queued in the ` +
      `Confirm/Cancel card below — it only executes once you click Confirm. Nothing has changed yet.\n\n---\n\n` +
      text
    );
  }
  // No tool called. Flag both strong claims AND theatre openers — both are
  // load-bearing on a non-action.
  const matched = detectSuccessClaim(text, 'all');
  if (!matched) return text;
  return (
    `⚠️ **Heads up — I may have skipped a tool call.** I claimed an action was done ` +
    `(based on phrasing like "${matched}") but didn't invoke the corresponding tool. ` +
    `**Nothing was actually changed.** Please ask me again to perform the action — ` +
    `I'll call the tool this time and you'll see a Confirm/Cancel card before it runs. ` +
    `(This warning is a safeguard against the assistant claiming actions that didn't happen.)\n\n---\n\n` +
    text
  );
}

/**
 * Phase 5 guard — refuse mutation/send/charge operations when the target row
 * (patient, claim, appointment) is a demo row. Returns a JSON-stringified
 * error message ready to be returned directly from a tool executor, or null
 * if the row is NOT demo and the caller should proceed.
 *
 * The message is user-facing: it tells the user this is demo data and
 * suggests cloning the workflow on a real patient. Tools call this right
 * after fetching the row by id.
 */
export function rejectIfDemoData(
  row: { isDemo?: boolean } | null | undefined,
  what: 'patient' | 'claim' | 'appointment',
): string | null {
  if (row && (row as any).isDemo) {
    return JSON.stringify({
      error: `This is a demo ${what} (created by enable_demo_mode). To keep demo and real data separate, demo rows can't be submitted, sent, or charged. To do this for real, create a real ${what} first — or call clear_demo_data to wipe the demo records.`,
      code: 'demo_data_refused',
    });
  }
  return null;
}

// Test-only access. Internal; do not import from runtime code.
// `seed` is sync for test convenience because Redis is never available in
// vitest — it goes straight to the in-memory Map fallback.
export const __proposalStoreTest = {
  size: () => proposalStore.size,
  clear: () => proposalStore.clear(),
  has: (id: string) => proposalStore.has(id),
  seed: (proposal: Omit<StoredProposal, 'id' | 'createdAt' | 'summary'> & { id?: string; summary?: string }): StoredProposal => {
    const id = proposal.id ?? (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`) as string;
    const stored: StoredProposal = {
      id,
      userId: proposal.userId,
      practiceId: proposal.practiceId,
      toolName: proposal.toolName,
      args: proposal.args,
      summary: proposal.summary ?? summarizeProposal(proposal.toolName, proposal.args),
      createdAt: Date.now(),
    };
    proposalStore.set(id, stored);
    return stored;
  },
};

// Keywords that indicate a complex query requiring Sonnet
const SONNET_KEYWORDS = [
  'soap', 'appeal', 'denial', 'denied', 'generate', 'draft', 'write',
  'create claim', 'submit claim', 'analyze', 'review denied',
  'appeal letter', 'correction', 'medical necessity',
  'underpay', 'underpaid', 'underpayment', 'dispute', 'short pay', 'short paid',
  'paid less', 'below contracted', 'partial payment',
];

/**
 * Determine which model to use based on message complexity.
 * Returns MODEL_HAIKU for simple lookups/questions, MODEL_SONNET for complex tasks.
 */
function selectModel(message: string, conversationHistory?: Array<{ role: string; content: string }>): string {
  const normalizedMsg = message.toLowerCase().trim();
  const wordCount = message.split(/\s+/).length;

  // Check for Sonnet keywords regardless of length
  for (const keyword of SONNET_KEYWORDS) {
    if (normalizedMsg.includes(keyword)) {
      return MODEL_SONNET;
    }
  }

  // Long messages (50+ words) are more likely complex
  if (wordCount >= 50) {
    return MODEL_SONNET;
  }

  // Check conversation history for ongoing complex tasks
  if (conversationHistory && conversationHistory.length > 0) {
    const lastFewMessages = conversationHistory.slice(-4);
    for (const msg of lastFewMessages) {
      const content = (msg.content || '').toLowerCase();
      for (const keyword of SONNET_KEYWORDS) {
        if (content.includes(keyword)) {
          return MODEL_SONNET;
        }
      }
    }
  }

  // Use Sonnet for all queries until Haiku 4 model is confirmed available
  // TODO: re-enable Haiku routing once model name is verified
  return MODEL_SONNET;
}

// ---------------------------------------------------------------------------
// Cost Optimization #2: Response Caching for Common Questions
// Cache pure knowledge questions that don't use tool calls
// ---------------------------------------------------------------------------
interface CachedResponse {
  content: string;
  suggestedActions: { label: string; path: string }[];
  timestamp: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_MAX_SIZE = 500;
const responseCache = new Map<string, CachedResponse>();

/** Normalize a message for cache key lookup (lowercase, collapse whitespace, strip punctuation) */
function normalizeCacheKey(message: string): string {
  return message
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

/** Check if a message is a cacheable knowledge question (no practice-specific data needed) */
function isCacheableQuestion(message: string): boolean {
  const normalized = message.toLowerCase().trim();

  // Questions that reference practice-specific data are NOT cacheable
  const practiceSpecificPatterns = [
    'my patient', 'my claim', 'my practice', 'my revenue', 'my denial',
    'how many patient', 'how many claim', 'how many appointment',
    'patient named', 'claim number', 'dashboard', 'statistics', 'stats',
    'eligibility', 'schedule', 'appointment', 'create', 'submit', 'add',
    'generate', 'draft', 'appeal', 'denied claim',
  ];
  for (const pattern of practiceSpecificPatterns) {
    if (normalized.includes(pattern)) return false;
  }

  // Questions about general billing knowledge ARE cacheable
  const cacheablePatterns = [
    /what is cpt/i, /what('s| is) the 8.minute/i, /what('s| is) (a |the )?modifier/i,
    /what does cpt/i, /explain.*cpt/i, /tell me about.*cpt/i,
    /what('s| is) (the )?difference between/i, /how do(es)? (i |you )?bill/i,
    /what modifiers/i, /telehealth modifier/i, /8.minute rule/i,
    /what is icd/i, /what('s| is) (a |the )?place of service/i,
    /units? (for|per|in)/i, /how to navigate/i, /how do i (find|go|get to)/i,
    /what('s| is) (a |the )?(go|gp|gn|kx) modifier/i,
  ];
  for (const pattern of cacheablePatterns) {
    if (pattern.test(normalized)) return true;
  }

  return false;
}

/** Store a response in the cache, evicting oldest entries if at capacity */
function cacheResponse(key: string, content: string, suggestedActions: { label: string; path: string }[]): void {
  // Evict oldest entries if at capacity
  if (responseCache.size >= CACHE_MAX_SIZE) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    responseCache.forEach((v, k) => {
      if (v.timestamp < oldestTime) {
        oldestTime = v.timestamp;
        oldestKey = k;
      }
    });
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(key, { content, suggestedActions, timestamp: Date.now() });
}

/** Get a cached response if available and not expired */
function getCachedResponse(key: string): CachedResponse | null {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return cached;
}

// ---------------------------------------------------------------------------
// Cost Optimization #3: Rate Limiting per Practice
// Prevent any single practice from running up excessive API costs
// ---------------------------------------------------------------------------
interface PracticeUsage {
  count: number;
  resetDate: string; // YYYY-MM-DD
}

const practiceUsageMap = new Map<number, PracticeUsage>();

/** Get the daily message limit for a billing plan */
function getPlanLimit(billingPlan: string | null | undefined): number {
  switch (billingPlan) {
    case 'practice': return Infinity; // Unlimited
    case 'professional': return 300;
    case 'starter': return 100;
    default: return 500; // Free/trial — generous for demos
  }
}

/** Get today's date string in YYYY-MM-DD format */
function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

/** Check if a practice has exceeded its daily message limit. Returns the limit and current count. */
function checkPracticeRateLimit(practiceId: number, billingPlan: string | null | undefined): { allowed: boolean; limit: number; used: number } {
  const today = getTodayString();
  const limit = getPlanLimit(billingPlan);

  let usage = practiceUsageMap.get(practiceId);
  if (!usage || usage.resetDate !== today) {
    // New day — reset counter
    usage = { count: 0, resetDate: today };
    practiceUsageMap.set(practiceId, usage);
  }

  return { allowed: usage.count < limit, limit, used: usage.count };
}

/** Increment the usage counter for a practice */
function incrementPracticeUsage(practiceId: number): void {
  const today = getTodayString();
  let usage = practiceUsageMap.get(practiceId);
  if (!usage || usage.resetDate !== today) {
    usage = { count: 0, resetDate: today };
  }
  usage.count++;
  practiceUsageMap.set(practiceId, usage);
}

let anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

// OT billing knowledge base embedded in the system prompt
const BILLING_KNOWLEDGE = `
## Common OT CPT Codes
- 97165: OT Evaluation, Low Complexity (typically 30 min)
- 97166: OT Evaluation, Moderate Complexity (typically 45 min)
- 97167: OT Evaluation, High Complexity (typically 60 min)
- 97168: OT Re-evaluation
- 97110: Therapeutic Exercises (per 15 min unit)
- 97112: Neuromuscular Re-education (per 15 min unit)
- 97116: Gait Training (per 15 min unit)
- 97140: Manual Therapy (per 15 min unit)
- 97530: Therapeutic Activities (per 15 min unit) - functional task training
- 97535: Self-care/Home Management Training (per 15 min unit)
- 97542: Wheelchair Management Training (per 15 min unit)
- 97750: Physical Performance Test (per 15 min unit)
- 97761: Prosthetic Training (per 15 min unit)
- 97763: Orthotic Management/Training (per 15 min unit)
- 92526: Treatment of Swallowing Dysfunction (when performed by OT)
- 97010: Hot/Cold Packs (no charge - usually bundled)
- 97032: Electrical Stimulation (per 15 min unit)
- 97033: Iontophoresis (per 15 min unit)
- 97034: Contrast Bath (per 15 min unit)
- 97035: Ultrasound (per 15 min unit)
- 97039: Unlisted Modality
- 97150: Group Therapy (per 15 min unit)

## Key Differences
- 97530 (Therapeutic Activities): Dynamic, functional activities (e.g., reaching into a cabinet, simulated meal prep). Focuses on functional task performance.
- 97110 (Therapeutic Exercises): Isolated movement patterns to improve strength, ROM, flexibility (e.g., resistive band exercises, stretching). Focuses on body structure/function.
- 97140 (Manual Therapy): Hands-on techniques by therapist (joint mobilization, soft tissue mobilization, manual traction).
- 97112 (Neuromuscular Re-ed): Balance, coordination, posture, proprioception, kinesthetic sense training.

## Common Modifiers
- GO: OT services (required by many payers for OT-specific billing)
- GP: PT services
- GN: SLP services
- 59: Distinct procedural service (use when billing multiple similar codes same session)
- 76: Repeat procedure by same physician
- KX: Requirements specified in the medical policy have been met (Medicare therapy cap)
- GA: Waiver of liability on file (ABN)
- CQ: Outpatient services furnished under arrangement to a provider of services (COTA)
- CO: OT services furnished in whole or in part by a COTA

## 8-Minute Rule (Medicare)
Units are based on total timed treatment minutes:
- 8-22 min = 1 unit
- 23-37 min = 2 units
- 38-52 min = 3 units
- 53-67 min = 4 units
- Each additional 15 min = 1 additional unit
- Minimum 8 minutes to bill 1 unit

## Telehealth Modifiers
- 95: Synchronous telemedicine service via real-time audio/video
- GT: Interactive audio/video telecommunications (older, some payers still require)
- Place of Service 02: Telehealth (patient location other than home)
- Place of Service 10: Telehealth in patient's home
- CR: Catastrophe/disaster modifier (COVID-related telehealth flexibilities)

## Common ICD-10 Codes for OT
- F82: Specific developmental disorder of motor function (Developmental Coordination Disorder)
- F84.0: Autistic disorder
- F84.5: Asperger's syndrome
- F90.0-F90.9: ADHD codes
- G80.0-G80.9: Cerebral palsy codes
- R27.8: Other lack of coordination
- R27.9: Unspecified lack of coordination
- R29.3: Abnormal posture
- R62.50: Unspecified lack of expected normal physiological development in childhood
- Z71.3: Dietary counseling and surveillance

## Payer-Specific Tips
- **Medicare**: Requires KX modifier when therapy threshold exceeded. Must document medical necessity. Functional Limitation Reporting (G-codes) no longer required since 2019.
- **Medicaid**: Rules vary by state. Many require prior authorization. Some states have visit limits.
- **UHC/Optum**: Often requires GO modifier. May have visit limits (e.g., 30 visits/year). Authorization often required after initial eval.
- **Aetna**: Commonly requires pre-certification. Often allows 12-20 visits per authorization.
- **BCBS**: Varies by plan. Many require GO modifier. Check specific plan for auth requirements.
- **Cigna**: Usually requires pre-authorization after evaluation. Typical authorization periods of 60-90 days.
- **Tricare**: Requires referral from PCM. No visit limits for active duty. Family members may have limits.

## HIPAA Compliance Reminders
- Never include full patient identifiers (SSN, full DOB, insurance member ID) in chat responses.
- Always refer to patients by first name only or use initials in AI responses.
- When discussing specific patient data, remind users to handle PHI appropriately.
- Chat history should be treated as potentially containing PHI.
`;

const BASE_SYSTEM_PROMPT = `Your name is Blanche. You are a friendly, expert AI billing assistant for TherapyBill, a therapy practice management platform. You specialize in occupational therapy (OT), physical therapy (PT), and speech-language pathology (SLP) billing, coding, and practice management. Always introduce yourself as Blanche when greeting a user for the first time. Be warm, encouraging, and helpful — especially with new users who may not be technical.

Your role:
1. Answer billing and coding questions accurately
2. Help with claim accuracy review and denial prevention
3. Provide practice management advice
4. Query practice data when asked about specific metrics (patients, claims, revenue, etc.)
5. Suggest actionable next steps when appropriate
6. Detect new practices and guide them through setup

${BILLING_KNOWLEDGE}

## Onboarding Guidance
NEVER answer setup questions from your own memory. The real setup state lives in the database and changes as the user takes actions. On the first user message of a conversation (or any time you're asked about setup, getting started, what's left, what to do next), CALL the get_practice_setup_status tool FIRST and base your answer on the returned checklist. Do not invent steps or hardcode a list.

When the user is in active setup (onboardingCompleted: false OR the checklist has incomplete required items), tailor your guidance to their role — see "User Context" below. Acknowledge what they've already done ("nice work — you have the first 3 items completed"); don't repeat it back as if it's pending.

After helping a user complete their first few real tasks (adding a patient, creating a claim, etc.), proactively suggest Claude Desktop: "By the way, did you know you can do all of this from Claude Desktop on your computer? It takes about 2 minutes to set up, and then you can manage billing, check eligibility, and write SOAP notes just by chatting with me. Want me to walk you through it?" This is a key differentiator for TherapyBill — always look for natural moments to mention it.

## Claude Desktop Integration (MCP)
If a user asks about Claude Desktop, MCP, connecting Claude, or using AI on their desktop, walk them through the setup step by step:

1. "First, you'll need Claude Desktop installed. You can download it free at claude.ai/download"
2. "Next, generate an API key. Go to Settings > MCP Integration in TherapyBill and click Generate Key. Give it a name like 'My Claude Desktop' and copy the key."
3. "Now open Claude Desktop, go to Settings (gear icon) > Connectors > Add custom connector"
4. "For the name, type: TherapyBill AI"
5. "For the URL, type: https://app.therapybillai.com/mcp"
6. "Click Add, then click Connect"
7. "A browser page will open asking for your API key. Paste the key you copied from step 2 and click Authorize"
8. "That's it! Go back to Claude Desktop, start a new chat, and try asking 'Show me my dashboard stats'"

If they seem confused at any step, slow down and explain in more detail. Offer to navigate them to the MCP Integration settings page using [Action: MCP Setup]. You can also direct them to the full setup guide at /mcp-setup using [Action: MCP Setup Guide].

If they ask "what is MCP?" or "what is Claude Desktop?", explain simply: "Claude Desktop is an app from Anthropic that lets you chat with Claude AI on your computer. With the TherapyBill connection, you can manage your billing, check patient eligibility, write SOAP notes, and more — all by just talking to Claude. It's like having me available on your desktop at all times."

## Demo / Practice Mode
When a new user wants to "try things out", "practice", "explore safely", or seems nervous about adding real patients, OFFER demo mode: call the enable_demo_mode tool. It creates 3 sample patients (all prefixed with "DEMO-"), 2 sample appointments for tomorrow, and 1 ready-to-submit sample claim — all clearly labeled, excluded from analytics, and refused by submission/sending tools so nothing fake reaches a real payer or patient.

After you've helped them walk through the workflow on the demo data and they're ready to use real data, OFFER to call clear_demo_data to remove it cleanly. clear_demo_data only deletes demo rows from the last 14 days, so any permanent showcase patients the user has hand-tagged via mark_patients_as_demo (e.g. their curated prospect-demo patients with realistic names) are preserved. Mention this if they ask whether their tagged patients will be affected.

Demo and real data live side-by-side — they can't be confused because every demo row has a yellow "DEMO" badge in the UI, is excluded from analytics, and refuses to be sent or submitted. That's the whole demo-mode safety story.

If a user mentions they have OLD test/demo/seed patients from before demo mode existed (or they want to use existing patients as "showcase data" when demoing the product to prospects), use find_legacy_demo_candidates to spot them by their telltales (@example.* email domains, 555 area codes, DEMO/TEST/SAMPLE in name). Show the list to the user, let THEM pick which IDs to mark, then call mark_patients_as_demo with the chosen IDs. The mark cascades to those patients' appointments and claims so the firewall stays consistent. If the user accidentally marks the wrong patient, unmark_demo_patients undoes it cleanly.

## Action Confirmation — STRICT RULES (read carefully)

This is the most important section of these instructions. Violating these rules causes a critical trust failure with the user.

**Rule 1: You MUST CALL THE TOOL to perform any action.** When the user asks you to mark, create, send, submit, charge, cancel, delete, update, schedule, or any other action that changes data — you MUST invoke the corresponding tool. There is no substitute for actually calling the tool. Narrating in prose that you've done something does NOT do it. The user's data only changes when a tool runs.

**Rule 2: NEVER claim an action has been performed.** When you call a mutation tool, the server will return status "awaiting_user_confirmation" — it is NOT executed yet; it is queued for the user to confirm via a Confirm/Cancel card in the chat. Until the user clicks Confirm AND you see the tool's actual result returned in a follow-up turn, the action HAS NOT HAPPENED. Frame your reply as **intent**, not as completion. Use phrasing like "I'm proposing to mark these 7 patients as demo — click Confirm below to do it" — never "I've marked them" or "Successfully marked" or "All set" or "Here's what I did" or "Done!" or any past-tense success phrasing.

**Rule 3: No checkmark theatre AND no premature celebration.** Until the user clicks Confirm AND you see the tool's actual result, NOTHING has happened — including when you're correctly proposing an action. Do not open your response with "Perfect!", "Great!", "Excellent!", "Awesome!", or any similar enthusiasm word. Do not use ✅, "successfully", "done", or "all set" anywhere in a response that includes a proposed mutation. Start with a neutral acknowledgement and move to the proposal.

GOOD opener examples (use these patterns):
  - "I can do that. I'm proposing to..."
  - "Got it — here's what I'd like to do..."
  - "Sure. I'll queue this up for your review..."
  - "I'd like to create [X] — please confirm below."

BAD opener examples (do NOT use):
  - "Perfect! I'm proposing to..."
  - "Great! I'll create Janet Doe..."
  - "Awesome, I'll queue that up..."
  - "✅ I've marked the patients..."
  - "All set! Just confirm below..."

The user cannot tell from your text whether an action ran. They can only tell from (a) seeing the Confirm card, (b) clicking it, and (c) seeing the result message. Celebrating before any of that happens makes them think it's done when it isn't.

**Rule 6: Do NOT over-promise multi-step actions.** Today the chat does not auto-continue after a Confirm. If you intend to do a sequence of mutations (e.g. create a patient AND schedule an appointment for them), you can either (a) propose BOTH tools in your CURRENT turn — they both create Confirm cards — OR (b) propose ONLY the first one and explicitly tell the user the next step. DO NOT promise "I'll immediately schedule X after you confirm" — you cannot continue automatically. Instead say "Step 1 is creating Janet. After you confirm that, ask me to schedule the 4 PM appointment and I'll propose it as step 2." Be explicit that the user must prompt you again for the next step.

If you've already called the first tool (proposal queued) and want to also queue the second one in the same turn, you may need to use a placeholder/recent-patient reference — for create_appointment, the patient must exist first, so multi-step really does need two turns. Default approach: do one mutation per turn; tell the user what's next.

**Rule 4: If you didn't call a tool, say so.** If the user asks you to do something and for some reason you don't call the tool (e.g. you're unsure of the IDs, you need clarification), say so explicitly: "I haven't done this yet — I need you to confirm X first" or "I'm not sure which patients to mark — can you confirm the IDs?" Never fake-execute a request by describing what would happen as if it happened.

**Rule 5: When the user reports they don't see the result of an action you "did," APOLOGIZE for the likely tool-skip and try again with the actual tool call.** Do not double down. Do not invent reasons the action might not be visible. Acknowledge the failure and retry with the real tool.

**Rule 7: NEVER guess an ID. Look it up first.** When the user references an entity by description rather than by number ("the appointment tomorrow at 4 PM", "Janet's claim", "Aaron's session"), you MUST call a read tool to find the actual ID before proposing any mutation. For appointments use get_appointments; for patients use search_patients; for claims use get_claim_status or the relevant claims tool. Never pass a made-up ID to cancel_appointment, reschedule_appointment, submit_claim, or any other tool — that produces "Appointment N not found" errors and looks broken. If you cannot find a unique match (zero results, or multiple equally-plausible candidates), tell the user what you found and ask which one — do not pick one at random.

The web-chat UI surfaces a Confirm/Cancel card for every mutation tool you call. The user sees that card. If you say "Done!" without calling the tool, no card appears and the user is misled. That is the failure mode we are preventing.

**IMPORTANT — card position:** Confirm cards render **BELOW** your text in the chat (after the message bubble). Always tell the user to "click Confirm **below**" — NEVER "click Confirm above". The card is always below, never above.

If a user is an admin and asks about safety, AI permissions, or how to make Claude Desktop ALSO require a second confirmation, tell them: "By default, when you (or anyone on your team) uses Claude Desktop, Claude Desktop's own 'Allow tool call?' prompt is the safety check. If you want belt-and-suspenders confirmation at the TherapyBill server level too — useful if anyone might click 'Always allow' in Claude Desktop — your admin can enable it with: PATCH /api/practices/<your-practice-id> with body { \"mcpRequiresConfirmation\": true }. With that on, mutation tools via Claude Desktop will refuse to run and direct the user back to the web chat (where the Confirm card still works)."

Guidelines:
- Be concise but thorough. Use bullet points for clarity.
- When discussing specific billing codes, always include the code number AND description.
- If you're unsure about a payer-specific rule, say so and recommend verifying with the payer.
- When you have access to practice data through function calls, use it to give specific, data-driven answers.
- For HIPAA compliance, refer to patients by first name only in responses.
- If asked about something outside your expertise, be honest about limitations.
- When suggesting actions, format them as clear next steps the user can take.
- Keep responses focused and practical — therapists are busy.
- Important: TherapyBill AI assists with billing accuracy by suggesting codes based on clinical documentation. All coding decisions must be reviewed and approved by the treating provider. This platform does not encourage or facilitate billing for services not rendered. Never suggest billing for services that were not documented or performed.

When a user asks about denied claims or denial follow-up, proactively review all denied claims using review_denied_claims, then offer to draft appeal letters or suggest corrections for each one.`;

/**
 * Role-specific opener guidance. Three roles exist in the system today:
 * `admin` (practice owner/admin), `therapist` (clinician), `billing` (billing/
 * front-desk staff). Each role's first-time-setup priorities are different.
 */
const ROLE_OPENERS: Record<string, string> = {
  admin: `This user is the practice ADMIN/OWNER. Their setup priorities (in order): practice info (name/NPI/tax ID/address/phone) → team invites → clearinghouse setup → compliance (MFA, BAA review). Frame your opener around what unblocks going live. Vocabulary: "your practice", "your team", "your clearinghouse".`,
  therapist: `This user is a THERAPIST/CLINICIAN. Setup priorities: their schedule, writing their first SOAP note, learning the workflow. Assume the back-office (NPI, payer setup, billing config) is handled by the admin — don't ask them about it. Vocabulary: "your schedule", "your patients", "your notes". Offer to walk through a SOAP note on a demo patient if available.`,
  billing: `This user is a BILLING / FRONT-DESK staff member. Setup priorities: the Front Desk board, the Claims queue, patient check-in, copay handling. Don't burden them with NPI/clearinghouse questions — that's the admin's job. Vocabulary: "today's check-ins", "the claims queue", "your front-desk board". Offer a tour of the Front Desk page first.`,
};

/**
 * Build the system prompt for a single request, injecting user role and current
 * page context. Keeps Blanche grounded in who the user is and what screen they're
 * looking at, so her responses are tailored instead of generic.
 *
 * Pass null/undefined for either field if not available — the prompt degrades
 * gracefully (omits the block rather than emitting a placeholder).
 */
export function buildSystemPrompt(opts: {
  role?: string | null;
  pageContext?: { path?: string | null; title?: string | null } | null;
  /** Override for tests; defaults to new Date() at call time. */
  now?: Date;
  /**
   * Client-supplied "today" in the user's local timezone (YYYY-MM-DD). The
   * server runs in UTC, so deriving "today" from `new Date()` can be off by
   * one day for users west of UTC in the evening (the ECS host's "today"
   * is already the user's tomorrow). Prefer this when supplied; fall back
   * to UTC-derived only if missing.
   */
  clientDate?: string | null;
}): string {
  const parts: string[] = [];

  // ALWAYS inject today's date so Blanche can interpret "today", "tomorrow",
  // "this week", etc. without asking the user for YYYY-MM-DD. Critical for
  // scheduling and "what's on the calendar today" type questions.
  const now = opts.now ?? new Date();
  const clientDateValid =
    typeof opts.clientDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opts.clientDate);
  // Anchor "today" to the user's local date if the client sent one. Otherwise
  // fall back to the server's UTC date (legacy behaviour; off-by-one for
  // western timezones late in the day).
  const isoDate = clientDateValid ? opts.clientDate! : now.toISOString().split('T')[0];
  // Derive "tomorrow" by parsing the anchor date as UTC noon and adding 24h —
  // noon-anchoring avoids DST/midnight edge cases that would push the result
  // back to the same day.
  const anchorMs = clientDateValid
    ? Date.parse(`${opts.clientDate}T12:00:00Z`)
    : now.getTime();
  const tomorrow = new Date(anchorMs + 86400_000).toISOString().split('T')[0];
  const friendly = new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  parts.push('## Today');
  parts.push(`- Date: ${isoDate} (${friendly})`);
  parts.push(
    `- When the user says "today" or omits a date, use ${isoDate}. When they say "tomorrow", use ${tomorrow}. Never ask the user for today's date — you already have it.`,
  );
  parts.push('');

  const role = (opts.role ?? '').toLowerCase();
  const roleOpener = ROLE_OPENERS[role];
  const page = opts.pageContext;
  const pageDesc = page?.title?.trim() || page?.path?.trim();

  if (roleOpener || pageDesc) {
    parts.push('## User Context');
    if (roleOpener) parts.push(`- Role guidance: ${roleOpener}`);
    if (pageDesc) {
      parts.push(
        `- Current page: ${page?.title?.trim() || 'unknown'}${
          page?.path?.trim() ? ` (${page?.path?.trim()})` : ''
        }`,
      );
      parts.push(
        '- Tailor your guidance to what is on this screen. If the user asks "what can I do here?", explain the features of this page specifically.',
      );
    }
    parts.push('');
  }

  return `${parts.join('\n')}\n${BASE_SYSTEM_PROMPT}`;
}

// Tool definitions for Claude function calling
const assistantTools: Anthropic.Tool[] = [
  {
    name: 'get_dashboard_stats',
    description: 'Get practice dashboard statistics including total claims, success rate, revenue, denial rate, pending claims, and monthly metrics.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_claims_by_status',
      description: 'Get a breakdown of claims grouped by their status (submitted, paid, denied, etc.).',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
    },
  },
  {
    name: 'get_top_denial_reasons',
      description: 'Get the most common reasons for claim denials.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
    },
  },
  {
    name: 'get_patient_count',
      description: 'Get the total number of active patients in the practice.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
    },
  },
  {
    name: 'search_patient',
      description: 'Search for a patient by name to get their information including visit counts and insurance details.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            description: 'The patient name or partial name to search for.',
          },
        },
        required: ['name'],
    },
  },
  {
    name: 'get_revenue_by_month',
      description: 'Get monthly revenue data for a date range. Defaults to the last 6 months if no range specified.',
      input_schema: {
        type: 'object' as const,
        properties: {
          months: {
            type: 'number',
            description: 'Number of months to look back. Defaults to 6.',
          },
        },
        required: [],
    },
  },
  {
    name: 'get_overdue_claims',
      description: 'Get claims that have been submitted but not paid for more than 30 days.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
    },
  },
  {
    name: 'get_collection_rate',
      description: 'Get the practice collection rate including breakdown by insurance provider.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
    },
  },
  {
    name: 'get_ar_aging',
      description: 'Get accounts receivable aging data showing outstanding amounts by age bucket (0-30, 31-60, 61-90, 90+ days).',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
    },
  },
  {
    name: 'get_practice_setup_status',
    description: 'Get the current setup and onboarding status for the practice. Call this when a user first messages you to understand if they are a new practice that needs setup guidance. Returns onboarding progress, patient/claim/appointment counts, sandbox mode status, and setup suggestions.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'enable_demo_mode',
    description:
      'Create a small set of clearly-labeled demo data (3 sample patients with DEMO- name prefix, 2 sample appointments for tomorrow, 1 ready-to-submit sample claim) so a new user can practice navigating TherapyBill without affecting real patient records. Demo data is excluded from analytics and refused by submission/sending paths — a fake claim can never be submitted to a real clearinghouse. Use this when a user asks to "try it out", "practice", "explore safely", or seems hesitant to add real data first.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'clear_demo_data',
    description:
      'Permanently delete ALL demo patients, appointments, and claims for this practice (rows where is_demo = true). Use when the user is done practicing and wants a clean slate. Irreversible — confirm with the user before calling.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'find_legacy_demo_candidates',
    description:
      'Find patients in this practice that LOOK like demo/test data based on telltale signals (IANA-reserved email domains like @example.com / @example.net / @example.org, 555 area code phone numbers, or DEMO / TEST / SAMPLE in the name) but are NOT currently tagged is_demo = true. Returns the candidates with which signal matched, so the user can review before flagging them. Use this when the user mentions cleaning up old/legacy demo or seed patients.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'mark_patients_as_demo',
    description:
      'Set is_demo = true on the given patient IDs (and cascade to all of their appointments + claims so the firewall is consistent — a "demo" patient with a real submittable claim would be a bug). Use this after find_legacy_demo_candidates so the user can confirm which IDs to flag. After this, those rows are excluded from analytics and refused by submit/send/charge paths.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientIds: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Patient IDs to flag as demo. Must belong to the caller\'s practice.',
        },
      },
      required: ['patientIds'],
    },
  },
  {
    name: 'unmark_demo_patients',
    description:
      'Reverse mark_patients_as_demo: set is_demo = false on the given patient IDs and their appointments + claims. Safety net for accidental flagging.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientIds: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Patient IDs to un-flag.',
        },
      },
      required: ['patientIds'],
    },
  },
  {
    name: 'create_patient',
    description: 'Create a new patient in the practice. Use this when a user wants to add their first patient or add a new patient through the assistant.',
    input_schema: {
      type: 'object' as const,
      properties: {
        firstName: { type: 'string' as const, description: 'Patient first name' },
        lastName: { type: 'string' as const, description: 'Patient last name' },
        dateOfBirth: { type: 'string' as const, description: 'Date of birth in YYYY-MM-DD format' },
        email: { type: 'string' as const, description: 'Patient or guardian email' },
        phone: { type: 'string' as const, description: 'Phone number' },
        insuranceProvider: { type: 'string' as const, description: 'Insurance company name' },
      },
      required: ['firstName', 'lastName'],
    },
  },
  {
    name: 'create_appointment',
    description: 'Schedule an appointment for a patient. Use this when a user wants to create their first appointment or schedule a session.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: { type: 'number' as const, description: 'Patient ID to schedule for' },
        date: { type: 'string' as const, description: 'Appointment date in YYYY-MM-DD format' },
        time: { type: 'string' as const, description: 'Start time in HH:MM format (24h)' },
        duration: { type: 'number' as const, description: 'Duration in minutes (default 60)' },
        type: { type: 'string' as const, description: 'Appointment type (default "Therapy Session")' },
      },
      required: ['patientId', 'date', 'time'],
    },
  },
  {
    name: 'reschedule_appointment',
    description: 'Move an existing appointment to a new date and/or time. Use when the user wants to reschedule, move, or change the time of an appointment. Requires the appointment ID and the new date/time. Looks up the appointment to preserve duration unless overridden.',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointmentId: { type: 'number' as const, description: 'The ID of the appointment to reschedule' },
        date: { type: 'string' as const, description: 'New date in YYYY-MM-DD format' },
        time: { type: 'string' as const, description: 'New start time in HH:MM (24h) format' },
        duration: { type: 'number' as const, description: 'Optional new duration in minutes; defaults to existing duration' },
      },
      required: ['appointmentId', 'date', 'time'],
    },
  },
  {
    name: 'cancel_appointment',
    description: 'Cancel an existing appointment. Marks it as cancelled with a reason; does not delete it. Use when the user wants to cancel a session.',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointmentId: { type: 'number' as const, description: 'The ID of the appointment to cancel' },
        reason: { type: 'string' as const, description: 'Cancellation reason (e.g., "patient request", "provider unavailable", "no-show")' },
        notes: { type: 'string' as const, description: 'Optional free-text notes about the cancellation' },
      },
      required: ['appointmentId', 'reason'],
    },
  },
  {
    name: 'suggest_appointment_slot',
    description: 'Find open appointment slots over the next N days based on existing scheduled appointments. Returns up to 5 suggested start times. Use when a user wants to know "when can I fit Jane in" or "find me an open slot next week". Considers existing scheduled (non-cancelled) appointments as conflicts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        durationMinutes: { type: 'number' as const, description: 'Slot length in minutes (default 60)' },
        daysAhead: { type: 'number' as const, description: 'How many days ahead to search (default 7, max 30)' },
        startHour: { type: 'number' as const, description: 'Earliest hour of day to consider, 0-23 (default 9)' },
        endHour: { type: 'number' as const, description: 'Latest hour to start a slot, 0-23 (default 17)' },
      },
      required: [],
    },
  },
  {
    name: 'send_patient_portal_invite',
    description: 'Email a patient a magic-link invitation to access the patient portal. Use when a user asks to send/resend a portal link, invite a patient to the portal, or grant patient portal access. Provide either patientId or patientName.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: { type: 'number' as const, description: 'Patient ID to send the portal invite to' },
        patientName: { type: 'string' as const, description: 'Patient name to look up (if ID not known)' },
      },
      required: [],
    },
  },
  {
    name: 'send_appointment_reminder',
    description: 'Send an appointment reminder to a patient via email and/or SMS for a specific upcoming appointment. Use when a user asks to send/resend a reminder for a particular appointment.',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointmentId: { type: 'number' as const, description: 'Appointment ID to send the reminder for' },
        channel: {
          type: 'string' as const,
          enum: ['sms', 'email', 'both'],
          description: 'Which channel to use. Default "both" — sends via every channel for which the patient has contact info and the practice has configured.',
        },
      },
      required: ['appointmentId'],
    },
  },
  {
    name: 'navigate_user',
    description: 'Direct the user to a specific page in the app. Use this to help them find the right place for what they want to do.',
    input_schema: {
      type: 'object' as const,
      properties: {
        page: {
          type: 'string' as const,
          enum: ['patients', 'calendar', 'claims', 'settings', 'soap-notes', 'analytics', 'mcp-setup', 'onboarding'],
          description: 'The page to navigate to',
        },
      },
      required: ['page'],
    },
  },
  {
    name: 'submit_claim',
    description: 'Create and submit an insurance claim for a patient session. Use when a therapist wants to bill for a completed session. Requires patient, CPT codes, diagnosis code, and service date. The claim is created in draft status for the therapist to review before submission.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: { type: 'number' as const, description: 'Patient ID to bill for' },
        patientName: { type: 'string' as const, description: 'Patient name (if ID not known)' },
        serviceDate: { type: 'string' as const, description: 'Date of service in YYYY-MM-DD format' },
        cptCodes: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'CPT codes for services rendered (e.g., ["97530", "97110"])',
        },
        diagnosisCode: { type: 'string' as const, description: 'ICD-10 diagnosis code' },
        units: { type: 'number' as const, description: 'Number of units (default based on CPT code)' },
        totalAmount: { type: 'number' as const, description: 'Total billed amount in dollars' },
      },
      required: ['patientId', 'serviceDate', 'cptCodes'],
    },
  },
  {
    name: 'check_eligibility',
    description: 'Check if a patient has active insurance coverage by running a real-time eligibility verification through the clearinghouse. Use this when a user asks about eligibility, insurance status, or coverage for a patient. Requires a patient ID or patient name to look up.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: { type: 'number' as const, description: 'Patient ID to check eligibility for' },
        patientName: { type: 'string' as const, description: 'Patient name to search for (if ID not known)' },
      },
      required: [],
    },
  },
  {
    name: 'verify_benefits',
    description: 'Run a comprehensive benefits verification for a patient. Returns detailed coverage information including plan status, plan type (HMO/PPO/EPO), therapy-specific visit limits (OT, PT, ST, Mental Health), prior authorization requirements, copay, coinsurance, deductible progress (individual and family), and out-of-pocket maximum progress. Use this when a user asks to check benefits, verify coverage details, or wants to know visit limits for a patient.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: { type: 'number' as const, description: 'Patient ID to verify benefits for' },
        patientName: { type: 'string' as const, description: 'Patient name to search for (if ID not known)' },
      },
      required: [],
    },
  },
  {
    name: 'generate_soap_note',
    description: 'Generate a SOAP note with billing codes for a therapy session. Use when a therapist describes a session and wants documentation generated. Collects session details and produces subjective, objective, assessment, and plan sections with CPT code recommendations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: { type: 'number' as const, description: 'Patient ID' },
        patientName: { type: 'string' as const, description: 'Patient name (if ID not known)' },
        sessionDuration: { type: 'number' as const, description: 'Session duration in minutes (default 60)' },
        activities: { type: 'array' as const, items: { type: 'string' as const }, description: 'Activities performed during session' },
        mood: { type: 'string' as const, description: 'Patient mood/presentation' },
        performance: { type: 'string' as const, description: 'Overall performance level' },
        assistanceLevel: { type: 'string' as const, description: 'Level of assistance needed' },
        planNextSteps: { type: 'string' as const, description: 'Plan for next session' },
        location: { type: 'string' as const, description: 'Treatment location (clinic, telehealth, home)' },
      },
      required: ['patientId', 'activities'],
    },
  },
  {
    name: 'review_denied_claims',
    description: 'Review all denied claims for the practice. Returns a list of denied claims with claim number, patient name, amount, denial reason, service date, and suggested action. Use this when a user asks about denied claims, denials, or denial follow-up.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'draft_appeal_letter',
    description: 'Draft an appeal letter for a denied claim. Looks up the claim details, denial reason, patient info, and service details, then generates a professional appeal letter with arguments for overturning the denial. Returns claim context and the generated appeal.',
    input_schema: {
      type: 'object' as const,
      properties: {
        claimId: {
          type: 'number' as const,
          description: 'The ID of the denied claim to draft an appeal for.',
        },
      },
      required: ['claimId'],
    },
  },
  {
    name: 'suggest_claim_correction',
    description: 'Analyze a denied claim and suggest specific corrections to fix the issue and get it paid. Examines the denial reason and recommends next steps such as resubmitting with corrections, obtaining prior authorization, or appealing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        claimId: {
          type: 'number' as const,
          description: 'The ID of the denied claim to analyze for corrections.',
        },
      },
      required: ['claimId'],
    },
  },
  {
    name: 'batch_eligibility_check',
    description: 'Check insurance eligibility for all patients with upcoming appointments in the next 7 days. No parameters needed. Returns a summary of how many patients were checked, how many are eligible, ineligible, or had errors, plus per-patient details.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'bulk_eligibility_by_filter',
    description: 'Run insurance eligibility checks for a flexible set of patients filtered by date range and/or payer name. Generalization of batch_eligibility_check. Use when the user asks to check eligibility for a specific date range, a specific payer (e.g. "all my Aetna patients next month"), or all active patients on a payer regardless of appointments. Hard caps: date range max 60 days, max 200 patients per call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startDate: {
          type: 'string' as const,
          description: 'Start date for appointment range (YYYY-MM-DD). Defaults to today. Ignored when appointmentsOnly is false.',
        },
        endDate: {
          type: 'string' as const,
          description: 'End date for appointment range (YYYY-MM-DD), inclusive. Defaults to today + 7 days. Range may not exceed 60 days.',
        },
        payerName: {
          type: 'string' as const,
          description: 'Optional case-insensitive substring to filter by patient insurance carrier name (e.g. "aetna", "blue cross").',
        },
        appointmentsOnly: {
          type: 'boolean' as const,
          description: 'If true (default), only check patients with non-cancelled appointments in the date range. If false, check all active patients matching the payerName filter (date range ignored).',
        },
      },
      required: [],
    },
  },
  {
    name: 'review_underpayments',
    description: 'Review all claims where insurance paid less than the expected reimbursement (from the fee schedule). Analyzes CAS adjustment reason codes to determine whether underpayments are standard contractual adjustments, patient responsibility, or true underpayments worth disputing. Use when a user asks about underpayments, short pays, insurance paying less than expected, or wants to review ERA adjustments.',
    input_schema: {
      type: 'object' as const,
      properties: {
        daysBack: {
          type: 'number' as const,
          description: 'Number of days to look back for underpayments. Defaults to 90.',
        },
      },
      required: [],
    },
  },
  {
    name: 'draft_underpayment_dispute',
    description: 'Draft a dispute letter for an underpaid claim. Looks up the claim, ERA/remittance data, adjustment reason codes, and fee schedule expected rate, then generates a professional dispute letter requesting reprocessing at the contracted rate. Use when a user wants to dispute an underpayment or fight a short pay from insurance.',
    input_schema: {
      type: 'object' as const,
      properties: {
        claimId: {
          type: 'number' as const,
          description: 'The ID of the underpaid claim to draft a dispute for.',
        },
      },
      required: ['claimId'],
    },
  },
  {
    name: 'check_claim_status',
    description: 'Check the live status of a specific submitted claim by polling the clearinghouse (Stedi) via X12 276/277. Returns the current payer-reported status (paid, pending, denied, rejected, etc.), the 277CA category code and description, last status date, and any payment/adjudication amounts. Use when a user asks for the latest status of a claim, whether a claim has paid, or wants to follow up on a submitted claim. Provide either claimId (preferred) or claimNumber.',
    input_schema: {
      type: 'object' as const,
      properties: {
        claimId: { type: 'number' as const, description: 'Internal claim ID (preferred).' },
        claimNumber: { type: 'string' as const, description: 'Claim number (e.g. "CLM-...") — used if claimId is not provided.' },
      },
      required: [],
    },
  },
  {
    name: 'create_patient_invoice',
    description: 'Create an invoice for a patient (typically for a copay, coinsurance, or self-pay balance) via Stripe. Amount is in dollars and capped at $10,000 from the assistant. Optionally link to an existing claim. Returns the Stripe payment intent details.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: { type: 'number' as const, description: 'Patient ID to invoice' },
        amount: { type: 'number' as const, description: 'Invoice amount in dollars (max 10000)' },
        description: { type: 'string' as const, description: 'Invoice description (e.g., "Copay for 03/15 session")' },
        claimId: { type: 'number' as const, description: 'Optional claim ID to link this invoice to' },
      },
      required: ['patientId', 'amount', 'description'],
    },
  },
  {
    name: 'send_patient_payment_link',
    description: 'Send a Stripe payment link to a patient for a specific invoice or arbitrary amount. Provide either invoiceId (to charge an existing invoice amount) or amount (in dollars). Returns the Stripe-hosted payment URL the patient can use to pay.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: { type: 'number' as const, description: 'Patient ID' },
        invoiceId: { type: 'string' as const, description: 'Existing invoice / payment intent ID to charge for (alternative to amount)' },
        amount: { type: 'number' as const, description: 'Amount to charge in dollars (alternative to invoiceId)' },
        message: { type: 'string' as const, description: 'Optional message / description shown on the payment page' },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'summarize_recent_eobs',
    description: 'Summarize EOBs (Explanation of Benefits) that have been uploaded to the practice, with the accumulator data extracted from each (in-network and out-of-network deductible/out-of-pocket progress, accumulator as-of date) and any recent claim line items the EOB listed. READ-ONLY: this tool does not accept file uploads — it reports on EOBs already uploaded through the patient/practice document upload flow. Use when asked about EOBs on file, accumulator status, deductible progress, or recent payer payment history.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'number' as const,
          description: 'Optional patient ID to filter EOBs to a single patient.',
        },
        daysBack: {
          type: 'number' as const,
          description: 'Number of days to look back for uploaded EOBs. Defaults to 30.',
        },
      },
      required: [],
    },
  },
  {
    name: 'check_plan_document_status',
    description: 'Check whether a specific patient has an SBC / plan document on file, what fields were extracted from it (deductibles, coinsurance, visit limits, prior auth, mental health parity, telehealth coverage), and what important benefit fields are missing. READ-ONLY: does not accept uploads — patient/practice still uploads documents through the existing UI. Use when asked about plan documents, SBC, benefit details on file, or what we know about a patient\'s plan coverage.',
    input_schema: {
      type: 'object' as const,
      properties: {
        patientId: {
          type: 'number' as const,
          description: 'The ID of the patient to check plan-document status for.',
        },
      },
      required: ['patientId'],
    },
  },
  {
    name: 'get_appeal_outcomes',
    description: 'Report appeal outcomes history for the practice. Returns total appeals, overall win rate, win rate by payer, win rate by denial reason/category, and the top winning argument patterns. Use when a user asks about appeal track record, appeal success rate, what arguments work, or which payers we win against. Also useful before drafting a new appeal so the assistant can cite past wins.',
    input_schema: {
      type: 'object' as const,
      properties: {
        payerName: {
          type: 'string' as const,
          description: 'Optional payer/insurance name filter (matched case-insensitively, partial match).',
        },
        daysBack: {
          type: 'number' as const,
          description: 'How many days of history to include. Defaults to 365.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_provider_productivity',
    description: 'Per-provider productivity report over a date range. Returns, for each provider in the practice: appointments completed, SOAP notes written, count of unsigned/incomplete notes, claims submitted, and total billed amount. Use when a user asks about productivity, provider stats, who is documenting, who is billing, or wants to compare therapists.',
    input_schema: {
      type: 'object' as const,
      properties: {
        startDate: {
          type: 'string' as const,
          description: 'Start date (YYYY-MM-DD). Defaults to 30 days ago.',
        },
        endDate: {
          type: 'string' as const,
          description: 'End date (YYYY-MM-DD). Defaults to today.',
        },
        providerId: {
          type: 'string' as const,
          description: 'Optional single provider/therapist user ID to scope the report to.',
        },
      },
      required: [],
    },
  },
];

// Strip likely PHI from clearinghouse / API error strings before they reach the
// assistant transcript. Stedi 270/271/276/277 errors echo the request payload,
// which contains member ID, DOB, and patient name. The assistant transcript is
// persisted, so raw error text is HIPAA-relevant.
export function sanitizeExternalError(raw: string | undefined | null): string {
  if (!raw) return 'unknown error';
  let s = String(raw);
  // SSN-like
  s = s.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[redacted-id]');
  // ISO and US dates (DOB / DOS)
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '[redacted-date]');
  s = s.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '[redacted-date]');
  // Long alphanumeric tokens (member IDs, policy numbers)
  s = s.replace(/\b[A-Z0-9]{8,}\b/g, '[redacted-id]');
  // Cap length so a verbose error can't dump a full payload into the transcript
  if (s.length > 200) s = s.slice(0, 200) + '…';
  return s;
}

function sanitizeExternalErrors(arr: string[] | undefined | null, max = 3): string[] {
  if (!arr || arr.length === 0) return [];
  return arr.slice(0, max).map(sanitizeExternalError);
}

// Shared helper: run eligibility checks for a list of patient IDs scoped to a practice.
// Used by both batch_eligibility_check and bulk_eligibility_by_filter.
type BulkEligibilityResult = {
  checked: number;
  eligible: number;
  ineligible: number;
  errors: number;
  results: Array<{ patientName: string; insurance: string | null; status: string; eligible: boolean | null; error?: string }>;
};

async function runBulkEligibility(
  practiceId: number,
  patientIds: number[],
): Promise<BulkEligibilityResult | { error: string }> {
  const { checkEligibility: stediCheckEligibility, isStediConfigured, PAYER_IDS: payerIds } = await import('../services/stediService');
  if (!isStediConfigured()) {
    return { error: 'Stedi API is not configured. Please set the STEDI_API_KEY.' };
  }

  const practice = await storage.getPractice(practiceId);

  const results: BulkEligibilityResult['results'] = [];
  let eligible = 0;
  let ineligible = 0;
  let errors = 0;

  for (let i = 0; i < patientIds.length; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 200));
    const pid = patientIds[i];
    try {
      const pat = await storage.getPatient(pid);
      if (!pat) { errors++; results.push({ patientName: 'Unknown', insurance: null, status: 'error', eligible: null, error: 'Patient not found' }); continue; }
      // Guard: ensure patient belongs to this practice (defense in depth)
      if (pat.practiceId !== practiceId) {
        errors++;
        results.push({ patientName: 'Unknown', insurance: null, status: 'error', eligible: null, error: 'Patient not in practice' });
        continue;
      }
      if (!pat.insuranceProvider && !pat.insuranceId && !pat.policyNumber) {
        errors++;
        results.push({ patientName: `${pat.firstName} ${pat.lastName}`, insurance: null, status: 'skipped', eligible: null, error: 'No insurance info' });
        continue;
      }

      const insName = (pat.insuranceProvider || '').toLowerCase();
      const pId = payerIds[insName] || pat.insuranceId || '60054';
      const eligRes = await stediCheckEligibility({
        payer: { id: pId, name: pat.insuranceProvider || 'Unknown' },
        provider: { npi: practice?.npi || '', organizationName: practice?.name || undefined },
        subscriber: { memberId: pat.insuranceId || pat.policyNumber || '', firstName: pat.firstName, lastName: pat.lastName, dateOfBirth: pat.dateOfBirth || '' },
      }, practiceId);

      const isElig = eligRes.status === 'active';
      if (isElig) eligible++;
      else if (eligRes.status === 'inactive') ineligible++;
      else errors++;

      results.push({
        patientName: `${pat.firstName} ${pat.lastName}`,
        insurance: pat.insuranceProvider || null,
        status: eligRes.status,
        eligible: isElig,
      });
    } catch (err) {
      errors++;
      results.push({ patientName: 'Unknown', insurance: null, status: 'error', eligible: null, error: sanitizeExternalError(err instanceof Error ? err.message : String(err)) });
    }
  }

  return { checked: patientIds.length, eligible, ineligible, errors, results };
}

// Execute tool calls against the database
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  practiceId: number,
  userId?: string,
): Promise<string> {
  try {
    switch (toolName) {
      case 'get_dashboard_stats': {
        const stats = await storage.getDashboardStats(practiceId);
        return JSON.stringify(stats);
      }

      case 'get_claims_by_status': {
        const statusData = await storage.getClaimsByStatus(practiceId);
        return JSON.stringify(statusData);
      }

      case 'get_top_denial_reasons': {
        const reasons = await storage.getTopDenialReasons(practiceId);
        return JSON.stringify(reasons);
      }

      case 'get_patient_count': {
        const patients = await storage.getPatients(practiceId);
        return JSON.stringify({ totalPatients: patients.length });
      }

      case 'search_patient': {
        const searchName = String(args.name || '').toLowerCase();
        const allPatients = await storage.getPatients(practiceId);
        const matches = allPatients.filter(
          (p) =>
            p.firstName.toLowerCase().includes(searchName) ||
            p.lastName.toLowerCase().includes(searchName) ||
            `${p.firstName} ${p.lastName}`.toLowerCase().includes(searchName),
        );

        if (matches.length === 0) {
          return JSON.stringify({ message: 'No patients found matching that name.' });
        }

        // Return limited info (HIPAA-conscious: no full DOB, SSN, or member IDs)
        const results = await Promise.all(
          matches.slice(0, 5).map(async (p) => {
            // Get eligibility/visit info if available
            let visitInfo = null;
            try {
              const eligibility = await storage.getEligibilityHistory(p.id);
              if (eligibility && eligibility.length > 0) {
                const latest = eligibility[0];
                visitInfo = {
                  visitsAllowed: latest.visitsAllowed,
                  visitsUsed: latest.visitsUsed,
                  visitsRemaining:
                    latest.visitsAllowed && latest.visitsUsed
                      ? latest.visitsAllowed - latest.visitsUsed
                      : null,
                  coverageStatus: latest.status,
                  coverageType: latest.coverageType,
                  copay: latest.copay,
                  authRequired: latest.authRequired,
                };
              }
            } catch {
              // Non-blocking
            }

            return {
              id: p.id,
              firstName: p.firstName,
              lastName: p.lastName,
              insuranceProvider: p.insuranceProvider,
              visitInfo,
            };
          }),
        );

        return JSON.stringify({ patients: results, totalMatches: matches.length });
      }

      case 'get_revenue_by_month': {
        const months = Number(args.months) || 6;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - months);
        const revenue = await storage.getRevenueByMonth(practiceId, startDate, endDate);
        return JSON.stringify(revenue);
      }

      case 'get_overdue_claims': {
        const allClaims = await storage.getClaimsByStatus(practiceId);
        const submittedCount =
          allClaims.find((c) => c.status === 'submitted')?.count || 0;
        // Also get dashboard stats for context
        const stats = await storage.getDashboardStats(practiceId);
        return JSON.stringify({
          pendingClaims: stats.pendingClaims,
          submittedCount,
          avgDaysToPayment: stats.avgDaysToPayment,
          note: 'Overdue claims are those submitted but not yet paid. Check the Claims page for detailed aging.',
        });
      }

      case 'get_collection_rate': {
        const collectionData = await storage.getCollectionRate(practiceId);
        return JSON.stringify(collectionData);
      }

      case 'get_ar_aging': {
        const arData = await storage.getDaysInAR(practiceId);
        return JSON.stringify(arData);
      }

      case 'get_practice_setup_status': {
        const practice = await storage.getPractice(practiceId);
        const patients = await storage.getPatients(practiceId);
        const claims = await storage.getClaims(practiceId);
        const appointments = await storage.getAppointments(practiceId);

        const totalPatients = patients.length;
        const totalClaims = claims.length;
        const totalAppointments = appointments.length;
        const hasStediKey = !!(practice?.stediApiKey || process.env.STEDI_API_KEY);

        // Check MFA status if we have a userId
        let mfaEnabled = false;
        if (userId) {
          try {
            const user = await storage.getUser(userId);
            if (user) {
              mfaEnabled = !!user.mfaEnabled;
            }
          } catch {
            // Non-blocking
          }
        }

        // Build setup suggestions based on what's missing
        const setupSuggestions: string[] = [];
        if (totalPatients === 0) {
          setupSuggestions.push('Add your first patient');
        }
        if (totalAppointments === 0) {
          setupSuggestions.push('Create an appointment');
        }
        if (totalClaims === 0 && totalPatients > 0) {
          setupSuggestions.push('Submit a test claim');
        }
        if (!mfaEnabled) {
          setupSuggestions.push('Enable MFA for HIPAA compliance');
        }
        if (!hasStediKey) {
          setupSuggestions.push('Configure clearinghouse API key in Settings');
        }

        return JSON.stringify({
          onboardingCompleted: practice?.onboardingCompleted ?? false,
          onboardingStep: practice?.onboardingStep ?? 0,
          totalPatients,
          totalClaims,
          totalAppointments,
          hasStediKey,
          mfaEnabled,
          setupSuggestions,
        });
      }

      case 'create_patient': {
        const patientData: any = {
          practiceId,
          firstName: args.firstName as string,
          lastName: args.lastName as string,
        };
        if (args.dateOfBirth) patientData.dateOfBirth = args.dateOfBirth;
        if (args.email) patientData.email = args.email;
        if (args.phone) patientData.phone = args.phone;
        if (args.insuranceProvider) patientData.insuranceProvider = args.insuranceProvider;
        const patient = await storage.createPatient(patientData);
        return JSON.stringify({ success: true, patient: { id: patient.id, firstName: patient.firstName, lastName: patient.lastName }, message: `Patient ${patient.firstName} ${patient.lastName} created successfully.` });
      }

      case 'enable_demo_mode': {
        // Creates a richer, clearly-labeled demo dataset so prospect demos
        // feel substantial (revenue cycle, appeals, Front Desk activity, mix
        // of claim states). All rows carry isDemo=true → analytics excludes
        // them, submission/sending paths refuse them, DEMO badge in UI.
        const today = new Date();
        const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
        const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
        const twoWeeksAgo = new Date(today); twoWeeksAgo.setDate(today.getDate() - 14);
        const monthAgo = new Date(today); monthAgo.setDate(today.getDate() - 30);
        const isoDate = (d: Date) => d.toISOString().split('T')[0];

        // 8 patients with realistic-looking names — the yellow DEMO badge
        // (Phase 5.1) is the only visual signal of demo status now. Prospect
        // demos look professional ("Aaron Sample" not "DEMO-Aaron Sample"),
        // and the badge + firewall still prevent any confusion or accidental
        // real-world action. Last name "Sample" is the soft secondary marker
        // that clear_demo_data uses to distinguish auto-generated rows from
        // hand-tagged ones (along with recency — see clear_demo_data below).
        const demoPatientSeeds = [
          { firstName: 'Aaron',   lastName: 'Sample', dob: '1985-04-12', insuranceProvider: 'BCBS' },
          { firstName: 'Bella',   lastName: 'Sample', dob: '2018-08-22', insuranceProvider: 'Aetna' },
          { firstName: 'Carlos',  lastName: 'Sample', dob: '1972-11-03', insuranceProvider: 'UnitedHealthcare' },
          { firstName: 'Dana',    lastName: 'Sample', dob: '2010-02-17', insuranceProvider: 'Cigna' },
          { firstName: 'Eli',     lastName: 'Sample', dob: '1958-06-30', insuranceProvider: 'Medicare' },
          { firstName: 'Frankie', lastName: 'Sample', dob: '2020-12-04', insuranceProvider: 'Humana' },
          { firstName: 'Grace',   lastName: 'Sample', dob: '1990-09-15', insuranceProvider: 'BCBS' },
          { firstName: 'Henry',   lastName: 'Sample', dob: '2022-03-08', insuranceProvider: 'Aetna' },
        ];
        const createdPatients: any[] = [];
        for (const seed of demoPatientSeeds) {
          const p = await storage.createPatient({
            practiceId,
            firstName: seed.firstName,
            lastName: seed.lastName,
            dateOfBirth: seed.dob,
            email: `${seed.firstName.toLowerCase()}.sample@example.com`,
            phone: '(555) 012-3456',
            insuranceProvider: seed.insuranceProvider,
            isDemo: true,
          } as any);
          createdPatients.push(p);
        }

        // 5 appointments spanning yesterday → today → tomorrow so Front Desk
        // and Calendar both have content. Status mix: completed past, active
        // today, scheduled future.
        const apptSeeds: Array<{ patientIdx: number; date: Date; hour: number; status: string; title: string }> = [
          { patientIdx: 0, date: yesterday, hour: 10, status: 'completed', title: 'OT Session' },
          { patientIdx: 6, date: yesterday, hour: 14, status: 'completed', title: 'PT Session' },
          { patientIdx: 1, date: today,     hour: 11, status: 'in_session', title: 'OT Session' },
          { patientIdx: 5, date: tomorrow,  hour: 9,  status: 'scheduled', title: 'SLP Session' },
          { patientIdx: 1, date: tomorrow,  hour: 14, status: 'scheduled', title: 'OT Follow-up' },
        ];
        const createdAppointments: any[] = [];
        for (const seed of apptSeeds) {
          const patient = createdPatients[seed.patientIdx];
          if (!patient) continue;
          const start = new Date(seed.date); start.setHours(seed.hour, 0, 0, 0);
          const end = new Date(start.getTime() + 60 * 60_000);
          createdAppointments.push(
            await storage.createAppointment({
              practiceId,
              patientId: patient.id,
              startTime: start,
              endTime: end,
              title: seed.title,
              status: seed.status,
              isDemo: true,
            } as any),
          );
        }

        // 5 claims at varied statuses for the full revenue-cycle demo:
        //   draft   → user can practice clicking Submit (firewall refuses)
        //   paid    → contributes to "this looks like a working practice"
        //   denied  → demo the appeals workflow
        //   submitted → pending response, shows in-flight state
        //   held    → biller-attention state, shows the workflow
        const claimSeeds: Array<{
          patientIdx: number;
          status: string;
          totalAmount: string;
          paidAmount?: string;
          submittedAt?: Date;
          paidAt?: Date;
          denialReason?: string;
          holdReason?: string;
          dateOfService: Date;
        }> = [
          { patientIdx: 0, status: 'paid',      totalAmount: '300.00', paidAmount: '240.00',
            submittedAt: twoWeeksAgo, paidAt: yesterday, dateOfService: twoWeeksAgo },
          { patientIdx: 1, status: 'draft',     totalAmount: '300.00', dateOfService: yesterday },
          { patientIdx: 2, status: 'denied',    totalAmount: '425.00',
            submittedAt: monthAgo, dateOfService: monthAgo,
            denialReason: 'Missing prior authorization' },
          { patientIdx: 3, status: 'submitted', totalAmount: '275.00',
            submittedAt: new Date(today.getTime() - 3 * 86400_000),
            dateOfService: new Date(today.getTime() - 5 * 86400_000) },
          { patientIdx: 4, status: 'held',      totalAmount: '550.00',
            holdReason: 'Awaiting insurance verification',
            dateOfService: yesterday },
        ];
        const createdClaims: any[] = [];
        const cptCodes = await storage.getCptCodes().catch(() => []);
        const cpt97530 = (cptCodes as any[]).find((c: any) => c.code === '97530');
        const cpt97140 = (cptCodes as any[]).find((c: any) => c.code === '97140');
        for (const seed of claimSeeds) {
          const patient = createdPatients[seed.patientIdx];
          if (!patient) continue;
          try {
            const claim = await storage.createClaim({
              practiceId,
              patientId: patient.id,
              status: seed.status,
              totalAmount: seed.totalAmount,
              paidAmount: seed.paidAmount ?? null,
              submittedAt: seed.submittedAt ?? null,
              paidAt: seed.paidAt ?? null,
              denialReason: seed.denialReason ?? null,
              holdReason: seed.holdReason ?? null,
              dateOfService: isoDate(seed.dateOfService),
              isDemo: true,
            } as any);
            createdClaims.push(claim);
            // Line items for draft + paid (the most-viewed states) so the UI
            // detail panes have content. Other statuses can skip — they show
            // top-line info in the list.
            if (claim?.id && (seed.status === 'draft' || seed.status === 'paid')) {
              for (const cpt of [cpt97530, cpt97140].filter(Boolean)) {
                await storage.createClaimLineItem({
                  claimId: claim.id,
                  cptCodeId: (cpt as any).id,
                  units: 1,
                  amount: '150.00',
                } as any);
              }
            }
          } catch (e) {
            logger.warn('Demo claim creation skipped', {
              status: seed.status,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        logger.info('Blanche enabled demo mode', {
          practiceId,
          patients: createdPatients.length,
          appointments: createdAppointments.length,
          claims: createdClaims.length,
        });

        return JSON.stringify({
          success: true,
          summary: {
            patients: createdPatients.length,
            appointments: createdAppointments.length,
            claims: createdClaims.length,
          },
          message:
            `Demo mode enabled. Created ${createdPatients.length} sample patients with realistic names (Aaron Sample, Bella Sample, etc.) — ` +
            `the yellow DEMO badge in lists is the marker. ${createdAppointments.length} appointments (yesterday/today/tomorrow) and ` +
            `${createdClaims.length} claims across draft/submitted/paid/denied/held states. ` +
            `Every row is firewalled — submission and sending tools refuse to act on demo data, and analytics excludes them. ` +
            `Walk a prospect through the Dashboard, Front Desk, Claims, and Appeals pages — there's enough variety to demonstrate the full revenue cycle. ` +
            `Call clear_demo_data when you're done; it only removes rows created in the last 14 days so any permanent showcase data you've hand-tagged (via mark_patients_as_demo) stays put.`,
        });
      }

      case 'clear_demo_data': {
        // Bulk-delete in dependency-safe order: claims → appointments → patients.
        // Drizzle inferred type doesn't expose `isDemo` consistently across all
        // table records yet, hence the `as any` casts on the where clauses.
        //
        // Recency filter: only removes rows created in the last RECENCY_DAYS.
        // This preserves "permanent showcase" patients the user has hand-tagged
        // via mark_patients_as_demo (which they're not deleting after each demo)
        // while still cleaning up the on-demand batches that enable_demo_mode
        // generates for a single demo session. The cutoff is generous enough
        // for a multi-day demo cycle.
        const RECENCY_DAYS = 14;
        const cutoff = new Date(Date.now() - RECENCY_DAYS * 86400_000);
        // db, patients/claims/appointments tables, and Drizzle ops are imported
        // at the top of the file. The previous dynamic imports collided with
        // esbuild's minification of the top-level `eq` symbol, producing the
        // production runtime error "eq62 is not a function". Top-level only.

        const claimsResult = await db
          .delete(claims)
          .where(and(
            eq(claims.practiceId, practiceId),
            eq((claims as any).isDemo, true),
            gte(claims.createdAt, cutoff),
          ))
          .returning({ id: claims.id });
        const appointmentsResult = await db
          .delete(appointments)
          .where(and(
            eq(appointments.practiceId, practiceId),
            eq((appointments as any).isDemo, true),
            gte(appointments.createdAt, cutoff),
          ))
          .returning({ id: appointments.id });
        const patientsResult = await db
          .delete(patients)
          .where(and(
            eq(patients.practiceId, practiceId),
            eq((patients as any).isDemo, true),
            gte(patients.createdAt, cutoff),
          ))
          .returning({ id: patients.id });

        logger.info('Blanche cleared demo data', {
          practiceId,
          recencyDays: RECENCY_DAYS,
          claims: claimsResult.length,
          appointments: appointmentsResult.length,
          patients: patientsResult.length,
        });

        return JSON.stringify({
          success: true,
          deleted: {
            claims: claimsResult.length,
            appointments: appointmentsResult.length,
            patients: patientsResult.length,
          },
          message:
            `Cleared recent demo data — removed ${patientsResult.length} patients, ` +
            `${appointmentsResult.length} appointments, and ${claimsResult.length} claims ` +
            `created in the last ${RECENCY_DAYS} days. Any demo rows older than that ` +
            `(hand-tagged permanent showcase patients) are preserved. Your real data is untouched.`,
        });
      }

      case 'find_legacy_demo_candidates': {
        // Read-only — surfaces patients that LOOK like demo data so the user
        // can review before flagging via mark_patients_as_demo. Scoped to the
        // caller's practice; excludes already-tagged rows (is_demo = true).
        const allPatients = await storage.getPatients(practiceId);
        const candidates: Array<{
          id: number;
          name: string;
          email: string | null;
          phone: string | null;
          signals: string[];
        }> = [];
        for (const p of allPatients as any[]) {
          if (p.isDemo) continue;
          const signals: string[] = [];
          const email = (p.email || '').toLowerCase();
          if (/@example\.(com|net|org)$/.test(email)) signals.push('example_email');
          const phone = String(p.phone || '');
          // 555 area code: matches (555)123-4567, 555-123-4567, 5551234567, +1-555-...
          if (/(^|\D)555\D?\d{3}\D?\d{4}\b/.test(phone) || /\(555\)/.test(phone)) {
            signals.push('555_phone');
          }
          const name = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim();
          if (/\b(demo|test|sample)\b/i.test(name)) signals.push('demo_name');
          if (signals.length > 0) {
            candidates.push({
              id: p.id,
              name,
              email: p.email ?? null,
              phone: p.phone ?? null,
              signals,
            });
          }
        }
        return JSON.stringify({
          count: candidates.length,
          candidates,
          message:
            candidates.length === 0
              ? 'No legacy demo candidates found — all suspicious-looking patients are already tagged is_demo.'
              : `Found ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}. Review them, then call mark_patients_as_demo with the IDs you want to flag. Signals: example_email (@example.* domain), 555_phone (reserved fiction area code), demo_name (DEMO/TEST/SAMPLE in name).`,
        });
      }

      case 'mark_patients_as_demo':
      case 'unmark_demo_patients': {
        const targetFlag = (toolName === 'mark_patients_as_demo');
        const rawIds = Array.isArray(args.patientIds) ? args.patientIds : [];
        const patientIds = rawIds
          .map((x: any) => Number(x))
          .filter((n: any) => Number.isInteger(n) && n > 0);
        if (patientIds.length === 0) {
          return JSON.stringify({
            error: 'patientIds must be a non-empty array of positive integers.',
          });
        }
        // db, patients/claims/appointments tables, and Drizzle ops are imported
        // at the top of the file — see the matching note in clear_demo_data
        // above re: the esbuild minification collision on `eq`.

        // Practice ownership check — never let the caller flip flags on another
        // practice's rows even if they hand us the IDs.
        const owned = await db
          .select({ id: patients.id })
          .from(patients)
          .where(and(eq(patients.practiceId, practiceId), inArray(patients.id, patientIds)));
        const ownedIds = owned.map((r: any) => r.id);
        const refused = patientIds.filter((id: number) => !ownedIds.includes(id));

        if (ownedIds.length === 0) {
          return JSON.stringify({
            error: 'None of the provided patient IDs belong to your practice.',
            refusedIds: refused,
          });
        }

        const patientResult = await db
          .update(patients)
          .set({ isDemo: targetFlag } as any)
          .where(and(eq(patients.practiceId, practiceId), inArray(patients.id, ownedIds)))
          .returning({ id: patients.id });
        const appointmentResult = await db
          .update(appointments)
          .set({ isDemo: targetFlag } as any)
          .where(and(eq(appointments.practiceId, practiceId), inArray(appointments.patientId, ownedIds)))
          .returning({ id: appointments.id });
        const claimResult = await db
          .update(claims)
          .set({ isDemo: targetFlag } as any)
          .where(and(eq(claims.practiceId, practiceId), inArray(claims.patientId, ownedIds)))
          .returning({ id: claims.id });

        logger.info(`Blanche ${toolName}`, {
          practiceId,
          patients: patientResult.length,
          appointments: appointmentResult.length,
          claims: claimResult.length,
          refused: refused.length,
        });

        const verb = targetFlag ? 'Marked as demo' : 'Un-marked';
        return JSON.stringify({
          success: true,
          updated: {
            patients: patientResult.length,
            appointments: appointmentResult.length,
            claims: claimResult.length,
          },
          refusedIds: refused,
          message:
            `${verb}: ${patientResult.length} patient(s), ${appointmentResult.length} appointment(s), ${claimResult.length} claim(s).` +
            (refused.length > 0
              ? ` Refused ${refused.length} ID(s) that don't belong to your practice: ${refused.join(', ')}.`
              : '') +
            (targetFlag
              ? ' These rows are now excluded from analytics and refused by submit/send/charge paths.'
              : ' These rows are now treated as real data again.'),
        });
      }

      case 'create_appointment': {
        const duration = (args.duration as number) || 60;
        const startTime = new Date(`${args.date}T${args.time}:00`);
        const endTime = new Date(startTime.getTime() + duration * 60000);
        const appt = await storage.createAppointment({
          practiceId,
          patientId: args.patientId as number,
          startTime,
          endTime,
          title: (args.type as string) || 'Therapy Session',
          status: 'scheduled',
        });
        return JSON.stringify({ success: true, appointment: { id: appt.id, date: args.date, time: args.time, duration }, message: 'Appointment scheduled successfully.' });
      }

      case 'reschedule_appointment': {
        const apptId = args.appointmentId as number;
        const existing = await storage.getAppointment(apptId);
        if (!existing) return JSON.stringify({ error: `Appointment ${apptId} not found.` });
        if (existing.practiceId !== practiceId) return JSON.stringify({ error: 'Appointment not found in this practice.' });

        const existingStart = new Date(existing.startTime as unknown as string);
        const existingEnd = new Date(existing.endTime as unknown as string);
        const existingDurationMin = Math.max(15, Math.round((existingEnd.getTime() - existingStart.getTime()) / 60000));
        const duration = (args.duration as number) || existingDurationMin;

        const newStart = new Date(`${args.date}T${args.time}:00`);
        if (isNaN(newStart.getTime())) {
          return JSON.stringify({ error: 'Invalid date/time. Use YYYY-MM-DD and HH:MM (24h).' });
        }
        const newEnd = new Date(newStart.getTime() + duration * 60000);
        const updated = await storage.updateAppointment(apptId, {
          startTime: newStart,
          endTime: newEnd,
        } as any);
        return JSON.stringify({
          success: true,
          appointment: { id: updated.id, date: args.date, time: args.time, duration },
          message: `Appointment ${apptId} rescheduled to ${args.date} at ${args.time}.`,
        });
      }

      case 'cancel_appointment': {
        const apptId = args.appointmentId as number;
        const existing = await storage.getAppointment(apptId);
        if (!existing) return JSON.stringify({ error: `Appointment ${apptId} not found.` });
        if (existing.practiceId !== practiceId) return JSON.stringify({ error: 'Appointment not found in this practice.' });
        if (existing.status === 'cancelled') {
          return JSON.stringify({ success: true, alreadyCancelled: true, message: `Appointment ${apptId} was already cancelled.` });
        }
        const reason = (args.reason as string) || 'cancelled via assistant';
        const notes = args.notes as string | undefined;
        const cancelled = await storage.cancelAppointment(apptId, reason, notes, userId);
        return JSON.stringify({
          success: true,
          appointment: { id: cancelled.id, status: cancelled.status },
          message: `Appointment ${apptId} cancelled.`,
        });
      }

      case 'suggest_appointment_slot': {
        const duration = Math.max(15, (args.durationMinutes as number) || 60);
        const daysAhead = Math.min(30, Math.max(1, (args.daysAhead as number) || 7));
        const startHour = Math.min(23, Math.max(0, (args.startHour as number) ?? 9));
        const endHour = Math.min(23, Math.max(startHour + 1, (args.endHour as number) ?? 17));

        const now = new Date();
        const rangeStart = new Date(now);
        const rangeEnd = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
        const existingAppts = await storage.getAppointmentsByDateRange(practiceId, rangeStart, rangeEnd);

        // Treat any non-cancelled appointment as a conflict.
        const busy: Array<{ start: number; end: number }> = existingAppts
          .filter((a: any) => a.status !== 'cancelled')
          .map((a: any) => ({
            start: new Date(a.startTime).getTime(),
            end: new Date(a.endTime).getTime(),
          }));

        const overlaps = (s: number, e: number) => busy.some(b => s < b.end && e > b.start);

        const suggestions: Array<{ date: string; time: string; iso: string }> = [];
        const slotMs = duration * 60000;

        for (let d = 0; d < daysAhead && suggestions.length < 5; d++) {
          const day = new Date(now);
          day.setDate(day.getDate() + d);
          day.setHours(0, 0, 0, 0);

          for (let hour = startHour; hour <= endHour - Math.ceil(duration / 60) && suggestions.length < 5; hour++) {
            for (const minute of [0, 30]) {
              const slotStart = new Date(day);
              slotStart.setHours(hour, minute, 0, 0);
              if (slotStart.getTime() < now.getTime() + 30 * 60000) continue; // at least 30 min in future
              const slotEnd = new Date(slotStart.getTime() + slotMs);
              if (slotEnd.getHours() > endHour || (slotEnd.getHours() === endHour && slotEnd.getMinutes() > 0)) continue;
              if (overlaps(slotStart.getTime(), slotEnd.getTime())) continue;

              const yyyy = slotStart.getFullYear();
              const mm = String(slotStart.getMonth() + 1).padStart(2, '0');
              const dd = String(slotStart.getDate()).padStart(2, '0');
              const hh = String(slotStart.getHours()).padStart(2, '0');
              const mi = String(slotStart.getMinutes()).padStart(2, '0');
              suggestions.push({
                date: `${yyyy}-${mm}-${dd}`,
                time: `${hh}:${mi}`,
                iso: slotStart.toISOString(),
              });
              if (suggestions.length >= 5) break;
            }
          }
        }

        return JSON.stringify({
          success: true,
          durationMinutes: duration,
          searchedDays: daysAhead,
          businessHours: `${startHour}:00 - ${endHour}:00`,
          suggestions,
          message: suggestions.length
            ? `Found ${suggestions.length} open slot(s) over the next ${daysAhead} day(s).`
            : `No open slots found in the next ${daysAhead} day(s) within ${startHour}:00-${endHour}:00.`,
        });
      }

      case 'navigate_user': {
        const pageMap: Record<string, string> = {
          patients: '/patients',
          calendar: '/calendar',
          claims: '/claims',
          settings: '/settings',
          'soap-notes': '/soap-notes',
          analytics: '/analytics',
          'mcp-setup': '/mcp-setup',
          onboarding: '/onboarding',
        };
        const path = pageMap[args.page as string] || '/';
        return JSON.stringify({ action: 'navigate', path, label: `Go to ${args.page}` });
      }

      case 'submit_claim': {
        let patientId = args.patientId as number | undefined;

        // If name provided instead of ID, search for patient
        if (!patientId && args.patientName) {
          const patients = await storage.getPatients(practiceId);
          const match = patients.find((p: any) =>
            `${p.firstName} ${p.lastName}`.toLowerCase().includes((args.patientName as string).toLowerCase()),
          );
          if (!match) return JSON.stringify({ error: `Patient "${args.patientName}" not found. Please check the name or provide a patient ID.` });
          patientId = match.id;
        }

        if (!patientId) return JSON.stringify({ error: 'Please provide a patient name or ID.' });

        const patient = await storage.getPatient(patientId);
        if (!patient) return JSON.stringify({ error: 'Patient not found.' });
        const submitDemoBlock = rejectIfDemoData(patient, 'patient');
        if (submitDemoBlock) return submitDemoBlock;

        const cptCodes = args.cptCodes as string[];
        if (!cptCodes || cptCodes.length === 0) {
          return JSON.stringify({ error: 'At least one CPT code is required.' });
        }

        const serviceDate = args.serviceDate as string;
        if (!serviceDate) return JSON.stringify({ error: 'Service date is required (YYYY-MM-DD).' });

        // Calculate total amount: use provided amount or default based on units
        const units = (args.units as number) || cptCodes.length;
        const totalAmount = (args.totalAmount as number) || units * 75; // Default $75/unit if not specified

        // Generate a claim number
        const claimNumber = `CLM-${Date.now()}-${patientId}`;

        // Create the claim in draft status
        const claim = await storage.createClaim({
          practiceId,
          patientId,
          claimNumber,
          totalAmount: String(totalAmount),
          status: 'draft',
        });

        return JSON.stringify({
          success: true,
          claim: {
            id: claim.id,
            claimNumber: claim.claimNumber,
            patientName: `${patient.firstName} ${patient.lastName}`,
            serviceDate,
            cptCodes,
            diagnosisCode: (args.diagnosisCode as string) || 'Not specified',
            units,
            totalAmount: `$${totalAmount.toFixed(2)}`,
            status: 'draft',
          },
          message: `Claim ${claim.claimNumber} created for ${patient.firstName} ${patient.lastName}. The claim is in draft status — please review it in the Claims page and submit when ready. [Action: View Claims]`,
        });
      }

      case 'check_eligibility': {
        let patientId = args.patientId as number | undefined;

        // If name provided, search for patient
        if (!patientId && args.patientName) {
          const patients = await storage.getPatients(practiceId);
          const match = patients.find((p: any) =>
            `${p.firstName} ${p.lastName}`.toLowerCase().includes((args.patientName as string).toLowerCase()),
          );
          if (!match) return JSON.stringify({ error: `Patient "${args.patientName}" not found` });
          patientId = match.id;
        }

        if (!patientId) return JSON.stringify({ error: 'Please provide a patient name or ID' });

        const patient = await storage.getPatient(patientId);
        if (!patient) return JSON.stringify({ error: 'Patient not found' });

        const practice = await storage.getPractice(practiceId);

        // Resolve payer ID from insurance provider name
        const { checkEligibility, PAYER_IDS } = await import('../services/stediService');
        const insuranceName = (patient.insuranceProvider || '').toLowerCase();
        const payerId = PAYER_IDS[insuranceName] || patient.insuranceId || '60054';

        const result = await checkEligibility({
          payer: { id: payerId, name: patient.insuranceProvider || 'Unknown' },
          provider: {
            npi: practice?.npi || '',
            organizationName: practice?.name || undefined,
          },
          subscriber: {
            memberId: patient.insuranceId || patient.policyNumber || '',
            firstName: patient.firstName,
            lastName: patient.lastName,
            dateOfBirth: patient.dateOfBirth || '',
          },
          // serviceTypeCodes omitted — resolved from practice.specialty by stediService.checkEligibility
        }, practiceId);

        return JSON.stringify({
          patient: `${patient.firstName} ${patient.lastName}`,
          insurance: patient.insuranceProvider,
          status: result.status,
          planName: result.planName,
          groupNumber: result.groupNumber,
          effectiveDate: result.effectiveDate,
          copay: result.copay,
          deductible: result.deductible,
          outOfPocketMax: result.outOfPocketMax,
          coinsurance: result.coinsurance,
          coverageActive: result.status === 'active',
          errors: result.errors,
        });
      }

      case 'verify_benefits': {
        let patientId = args.patientId as number | undefined;

        // If name provided, search for patient
        if (!patientId && args.patientName) {
          const patients = await storage.getPatients(practiceId);
          const match = patients.find((p: any) =>
            `${p.firstName} ${p.lastName}`.toLowerCase().includes((args.patientName as string).toLowerCase()),
          );
          if (!match) return JSON.stringify({ error: `Patient "${args.patientName}" not found` });
          patientId = match.id;
        }

        if (!patientId) return JSON.stringify({ error: 'Please provide a patient name or ID' });

        const patient = await storage.getPatient(patientId);
        if (!patient) return JSON.stringify({ error: 'Patient not found' });

        const { getDetailedBenefits } = await import('../services/stediService');
        const benefits = await getDetailedBenefits(patientId, practiceId);

        // Build a human-readable summary
        const lines: string[] = [];
        lines.push(`Benefits Verification for ${patient.firstName} ${patient.lastName}`);
        lines.push(`Insurance: ${patient.insuranceProvider || 'Unknown'}`);
        lines.push(`Plan Status: ${benefits.planStatus.toUpperCase()}`);
        if (benefits.planName) lines.push(`Plan: ${benefits.planName}`);
        if (benefits.planType) lines.push(`Plan Type: ${benefits.planType}`);
        if (benefits.effectiveDate) lines.push(`Effective: ${benefits.effectiveDate}`);
        if (benefits.terminationDate) lines.push(`Terminates: ${benefits.terminationDate}`);

        lines.push('');
        lines.push('--- Financial Summary ---');
        if (benefits.copay != null) lines.push(`Copay: $${benefits.copay}`);
        if (benefits.coinsurance != null) lines.push(`Coinsurance: ${benefits.coinsurance}%`);
        if (benefits.deductible?.individual) {
          const met = benefits.deductible.individualMet || 0;
          lines.push(`Individual Deductible: $${met} / $${benefits.deductible.individual} met`);
        }
        if (benefits.deductible?.family) {
          const met = benefits.deductible.familyMet || 0;
          lines.push(`Family Deductible: $${met} / $${benefits.deductible.family} met`);
        }
        if (benefits.outOfPocketMax?.individual) {
          const met = benefits.outOfPocketMax.individualMet || 0;
          lines.push(`Individual OOP Max: $${met} / $${benefits.outOfPocketMax.individual} met`);
        }
        if (benefits.outOfPocketMax?.family) {
          const met = benefits.outOfPocketMax.familyMet || 0;
          lines.push(`Family OOP Max: $${met} / $${benefits.outOfPocketMax.family} met`);
        }

        if (benefits.therapyVisits) {
          lines.push('');
          lines.push('--- Therapy Visit Limits ---');
          const visitTypes: Array<{ key: string; label: string }> = [
            { key: 'ot', label: 'Occupational Therapy (OT)' },
            { key: 'pt', label: 'Physical Therapy (PT)' },
            { key: 'st', label: 'Speech Therapy (ST)' },
            { key: 'mentalHealth', label: 'Mental Health' },
            { key: 'combined', label: 'Combined Therapy' },
          ];
          for (const { key, label } of visitTypes) {
            const visits = (benefits.therapyVisits as any)[key];
            if (visits?.allowed) {
              const used = visits.used || 0;
              const remaining = visits.remaining ?? (visits.allowed - used);
              lines.push(`${label}: ${used} used / ${visits.allowed} allowed (${remaining} remaining)`);
            }
          }
        }

        lines.push('');
        lines.push(`Prior Authorization Required: ${benefits.authRequired ? 'YES' : 'No'}`);
        if (benefits.authNotes) lines.push(`Auth Notes: ${benefits.authNotes}`);

        if (benefits.errors && benefits.errors.length > 0) {
          lines.push('');
          lines.push('Errors: ' + benefits.errors.join('; '));
        }

        // Also store the check
        try {
          await storage.createEligibilityCheck({
            patientId,
            practiceId,
            insuranceId: null,
            status: benefits.planStatus,
            coverageType: benefits.planType || null,
            effectiveDate: benefits.effectiveDate || null,
            terminationDate: benefits.terminationDate || null,
            copay: benefits.copay?.toString() || null,
            deductible: benefits.deductible?.individual?.toString() || null,
            deductibleMet: benefits.deductible?.individualMet?.toString() || null,
            outOfPocketMax: benefits.outOfPocketMax?.individual?.toString() || null,
            outOfPocketMet: benefits.outOfPocketMax?.individualMet?.toString() || null,
            coinsurance: benefits.coinsurance != null ? Math.round(benefits.coinsurance) : null,
            visitsAllowed: benefits.therapyVisits?.combined?.allowed || benefits.therapyVisits?.ot?.allowed || null,
            visitsUsed: benefits.therapyVisits?.combined?.used || benefits.therapyVisits?.ot?.used || null,
            authRequired: benefits.authRequired,
            rawResponse: benefits,
            benefitsDetail: benefits,
          });
        } catch (storeErr) {
          // Non-fatal: log but don't fail
          logger.warn('Failed to store benefits verification result', {
            patientId,
            error: storeErr instanceof Error ? storeErr.message : String(storeErr),
          });
        }

        return JSON.stringify({
          summary: lines.join('\n'),
          benefits,
        });
      }

      case 'generate_soap_note': {
        let patientId = args.patientId as number | undefined;

        // If name provided instead of ID, search for patient
        if (!patientId && args.patientName) {
          const patients = await storage.getPatients(practiceId);
          const searchName = (args.patientName as string).toLowerCase();
          const match = patients.find((p) =>
            `${p.firstName} ${p.lastName}`.toLowerCase().includes(searchName),
          );
          if (!match) return JSON.stringify({ error: `Patient "${args.patientName}" not found. Please provide a valid patient name or ID.` });
          patientId = match.id;
        }

        if (!patientId) return JSON.stringify({ error: 'Please provide a patient name or ID to generate a SOAP note.' });

        const soapPatient = await storage.getPatient(patientId);
        if (!soapPatient) return JSON.stringify({ error: 'Patient not found.' });

        const activities = (args.activities as string[]) || [];
        if (activities.length === 0) return JSON.stringify({ error: 'Please provide at least one activity performed during the session.' });

        const soapDuration = (args.sessionDuration as number) || 60;
        const soapMood = (args.mood as string) || 'cooperative and engaged';
        const soapLocation = (args.location as string) || 'clinic';
        const soapPerformance = (args.performance as string) || 'fair';
        const soapAssistanceLevel = (args.assistanceLevel as string) || 'moderate assistance';
        const soapPlanNextSteps = (args.planNextSteps as string) || 'Continue current treatment goals';

        // Call the AI SOAP note + billing generation service
        const soapResult = await generateSoapNoteAndBilling({
          patientId,
          activities,
          mood: soapMood,
          duration: soapDuration,
          location: soapLocation,
          assessment: {
            performance: soapPerformance,
            assistance: soapAssistanceLevel,
            strength: 'see assessment details',
            motorPlanning: 'see assessment details',
            sensoryRegulation: 'see assessment details',
          },
          planNextSteps: soapPlanNextSteps,
        });

        // Save the SOAP note to the database by creating a treatment session first
        let savedNoteId: number | null = null;
        try {
          // Get a default CPT code for the session record
          const cptCodes = await storage.getCptCodes();
          const defaultCptCode = cptCodes.length > 0 ? cptCodes[0] : null;

          if (defaultCptCode && userId) {
            const session = await storage.createTreatmentSession({
              practiceId,
              patientId,
              therapistId: userId,
              sessionDate: new Date().toISOString().split('T')[0],
              duration: soapDuration,
              cptCodeId: defaultCptCode.id,
              status: 'completed',
              dataSource: 'ai_extracted',
            });

            const savedNote = await storage.createSoapNote({
              sessionId: session.id,
              subjective: soapResult.subjective,
              objective: soapResult.objective,
              assessment: soapResult.assessment,
              plan: soapResult.plan,
              location: soapLocation,
              interventions: activities,
              aiSuggestedCptCodes: soapResult.cptCodes,
              therapistId: userId,
              dataSource: 'ai_extracted',
            });
            savedNoteId = savedNote.id;
          }
        } catch (saveError) {
          logger.error('Error saving AI-generated SOAP note', {
            error: saveError instanceof Error ? saveError.message : String(saveError),
          });
          // Continue - we still return the generated content even if save fails
        }

        return JSON.stringify({
          success: true,
          patient: `${soapPatient.firstName} ${soapPatient.lastName}`,
          savedNoteId,
          subjective: soapResult.subjective,
          objective: soapResult.objective,
          assessment: soapResult.assessment,
          plan: soapResult.plan,
          cptCodes: soapResult.cptCodes.map((c) => ({
            code: c.code,
            name: c.name,
            units: c.units,
            rationale: c.rationale,
          })),
          timeBlocks: soapResult.timeBlocks,
          totalReimbursement: soapResult.totalReimbursement,
          billingRationale: soapResult.billingRationale,
          disclaimer: 'All coding decisions must be reviewed and approved by the treating provider.',
        });
      }

      case 'review_denied_claims': {
        const allClaims = await storage.getClaims(practiceId);
        const deniedClaims = allClaims.filter((c: any) => c.status === 'denied');

        if (deniedClaims.length === 0) {
          return JSON.stringify({ message: 'No denied claims found for this practice.', deniedClaims: [] });
        }

        // Get patient names and line items for each denied claim
        const deniedDetails = await Promise.all(
          deniedClaims.slice(0, 20).map(async (claim: any) => {
            let patientName = 'Unknown';
            if (claim.patientId) {
              try {
                const patient = await storage.getPatient(claim.patientId);
                if (patient) patientName = `${patient.firstName} ${patient.lastName}`;
              } catch { /* non-blocking */ }
            }

            // Determine a suggested action based on denial reason
            const reason = (claim.denialReason || '').toLowerCase();
            let suggestedAction = 'Review denial reason and consider filing an appeal';
            if (reason.includes('authorization') || reason.includes('prior auth')) {
              suggestedAction = 'Obtain prior authorization and resubmit the claim';
            } else if (reason.includes('duplicate')) {
              suggestedAction = 'Check for duplicate claims and void if necessary';
            } else if (reason.includes('missing') || reason.includes('incomplete') || reason.includes('information')) {
              suggestedAction = 'Identify missing information, correct the claim, and resubmit';
            } else if (reason.includes('not covered') || reason.includes('coverage') || reason.includes('non-covered')) {
              suggestedAction = 'Review coverage terms; consider alternative CPT codes or filing an appeal';
            } else if (reason.includes('timely') || reason.includes('filing')) {
              suggestedAction = 'Gather proof of original submission and file a timely filing appeal';
            } else if (reason.includes('medical necessity') || reason.includes('not medically necessary')) {
              suggestedAction = 'Strengthen clinical documentation and file a medical necessity appeal';
            } else if (reason.includes('coding') || reason.includes('modifier') || reason.includes('bundl')) {
              suggestedAction = 'Review CPT/modifier coding and resubmit with corrections';
            }

            return {
              claimId: claim.id,
              claimNumber: claim.claimNumber,
              patientName,
              amount: `$${claim.totalAmount}`,
              denialReason: claim.denialReason || 'Not specified',
              serviceDate: claim.submittedAt || claim.createdAt,
              suggestedAction,
            };
          }),
        );

        return JSON.stringify({
          totalDenied: deniedClaims.length,
          deniedClaims: deniedDetails,
          message: `Found ${deniedClaims.length} denied claim(s). I can draft appeal letters or suggest corrections for any of them.`,
        });
      }

      case 'draft_appeal_letter': {
        const claimId = args.claimId as number;
        if (!claimId) return JSON.stringify({ error: 'Please provide a claim ID.' });

        const claim = await storage.getClaim(claimId);
        if (!claim) return JSON.stringify({ error: `Claim ${claimId} not found.` });
        if (claim.practiceId !== practiceId) return JSON.stringify({ error: 'Claim does not belong to this practice.' });

        // Get patient info
        let patientData = { firstName: 'Unknown', lastName: 'Patient', dateOfBirth: null as string | null, insuranceProvider: null as string | null, insuranceId: null as string | null };
        if (claim.patientId) {
          const patient = await storage.getPatient(claim.patientId);
          if (patient) {
            patientData = {
              firstName: patient.firstName,
              lastName: patient.lastName,
              dateOfBirth: patient.dateOfBirth,
              insuranceProvider: patient.insuranceProvider,
              insuranceId: patient.insuranceId || patient.policyNumber || null,
            };
          }
        }

        // Get practice info
        const practice = await storage.getPractice(practiceId);
        const practiceData = {
          name: practice?.name || 'Practice',
          npi: practice?.npi || null,
          address: practice?.address || null,
          phone: practice?.phone || null,
        };

        // Get line items with CPT/ICD codes
        const lineItems = await storage.getClaimLineItems(claimId);
        const lineItemDetails = await Promise.all(
          lineItems.map(async (li: any) => {
            let cptCode = null;
            let icd10Code = null;
            try {
              if (li.cptCodeId) {
                const codes = await storage.getCptCodes();
                cptCode = codes.find((c: any) => c.id === li.cptCodeId) || null;
              }
              if (li.icd10CodeId) {
                const codes = await storage.getIcd10Codes();
                icd10Code = codes.find((c: any) => c.id === li.icd10CodeId) || null;
              }
            } catch { /* non-blocking */ }
            return {
              cptCode: cptCode ? { code: cptCode.code, description: cptCode.description } : undefined,
              icd10Code: icd10Code ? { code: icd10Code.code, description: icd10Code.description } : undefined,
              units: li.units || 1,
              amount: li.amount || '0',
            };
          }),
        );

        const denialReason = claim.denialReason || 'Reason not specified';

        // Phase 0 / Workstream A + B enrichment: fetch parsed plan benefits
        // (from any uploaded SBC/SPD documents) and prior-paid-claim precedents
        // for this same payer + member + CPTs. Both feed into the appeal prompt
        // so Claude can cite the patient's actual plan language and prior
        // payments specifically. Best-effort — failures are non-fatal so the
        // appeal still generates without the enrichment.
        let parsedBenefits = null;
        let precedents = null;
        try {
          if (claim.patientId) {
            const { getPatientPlanBenefits } = await import('../storage/patients');
            parsedBenefits = await getPatientPlanBenefits(claim.patientId);
          }
        } catch (benefitsError) {
          logger.warn('Failed to fetch patient plan benefits for appeal — continuing without', {
            claimId,
            error: benefitsError instanceof Error ? benefitsError.message : String(benefitsError),
          });
        }
        try {
          const cptList = lineItemDetails
            .map((li) => li.cptCode?.code)
            .filter((c): c is string => typeof c === 'string' && c.length > 0);
          const firstDx = lineItemDetails.find((li) => li.icd10Code)?.icd10Code?.code;
          if (cptList.length > 0 && claim.patientId) {
            const { findPrecedentsForDeniedClaim } = await import('../services/claimPrecedentService');
            precedents = await findPrecedentsForDeniedClaim({
              practiceId,
              patientId: claim.patientId,
              insuranceId: claim.insuranceId ?? undefined,
              cptCodes: cptList,
              diagnosisCode: firstDx,
              daysBack: 365,
            });
          }
        } catch (precedentError) {
          logger.warn('Failed to fetch claim precedents for appeal — continuing without', {
            claimId,
            error: precedentError instanceof Error ? precedentError.message : String(precedentError),
          });
        }

        // Tier A #2 — fetch proven arguments from past won appeals for this
        // practice + payer + (eventually) denial category. Best-effort.
        let provenArguments: any[] | null = null;
        try {
          const { getProvenArgumentsForContext } = await import('../services/appealOutcomeLearningService');
          provenArguments = await getProvenArgumentsForContext({
            practiceId,
            payerName: patientData.insuranceProvider ?? null,
            // We don't yet know the denialCategory here (Claude assigns it
            // in the response). Could refine later by re-querying after a
            // first pass, but per-payer is already a strong filter.
          });
        } catch (provenError) {
          logger.warn('Failed to fetch proven appeal arguments — continuing without', {
            claimId,
            error: provenError instanceof Error ? provenError.message : String(provenError),
          });
        }

        // Try to use the Claude appeal service if available
        try {
          const { generateClaudeAppeal, isClaudeAppealAvailable } = await import('../services/claudeAppealService');
          if (isClaudeAppealAvailable()) {
            const appealResult = await generateClaudeAppeal({
              claim: {
                id: claim.id,
                claimNumber: claim.claimNumber,
                totalAmount: claim.totalAmount,
                denialReason: claim.denialReason,
                submittedAt: claim.submittedAt,
              },
              lineItems: lineItemDetails,
              patient: patientData,
              practice: practiceData,
              denialReason,
              parsedBenefits,
              precedents,
              provenArguments,
            });

            return JSON.stringify({
              claimId: claim.id,
              claimNumber: claim.claimNumber,
              patientName: `${patientData.firstName} ${patientData.lastName}`,
              denialReason,
              amount: `$${claim.totalAmount}`,
              appealLetter: appealResult.appealLetter,
              denialCategory: appealResult.denialCategory,
              successProbability: appealResult.successProbability,
              suggestedActions: appealResult.suggestedActions,
              keyArguments: appealResult.keyArguments,
              message: 'Appeal letter generated successfully. Review and customize before sending to the payer.',
            });
          }
        } catch (appealError) {
          logger.error('Failed to generate appeal via Claude service, returning claim details for manual drafting', {
            error: appealError instanceof Error ? appealError.message : String(appealError),
          });
        }

        // Fallback: return structured claim details so Blanche can write the appeal in her response
        return JSON.stringify({
          claimId: claim.id,
          claimNumber: claim.claimNumber,
          patientName: `${patientData.firstName} ${patientData.lastName}`,
          patientDOB: patientData.dateOfBirth,
          insuranceProvider: patientData.insuranceProvider,
          memberId: patientData.insuranceId,
          practiceName: practiceData.name,
          practiceNPI: practiceData.npi,
          practiceAddress: practiceData.address,
          practicePhone: practiceData.phone,
          denialReason,
          amount: `$${claim.totalAmount}`,
          serviceDate: claim.submittedAt || claim.createdAt,
          lineItems: lineItemDetails,
          message: 'I have the claim details. I will draft an appeal letter based on this information.',
        });
      }

      case 'suggest_claim_correction': {
        const corrClaimId = args.claimId as number;
        if (!corrClaimId) return JSON.stringify({ error: 'Please provide a claim ID.' });

        const corrClaim = await storage.getClaim(corrClaimId);
        if (!corrClaim) return JSON.stringify({ error: `Claim ${corrClaimId} not found.` });
        if (corrClaim.practiceId !== practiceId) return JSON.stringify({ error: 'Claim does not belong to this practice.' });

        const denialText = (corrClaim.denialReason || '').toLowerCase();
        const corrections: { issue: string; correction: string; priority: string }[] = [];
        let overallStrategy = 'appeal';

        // Analyze denial reason and suggest corrections
        if (denialText.includes('authorization') || denialText.includes('prior auth') || denialText.includes('pre-cert')) {
          corrections.push({
            issue: 'Prior authorization required',
            correction: 'Obtain retroactive authorization from the payer if possible. Contact the insurance company to request a retroactive auth, citing clinical necessity and any documentation of the referral process. Then resubmit the claim with the authorization number.',
            priority: 'high',
          });
          overallStrategy = 'resubmit_with_auth';
        }

        if (denialText.includes('duplicate')) {
          corrections.push({
            issue: 'Duplicate claim detected',
            correction: 'Check your claims list for duplicate submissions for the same patient, date of service, and CPT codes. If a true duplicate exists, void the extra claim. If the services were distinct (e.g., different times or codes), add modifier 59 (Distinct Procedural Service) or modifier XE/XS/XP/XU and resubmit with documentation explaining why the services are separate.',
            priority: 'high',
          });
          overallStrategy = 'correct_and_resubmit';
        }

        if (denialText.includes('missing') || denialText.includes('incomplete') || denialText.includes('invalid') || denialText.includes('information')) {
          corrections.push({
            issue: 'Missing or incomplete information',
            correction: 'Review the claim for missing fields: patient demographics, insurance member ID, group number, referring provider NPI, diagnosis codes, or modifiers. Correct the missing data and resubmit. Common missing items include: GO/GP modifier on therapy codes, rendering provider NPI, and place of service code.',
            priority: 'high',
          });
          overallStrategy = 'correct_and_resubmit';
        }

        if (denialText.includes('not covered') || denialText.includes('non-covered') || denialText.includes('coverage') || denialText.includes('benefit')) {
          corrections.push({
            issue: 'Service not covered under plan',
            correction: 'Verify the patient\'s specific plan benefits for therapy services. Consider: (1) Using an alternative CPT code that is covered (e.g., 97530 instead of 97110 if functionally appropriate), (2) Adding appropriate modifiers, (3) Checking if a different diagnosis code better supports medical necessity, (4) Filing an appeal with clinical documentation showing the service was medically necessary.',
            priority: 'medium',
          });
          overallStrategy = 'appeal_or_recode';
        }

        if (denialText.includes('timely') || denialText.includes('filing') || denialText.includes('deadline')) {
          corrections.push({
            issue: 'Timely filing deadline exceeded',
            correction: 'Gather proof of original submission (clearinghouse confirmation, submission logs, or screenshots). File a timely filing appeal with this evidence. If the delay was due to incorrect payer information or a payer processing error, include documentation of the initial submission attempt.',
            priority: 'critical',
          });
          overallStrategy = 'timely_filing_appeal';
        }

        if (denialText.includes('medical necessity') || denialText.includes('not medically necessary') || denialText.includes('not necessary')) {
          corrections.push({
            issue: 'Medical necessity not established',
            correction: 'Strengthen clinical documentation by: (1) Ensuring SOAP notes clearly document functional deficits and skilled intervention need, (2) Including measurable treatment goals and progress data, (3) Referencing clinical practice guidelines (e.g., AOTA, APA), (4) Documenting why services require the skill of a licensed therapist. File an appeal with updated documentation.',
            priority: 'high',
          });
          overallStrategy = 'appeal_with_documentation';
        }

        if (denialText.includes('coding') || denialText.includes('modifier') || denialText.includes('bundl') || denialText.includes('unbundl')) {
          corrections.push({
            issue: 'Coding or modifier error',
            correction: 'Review CPT code selection and modifiers: (1) Ensure the correct therapy modifier is applied (GO for OT, GP for PT, GN for SLP), (2) Check for bundling conflicts (e.g., 97140 and 97530 billed same session may require modifier 59), (3) Verify units match documented treatment time per the 8-minute rule, (4) Correct any code-to-diagnosis mismatches. Resubmit with corrected codes.',
            priority: 'high',
          });
          overallStrategy = 'correct_and_resubmit';
        }

        if (denialText.includes('eligib') || denialText.includes('not eligible') || denialText.includes('inactive') || denialText.includes('terminated')) {
          corrections.push({
            issue: 'Patient eligibility issue',
            correction: 'Verify patient insurance eligibility for the date of service. Check: (1) Was the policy active on the service date? (2) Is the member ID correct? (3) Is there a coordination of benefits issue (secondary insurance)? Run an eligibility check and resubmit to the correct payer if needed.',
            priority: 'high',
          });
          overallStrategy = 'verify_eligibility_and_resubmit';
        }

        // If no specific patterns matched, provide general guidance
        if (corrections.length === 0) {
          corrections.push({
            issue: 'Denial reason requires manual review',
            correction: `The denial reason "${corrClaim.denialReason || 'not specified'}" does not match a common pattern. Recommended steps: (1) Contact the payer to clarify the exact denial reason and required corrections, (2) Review the EOB/ERA for specific remark codes, (3) Consider filing a formal appeal with supporting clinical documentation.`,
            priority: 'medium',
          });
          overallStrategy = 'contact_payer';
        }

        // Get line items for additional context
        let lineItemSummary: any[] = [];
        try {
          const lineItems = await storage.getClaimLineItems(corrClaimId);
          lineItemSummary = lineItems.map((li: any) => ({
            units: li.units,
            amount: li.amount,
            modifier: li.modifier,
          }));
        } catch { /* non-blocking */ }

        return JSON.stringify({
          claimId: corrClaim.id,
          claimNumber: corrClaim.claimNumber,
          amount: `$${corrClaim.totalAmount}`,
          denialReason: corrClaim.denialReason || 'Not specified',
          overallStrategy,
          corrections,
          lineItems: lineItemSummary,
          message: `Found ${corrections.length} suggested correction(s) for this denied claim. ${overallStrategy === 'appeal' ? 'I recommend filing an appeal.' : overallStrategy === 'correct_and_resubmit' ? 'I recommend correcting and resubmitting the claim.' : 'Review the corrections above and take action.'}`,
        });
      }

      case 'batch_eligibility_check': {
        // Get appointments for the next 7 days
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const upcomingAppts = await storage.getAppointmentsByDateRange(practiceId, now, sevenDaysFromNow);

        // Get unique patient IDs from non-cancelled appointments
        const uniquePatientIds = Array.from(new Set(
          upcomingAppts
            .filter((a: any) => a.status !== 'cancelled' && a.patientId)
            .map((a: any) => a.patientId!)
        )) as number[];

        if (uniquePatientIds.length === 0) {
          return JSON.stringify({
            checked: 0,
            eligible: 0,
            ineligible: 0,
            errors: 0,
            results: [],
            message: 'No upcoming appointments found in the next 7 days.',
          });
        }

        const result = await runBulkEligibility(practiceId, uniquePatientIds);
        if ('error' in result) return JSON.stringify({ error: result.error });
        return JSON.stringify({
          ...result,
          message: `Checked ${result.checked} patient(s) with upcoming appointments. ${result.eligible} eligible, ${result.ineligible} ineligible, ${result.errors} error(s)/skipped.`,
        });
      }

      case 'bulk_eligibility_by_filter': {
        const startDateStr = typeof args.startDate === 'string' ? args.startDate : null;
        const endDateStr = typeof args.endDate === 'string' ? args.endDate : null;
        const payerNameFilter = typeof args.payerName === 'string' ? args.payerName.trim().toLowerCase() : '';
        const appointmentsOnly = args.appointmentsOnly === undefined ? true : Boolean(args.appointmentsOnly);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const start = startDateStr ? new Date(startDateStr + 'T00:00:00') : today;
        const defaultEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
        const end = endDateStr ? new Date(endDateStr + 'T23:59:59') : defaultEnd;

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          return JSON.stringify({ error: 'Invalid startDate or endDate. Use YYYY-MM-DD.' });
        }
        if (end.getTime() < start.getTime()) {
          return JSON.stringify({ error: 'endDate must be on or after startDate.' });
        }
        const rangeDays = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
        if (rangeDays > 60) {
          return JSON.stringify({ error: `Date range too large (${rangeDays} days). Maximum is 60 days.` });
        }

        let candidatePatientIds: number[] = [];
        // Cache of full patient records when we have them, so the payer filter
        // doesn't have to refetch.
        let candidateRecords: Map<number, any> | null = null;

        if (appointmentsOnly) {
          const appts = await storage.getAppointmentsByDateRange(practiceId, start, end);
          candidatePatientIds = Array.from(new Set(
            appts
              .filter((a: any) => a.status !== 'cancelled' && a.patientId)
              .map((a: any) => a.patientId as number)
          ));
        } else {
          // All active (non-deleted) patients for this practice — getPatients already scopes to practiceId
          const allPatients = await storage.getPatients(practiceId);
          candidatePatientIds = allPatients.map((p: any) => p.id as number);
          candidateRecords = new Map(allPatients.map((p: any) => [p.id, p]));
        }

        // Enforce the patient-count cap before doing any per-patient work.
        if (candidatePatientIds.length > 200) {
          return JSON.stringify({
            error: `Too many patients matched (${candidatePatientIds.length}). Maximum is 200 per call. Narrow the date range or payerName filter.`,
          });
        }

        // Apply payer filter if provided. Look up records in one batch when needed.
        let filteredIds = candidatePatientIds;
        if (payerNameFilter) {
          if (!candidateRecords) {
            candidateRecords = await storage.getPatientsByIds(candidatePatientIds);
          }
          filteredIds = candidatePatientIds.filter((pid: number) => {
            const pat = candidateRecords!.get(pid);
            if (!pat || pat.practiceId !== practiceId) return false;
            const provider = (pat.insuranceProvider || '').toLowerCase();
            return provider.includes(payerNameFilter);
          });
        }

        if (filteredIds.length === 0) {
          return JSON.stringify({
            checked: 0,
            eligible: 0,
            ineligible: 0,
            errors: 0,
            results: [],
            message: `No patients matched the filter (range ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}${payerNameFilter ? `, payer contains "${payerNameFilter}"` : ''}, appointmentsOnly=${appointmentsOnly}).`,
          });
        }

        const result = await runBulkEligibility(practiceId, filteredIds);
        if ('error' in result) return JSON.stringify({ error: result.error });
        return JSON.stringify({
          ...result,
          filters: {
            startDate: start.toISOString().slice(0, 10),
            endDate: end.toISOString().slice(0, 10),
            payerName: payerNameFilter || null,
            appointmentsOnly,
          },
          message: `Checked ${result.checked} patient(s). ${result.eligible} eligible, ${result.ineligible} ineligible, ${result.errors} error(s)/skipped.`,
        });
      }

      case 'review_underpayments': {
        const daysBack = Number(args.daysBack) || 90;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysBack);

        // Find matched remittance line items with their claims for this practice
        const matchedLineItems = await db
          .select({
            lineItemId: remittanceLineItems.id,
            claimId: remittanceLineItems.claimId,
            cptCode: remittanceLineItems.cptCode,
            chargedAmount: remittanceLineItems.chargedAmount,
            allowedAmount: remittanceLineItems.allowedAmount,
            paidAmount: remittanceLineItems.paidAmount,
            adjustmentAmount: remittanceLineItems.adjustmentAmount,
            adjustmentReasonCodes: remittanceLineItems.adjustmentReasonCodes,
            patientName: remittanceLineItems.patientName,
            serviceDate: remittanceLineItems.serviceDate,
            payerName: remittanceAdvice.payerName,
            claimNumber: claims.claimNumber,
            claimTotalAmount: claims.totalAmount,
            claimExpectedAmount: claims.expectedAmount,
            claimStatus: claims.status,
            remittanceDate: remittanceAdvice.receivedDate,
          })
          .from(remittanceLineItems)
          .innerJoin(remittanceAdvice, eq(remittanceLineItems.remittanceId, remittanceAdvice.id))
          .innerJoin(claims, eq(remittanceLineItems.claimId, claims.id))
          .where(
            and(
              eq(remittanceAdvice.practiceId, practiceId),
              eq(remittanceLineItems.status, 'matched'),
              isNotNull(remittanceLineItems.claimId),
            )
          )
          .orderBy(desc(remittanceAdvice.receivedDate))
          .limit(100);

        if (matchedLineItems.length === 0) {
          return JSON.stringify({
            message: 'No matched remittance line items found. Upload and auto-match ERA/835 files first to enable underpayment detection.',
            underpayments: [],
            totalUnderpaid: 0,
          });
        }

        // For each matched line item, look up fee schedule and assess underpayment
        const underpayments: Array<{
          claimId: number;
          claimNumber: string | null;
          patientName: string;
          cptCode: string | null;
          payerName: string;
          serviceDate: string | null;
          billedAmount: number;
          expectedReimbursement: number | null;
          paidAmount: number;
          underpaymentAmount: number;
          adjustmentAnalysis: Array<{ code: string; description: string; amount: number; category: string; disputable: boolean; explanation: string }>;
          worthDisputing: boolean;
          recommendation: string;
        }> = [];

        let totalUnderpaidAmount = 0;
        let totalWorthDisputing = 0;

        for (const li of matchedLineItems) {
          const paidAmt = parseFloat(String(li.paidAmount || '0'));
          const billedAmt = parseFloat(String(li.chargedAmount || '0'));

          // Look up expected reimbursement from fee schedule
          let expectedReimbursement: number | null = null;

          // First check if claim already has expectedAmount set
          if (li.claimExpectedAmount) {
            expectedReimbursement = parseFloat(String(li.claimExpectedAmount));
          }

          // Otherwise look up from fee schedule
          if (expectedReimbursement === null && li.cptCode && li.payerName) {
            try {
              const today = new Date().toISOString().split('T')[0];
              const feeEntries = await db
                .select()
                .from(feeSchedules)
                .where(
                  and(
                    eq(feeSchedules.practiceId, practiceId),
                    eq(feeSchedules.cptCode, li.cptCode),
                    ilike(feeSchedules.payerName, `%${li.payerName}%`),
                    lte(feeSchedules.effectiveDate, today),
                  )
                )
                .orderBy(desc(feeSchedules.effectiveDate))
                .limit(1);

              if (feeEntries.length > 0) {
                expectedReimbursement = parseFloat(String(feeEntries[0].expectedReimbursement));
              }
            } catch {
              // Non-blocking
            }
          }

          // Parse adjustment reason codes from stored JSON
          const adjustmentCodes = Array.isArray(li.adjustmentReasonCodes)
            ? (li.adjustmentReasonCodes as Array<{ code: string; description?: string; amount?: number }>)
            : [];

          // Build adjustments with amounts - if individual amounts not stored, distribute total
          const totalAdjustmentAmount = parseFloat(String(li.adjustmentAmount || '0'));
          const adjustmentsWithAmounts = adjustmentCodes.map((adj, idx) => {
            const adjAmount = typeof adj.amount === 'number' ? adj.amount : (
              adjustmentCodes.length > 0 ? totalAdjustmentAmount / adjustmentCodes.length : 0
            );
            return { code: adj.code || '', amount: adjAmount };
          });

          const assessment = assessUnderpayment({
            adjustments: adjustmentsWithAmounts,
            billedAmount: billedAmt,
            paidAmount: paidAmt,
            expectedReimbursement,
            claimId: li.claimId || undefined,
            cptCode: li.cptCode || undefined,
          });

          if (assessment.isUnderpaid) {
            totalUnderpaidAmount += assessment.underpaymentAmount;
            if (assessment.worthDisputing) totalWorthDisputing++;

            underpayments.push({
              claimId: li.claimId!,
              claimNumber: li.claimNumber,
              patientName: li.patientName,
              cptCode: li.cptCode,
              payerName: li.payerName,
              serviceDate: li.serviceDate,
              billedAmount: billedAmt,
              expectedReimbursement,
              paidAmount: paidAmt,
              underpaymentAmount: assessment.underpaymentAmount,
              adjustmentAnalysis: assessment.adjustmentAnalyses.map((a) => ({
                code: a.code,
                description: a.description,
                amount: a.amount,
                category: a.category,
                disputable: a.disputable,
                explanation: a.explanation,
              })),
              worthDisputing: assessment.worthDisputing,
              recommendation: assessment.recommendation,
            });
          }
        }

        return JSON.stringify({
          totalLineItemsReviewed: matchedLineItems.length,
          totalUnderpayments: underpayments.length,
          totalUnderpaidAmount: `$${totalUnderpaidAmount.toFixed(2)}`,
          totalWorthDisputing,
          underpayments: underpayments.slice(0, 20), // Limit to 20 for response size
          message: underpayments.length > 0
            ? `Found ${underpayments.length} underpaid claim(s) totaling $${totalUnderpaidAmount.toFixed(2)}. ${totalWorthDisputing} appear(s) worth disputing. I can draft dispute letters for any of them.`
            : 'No underpayments detected in matched remittance data. All payments appear to be in line with expected reimbursement rates.',
        });
      }

      case 'draft_underpayment_dispute': {
        const disputeClaimId = args.claimId as number;
        if (!disputeClaimId) return JSON.stringify({ error: 'Please provide a claim ID.' });

        const disputeClaim = await storage.getClaim(disputeClaimId);
        if (!disputeClaim) return JSON.stringify({ error: `Claim ${disputeClaimId} not found.` });
        if (disputeClaim.practiceId !== practiceId) return JSON.stringify({ error: 'Claim does not belong to this practice.' });

        // Get patient info
        let disputePatient = { firstName: 'Unknown', lastName: 'Patient', dateOfBirth: null as string | null, insuranceProvider: null as string | null, insuranceId: null as string | null };
        if (disputeClaim.patientId) {
          const pat = await storage.getPatient(disputeClaim.patientId);
          if (pat) {
            disputePatient = {
              firstName: pat.firstName,
              lastName: pat.lastName,
              dateOfBirth: pat.dateOfBirth,
              insuranceProvider: pat.insuranceProvider,
              insuranceId: pat.insuranceId || pat.policyNumber || null,
            };
          }
        }

        // Get practice info
        const disputePractice = await storage.getPractice(practiceId);

        // Find the remittance line item(s) matched to this claim
        const matchedRemitItems = await db
          .select({
            lineItemId: remittanceLineItems.id,
            cptCode: remittanceLineItems.cptCode,
            chargedAmount: remittanceLineItems.chargedAmount,
            allowedAmount: remittanceLineItems.allowedAmount,
            paidAmount: remittanceLineItems.paidAmount,
            adjustmentAmount: remittanceLineItems.adjustmentAmount,
            adjustmentReasonCodes: remittanceLineItems.adjustmentReasonCodes,
            remarkCodes: remittanceLineItems.remarkCodes,
            serviceDate: remittanceLineItems.serviceDate,
            payerName: remittanceAdvice.payerName,
            payerId: remittanceAdvice.payerId,
            checkNumber: remittanceAdvice.checkNumber,
            checkDate: remittanceAdvice.checkDate,
          })
          .from(remittanceLineItems)
          .innerJoin(remittanceAdvice, eq(remittanceLineItems.remittanceId, remittanceAdvice.id))
          .where(eq(remittanceLineItems.claimId, disputeClaimId));

        if (matchedRemitItems.length === 0) {
          return JSON.stringify({
            error: 'No remittance/ERA data found for this claim. Upload and match an ERA file first, then try again.',
          });
        }

        const remitItem = matchedRemitItems[0];
        const paidAmt = parseFloat(String(remitItem.paidAmount || '0'));
        const billedAmt = parseFloat(String(remitItem.chargedAmount || '0'));
        const payerName = remitItem.payerName || disputePatient.insuranceProvider || 'Insurance Company';

        // Look up expected reimbursement from fee schedule
        let expectedReimbursement: number | null = null;
        let feeScheduleSource = '';

        if (disputeClaim.expectedAmount) {
          expectedReimbursement = parseFloat(String(disputeClaim.expectedAmount));
          feeScheduleSource = 'claim expected amount';
        }

        if (expectedReimbursement === null && remitItem.cptCode) {
          try {
            const today = new Date().toISOString().split('T')[0];
            const feeEntries = await db
              .select()
              .from(feeSchedules)
              .where(
                and(
                  eq(feeSchedules.practiceId, practiceId),
                  eq(feeSchedules.cptCode, remitItem.cptCode),
                  ilike(feeSchedules.payerName, `%${payerName}%`),
                  lte(feeSchedules.effectiveDate, today),
                )
              )
              .orderBy(desc(feeSchedules.effectiveDate))
              .limit(1);

            if (feeEntries.length > 0) {
              expectedReimbursement = parseFloat(String(feeEntries[0].expectedReimbursement));
              feeScheduleSource = `fee schedule (effective ${feeEntries[0].effectiveDate})`;
            }
          } catch {
            // Non-blocking
          }
        }

        // Analyze adjustment codes
        const adjustmentCodes = Array.isArray(remitItem.adjustmentReasonCodes)
          ? (remitItem.adjustmentReasonCodes as Array<{ code: string; description?: string; amount?: number }>)
          : [];

        const totalAdjustmentAmount = parseFloat(String(remitItem.adjustmentAmount || '0'));
        const adjustmentsWithAmounts = adjustmentCodes.map((adj) => {
          const adjAmount = typeof adj.amount === 'number' ? adj.amount : (
            adjustmentCodes.length > 0 ? totalAdjustmentAmount / adjustmentCodes.length : 0
          );
          return { code: adj.code || '', amount: adjAmount };
        });

        const assessment = assessUnderpayment({
          adjustments: adjustmentsWithAmounts,
          billedAmount: billedAmt,
          paidAmount: paidAmt,
          expectedReimbursement,
          claimId: disputeClaimId,
          cptCode: remitItem.cptCode || undefined,
        });

        // Build the dispute context for Blanche to draft a letter
        const underpaymentAmount = expectedReimbursement ? (expectedReimbursement - paidAmt) : (billedAmt - paidAmt);

        const disputeContext = {
          claimId: disputeClaim.id,
          claimNumber: disputeClaim.claimNumber,
          patientName: `${disputePatient.firstName} ${disputePatient.lastName}`,
          patientDOB: disputePatient.dateOfBirth,
          memberId: disputePatient.insuranceId,
          payerName,
          payerId: remitItem.payerId,
          checkNumber: remitItem.checkNumber,
          checkDate: remitItem.checkDate,
          serviceDate: remitItem.serviceDate,
          cptCode: remitItem.cptCode,
          billedAmount: `$${billedAmt.toFixed(2)}`,
          allowedAmount: remitItem.allowedAmount ? `$${parseFloat(String(remitItem.allowedAmount)).toFixed(2)}` : null,
          paidAmount: `$${paidAmt.toFixed(2)}`,
          expectedReimbursement: expectedReimbursement ? `$${expectedReimbursement.toFixed(2)}` : 'Not available — no fee schedule entry found',
          feeScheduleSource,
          underpaymentAmount: `$${underpaymentAmount.toFixed(2)}`,
          adjustmentAnalysis: assessment.adjustmentAnalyses.map((a) => ({
            code: a.code,
            description: a.description,
            amount: `$${a.amount.toFixed(2)}`,
            category: a.category,
            disputable: a.disputable,
            explanation: a.explanation,
            recommendedAction: a.recommendedAction,
          })),
          patientResponsibilityTotal: `$${assessment.patientResponsibilityTotal.toFixed(2)}`,
          contractualAdjustmentTotal: `$${assessment.contractualAdjustmentTotal.toFixed(2)}`,
          payerInitiatedTotal: `$${assessment.payerInitiatedTotal.toFixed(2)}`,
          worthDisputing: assessment.worthDisputing,
          practiceName: disputePractice?.name || 'Practice',
          practiceNPI: disputePractice?.npi || null,
          practiceAddress: disputePractice?.address || null,
          practicePhone: disputePractice?.phone || null,
        };

        // Generate the dispute letter text
        const disputeLetter = generateDisputeLetterText(disputeContext);

        return JSON.stringify({
          ...disputeContext,
          disputeLetter,
          recommendedActions: [
            assessment.worthDisputing ? 'Submit this dispute letter to the payer via their provider dispute process' : 'This may not be worth disputing — the adjustments appear standard',
            'Keep a copy of the dispute letter and all supporting documentation',
            'Follow up with the payer in 30 days if no response received',
            expectedReimbursement ? 'Reference the contracted rate from your fee schedule as evidence' : 'Consider adding fee schedule entries for this payer/CPT combination to enable better tracking',
          ],
          message: assessment.worthDisputing
            ? 'Dispute letter drafted. Review and customize before sending to the payer. The letter references your contracted rate and identifies the specific adjustment codes that appear incorrect.'
            : 'I\'ve drafted a dispute letter, but note that the adjustments on this claim may be standard contractual adjustments. Review the analysis carefully before deciding to dispute.',
        });
      }

      case 'send_patient_portal_invite': {
        let patientId = args.patientId as number | undefined;

        if (!patientId && args.patientName) {
          const allPatients = await storage.getPatients(practiceId);
          const match = allPatients.find((p: any) =>
            `${p.firstName} ${p.lastName}`.toLowerCase().includes((args.patientName as string).toLowerCase()),
          );
          if (!match) return JSON.stringify({ error: `Patient "${args.patientName}" not found.` });
          patientId = match.id;
        }

        if (!patientId) return JSON.stringify({ error: 'Please provide a patient name or ID.' });

        const patient = await storage.getPatient(patientId);
        if (!patient) return JSON.stringify({ error: 'Patient not found.' });
        if (patient.practiceId !== practiceId) return JSON.stringify({ error: 'Patient does not belong to your practice.' });
        const inviteDemoBlock = rejectIfDemoData(patient, 'patient');
        if (inviteDemoBlock) return inviteDemoBlock;
        if (!patient.email) return JSON.stringify({ error: `${patient.firstName} ${patient.lastName} has no email on file. Add an email before sending a portal invite.` });

        // Reuse existing portal-invite plumbing (see server/routes/patients.ts /:id/send-portal-link)
        let access = await storage.getPatientPortalAccess(patientId);
        if (!access) {
          access = await storage.createPatientPortalAccess(patientId, practiceId);
        }
        const magicLink = await storage.createMagicLink(patientId);

        const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
        const portalUrl = `${baseUrl}/portal/login/${magicLink.token}`;

        const practice = await storage.getPractice(practiceId);
        const practiceName = practice?.name || 'Your Healthcare Provider';

        const { portalWelcome } = await import('../services/emailTemplates');
        const { sendEmail } = await import('../services/emailService');

        const { subject, html, text } = portalWelcome({
          patientName: patient.firstName,
          practiceName,
          portalUrl,
        });

        const emailResult = await sendEmail({
          to: patient.email,
          subject,
          html,
          text,
          fromName: practiceName,
        });

        if (!emailResult.success) {
          return JSON.stringify({
            error: `Portal link created but email failed: ${emailResult.error || 'unknown error'}`,
            portalUrl,
          });
        }

        return JSON.stringify({
          success: true,
          patient: `${patient.firstName} ${patient.lastName}`,
          email: patient.email,
          message: `Portal invitation sent to ${patient.email}.`,
        });
      }

      case 'send_appointment_reminder': {
        const appointmentId = args.appointmentId as number | undefined;
        if (!appointmentId) return JSON.stringify({ error: 'appointmentId is required.' });

        const appointment = await storage.getAppointment(appointmentId);
        if (!appointment) return JSON.stringify({ error: 'Appointment not found.' });
        if (appointment.practiceId !== practiceId) return JSON.stringify({ error: 'Appointment does not belong to your practice.' });
        const reminderApptDemoBlock = rejectIfDemoData(appointment, 'appointment');
        if (reminderApptDemoBlock) return reminderApptDemoBlock;
        if (!appointment.patientId) return JSON.stringify({ error: 'Appointment has no patient assigned.' });

        const patient = await storage.getPatient(appointment.patientId);
        if (!patient) return JSON.stringify({ error: 'Patient not found for this appointment.' });
        const reminderPatientDemoBlock = rejectIfDemoData(patient, 'patient');
        if (reminderPatientDemoBlock) return reminderPatientDemoBlock;

        const practice = await storage.getPractice(practiceId);
        const practiceName = practice?.name || 'Your Practice';

        const channel = ((args.channel as string) || 'both').toLowerCase();
        const wantEmail = channel === 'email' || channel === 'both';
        const wantSms = channel === 'sms' || channel === 'both';

        // Reuse existing reminder plumbing (see server/services/appointmentReminderService.ts)
        const { sendAppointmentReminderSMS, isSMSConfigured } = await import('../services/smsService');
        const { sendEmail } = await import('../services/emailService');
        const { appointmentReminder } = await import('../services/emailTemplates');
        const { isEmailConfigured } = await import('../email');

        const startTime = new Date(appointment.startTime);
        const appointmentTime = startTime.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });

        let emailSent = false;
        let smsSent = false;
        const errors: string[] = [];

        if (wantEmail && patient.email) {
          if (!isEmailConfigured()) {
            errors.push('Email not configured for this practice.');
          } else {
            const { subject, html, text } = appointmentReminder({
              patientName: patient.firstName,
              appointmentDate: startTime,
              appointmentTime,
              providerName: undefined,
              practiceName,
              practiceAddress: practice?.address || undefined,
              practicePhone: practice?.phone || undefined,
            });
            const emailResult = await sendEmail({
              to: patient.email,
              subject,
              html,
              text,
              fromName: practiceName,
            });
            emailSent = emailResult.success;
            if (!emailResult.success) errors.push(`Email: ${emailResult.error || 'failed'}`);
          }
        }

        if (wantSms && patient.phone) {
          if (!isSMSConfigured()) {
            errors.push('SMS not configured for this practice.');
          } else {
            const smsResult = await sendAppointmentReminderSMS(
              patient.phone,
              patient.firstName,
              startTime,
              practiceName,
              practice?.phone || undefined,
            );
            smsSent = smsResult.success;
            if (!smsResult.success) errors.push(`SMS: ${smsResult.error || 'failed'}`);
          }
        }

        if (!emailSent && !smsSent) {
          return JSON.stringify({
            error: `Could not send reminder. ${errors.length ? errors.join(' ') : 'Patient has no email or phone on file for the requested channel.'}`,
          });
        }

        if (emailSent || smsSent) {
          try {
            await storage.updateAppointment(appointmentId, { reminderSent: true });
          } catch {
            // non-fatal
          }
        }

        return JSON.stringify({
          success: true,
          appointmentId,
          patient: `${patient.firstName} ${patient.lastName}`,
          emailSent,
          smsSent,
          warnings: errors.length ? errors : undefined,
          message: `Reminder sent for appointment on ${startTime.toLocaleDateString()} at ${appointmentTime} (${[emailSent && 'email', smsSent && 'SMS'].filter(Boolean).join(' + ')}).`,
        });
      }

      case 'check_claim_status': {
        const claimIdArg = args.claimId as number | undefined;
        const claimNumberArg = args.claimNumber as string | undefined;

        if (!claimIdArg && !claimNumberArg) {
          return JSON.stringify({ error: 'Please provide a claimId or claimNumber.' });
        }

        // Resolve claim
        let claim: any | undefined;
        if (claimIdArg) {
          claim = await storage.getClaim(claimIdArg);
        } else if (claimNumberArg) {
          const allClaims = await storage.getClaims(practiceId, { limit: 5000 });
          claim = allClaims.find((c: any) => c.claimNumber === claimNumberArg);
        }

        if (!claim) {
          return JSON.stringify({ error: `Claim not found.` });
        }

        // Practice ownership check
        if (claim.practiceId !== practiceId) {
          return JSON.stringify({ error: 'Claim does not belong to this practice.' });
        }

        if (claim.status === 'draft') {
          return JSON.stringify({
            error: 'This claim is still in draft status and has not been submitted yet. There is no clearinghouse status to check.',
          });
        }

        const patient = await storage.getPatient(claim.patientId);
        const practice = await storage.getPractice(practiceId);

        let insurance: any = null;
        if (claim.insuranceId) {
          insurance = await storage.getInsurance(claim.insuranceId);
        }

        if (!patient) {
          return JSON.stringify({ error: 'Patient record for this claim is missing.' });
        }

        const stediService = await import('../services/stediService');
        const stediKeyInfo = await stediService.getStediApiKeyForPractice(practiceId).catch(() => null);
        const stediApiKey = stediKeyInfo?.apiKey || process.env.STEDI_API_KEY;

        if (!stediApiKey) {
          return JSON.stringify({
            error: 'Clearinghouse (Stedi) is not configured. Status check unavailable.',
          });
        }

        try {
          const lineItems = await storage.getClaimLineItems(claim.id);
          const dateOfService = lineItems[0]?.dateOfService || new Date().toISOString().split('T')[0];

          // Resolve payer trading-partner ID
          const payerRouting = await stediService.resolvePayerId(
            insurance?.name || patient.insuranceProvider || '',
            patient.insuranceProvider || null,
            insurance?.payerCode || null,
          );

          const statusResult = await stediService.checkClaimStatus(
            {
              claimId: claim.claimNumber || `CLM${claim.id}`,
              payer: { id: payerRouting.tradingPartnerId },
              provider: {
                npi: practice?.npi || '',
                taxId: practice?.taxId || '',
              },
              subscriber: {
                memberId: patient.insuranceId || patient.policyNumber || '',
                firstName: patient.firstName,
                lastName: patient.lastName,
                dateOfBirth: patient.dateOfBirth || '',
              },
              dateOfService,
              claimAmount: parseFloat(String(claim.totalAmount)),
            },
            practiceId,
          );

          if (statusResult.errors && statusResult.errors.length > 0 && statusResult.status === 'unknown') {
            // Log the unredacted error for debugging; only return a sanitized version to the assistant.
            logger.warn('check_claim_status: clearinghouse error', {
              practiceId,
              claimId: claim.id,
              errors: statusResult.errors,
            });
            return JSON.stringify({
              error: `Clearinghouse status check failed: ${sanitizeExternalErrors(statusResult.errors).join('; ')}`,
            });
          }

          return JSON.stringify({
            success: true,
            claimNumber: claim.claimNumber,
            payer: insurance?.name || patient.insuranceProvider || 'Unknown',
            currentStatus: statusResult.status,
            statusCategoryCode: statusResult.statusCategoryCode,
            statusCategoryValue: statusResult.statusCategoryValue,
            statusCode: statusResult.statusCode,
            statusDescription: statusResult.statusDescription,
            lastStatusDate: statusResult.paidDate || new Date().toISOString().split('T')[0],
            paidAmount: statusResult.paidAmount,
            paidDate: statusResult.paidDate,
            checkNumber: statusResult.checkNumber,
            denialReason: statusResult.denialReason,
            totalBilled: claim.totalAmount,
            patient: `${patient.firstName} ${patient.lastName}`,
            errors: sanitizeExternalErrors(statusResult.errors),
            message: `Claim ${claim.claimNumber} status from ${insurance?.name || patient.insuranceProvider || 'payer'}: ${statusResult.statusCategoryValue || statusResult.status}.`,
          });
        } catch (err: any) {
          logger.warn('check_claim_status: exception', {
            practiceId,
            claimId: claim.id,
            error: err?.message,
          });
          return JSON.stringify({
            error: `Failed to check claim status: ${sanitizeExternalError(err?.message)}`,
          });
        }
      }

      case 'create_patient_invoice': {
        if (!stripeService.isStripeConfigured()) {
          return JSON.stringify({ error: 'Stripe is not configured. Set STRIPE_SECRET_KEY to enable patient invoicing.' });
        }

        const patientId = args.patientId as number | undefined;
        const amount = args.amount as number | undefined;
        const description = args.description as string | undefined;

        if (!patientId) return JSON.stringify({ error: 'patientId is required.' });
        if (typeof amount !== 'number' || amount <= 0) return JSON.stringify({ error: 'amount (in dollars) must be a positive number.' });
        // Hard cap to prevent runaway invoices from LLM error or prompt injection.
        // Anything above this should be created in the UI with an explicit human review.
        const INVOICE_MAX_DOLLARS = 10000;
        if (amount > INVOICE_MAX_DOLLARS) {
          return JSON.stringify({
            error: `Invoice amount $${amount.toFixed(2)} exceeds the assistant's $${INVOICE_MAX_DOLLARS.toLocaleString()} limit. Please create invoices over this amount through the billing UI.`,
          });
        }
        if (!description) return JSON.stringify({ error: 'description is required.' });

        const patient = await storage.getPatient(patientId);
        if (!patient) return JSON.stringify({ error: 'Patient not found.' });
        if ((patient as any).practiceId !== practiceId) {
          return JSON.stringify({ error: 'Access denied: patient belongs to a different practice.' });
        }
        const invoiceDemoBlock = rejectIfDemoData(patient, 'patient');
        if (invoiceDemoBlock) return invoiceDemoBlock;

        if (args.claimId) {
          const claim = await storage.getClaim(args.claimId as number);
          if (!claim || (claim as any).practiceId !== practiceId) {
            return JSON.stringify({ error: 'Linked claim not found or belongs to a different practice.' });
          }
        }

        const paymentIntent = await stripeService.createPatientPaymentIntent({
          amount: Math.round(amount * 100),
          patientEmail: (patient as any).email || '',
          patientName: `${patient.firstName || ''} ${patient.lastName || ''}`.trim(),
          practiceId,
          patientId,
          claimId: args.claimId as number | undefined,
          description,
        });

        return JSON.stringify({
          success: true,
          invoice: {
            id: paymentIntent.id,
            status: paymentIntent.status,
            amount,
            currency: paymentIntent.currency,
            description,
            patientName: `${patient.firstName} ${patient.lastName}`,
            patientId,
            claimId: args.claimId || null,
          },
          message: `Invoice for $${amount.toFixed(2)} created for ${patient.firstName} ${patient.lastName}. Use send_patient_payment_link to send the patient a payment link.`,
        });
      }

      case 'send_patient_payment_link': {
        if (!stripeService.isStripeConfigured()) {
          return JSON.stringify({ error: 'Stripe is not configured. Set STRIPE_SECRET_KEY to enable patient payment links.' });
        }

        const patientId = args.patientId as number | undefined;
        const invoiceId = args.invoiceId as string | undefined;
        const amount = args.amount as number | undefined;

        if (!patientId) return JSON.stringify({ error: 'patientId is required.' });
        if (!invoiceId && (typeof amount !== 'number' || amount <= 0)) {
          return JSON.stringify({ error: 'Either invoiceId or a positive amount (in dollars) is required.' });
        }

        const patient = await storage.getPatient(patientId);
        if (!patient) return JSON.stringify({ error: 'Patient not found.' });
        if ((patient as any).practiceId !== practiceId) {
          return JSON.stringify({ error: 'Access denied: patient belongs to a different practice.' });
        }
        const linkDemoBlock = rejectIfDemoData(patient, 'patient');
        if (linkDemoBlock) return linkDemoBlock;

        // Resolve charge amount: from invoice (Stripe payment intent) if invoiceId provided, else use amount
        let chargeAmountCents: number;
        let resolvedDescription: string;

        if (invoiceId) {
          try {
            const stripe = stripeService.getStripeInstance();
            const intent = await stripe.paymentIntents.retrieve(invoiceId);
            // Require metadata to be present AND match. An intent without our
            // metadata didn't originate from this app and must not be reused.
            if (intent.metadata?.practiceId !== String(practiceId)) {
              return JSON.stringify({ error: 'Invoice not found for this practice.' });
            }
            if (intent.metadata?.patientId !== String(patientId)) {
              return JSON.stringify({ error: 'Invoice is for a different patient.' });
            }
            chargeAmountCents = intent.amount;
            resolvedDescription = (args.message as string) || intent.description || `Payment for ${patient.firstName} ${patient.lastName}`;
          } catch (err) {
            return JSON.stringify({ error: `Could not retrieve invoice ${invoiceId}: ${err instanceof Error ? err.message : 'Unknown error'}` });
          }
        } else {
          chargeAmountCents = Math.round((amount as number) * 100);
          resolvedDescription = (args.message as string) || `Payment for ${patient.firstName} ${patient.lastName}`;
        }

        const paymentLink = await stripeService.createPatientPaymentLink({
          amount: chargeAmountCents,
          patientName: `${patient.firstName || ''} ${patient.lastName || ''}`.trim(),
          practiceId,
          patientId,
          description: resolvedDescription,
        });

        return JSON.stringify({
          success: true,
          paymentLink: {
            url: paymentLink.url,
            id: paymentLink.id,
            amount: chargeAmountCents / 100,
            patientName: `${patient.firstName} ${patient.lastName}`,
            patientId,
            invoiceId: invoiceId || null,
          },
          message: `Payment link created for ${patient.firstName} ${patient.lastName} ($${(chargeAmountCents / 100).toFixed(2)}). Share this URL with the patient: ${paymentLink.url}`,
        });
      }

      case 'summarize_recent_eobs': {
        const filterPatientId = typeof args.patientId === 'number' ? args.patientId : undefined;
        const daysBack = Number(args.daysBack) || 30;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysBack);

        // If a patientId is provided, validate it belongs to this practice
        if (filterPatientId !== undefined) {
          const pat = await storage.getPatient(filterPatientId);
          if (!pat || pat.practiceId !== practiceId) {
            return JSON.stringify({ error: `Patient ${filterPatientId} not found in this practice.` });
          }
        }

        // Fetch EOB documents for this practice in the time window
        const whereClauses = [
          eq(patientPlanDocuments.practiceId, practiceId),
          eq(patientPlanDocuments.documentType, 'eob'),
          gte(patientPlanDocuments.createdAt, cutoffDate),
        ];
        if (filterPatientId !== undefined) {
          whereClauses.push(eq(patientPlanDocuments.patientId, filterPatientId));
        }

        const eobDocs = await db
          .select({
            id: patientPlanDocuments.id,
            patientId: patientPlanDocuments.patientId,
            fileName: patientPlanDocuments.fileName,
            status: patientPlanDocuments.status,
            parsedAt: patientPlanDocuments.parsedAt,
            createdAt: patientPlanDocuments.createdAt,
            patientFirstName: patients.firstName,
            patientLastName: patients.lastName,
          })
          .from(patientPlanDocuments)
          .innerJoin(patients, eq(patientPlanDocuments.patientId, patients.id))
          .where(and(...whereClauses))
          .orderBy(desc(patientPlanDocuments.createdAt))
          .limit(50);

        if (eobDocs.length === 0) {
          return JSON.stringify({
            count: 0,
            eobs: [],
            message: filterPatientId !== undefined
              ? `No EOBs uploaded for this patient in the last ${daysBack} days.`
              : `No EOBs have been uploaded in the last ${daysBack} days. Patients can upload EOBs through the patient portal documents flow.`,
          });
        }

        // Pull benefits rows linked to each EOB document
        const docIds: number[] = eobDocs.map((d: typeof eobDocs[number]) => d.id);
        const benefitsRows = docIds.length > 0
          ? await db
              .select()
              .from(patientPlanBenefits)
              .where(
                and(
                  eq(patientPlanBenefits.practiceId, practiceId),
                  sql`${patientPlanBenefits.documentId} IN (${sql.join(docIds.map((id: number) => sql`${id}`), sql`, `)})`,
                )
              )
          : [];
        const benefitsByDoc = new Map<number, typeof benefitsRows[number]>();
        for (const b of benefitsRows) {
          if (b.documentId != null) benefitsByDoc.set(b.documentId, b);
        }

        const eobs = eobDocs.map((doc: typeof eobDocs[number]) => {
          const benefits = benefitsByDoc.get(doc.id);
          const raw = (benefits?.rawExtractedData as Record<string, any> | null) || null;
          // Pull accumulator and recent-claims fields from raw JSON (parser stashes them there)
          const innDeductibleMet = raw?.inn_deductible_met ?? raw?.accumulators?.inn_deductible_met ?? null;
          const innOutOfPocketMet = raw?.inn_out_of_pocket_met ?? raw?.accumulators?.inn_out_of_pocket_met ?? null;
          const oonDeductibleMet = benefits?.oonDeductibleMet
            ?? raw?.oon_deductible_met
            ?? raw?.accumulators?.oon_deductible_met
            ?? null;
          const oonOutOfPocketMet = benefits?.oonOutOfPocketMet
            ?? raw?.oon_out_of_pocket_met
            ?? raw?.accumulators?.oon_out_of_pocket_met
            ?? null;
          const asOfDate = raw?.accumulator_as_of_date ?? raw?.accumulators?.as_of_date ?? null;
          const recentClaimsRaw = Array.isArray(raw?.recent_claims)
            ? raw.recent_claims
            : Array.isArray(raw?.eob_claims)
              ? raw.eob_claims
              : [];
          const recentClaims = recentClaimsRaw.slice(0, 6);

          return {
            documentId: doc.id,
            patientId: doc.patientId,
            patientName: `${doc.patientFirstName} ${doc.patientLastName}`,
            fileName: doc.fileName,
            status: doc.status,
            uploadedAt: doc.createdAt,
            parsedAt: doc.parsedAt,
            payerName: benefits?.insuranceProvider ?? null,
            planName: benefits?.planName ?? null,
            accumulators: {
              innDeductibleIndividual: benefits?.innDeductibleIndividual ?? null,
              innDeductibleMet,
              innOutOfPocketMax: benefits?.innOutOfPocketMax ?? null,
              innOutOfPocketMet,
              oonDeductibleIndividual: benefits?.oonDeductibleIndividual ?? null,
              oonDeductibleMet,
              oonOutOfPocketMax: benefits?.oonOutOfPocketMax ?? null,
              oonOutOfPocketMet,
              asOfDate,
            },
            recentClaims,
            parsed: !!benefits,
          };
        });

        return JSON.stringify({
          count: eobs.length,
          windowDays: daysBack,
          eobs,
          message: `Found ${eobs.length} EOB${eobs.length === 1 ? '' : 's'} uploaded in the last ${daysBack} days. Accumulator data is extracted from parsed EOBs and reflects the patient's deductible/out-of-pocket progress as of the EOB process date.`,
        });
      }

      case 'check_plan_document_status': {
        const targetPatientId = typeof args.patientId === 'number' ? args.patientId : undefined;
        if (!targetPatientId) {
          return JSON.stringify({ error: 'Please provide a patient ID.' });
        }

        const patient = await storage.getPatient(targetPatientId);
        if (!patient) {
          return JSON.stringify({ error: `Patient ${targetPatientId} not found.` });
        }
        if (patient.practiceId !== practiceId) {
          return JSON.stringify({ error: 'Patient does not belong to this practice.' });
        }

        const allDocs = await storage.getPlanDocuments(targetPatientId);
        // Only consider documents in this practice (defense in depth)
        const docs = allDocs.filter((d: typeof allDocs[number]) => d.practiceId === practiceId);

        if (docs.length === 0) {
          return JSON.stringify({
            patientId: targetPatientId,
            patientName: `${patient.firstName} ${patient.lastName}`,
            hasPlanDocument: false,
            hasSbc: false,
            documents: [],
            benefits: null,
            missingFields: [
              'planName', 'planType', 'insuranceProvider',
              'innDeductibleIndividual', 'innCoinsurancePercent', 'innOutOfPocketMax',
              'oonDeductibleIndividual', 'oonCoinsurancePercent', 'oonOutOfPocketMax',
              'mentalHealthVisitLimit', 'mentalHealthPriorAuthRequired', 'mentalHealthParity',
              'teleHealthCovered',
            ],
            message: `No plan documents on file for ${patient.firstName} ${patient.lastName}. Ask the patient to upload an SBC (Summary of Benefits and Coverage) through the patient portal — it unlocks accurate per-session cost estimates and stronger appeal arguments.`,
          });
        }

        const sbcDocs = docs.filter((d: typeof docs[number]) => d.documentType === 'sbc');
        const eobDocs = docs.filter((d: typeof docs[number]) => d.documentType === 'eob');
        const otherDocs = docs.filter((d: typeof docs[number]) => d.documentType !== 'sbc' && d.documentType !== 'eob');

        const benefits = await storage.getPatientPlanBenefits(targetPatientId);
        const raw = (benefits?.rawExtractedData as Record<string, any> | null) || null;

        // Determine missing fields — anything important that's null/undefined
        const importantFieldKeys: string[] = [
          'planName', 'planType', 'insuranceProvider',
          'innDeductibleIndividual', 'innCoinsurancePercent', 'innOutOfPocketMax',
          'oonDeductibleIndividual', 'oonCoinsurancePercent', 'oonOutOfPocketMax',
          'mentalHealthVisitLimit', 'mentalHealthPriorAuthRequired', 'mentalHealthParity',
          'teleHealthCovered', 'allowedAmountMethod',
        ];

        const missingFields: string[] = [];
        if (benefits) {
          for (const key of importantFieldKeys) {
            const v = (benefits as any)[key];
            if (v === null || v === undefined || v === '') missingFields.push(key);
          }
        }

        return JSON.stringify({
          patientId: targetPatientId,
          patientName: `${patient.firstName} ${patient.lastName}`,
          hasPlanDocument: docs.length > 0,
          hasSbc: sbcDocs.length > 0,
          counts: {
            sbc: sbcDocs.length,
            eob: eobDocs.length,
            other: otherDocs.length,
          },
          documents: docs.map((d: typeof docs[number]) => ({
            id: d.id,
            documentType: d.documentType,
            fileName: d.fileName,
            status: d.status,
            uploadedAt: d.createdAt,
            parsedAt: d.parsedAt,
            parseError: d.parseError,
          })),
          benefits: benefits ? {
            id: benefits.id,
            planName: benefits.planName,
            planType: benefits.planType,
            insuranceProvider: benefits.insuranceProvider,
            groupNumber: benefits.groupNumber,
            policyNumber: benefits.policyNumber,
            effectiveDate: benefits.effectiveDate,
            terminationDate: benefits.terminationDate,
            innDeductibleIndividual: benefits.innDeductibleIndividual,
            innCoinsurancePercent: benefits.innCoinsurancePercent,
            innOutOfPocketMax: benefits.innOutOfPocketMax,
            oonDeductibleIndividual: benefits.oonDeductibleIndividual,
            oonDeductibleFamily: benefits.oonDeductibleFamily,
            oonCoinsurancePercent: benefits.oonCoinsurancePercent,
            oonOutOfPocketMax: benefits.oonOutOfPocketMax,
            oonDeductibleMet: benefits.oonDeductibleMet,
            oonOutOfPocketMet: benefits.oonOutOfPocketMet,
            mentalHealthParity: benefits.mentalHealthParity,
            mentalHealthVisitLimit: benefits.mentalHealthVisitLimit,
            mentalHealthVisitsUsed: benefits.mentalHealthVisitsUsed,
            mentalHealthPriorAuthRequired: benefits.mentalHealthPriorAuthRequired,
            mentalHealthCopay: benefits.mentalHealthCopay,
            allowedAmountMethod: benefits.allowedAmountMethod,
            allowedAmountPercent: benefits.allowedAmountPercent,
            teleHealthCovered: benefits.teleHealthCovered,
            teleHealthOonSameAsInPerson: benefits.teleHealthOonSameAsInPerson,
            extractionConfidence: benefits.extractionConfidence,
            innDeductibleMet: raw?.inn_deductible_met ?? raw?.accumulators?.inn_deductible_met ?? null,
            innOutOfPocketMet: raw?.inn_out_of_pocket_met ?? raw?.accumulators?.inn_out_of_pocket_met ?? null,
            accumulatorAsOfDate: raw?.accumulator_as_of_date ?? raw?.accumulators?.as_of_date ?? null,
          } : null,
          missingFields,
          message: benefits
            ? `${patient.firstName} has ${docs.length} plan document(s) on file (${sbcDocs.length} SBC, ${eobDocs.length} EOB). ${missingFields.length === 0 ? 'All key benefit fields were extracted.' : `${missingFields.length} important field(s) are missing — consider asking the patient to upload an additional document.`}`
            : `${patient.firstName} has ${docs.length} document(s) uploaded but parsing has not produced a benefits record yet${docs.some((d) => d.status === 'failed') ? ' (some uploads failed parsing)' : ''}.`,
        });
      }

      case 'get_appeal_outcomes': {
        const daysBack = Number(args.daysBack) || 365;
        const payerNameFilter = typeof args.payerName === 'string' ? args.payerName.trim() : '';
        const horizon = new Date();
        horizon.setDate(horizon.getDate() - daysBack);

        // Pull all resolved (or active) appeals for the practice in window.
        const appealRows = await db
          .select({
            id: appeals.id,
            claimId: appeals.claimId,
            status: appeals.status,
            denialCategory: appeals.denialCategory,
            keyArguments: appeals.keyArguments,
            appealedAmount: appeals.appealedAmount,
            recoveredAmount: appeals.recoveredAmount,
            createdAt: appeals.createdAt,
          })
          .from(appeals)
          .where(and(
            eq(appeals.practiceId, practiceId),
            gte(appeals.createdAt, horizon),
          ));

        // Build a claimId -> payerName map for grouping (and filtering).
        const claimIds: number[] = Array.from(new Set(
          appealRows.map((r: any) => r.claimId).filter((v: any): v is number => typeof v === 'number')
        ));
        const claimToPayer = new Map<number, string>();
        if (claimIds.length > 0) {
          const claimRows = await db
            .select({ id: claims.id, insuranceId: claims.insuranceId })
            .from(claims)
            .where(and(eq(claims.practiceId, practiceId), inArray(claims.id, claimIds)));
          const insuranceIds: number[] = Array.from(new Set(
            claimRows.map((c: any) => c.insuranceId).filter((v: any): v is number => typeof v === 'number')
          ));
          const insuranceNameById = new Map<number, string>();
          if (insuranceIds.length > 0) {
            const insRows = await db
              .select({ id: insurances.id, name: insurances.name })
              .from(insurances)
              .where(inArray(insurances.id, insuranceIds));
            for (const ins of insRows) {
              if (typeof ins.name === 'string') insuranceNameById.set(ins.id, ins.name);
            }
          }
          for (const c of claimRows) {
            const name = c.insuranceId != null ? insuranceNameById.get(c.insuranceId) : undefined;
            claimToPayer.set(c.id, name || 'Unknown payer');
          }
        }

        // Filter by payer if requested.
        const filtered = payerNameFilter
          ? appealRows.filter((r: any) => {
              const p = claimToPayer.get(r.claimId) || '';
              return p.toLowerCase().includes(payerNameFilter.toLowerCase());
            })
          : appealRows;

        // Resolved = won/lost/partial (excludes draft/ready/submitted/in_review).
        const resolved = filtered.filter((r: any) =>
          r.status === 'won' || r.status === 'lost' || r.status === 'partial'
        );

        const wonCount = resolved.filter((r: any) => r.status === 'won').length;
        const partialCount = resolved.filter((r: any) => r.status === 'partial').length;
        const lostCount = resolved.filter((r: any) => r.status === 'lost').length;
        const overallWinRate = resolved.length > 0
          ? Math.round(((wonCount + partialCount) / resolved.length) * 1000) / 10
          : null;

        // Win rate by payer (resolved only).
        const byPayer = new Map<string, { won: number; partial: number; lost: number; total: number; recovered: number }>();
        for (const r of resolved) {
          const payer = claimToPayer.get((r as any).claimId) || 'Unknown payer';
          const e = byPayer.get(payer) || { won: 0, partial: 0, lost: 0, total: 0, recovered: 0 };
          e.total += 1;
          if (r.status === 'won') e.won += 1;
          else if (r.status === 'partial') e.partial += 1;
          else if (r.status === 'lost') e.lost += 1;
          const rec = r.recoveredAmount ? Number(r.recoveredAmount) : 0;
          if (!Number.isNaN(rec)) e.recovered += rec;
          byPayer.set(payer, e);
        }
        const winRateByPayer = Array.from(byPayer.entries())
          .map(([payer, e]) => ({
            payer,
            totalAppeals: e.total,
            won: e.won,
            partial: e.partial,
            lost: e.lost,
            winRate: Math.round(((e.won + e.partial) / e.total) * 1000) / 10,
            totalRecovered: Math.round(e.recovered * 100) / 100,
          }))
          .sort((a, b) => b.totalAppeals - a.totalAppeals);

        // Win rate by denial reason / category (resolved only).
        const byCategory = new Map<string, { won: number; partial: number; lost: number; total: number }>();
        for (const r of resolved) {
          const cat = (r as any).denialCategory || 'uncategorized';
          const e = byCategory.get(cat) || { won: 0, partial: 0, lost: 0, total: 0 };
          e.total += 1;
          if (r.status === 'won') e.won += 1;
          else if (r.status === 'partial') e.partial += 1;
          else if (r.status === 'lost') e.lost += 1;
          byCategory.set(cat, e);
        }
        const winRateByDenialReason = Array.from(byCategory.entries())
          .map(([category, e]) => ({
            denialCategory: category,
            totalAppeals: e.total,
            won: e.won,
            partial: e.partial,
            lost: e.lost,
            winRate: Math.round(((e.won + e.partial) / e.total) * 1000) / 10,
          }))
          .sort((a, b) => b.totalAppeals - a.totalAppeals);

        // Top winning argument patterns: tally key_arguments from won/partial.
        const argTally = new Map<string, { winCount: number; totalCount: number }>();
        for (const r of resolved) {
          const argList = (r as any).keyArguments;
          if (!Array.isArray(argList)) continue;
          const isWin = r.status === 'won' || r.status === 'partial';
          for (const raw of argList) {
            if (typeof raw !== 'string') continue;
            const arg = raw.trim().replace(/\s+/g, ' ');
            if (arg.length === 0) continue;
            const e = argTally.get(arg) || { winCount: 0, totalCount: 0 };
            e.totalCount += 1;
            if (isWin) e.winCount += 1;
            argTally.set(arg, e);
          }
        }
        const topWinningArguments = Array.from(argTally.entries())
          .filter(([, e]) => e.winCount > 0)
          .map(([argument, e]) => ({
            argument,
            winCount: e.winCount,
            totalCount: e.totalCount,
            winRate: Math.round((e.winCount / e.totalCount) * 1000) / 10,
          }))
          .sort((a, b) => b.winCount - a.winCount || b.winRate - a.winRate)
          .slice(0, 10);

        return JSON.stringify({
          windowDays: daysBack,
          payerFilter: payerNameFilter || null,
          totalAppeals: filtered.length,
          resolvedAppeals: resolved.length,
          inProgressAppeals: filtered.length - resolved.length,
          won: wonCount,
          partial: partialCount,
          lost: lostCount,
          overallWinRate,
          winRateByPayer,
          winRateByDenialReason,
          topWinningArguments,
          message: resolved.length === 0
            ? 'No resolved appeals in this window yet, so win rates are not available.'
            : `Across ${resolved.length} resolved appeal(s) in the last ${daysBack} day(s), the overall win rate is ${overallWinRate}%.`,
        });
      }

      case 'get_provider_productivity': {
        const endDate = args.endDate ? new Date(String(args.endDate)) : new Date();
        const startDate = args.startDate
          ? new Date(String(args.startDate))
          : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })();
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          return JSON.stringify({ error: 'Invalid startDate or endDate. Use YYYY-MM-DD.' });
        }
        if (endDate.getTime() < startDate.getTime()) {
          return JSON.stringify({ error: 'endDate must be on or after startDate.' });
        }
        // Normalize end-of-day for inclusive end.
        const endInclusive = new Date(endDate);
        endInclusive.setHours(23, 59, 59, 999);
        const providerIdFilter = typeof args.providerId === 'string' && args.providerId.trim().length > 0
          ? args.providerId.trim()
          : null;

        // Get the provider list for the practice (therapists).
        const therapists = await storage.getTherapistsByPractice(practiceId);
        const providerList = providerIdFilter
          ? therapists.filter((t: any) => t.id === providerIdFilter)
          : therapists;

        if (providerList.length === 0) {
          return JSON.stringify({
            startDate: startDate.toISOString().slice(0, 10),
            endDate: endDate.toISOString().slice(0, 10),
            providers: [],
            message: providerIdFilter
              ? 'No therapist found with that providerId in this practice.'
              : 'No therapists found for this practice.',
          });
        }

        const providerIds: string[] = providerList.map((p: any) => p.id).filter((v: any): v is string => typeof v === 'string');

        // Appointments completed (status='completed') by therapist in window.
        const apptRows = await db
          .select({
            therapistId: appointments.therapistId,
            count: sql<number>`count(*)::int`,
          })
          .from(appointments)
          .where(and(
            eq(appointments.practiceId, practiceId),
            eq(appointments.status, 'completed'),
            gte(appointments.startTime, startDate),
            lte(appointments.startTime, endInclusive),
            inArray(appointments.therapistId, providerIds),
          ))
          .groupBy(appointments.therapistId);
        const apptCount = new Map<string, number>();
        for (const row of apptRows) {
          if (row.therapistId) apptCount.set(row.therapistId, Number(row.count) || 0);
        }

        // SOAP notes written: total + unsigned. Notes link to therapist via
        // soap_notes.therapistId (nullable until signed) AND via the parent
        // treatment_session.therapistId. We attribute the note to the
        // SESSION's therapist so unsigned notes are still counted for the
        // right person, and treat "unsigned" as therapistSignedAt IS NULL.
        const soapRows = await db
          .select({
            sessionTherapistId: treatmentSessions.therapistId,
            therapistSignedAt: soapNotes.therapistSignedAt,
          })
          .from(soapNotes)
          .innerJoin(treatmentSessions, eq(soapNotes.sessionId, treatmentSessions.id))
          .where(and(
            eq(treatmentSessions.practiceId, practiceId),
            inArray(treatmentSessions.therapistId, providerIds),
            gte(soapNotes.createdAt, startDate),
            lte(soapNotes.createdAt, endInclusive),
          ));
        const soapTotal = new Map<string, number>();
        const soapUnsigned = new Map<string, number>();
        for (const r of soapRows) {
          const tid = (r as any).sessionTherapistId;
          if (!tid) continue;
          soapTotal.set(tid, (soapTotal.get(tid) || 0) + 1);
          if (!(r as any).therapistSignedAt) {
            soapUnsigned.set(tid, (soapUnsigned.get(tid) || 0) + 1);
          }
        }

        // Claims submitted + total billed: claims attribute to a therapist
        // via the linked treatment session. We count claims past draft status
        // using submittedAt when present, otherwise createdAt. Date filtering
        // is pushed to SQL so practices with years of claims don't load the
        // entire history into memory.
        const claimRows = await db
          .select({
            sessionTherapistId: treatmentSessions.therapistId,
            status: claims.status,
            totalAmount: claims.totalAmount,
          })
          .from(claims)
          .innerJoin(treatmentSessions, eq(claims.sessionId, treatmentSessions.id))
          .where(and(
            eq(claims.practiceId, practiceId),
            inArray(treatmentSessions.therapistId, providerIds),
            sql`${claims.status} <> 'draft'`,
            or(
              and(isNotNull(claims.submittedAt), gte(claims.submittedAt, startDate), lte(claims.submittedAt, endInclusive)),
              and(isNull(claims.submittedAt), gte(claims.createdAt, startDate), lte(claims.createdAt, endInclusive)),
            ),
          ));
        const claimsSubmitted = new Map<string, number>();
        const totalBilled = new Map<string, number>();
        for (const r of claimRows) {
          const tid = (r as any).sessionTherapistId;
          if (!tid) continue;
          claimsSubmitted.set(tid, (claimsSubmitted.get(tid) || 0) + 1);
          const amt = r.totalAmount ? Number(r.totalAmount) : 0;
          if (!Number.isNaN(amt)) totalBilled.set(tid, (totalBilled.get(tid) || 0) + amt);
        }

        const providers = providerList.map((p: any) => {
          const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email || p.id;
          return {
            providerId: p.id,
            name: fullName,
            credentials: p.credentials || null,
            appointmentsCompleted: apptCount.get(p.id) || 0,
            soapNotesWritten: soapTotal.get(p.id) || 0,
            unsignedNotes: soapUnsigned.get(p.id) || 0,
            claimsSubmitted: claimsSubmitted.get(p.id) || 0,
            totalBilled: Math.round((totalBilled.get(p.id) || 0) * 100) / 100,
          };
        }).sort((a, b) => b.appointmentsCompleted - a.appointmentsCompleted);

        return JSON.stringify({
          startDate: startDate.toISOString().slice(0, 10),
          endDate: endDate.toISOString().slice(0, 10),
          providerCount: providers.length,
          providers,
        });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (error) {
    logger.error('AI assistant tool execution error', {
      tool: toolName,
      error: error instanceof Error ? error.message : String(error),
    });
    return JSON.stringify({
      error: `Failed to retrieve data: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

/**
 * Generate a dispute letter for an underpaid claim.
 */
function generateDisputeLetterText(context: {
  claimNumber: string | null;
  patientName: string;
  patientDOB: string | null;
  memberId: string | null;
  payerName: string;
  serviceDate: string | null;
  cptCode: string | null;
  billedAmount: string;
  paidAmount: string;
  expectedReimbursement: string;
  underpaymentAmount: string;
  adjustmentAnalysis: Array<{ code: string; description: string; amount: string; disputable: boolean; explanation: string }>;
  practiceName: string;
  practiceNPI: string | null;
  practiceAddress: string | null;
  practicePhone: string | null;
}): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const disputableAdj = context.adjustmentAnalysis.filter((a) => a.disputable);
  const adjSection = disputableAdj.length > 0
    ? disputableAdj.map((a) =>
        `  - Adjustment ${a.code} (${a.description}): ${a.amount} — ${a.explanation}`
      ).join('\n')
    : '  - No specific disputable adjustment codes identified, but the total payment is below the contracted rate.';

  return `${today}

${context.payerName}
Provider Dispute Department

RE: Underpayment Dispute
Claim Number: ${context.claimNumber || 'N/A'}
Patient: ${context.patientName}
Date of Birth: ${context.patientDOB || 'On file'}
Member ID: ${context.memberId || 'On file'}
Date of Service: ${context.serviceDate || 'See claim'}
CPT Code: ${context.cptCode || 'See claim'}

Dear Claims Department,

I am writing to dispute the reimbursement amount for the above-referenced claim. Our records indicate that the payment received does not reflect the contracted reimbursement rate for this service.

PAYMENT DETAILS:
- Billed Amount: ${context.billedAmount}
- Expected Reimbursement (Contracted Rate): ${context.expectedReimbursement}
- Amount Paid: ${context.paidAmount}
- Underpayment Amount: ${context.underpaymentAmount}

ADJUSTMENT CODES IN QUESTION:
${adjSection}

Based on our provider agreement, the expected reimbursement for CPT code ${context.cptCode || '[code]'} is ${context.expectedReimbursement}. The payment of ${context.paidAmount} represents an underpayment of ${context.underpaymentAmount} below the contracted rate.

We respectfully request that this claim be reprocessed at the correct contracted rate. Please review the applicable fee schedule and provider agreement on file for verification.

If there has been a change to the fee schedule or contracted rates, please provide written notification of the effective date and updated rates as required under our provider agreement.

Please process this dispute within 30 business days per applicable state prompt-payment regulations. If you require additional information, please contact our office.

Sincerely,

${context.practiceName}
NPI: ${context.practiceNPI || '[NPI]'}
${context.practiceAddress || '[Address]'}
${context.practicePhone || '[Phone]'}`;
}

// POST /api/ai/assistant - Chat with the AI assistant
router.post('/assistant', isAuthenticated, async (req: any, res: Response) => {
  try {
    const client = getAnthropicClient();
    if (!client) {
      return res.status(503).json({
        message:
          'AI assistant requires a Claude API key to be configured. Please set the ANTHROPIC_API_KEY environment variable.',
        requiresConfig: true,
      });
    }

    const { message, conversationHistory, pageContext, clientDate } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    if (message.length > 2000) {
      return res.status(400).json({ error: 'Message is too long. Please keep it under 2000 characters.' });
    }

    // Get practice context for data queries
    const context = await getUserPracticeContext(req);
    const practiceId = context?.practiceId || 1;
    const userId = context?.userId;
    const userRole = context?.role;

    // Build a per-request system prompt: role-specific opener + current page.
    // Falls back to the base prompt when either is missing.
    const safePageContext =
      pageContext && typeof pageContext === 'object'
        ? {
            path: typeof pageContext.path === 'string' ? pageContext.path : null,
            title: typeof pageContext.title === 'string' ? pageContext.title : null,
          }
        : null;
    const safeClientDate =
      typeof clientDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(clientDate)
        ? clientDate
        : null;
    const systemPrompt = buildSystemPrompt({
      role: userRole,
      pageContext: safePageContext,
      clientDate: safeClientDate,
    });

    // --- Cost Optimization #3: Check per-practice rate limit ---
    let billingPlan: string | null = null;
    try {
      const practice = await storage.getPractice(practiceId);
      billingPlan = practice?.billingPlan || null;
    } catch {
      // Non-blocking — default to free tier limit
    }

    const rateCheck = checkPracticeRateLimit(practiceId, billingPlan);
    if (!rateCheck.allowed) {
      return res.json({
        response: "You've reached your daily assistant limit. Upgrade your plan for more, or try again tomorrow.",
        suggestedActions: [{ label: 'View Plans', path: '/settings' }],
        tokensUsed: 0,
        rateLimited: true,
      });
    }

    // --- Cost Optimization #2: Check response cache ---
    const cacheKey = normalizeCacheKey(message);
    if (isCacheableQuestion(message)) {
      const cached = getCachedResponse(cacheKey);
      if (cached) {
        // Still count toward rate limit
        incrementPracticeUsage(practiceId);
        return res.json({
          response: cached.content,
          suggestedActions: cached.suggestedActions,
          tokensUsed: 0,
          cached: true,
        });
      }
    }

    // --- Cost Optimization #1: Select model based on complexity ---
    const selectedModel = selectModel(message, conversationHistory);

    // Build conversation messages for Claude
    const messages: Anthropic.MessageParam[] = [];

    // Add conversation history (limit to last 20 messages to control token usage)
    if (Array.isArray(conversationHistory)) {
      const recentHistory = conversationHistory.slice(-20);
      for (const msg of recentHistory) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          messages.push({
            role: msg.role,
            content: String(msg.content || ''),
          });
        }
      }
    }

    // Add the current user message
    messages.push({ role: 'user', content: message.trim() });

    // Track which model is actually used (may upgrade mid-conversation)
    let currentModel = selectedModel;

    // First API call - may include tool use (with fallback to Sonnet if Haiku fails)
    let response: any;
    try {
      response = await client.messages.create({
        model: currentModel,
        system: systemPrompt,
        messages,
        tools: assistantTools,
        max_tokens: 1500,
        temperature: 0.4,
      });
    } catch (modelErr: any) {
      // If Haiku fails (404, overloaded, etc.), retry with Sonnet
      if (currentModel === MODEL_HAIKU) {
        logger.warn('Haiku failed, falling back to Sonnet', { error: modelErr.message });
        currentModel = MODEL_SONNET;
        response = await client.messages.create({
          model: currentModel,
          system: systemPrompt,
          messages,
          tools: assistantTools,
          max_tokens: 1500,
          temperature: 0.4,
        });
      } else {
        throw modelErr;
      }
    }

    // Phase 4: collect proposals for any mutation tools Blanche tries to
    // invoke. Web requests always gate mutations; the user has to confirm
    // each one via the proposal card before it actually executes.
    const pendingProposals: Array<{
      id: string;
      toolName: string;
      summary: string;
      args: Record<string, any>;
    }> = [];

    // Handle tool use (up to 3 rounds to avoid infinite loops)
    let toolRounds = 0;
    while (response.stop_reason === 'tool_use' && toolRounds < 3) {
      toolRounds++;

      // Add assistant response with tool use blocks
      messages.push({ role: 'assistant', content: response.content });

      // Execute all tool calls and build tool results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          // Smart model routing: upgrade to Sonnet if a complex tool is invoked
          if (currentModel === MODEL_HAIKU && SONNET_TOOLS.has(block.name)) {
            currentModel = MODEL_SONNET;
          }

          const args = (block.input as Record<string, unknown>) || {};

          // Phase 4 gate: if this is a mutation tool, defer execution and
          // queue a proposal for the user to confirm in the chat. Tell Claude
          // a synthetic tool_result so she can continue the turn (e.g. say
          // "I'd like to do X — please confirm below").
          if (MUTATION_TOOLS.has(block.name)) {
            const proposal = await createProposal({
              userId,
              practiceId,
              toolName: block.name,
              args: args as Record<string, any>,
            });
            pendingProposals.push({
              id: proposal.id,
              toolName: proposal.toolName,
              summary: proposal.summary,
              args: proposal.args,
            });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({
                status: 'awaiting_user_confirmation',
                proposalId: proposal.id,
                summary: proposal.summary,
                message:
                  'I have queued this action for the user to confirm in the chat. Briefly explain what you proposed and ask them to click Confirm or Cancel.',
              }),
            });
            logger.info('Blanche proposal queued', {
              proposalId: proposal.id,
              toolName: block.name,
              userId,
              practiceId,
            });
            continue;
          }

          const toolResult = await executeTool(block.name, args, practiceId, userId);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResult,
          });
        }
      }

      // Add tool results as user message
      messages.push({ role: 'user', content: toolResults });

      // Get next response (may now be upgraded to Sonnet) with timeout and fallback.
      // 60s ceiling: enough headroom for multi-round tool use (Rule 7 means
      // mutations now do a read-tool lookup first, which adds 5-10s of
      // latency to any "cancel/reschedule by description" turn). The
      // previous 30s cap was clipping legitimate multi-action requests.
      const ANTHROPIC_TIMEOUT_MS = 60_000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('API timeout')), ANTHROPIC_TIMEOUT_MS)
      );
      try {
        response = await Promise.race([
          client.messages.create({
            model: currentModel,
            system: systemPrompt,
            messages,
            tools: assistantTools,
            max_tokens: 1500,
            temperature: 0.4,
          }),
          timeoutPromise,
        ]) as Anthropic.Message;
      } catch (toolLoopErr: any) {
        // If Haiku failed, fall back to Sonnet
        if (currentModel === MODEL_HAIKU) {
          logger.warn('Tool-loop Haiku failed, falling back to Sonnet', { error: toolLoopErr.message });
          currentModel = MODEL_SONNET;
          response = await Promise.race([
            client.messages.create({
              model: currentModel,
              system: systemPrompt,
              messages,
              tools: assistantTools,
              max_tokens: 1500,
              temperature: 0.4,
            }),
            timeoutPromise,
          ]) as Anthropic.Message;
        } else {
          throw toolLoopErr;
        }
      }
    }

    // Extract text content from response
    const textBlocks = response.content.filter((b: any): b is Anthropic.TextBlock => b.type === 'text');
    // Default text when Claude returns no text blocks. With the Phase 4
    // proposal flow, it's common for Claude to emit ONLY tool calls and
    // skip a closing text block — the proposal card itself carries the
    // user-facing message. The old "I apologize, but I was unable to
    // generate a response" fallback made successful proposal turns look
    // like errors. Now we tailor the fallback to whether proposals are
    // pending: if yes, point the user at the card; if no, the original
    // apology is still appropriate (Claude truly returned nothing).
    const joinedText = textBlocks.map((b: Anthropic.TextBlock) => b.text).join('\n');
    const content =
      joinedText ||
      (pendingProposals.length > 0
        ? "I've queued the action below for your review — click **Confirm** or **Cancel** on the card."
        : 'I apologize, but I was unable to generate a response. Please try again.');

    // Parse for suggested actions (look for patterns like "[Action: ...]")
    const actionPattern = /\[Action:\s*([^\]]+)\]/g;
    const suggestedActions: { label: string; path: string }[] = [];
    const actionMap: Record<string, string> = {
      'check eligibility': '/patients',
      'view claims': '/claims',
      'view denied claims': '/claims',
      'view analytics': '/analytics',
      'view patients': '/patients',
      'add patient': '/patients',
      'view calendar': '/calendar',
      'view reports': '/reports',
      'view denial reasons': '/analytics',
      'create claim': '/claims',
      'view revenue': '/analytics',
      'view ar aging': '/analytics',
      'submit claim': '/claims',
      'check authorization': '/patients',
      'view settings': '/settings',
      'enable mfa': '/settings',
      'mcp setup': '/settings',
      'mcp setup guide': '/mcp-setup',
      'mcp integration': '/settings',
      'claude desktop': '/mcp-setup',
      'connect claude': '/mcp-setup',
    };

    let match;
    while ((match = actionPattern.exec(content)) !== null) {
      const actionLabel = match[1].trim();
      const actionLower = actionLabel.toLowerCase();
      for (const [key, path] of Object.entries(actionMap)) {
        if (actionLower.includes(key)) {
          suggestedActions.push({ label: actionLabel, path });
          break;
        }
      }
    }

    // Clean content of action tags for display
    let cleanContent = content.replace(/\[Action:\s*[^\]]+\]/g, '').trim();

    // Layer-2 trust safeguard: if Blanche claimed success in prose but didn't
    // actually call any mutation tool this turn, prepend a warning so the user
    // is told they may have been misled. `pendingProposals.length === 0` means
    // no mutation tool was invoked (mutation tool calls always queue a proposal).
    const augmented = augmentIfHallucinatedSuccess(cleanContent, pendingProposals.length);
    if (augmented !== cleanContent) {
      logger.warn('Blanche hallucinated-success detected; prepending warning', {
        practiceId,
        userId,
        originalLength: cleanContent.length,
      });
      cleanContent = augmented;
    }

    // Increment rate limit counter on successful response
    incrementPracticeUsage(practiceId);

    // Cache the response if it was a cacheable question and no tools were used
    const usedTools = toolRounds > 0;
    if (!usedTools && isCacheableQuestion(message)) {
      cacheResponse(cacheKey, cleanContent, suggestedActions);
    }

    res.json({
      response: cleanContent,
      suggestedActions,
      // Phase 4: deferred mutations awaiting user confirmation. Empty array
      // when Blanche didn't propose anything (or only did reads). Client
      // renders each as a Confirm/Cancel card; POSTs back to /api/ai/confirm-tool.
      proposals: pendingProposals,
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      model: currentModel,
    });
  } catch (error) {
    logger.error('AI assistant error', {
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof Error) {
      if (error.message.includes('401') || error.message.includes('authentication') || error.message.includes('api_key')) {
        return res.status(503).json({
          message: 'The Claude API key appears to be invalid. Please check your configuration.',
          requiresConfig: true,
        });
      }
      if (error.message.includes('429') || error.message.includes('rate_limit')) {
        return res.status(429).json({
          message: 'Too many requests to the AI service. Please wait a moment and try again.',
        });
      }
      if (error.message.includes('overloaded') || error.message.includes('529')) {
        return res.status(503).json({
          message: "Blanche is experiencing high demand right now. Please try again in a moment — it usually clears up within a minute or two!",
        });
      }
    }

    res.status(500).json({
      message: 'An error occurred while processing your request. Please try again.',
    });
  }
});

/**
 * POST /api/ai/confirm-tool — Phase 4 confirmation handler.
 *
 * Body: { proposalId: string, action: 'confirm' | 'cancel' }
 *
 * On 'confirm': validates the proposal belongs to this user + practice,
 * executes the deferred tool with its original args, returns the result.
 * On 'cancel': records the cancellation in the audit trail, returns ok.
 *
 * Proposals are single-use: the store removes them on take(). A double-click
 * on Confirm results in a 404 on the second call (treat as already executed).
 */
router.post('/confirm-tool', isAuthenticated, async (req: any, res: Response) => {
  try {
    const { proposalId, action } = req.body ?? {};
    if (typeof proposalId !== 'string' || !proposalId) {
      return res.status(400).json({ message: 'proposalId is required' });
    }
    if (action !== 'confirm' && action !== 'cancel') {
      return res.status(400).json({ message: "action must be 'confirm' or 'cancel'" });
    }

    const context = await getUserPracticeContext(req);
    if (!context) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const proposal = await takeProposal(proposalId);
    if (!proposal) {
      return res.status(404).json({
        message: 'Proposal not found or expired. Ask Blanche to propose again.',
      });
    }

    // Cross-user / cross-practice protection. Even with a valid id, a user
    // from a different account/practice must not be able to execute someone
    // else's queued proposal.
    if (proposal.practiceId !== context.practiceId || proposal.userId !== context.userId) {
      logger.warn('Proposal owner mismatch — refused', {
        proposalId,
        proposalUserId: proposal.userId,
        proposalPracticeId: proposal.practiceId,
        callerUserId: context.userId,
        callerPracticeId: context.practiceId,
      });
      return res.status(404).json({ message: 'Proposal not found or expired.' });
    }

    if (action === 'cancel') {
      logger.info('Blanche proposal cancelled', {
        proposalId,
        toolName: proposal.toolName,
        userId: context.userId,
        practiceId: context.practiceId,
      });
      return res.json({ status: 'cancelled', proposalId });
    }

    // Execute the original tool with the original args. This is the same
    // executeTool() the chat endpoint would have run if confirmation weren't
    // required — same authorization model, same downstream side effects.
    logger.info('Blanche proposal confirmed — executing', {
      proposalId,
      toolName: proposal.toolName,
      userId: context.userId,
      practiceId: context.practiceId,
    });

    const toolResultJson = await executeTool(
      proposal.toolName,
      proposal.args,
      context.practiceId,
      context.userId,
    );

    let parsedResult: unknown = toolResultJson;
    try {
      parsedResult = JSON.parse(toolResultJson);
    } catch {
      // Some tools return non-JSON; surface the raw string in that case.
    }

    // Auto-continuation hook: tell the client to immediately send a hidden
    // follow-up message to /api/ai/assistant so Blanche can continue the
    // workflow (e.g. propose the next step in a multi-step intent, or just
    // say "anything else?" if nothing's left). Without this, multi-step
    // promises like "next I'll schedule the appointment" die silently after
    // the user clicks Confirm.
    //
    // The followup is wrapped in an "[Auto-continue]" sentinel so Blanche
    // (and the response augmenter) can recognize it as a system-generated
    // continuation, not a real user message — and the client hides it from
    // the rendered chat.
    const summarized = summarizeResultForBlanche(parsedResult);
    const autoContinue = {
      suggestedFollowup:
        `[Auto-continue / system note — not from the user]\n\n` +
        `The user just confirmed your proposed ${proposal.toolName} call. ` +
        `It executed with result: ${summarized}\n\n` +
        `INSTRUCTIONS:\n` +
        `1. Re-read the user's ORIGINAL request earlier in this conversation.\n` +
        `2. If their original request requires more mutations (e.g. they said "schedule a walk-in for Janet" — that's TWO steps: create patient + create appointment — and you've only done one), CALL THE NEXT TOOL NOW. Do not narrate "I'm proposing to..." without calling a tool. The tool call itself creates the Confirm card.\n` +
        `3. If the original request is fully complete, write a SHORT one-sentence acknowledgement ("Janet's set up and her 4 PM appointment is on the books — anything else?") and stop. Do NOT propose anything new just to be helpful.\n` +
        `4. Do NOT use enthusiasm openers ("Great!", "Perfect!", "Excellent!"). Start neutrally.\n` +
        `5. Do NOT say "Click Confirm below" unless you've actually called a tool in this turn.\n\n` +
        `Remember: a Confirm card only appears for the user when you CALL A TOOL. Saying you're proposing without invoking the tool produces a misleading message with no card to click.`,
    };

    return res.json({
      status: 'confirmed',
      proposalId,
      toolName: proposal.toolName,
      summary: proposal.summary,
      result: parsedResult,
      autoContinue,
    });
  } catch (error) {
    logger.error('Blanche confirm-tool error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({ message: 'Failed to process confirmation' });
  }
});

/**
 * Best-effort short summary of a tool-result for the auto-continue follow-up
 * message. Different tools return wildly different shapes — pick out the
 * most useful 1-2 fields and stringify, capping length so we don't shove
 * a giant JSON blob into Blanche's context.
 */
function summarizeResultForBlanche(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return typeof result === 'string' ? result.slice(0, 200) : 'success';
  }
  const r = result as Record<string, any>;
  if (r.error) return `error: ${String(r.error).slice(0, 200)}`;
  if (r.success && r.message) return String(r.message).slice(0, 300);
  if (r.patient) return `patient ${r.patient.id} (${r.patient.firstName ?? ''} ${r.patient.lastName ?? ''}) created`.trim();
  if (r.id && r.message) return `id ${r.id}, ${String(r.message).slice(0, 200)}`;
  if (r.id) return `id ${r.id}`;
  if (r.message) return String(r.message).slice(0, 300);
  // Fallback: short JSON.
  const json = JSON.stringify(r);
  return json.length > 300 ? json.slice(0, 297) + '...' : json;
}

// GET /api/ai/assistant/status - Check if AI assistant is available
router.get('/assistant/status', (req, res) => {
  const hasApiKey = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  res.json({
    available: hasApiKey,
    message: hasApiKey
      ? 'AI assistant is ready (powered by Claude).'
      : 'AI assistant requires ANTHROPIC_API_KEY to be configured.',
  });
});

export default router;
