/**
 * AWS Secrets Manager helper.
 *
 * Reads secrets server-side with a small in-process cache. Falls back to an
 * env var when no secret ARN is configured (local dev). Never expose the
 * returned values to the client.
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import logger from './logger';

interface CachedSecret {
  value: string;
  expiresAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 min
const cache = new Map<string, CachedSecret>();

let client: SecretsManagerClient | null = null;
const getClient = (): SecretsManagerClient => {
  if (!client) {
    client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return client;
};

/**
 * Read a secret string from AWS Secrets Manager (with a 10-min cache).
 *
 * If the secret JSON contains the key in `jsonKey`, returns that field;
 * otherwise returns the raw SecretString.
 */
export async function getSecret(secretId: string, jsonKey?: string): Promise<string> {
  const cacheKey = jsonKey ? `${secretId}#${jsonKey}` : secretId;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const out = await getClient().send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!out.SecretString) throw new Error(`Secret ${secretId} has no SecretString`);

  let value = out.SecretString;
  if (jsonKey) {
    try {
      const parsed = JSON.parse(out.SecretString);
      if (typeof parsed[jsonKey] !== 'string') {
        throw new Error(`Secret ${secretId} JSON has no string field "${jsonKey}"`);
      }
      value = parsed[jsonKey];
    } catch (e) {
      throw new Error(`Failed to parse secret ${secretId} as JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  cache.set(cacheKey, { value, expiresAt: Date.now() + TTL_MS });
  return value;
}

/**
 * Read a secret, preferring AWS Secrets Manager (if a secret ARN/name is set
 * in `secretEnvVar`) and falling back to a plain env var (`fallbackEnvVar`)
 * — useful for local dev and tests.
 */
export async function getSecretOrEnv(opts: {
  secretEnvVar: string;
  jsonKey?: string;
  fallbackEnvVar: string;
}): Promise<string | null> {
  const secretId = process.env[opts.secretEnvVar];
  if (secretId) {
    try {
      return await getSecret(secretId, opts.jsonKey);
    } catch (e) {
      logger.error('Secrets Manager fetch failed; falling back to env var', {
        secretEnvVar: opts.secretEnvVar,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return process.env[opts.fallbackEnvVar] ?? null;
}
