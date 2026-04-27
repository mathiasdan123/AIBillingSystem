/**
 * AI Insight Narrative Service
 *
 * Generates concise human-readable summaries for daily/weekly insights
 * reports using Anthropic's Message Batches API. The Batch API is the
 * right fit for this workload because:
 *
 *   - Cron-driven (6 PM daily / Mon 8 AM weekly) — no real-time SLA
 *   - Multi-practice — N practices = N independent prompts batched in one call
 *   - 50% cost discount on Claude inference vs synchronous calls
 *   - Higher rate-limit headroom — won't get throttled at scale
 *
 * Failure mode: returns an empty map. Callers should fall back to sending
 * the reports without narratives so practices still get their email.
 */

import Anthropic from '@anthropic-ai/sdk';
import logger from './logger';

let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    logger.warn('ANTHROPIC_API_KEY not set — AI insight narratives disabled');
    return null;
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 400;
const POLL_INTERVAL_MS = 20_000; // 20s
const MAX_WAIT_MS = 25 * 60_000; // 25 min hard cap

export interface NarrativeRequest {
  /** Stable identifier the caller uses to match results back. */
  customId: string;
  kind: 'daily' | 'weekly';
  practiceName: string;
  /** The raw report object from generateDailyReport / generateWeeklyReport. */
  report: any;
}

/**
 * Submits a batch of narrative-generation prompts to Anthropic and polls
 * until completion. Returns map of customId → narrative text. Items that
 * errored or timed out are simply absent from the map (caller treats as
 * "no narrative available").
 */
export async function generateInsightNarrativesBatch(
  items: NarrativeRequest[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (items.length === 0) return result;

  const client = getAnthropic();
  if (!client) return result;

  const requests = items.map((item) => ({
    custom_id: item.customId,
    params: {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user' as const,
          content: buildUserPrompt(item),
        },
      ],
    },
  }));

  let batchId: string;
  try {
    const batch = await (client as any).messages.batches.create({ requests });
    batchId = batch.id;
    logger.info('AI insight narrative batch submitted', {
      batchId,
      requestCount: items.length,
    });
  } catch (err: any) {
    logger.error('Failed to submit AI insight narrative batch', {
      error: err?.message,
      requestCount: items.length,
    });
    return result;
  }

  // Poll for completion.
  const startedAt = Date.now();
  let processingStatus = 'in_progress';
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const batch = await (client as any).messages.batches.retrieve(batchId);
      processingStatus = batch.processing_status;
      if (processingStatus === 'ended') break;
    } catch (err: any) {
      logger.warn('AI insight narrative batch poll failed', {
        batchId,
        error: err?.message,
      });
    }
  }

  if (processingStatus !== 'ended') {
    logger.warn('AI insight narrative batch timed out', {
      batchId,
      waitedMs: Date.now() - startedAt,
      lastStatus: processingStatus,
    });
    return result;
  }

  // Stream results and pluck text blocks.
  try {
    const resultsStream = await (client as any).messages.batches.results(batchId);
    for await (const entry of resultsStream) {
      if (!entry || !entry.custom_id) continue;
      const r = entry.result;
      if (!r || r.type !== 'succeeded' || !r.message?.content) {
        if (r?.type === 'errored') {
          logger.warn('AI insight narrative item errored', {
            batchId,
            customId: entry.custom_id,
            error: r.error,
          });
        }
        continue;
      }
      const text = r.message.content
        .filter((b: any) => b?.type === 'text')
        .map((b: any) => b.text as string)
        .join('\n')
        .trim();
      if (text) result.set(entry.custom_id, text);
    }
    logger.info('AI insight narrative batch completed', {
      batchId,
      requestedCount: items.length,
      narrativeCount: result.size,
    });
  } catch (err: any) {
    logger.error('Failed to fetch AI insight narrative results', {
      batchId,
      error: err?.message,
    });
  }

  return result;
}

const SYSTEM_PROMPT = `You write short executive summaries for medical billing reports for behavioral-health and pediatric-therapy practices.

Style rules:
- 3-5 sentences. Plain English. No bullet points unless explicitly listing >2 items.
- Lead with the single most important takeaway from the data.
- Call out specific numbers from the data — never invent figures.
- If denial rate, AR aging, or auth status is concerning, recommend ONE concrete next action.
- Use "accuracy" framing for billing language — never "optimization" or "maximization".
- Never offer coding decisions. Recommendations are operational (rerun eligibility, follow up on auth, review aging claims).
- Tone: peer-to-peer biller-to-biller, not corporate.
- Do not start with "Here is" or "This report" or pleasantries — jump straight to the takeaway.`;

function buildUserPrompt(item: NarrativeRequest): string {
  const { kind, practiceName, report } = item;
  const summaryLines: string[] = [];
  summaryLines.push(`Practice: ${practiceName}`);
  summaryLines.push(`Report type: ${kind === 'daily' ? 'Daily (today)' : `Weekly (${report.weekOf} to ${report.weekEnd})`}`);
  summaryLines.push('');

  if (kind === 'daily') {
    summaryLines.push('CLAIMS TODAY');
    summaryLines.push(`  New: ${report.claimsSummary?.newToday ?? 0}`);
    summaryLines.push(`  Submitted: ${report.claimsSummary?.submittedToday ?? 0}`);
    summaryLines.push(`  Paid: ${report.claimsSummary?.paidToday ?? 0}`);
    summaryLines.push(`  Denied: ${report.claimsSummary?.deniedToday ?? 0}`);
    summaryLines.push('');
    summaryLines.push(`Revenue collected today: $${(report.revenueCollectedToday ?? 0).toFixed(2)}`);
    summaryLines.push(`Trailing 7-day denial rate: ${report.denialRateTrailing7Day ?? 0}%`);
    summaryLines.push('');
    summaryLines.push('PATIENT VOLUME');
    summaryLines.push(`  Completed: ${report.patientVolume?.completed ?? 0}`);
    summaryLines.push(`  No-shows: ${report.patientVolume?.noShows ?? 0}`);
    summaryLines.push(`  Cancellations: ${report.patientVolume?.cancellations ?? 0}`);
    summaryLines.push(`  Scheduled: ${report.patientVolume?.scheduled ?? 0}`);
    summaryLines.push('');
    summaryLines.push('AR AGING');
    summaryLines.push(`  30+ days: ${report.agingClaims?.over30?.count ?? 0} claims, $${(report.agingClaims?.over30?.amount ?? 0).toFixed(2)}`);
    summaryLines.push(`  60+ days: ${report.agingClaims?.over60?.count ?? 0} claims, $${(report.agingClaims?.over60?.amount ?? 0).toFixed(2)}`);
    summaryLines.push(`  90+ days: ${report.agingClaims?.over90?.count ?? 0} claims, $${(report.agingClaims?.over90?.amount ?? 0).toFixed(2)}`);
    if (Array.isArray(report.expiringAuthorizations) && report.expiringAuthorizations.length > 0) {
      summaryLines.push('');
      summaryLines.push(`EXPIRING AUTHS (${report.expiringAuthorizations.length})`);
      report.expiringAuthorizations.slice(0, 5).forEach((a: any) => {
        summaryLines.push(`  ${a.patientName} — expires ${a.expirationDate}, ${a.remainingVisits ?? '?'} visits left`);
      });
    }
    if (Array.isArray(report.actionItems) && report.actionItems.length > 0) {
      summaryLines.push('');
      summaryLines.push('FLAGGED ACTION ITEMS');
      report.actionItems.slice(0, 6).forEach((it: any) => {
        summaryLines.push(`  [${it.priority}] ${it.category}: ${it.description}`);
      });
    }
  } else {
    // Weekly
    summaryLines.push('CLAIM TRENDS (this week vs last week)');
    summaryLines.push(`  Total: ${report.claimTrends?.thisWeek?.total ?? 0} vs ${report.claimTrends?.lastWeek?.total ?? 0}`);
    summaryLines.push(`  Paid: ${report.claimTrends?.thisWeek?.paid ?? 0} vs ${report.claimTrends?.lastWeek?.paid ?? 0}`);
    summaryLines.push(`  Denied: ${report.claimTrends?.thisWeek?.denied ?? 0} vs ${report.claimTrends?.lastWeek?.denied ?? 0}`);
    summaryLines.push(`  Submitted: ${report.claimTrends?.thisWeek?.submitted ?? 0} vs ${report.claimTrends?.lastWeek?.submitted ?? 0}`);
    summaryLines.push('');
    summaryLines.push('REVENUE');
    summaryLines.push(`  Collected: $${(report.revenueSummary?.totalCollected ?? 0).toFixed(2)}`);
    summaryLines.push(`  Outstanding: $${(report.revenueSummary?.totalOutstanding ?? 0).toFixed(2)}`);
    if (Array.isArray(report.topDenialReasons) && report.topDenialReasons.length > 0) {
      summaryLines.push('');
      summaryLines.push('TOP DENIAL REASONS');
      report.topDenialReasons.slice(0, 5).forEach((r: any) => {
        summaryLines.push(`  ${r.reason}: ${r.count}`);
      });
    }
    if (Array.isArray(report.recommendations) && report.recommendations.length > 0) {
      summaryLines.push('');
      summaryLines.push('SYSTEM RECOMMENDATIONS (rule-based)');
      report.recommendations.slice(0, 5).forEach((rec: string, i: number) => {
        summaryLines.push(`  ${i + 1}. ${rec}`);
      });
    }
  }

  summaryLines.push('');
  summaryLines.push(`Write a 3-5 sentence executive summary for this ${kind} report. Lead with the most important takeaway, cite specific numbers, and recommend ONE concrete next action if anything is concerning.`);
  return summaryLines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
