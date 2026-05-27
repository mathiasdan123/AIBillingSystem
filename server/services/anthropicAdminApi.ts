/**
 * Anthropic Organization Admin API client.
 *
 * Fetches usage (token breakdown) and cost (billed $) reports from the
 * Anthropic Admin API. Requires an Admin API key (sk-ant-admin-...) — service
 * account keys do NOT have access to /v1/organizations/* endpoints.
 *
 * Responses are cached for 5 minutes because:
 *  - Anthropic only updates usage data every ~5 min.
 *  - The endpoint is rate-limited to ~1 request/min.
 *
 * Never call this from the client.
 */

import { getSecretOrEnv } from './awsSecretsManager';
import logger from './logger';

const ADMIN_BASE = 'https://api.anthropic.com/v1/organizations';
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedResponse {
  value: unknown;
  expiresAt: number;
}
const responseCache = new Map<string, CachedResponse>();

async function getAdminKey(): Promise<string> {
  const key = await getSecretOrEnv({
    secretEnvVar: 'ANTHROPIC_ADMIN_API_KEY_SECRET_ID',
    jsonKey: 'apiKey',
    fallbackEnvVar: 'ANTHROPIC_ADMIN_API_KEY',
  });
  if (!key) {
    throw new Error(
      'Anthropic Admin API key not configured. Set ANTHROPIC_ADMIN_API_KEY_SECRET_ID (Secrets Manager) or ANTHROPIC_ADMIN_API_KEY (env).',
    );
  }
  if (!key.startsWith('sk-ant-admin')) {
    logger.warn('ANTHROPIC_ADMIN_API_KEY does not start with sk-ant-admin — Usage/Cost API will likely return 401.');
  }
  return key;
}

interface UsageBucket {
  starting_at: string;
  ending_at: string;
  results: Array<{
    uncached_input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    output_tokens?: number;
    server_tool_use?: Record<string, number>;
    model?: string;
    service_tier?: string;
    context_window?: string;
    workspace_id?: string | null;
    api_key_id?: string | null;
  }>;
}

interface CostBucket {
  starting_at: string;
  ending_at: string;
  results: Array<{
    /** Cost amount; field name in Anthropic responses. */
    amount?: number;
    /** Currency, e.g. "USD". */
    currency?: string;
    /** Cost type, e.g. "tokens". */
    cost_type?: string;
    /** Free-form description Anthropic attaches (model + token type). */
    description?: string;
    workspace_id?: string | null;
    model?: string;
  }>;
}

interface UsageResponse { data: UsageBucket[]; has_more: boolean; next_page?: string | null; }
interface CostResponse { data: CostBucket[]; has_more: boolean; next_page?: string | null; }

async function adminGet<T>(path: string, params: Record<string, string | string[]>): Promise<T> {
  const cacheKey = `${path}?${JSON.stringify(params)}`;
  const hit = responseCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else qs.append(k, v);
  }

  const key = await getAdminKey();
  const url = `${ADMIN_BASE}${path}?${qs.toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic Admin API ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as T;
  responseCache.set(cacheKey, { value: json, expiresAt: Date.now() + CACHE_TTL_MS });
  return json;
}

/** group_by options valid on /usage_report/messages */
export type UsageGroupBy = 'model' | 'workspace_id' | 'api_key_id' | 'service_tier' | 'context_window';
/** group_by options valid on /cost_report (Anthropic does NOT accept "model" here). */
export type CostGroupBy = 'description' | 'workspace_id';

export interface FetchOpts {
  startingAt: Date;
  endingAt: Date;
  bucketWidth: '1m' | '1h' | '1d';
  groupBy?: UsageGroupBy[];
  /**
   * Optional workspace scoping. Anthropic's Admin API accepts a
   * `workspace_ids[]` filter that limits the report to a subset of the org's
   * workspaces. When omitted, results cover the entire org (which mixes
   * production usage with personal/dev work in one-person orgs).
   */
  workspaceIds?: string[];
}

export async function fetchMessagesUsage(opts: FetchOpts): Promise<UsageResponse> {
  const params: Record<string, string | string[]> = {
    starting_at: opts.startingAt.toISOString(),
    ending_at: opts.endingAt.toISOString(),
    bucket_width: opts.bucketWidth,
    limit: '31',
  };
  if (opts.groupBy?.length) params['group_by[]'] = opts.groupBy;
  if (opts.workspaceIds?.length) params['workspace_ids[]'] = opts.workspaceIds;
  return adminGet<UsageResponse>('/usage_report/messages', params);
}

export async function fetchCost(opts: {
  startingAt: Date;
  endingAt: Date;
  bucketWidth?: '1d';
  groupBy?: CostGroupBy[];
  workspaceIds?: string[];
}): Promise<CostResponse> {
  const params: Record<string, string | string[]> = {
    starting_at: opts.startingAt.toISOString(),
    ending_at: opts.endingAt.toISOString(),
    // Cost report only supports 1d buckets today.
    bucket_width: opts.bucketWidth || '1d',
    limit: '31',
  };
  if (opts.groupBy?.length) params['group_by[]'] = opts.groupBy;
  if (opts.workspaceIds?.length) params['workspace_ids[]'] = opts.workspaceIds;
  return adminGet<CostResponse>('/cost_report', params);
}

/** Bypass the cache (useful in tests or a manual refresh button). */
export function clearAdminApiCache(): void {
  responseCache.clear();
}
