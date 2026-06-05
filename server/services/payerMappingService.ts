/**
 * Practice Payer Mapping (Phase 1 — onboarding payer resolution).
 *
 * Single resolution path from a raw insurance/payer name (as it arrives from
 * data import or patient intake) to a verified Stedi payer ID. Before this,
 * eligibility hardcoded a 10-entry PAYER_IDS map (falling back to Aetna 60054),
 * while claims used resolvePayerId() + crosswalk — two inconsistent paths, and
 * nothing resolved payers at onboarding.
 *
 * resolvePracticePayer() unifies them with a cache-first ladder:
 *   1. practice_payer_map  — per-practice resolved/confirmed mapping (cache hit)
 *   2. resolvePayerId()    — existing crosswalk → static PAYER_IDS → payerCode
 *   3. live Stedi search   — searchPayers(), cached globally in payer_search_cache
 *   4. unmatched           — recorded so onboarding can surface it for a human pick
 *
 * The pure helpers (normalizePayerName, scoreNameMatch, pickBestMatch) are
 * exported so they can be unit-tested without a DB or the network.
 */

import { practicePayerMap, payerSearchCache } from '../../shared/schema';
import { and, eq } from 'drizzle-orm';
import logger from './logger';
import { resolvePayerId, searchPayers, type PayerSearchResult } from './stediService';

// db is imported lazily inside each async function (not at module load) so the
// pure helpers below — normalizePayerName/scoreNameMatch/pickBestMatch — can be
// imported and unit-tested without a configured DATABASE_URL. Mirrors the
// lazy-import pattern in stediService.resolvePayerId.

// How long a cached live-search result stays fresh before we re-query Stedi.
const SEARCH_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Minimum name-match score to auto-accept a live Stedi search result without a
// human review. Set high (effectively requires an exact normalized-token match;
// see scoreNameMatch) so fuzzy/sub-plan matches go to the onboarding review UI
// instead of silently routing claims to a wrong-but-similar payer.
const AUTO_ACCEPT_THRESHOLD = 0.85;

// Common payer-name abbreviations/variants collapsed to a canonical token so
// "BCBS", "BC/BS", "Blue Cross Blue Shield", and "blue-cross blueshield" all
// normalize the same. These run AFTER punctuation is stripped to spaces, so
// patterns match the space-separated form (e.g. "bc bs", not "bc/bs"). Joined
// variants ("bluecross", "blueshield") are split before the bcbs collapse.
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bbluecross\b/g, 'blue cross'],
  [/\bblueshield\b/g, 'blue shield'],
  [/\bbcbs\b/g, 'blue cross blue shield'],
  [/\bbc bs\b/g, 'blue cross blue shield'],
  [/\buhc\b/g, 'unitedhealthcare'],
  [/\buhg\b/g, 'unitedhealthcare'],
  [/\bunited health ?care\b/g, 'unitedhealthcare'],
  [/\bghi\b/g, 'group health incorporated'],
  [/\bumr\b/g, 'united medical resources'],
];

/**
 * Normalize a raw payer name into a stable lookup key: lowercase, strip
 * punctuation, expand known abbreviations, collapse whitespace. Pure.
 */
export function normalizePayerName(raw: string | null | undefined): string {
  if (!raw) return '';
  // 1. Lowercase + replace punctuation with spaces (keep alphanumerics).
  let s = String(raw).toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim();
  // 2. Expand abbreviations (BCBS → blue cross blue shield, etc.).
  for (const [pattern, replacement] of ABBREVIATIONS) {
    s = s.replace(pattern, replacement);
  }
  const expanded = s.replace(/\s+/g, ' ').trim();
  // 3. Drop generic corporate-suffix noise that doesn't disambiguate a payer.
  //    NOTE: we deliberately do NOT strip "health plan" — it's load-bearing in
  //    regional Medicaid/HMO names ("Health Plan of San Mateo", "The Health
  //    Plan"). Stripping it collapsed distinct payers to the same key (and some
  //    to empty), which — given practice_payer_map's (practiceId, normalizedName)
  //    upsert key — could overwrite one payer's confirmed mapping with another's.
  const stripped = expanded
    .replace(/\b(insurance|inc|llc|of|the|company|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // 4. Never let noise-stripping empty out a non-empty name (e.g. "Health
  //    Insurance Co") — fall back to the expanded form so it stays resolvable
  //    and can't collide with every other all-noise name on the empty key.
  return stripped || expanded;
}

/**
 * Score how well a candidate Stedi result matches the query name, 0..1. Pure.
 *
 * Only an EXACT normalized-token match scores 1.0 — and (with the auto-accept
 * threshold at 0.85) only a 1.0 resolves without human review. Everything else
 * is deliberately scored below the bar so it surfaces in the onboarding review
 * UI rather than silently routing claims. This matters because asymmetric
 * containment ("Cigna Behavioral Health" ⊃ "Cigna", "UnitedHealthcare Community
 * Plan" ⊃ "UnitedHealthcare") denotes a *different sub-plan* with a different
 * payer ID — a high-confidence containment match there would mis-route behavioral
 * / Medicaid claims to the commercial payer. Aliases are considered too.
 */
export function scoreNameMatch(query: string, candidate: PayerSearchResult): number {
  const q = normalizePayerName(query);
  if (!q) return 0;
  const names = [candidate.displayName, ...(candidate.aliases || [])]
    .map(normalizePayerName)
    .filter(Boolean);
  if (names.length === 0) return 0;

  let best = 0;
  const qTokens = new Set(q.split(' ').filter(Boolean));
  for (const name of names) {
    if (name === q) return 1; // exact token-string match — the only auto-accept

    const nameTokens = name.split(' ').filter(Boolean);
    if (nameTokens.length === 0) continue;
    const nameSet = new Set(nameTokens);

    // Jaccard over token sets: rewards full overlap, penalizes extra qualifier
    // tokens on either side (so sub-plans score lower than the base plan).
    let inter = 0;
    for (const t of Array.from(qTokens)) if (nameSet.has(t)) inter++;
    const union = new Set([...Array.from(qTokens), ...nameTokens]).size;
    let score = union > 0 ? inter / union : 0;

    // Containment is a weak signal only — capped below the auto-accept threshold
    // so a contained name still needs review (it's usually a sub-plan, not the
    // same entity).
    if (name.includes(q) || q.includes(name)) score = Math.max(score, 0.8);

    best = Math.max(best, score);
  }
  return best;
}

/**
 * Pick the highest-scoring Stedi result for a query, or null. Pure.
 * Tie-break: prefer the candidate with the FEWER tokens in its name — i.e. the
 * base plan ("Anthem Blue Cross") over a sub-plan with extra qualifiers
 * ("Anthem Blue Cross Partnership Plan", a Medicaid product). Deterministic so
 * the same inputs always resolve the same way regardless of Stedi result order.
 */
export function pickBestMatch(
  query: string,
  results: PayerSearchResult[],
): { match: PayerSearchResult; score: number } | null {
  let best: { match: PayerSearchResult; score: number } | null = null;
  let bestTokens = Infinity;
  for (const r of results) {
    const score = scoreNameMatch(query, r);
    const tokens = normalizePayerName(r.displayName).split(' ').filter(Boolean).length;
    if (!best || score > best.score || (score === best.score && tokens < bestTokens)) {
      best = { match: r, score };
      bestTokens = tokens;
    }
  }
  return best;
}

export interface ResolvedPayer {
  stediPayerId: string | null;
  displayName: string | null;
  transactionSupport: Record<string, string> | null;
  confidence: number;
  source: 'practice_map' | 'crosswalk' | 'static_map' | 'insurance_record' | 'stedi_search' | 'unmatched';
  needsReview: boolean;
}

const UNMATCHED: ResolvedPayer = {
  stediPayerId: null,
  displayName: null,
  transactionSupport: null,
  confidence: 0,
  source: 'unmatched',
  needsReview: true,
};

/**
 * Fetch a global live-search result set for a normalized query, using the
 * payer_search_cache table (cross-practice) to avoid re-hitting Stedi. Returns
 * the raw PayerSearchResult[] (possibly empty). Network/db failures degrade to [].
 *
 * The cache is intentionally global (keyed only on normalizedQuery): Stedi's
 * payer-network /payers/search is a directory lookup over the shared network,
 * not account-scoped data, so the result set for a given name is the same
 * regardless of which practice's API key issues it. (The practice key is still
 * passed so the call is attributed/authorized correctly.)
 */
async function cachedSearch(rawName: string, normalized: string, practiceId?: number): Promise<PayerSearchResult[]> {
  try {
    const { getDb } = await import('../db');
    const db = await getDb();
    const [cached] = await db
      .select()
      .from(payerSearchCache)
      .where(eq(payerSearchCache.normalizedQuery, normalized))
      .limit(1);

    const fresh =
      cached?.fetchedAt && Date.now() - new Date(cached.fetchedAt).getTime() < SEARCH_CACHE_TTL_MS;
    if (cached && fresh && Array.isArray(cached.results)) {
      return cached.results as PayerSearchResult[];
    }

    const results = await searchPayers(rawName, { practiceId });
    // Upsert the cache row (unique on normalizedQuery).
    await db
      .insert(payerSearchCache)
      .values({ normalizedQuery: normalized, results, fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: payerSearchCache.normalizedQuery,
        set: { results, fetchedAt: new Date() },
      });
    return results;
  } catch (error) {
    logger.warn('Payer search cache/live lookup failed', {
      normalized,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/** Persist a resolved mapping into practice_payer_map (upsert on practice+normalized). */
async function upsertMapping(
  practiceId: number,
  rawName: string,
  normalized: string,
  resolved: ResolvedPayer,
): Promise<void> {
  try {
    const { getDb } = await import('../db');
    const db = await getDb();
    const status = resolved.needsReview ? (resolved.stediPayerId ? 'auto' : 'unmatched') : 'auto';
    await db
      .insert(practicePayerMap)
      .values({
        practiceId,
        rawName: rawName.slice(0, 200),
        normalizedName: normalized.slice(0, 200),
        stediPayerId: resolved.stediPayerId,
        displayName: resolved.displayName,
        transactionSupport: resolved.transactionSupport ?? undefined,
        confidence: resolved.confidence.toFixed(2),
        source: resolved.source === 'unmatched' ? 'stedi_search' : resolved.source,
        status,
      })
      .onConflictDoUpdate({
        target: [practicePayerMap.practiceId, practicePayerMap.normalizedName],
        set: {
          rawName: rawName.slice(0, 200),
          stediPayerId: resolved.stediPayerId,
          displayName: resolved.displayName,
          transactionSupport: resolved.transactionSupport ?? undefined,
          confidence: resolved.confidence.toFixed(2),
          source: resolved.source === 'unmatched' ? 'stedi_search' : resolved.source,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    logger.warn('Failed to persist practice payer mapping', {
      practiceId,
      normalized,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface ResolveOptions {
  /** Skip the live Stedi search (used for fast/offline resolution). */
  noLiveSearch?: boolean;
  /** Don't write the result back to practice_payer_map (read-only resolution). */
  noPersist?: boolean;
}

/**
 * Resolve a raw payer name to a Stedi payer ID for a practice, cache-first.
 * Never throws — degrades to an 'unmatched' result on any failure so callers
 * (eligibility/claims/onboarding) can decide how to handle a miss.
 */
export async function resolvePracticePayer(
  practiceId: number,
  rawName: string,
  options: ResolveOptions = {},
): Promise<ResolvedPayer> {
  const normalized = normalizePayerName(rawName);
  if (!normalized) return UNMATCHED;

  // 1. Practice map — a previously resolved/confirmed mapping for this practice.
  try {
    const { getDb } = await import('../db');
    const db = await getDb();
    const [row] = await db
      .select()
      .from(practicePayerMap)
      .where(and(eq(practicePayerMap.practiceId, practiceId), eq(practicePayerMap.normalizedName, normalized)))
      .limit(1);
    if (row && row.stediPayerId) {
      return {
        stediPayerId: row.stediPayerId,
        displayName: row.displayName ?? null,
        transactionSupport: (row.transactionSupport as Record<string, string>) ?? null,
        confidence: row.confidence ? Number(row.confidence) : 1,
        source: 'practice_map',
        needsReview: row.status === 'auto',
      };
    }
  } catch (error) {
    logger.warn('practice_payer_map lookup failed', {
      practiceId,
      normalized,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 2. Existing crosswalk → static PAYER_IDS → insurance payerCode.
  const routed = await resolvePayerId(rawName, rawName, null);
  if (routed.routingSource !== 'default' && routed.tradingPartnerId && routed.tradingPartnerId !== '00000') {
    // The static PAYER_IDS map has two "varies by state" placeholders — BCBS
    // (00590, one state's plan) and Medicaid (SKMED). Auto-accepting those for a
    // multi-state rollout would route a TX practice's "Medicaid" to the wrong
    // state's payer. Flag them for review; crosswalk + specific static entries
    // (Aetna/Cigna/etc.) stay auto-accepted.
    const STATE_VARYING_STATIC_IDS = new Set(['00590', 'SKMED']);
    const needsReview =
      routed.routingSource === 'static_map' &&
      STATE_VARYING_STATIC_IDS.has(routed.tradingPartnerId);
    const resolved: ResolvedPayer = {
      stediPayerId: routed.tradingPartnerId,
      displayName: routed.matchedSubPlan ?? null,
      transactionSupport: null,
      confidence: routed.routingSource === 'crosswalk' ? 0.95 : 0.9,
      source: routed.routingSource as ResolvedPayer['source'],
      needsReview,
    };
    if (!options.noPersist) await upsertMapping(practiceId, rawName, normalized, resolved);
    return resolved;
  }

  // 3. Live Stedi payer search (cached globally), pick the best name match.
  if (!options.noLiveSearch) {
    const results = await cachedSearch(rawName, normalized, practiceId);
    const best = pickBestMatch(rawName, results);
    if (best && best.match.payerId) {
      const resolved: ResolvedPayer = {
        stediPayerId: best.match.payerId,
        displayName: best.match.displayName || null,
        transactionSupport: best.match.transactionSupport as Record<string, string>,
        confidence: Number(best.score.toFixed(2)),
        source: 'stedi_search',
        needsReview: best.score < AUTO_ACCEPT_THRESHOLD,
      };
      if (!options.noPersist) await upsertMapping(practiceId, rawName, normalized, resolved);
      return resolved;
    }
  }

  // 4. Nothing matched — record the miss so onboarding can surface it.
  if (!options.noPersist) await upsertMapping(practiceId, rawName, normalized, UNMATCHED);
  return UNMATCHED;
}

/**
 * Resolve a batch of distinct raw payer names for a practice (onboarding use).
 * De-dupes by normalized name so each unique payer is resolved once.
 */
export async function resolveDistinctPayers(
  practiceId: number,
  rawNames: string[],
  options: ResolveOptions = {},
): Promise<Array<{ rawName: string; resolved: ResolvedPayer }>> {
  const seen = new Map<string, string>(); // normalized -> first rawName seen
  for (const raw of rawNames) {
    const n = normalizePayerName(raw);
    if (n && !seen.has(n)) seen.set(n, raw);
  }
  const out: Array<{ rawName: string; resolved: ResolvedPayer }> = [];
  for (const rawName of Array.from(seen.values())) {
    out.push({ rawName, resolved: await resolvePracticePayer(practiceId, rawName, options) });
  }
  return out;
}

export default { normalizePayerName, scoreNameMatch, pickBestMatch, resolvePracticePayer, resolveDistinctPayers };
