/**
 * Plaid integration for deposit reconciliation. Read-only by construction:
 * only the Transactions product is requested — this service can see deposits
 * and can never move money. Access tokens are encrypted at rest with the
 * platform's AES-256-GCM service. Nothing patient-identifying is ever sent to
 * Plaid; the remittance<->deposit association exists only in our database.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from 'crypto';
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from 'plaid';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { bankAccounts, bankItems, bankTransactions, type BankAccount } from '@shared/schema';
import { decryptField, encryptField } from '../phiEncryptionService';
import logger from '../logger';

let _client: PlaidApi | null = null;

export function plaidClient(): PlaidApi {
  if (_client) return _client;
  const env = process.env.PLAID_ENV ?? 'sandbox';
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    throw new Error('PLAID_CLIENT_ID / PLAID_SECRET not configured');
  }
  _client = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env]!,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
          'PLAID-SECRET': process.env.PLAID_SECRET,
        },
      },
    }),
  );
  return _client;
}

export function isPlaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export async function createLinkToken(practiceId: number): Promise<string> {
  const { data } = await plaidClient().linkTokenCreate({
    user: { client_user_id: `practice-${practiceId}` },
    client_name: 'TherapyBill AI',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
    webhook: process.env.PLAID_WEBHOOK_URL || undefined,
  });
  return data.link_token;
}

export async function exchangePublicToken(
  practiceId: number,
  publicToken: string,
): Promise<{ itemId: number; accounts: number; initialSync: SyncTotals }> {
  const client = plaidClient();
  const { data: exchanged } = await client.itemPublicTokenExchange({ public_token: publicToken });
  const { data: accountsRes } = await client.accountsGet({ access_token: exchanged.access_token });

  const encrypted = encryptField(exchanged.access_token);
  if (!encrypted) throw new Error('Failed to encrypt Plaid access token');

  const [item] = await db
    .insert(bankItems)
    .values({
      practiceId,
      plaidItemId: exchanged.item_id,
      accessTokenEncrypted: JSON.stringify(encrypted),
      institutionName: accountsRes.item.institution_name ?? null,
    })
    .returning();

  for (const a of accountsRes.accounts) {
    await db.insert(bankAccounts).values({
      itemId: item!.id,
      plaidAccountId: a.account_id,
      name: a.name,
      mask: a.mask,
      subtype: a.subtype ?? null,
    });
  }

  const initialSync = await syncItem(exchanged.item_id);
  return { itemId: item!.id, accounts: accountsRes.accounts.length, initialSync };
}

export interface SyncTotals {
  added: number;
  modified: number;
  removed: number;
}

/** Cursor-based transaction sync for one bank item. Idempotent. */
export async function syncItem(plaidItemId: string): Promise<SyncTotals> {
  const [item] = await db.select().from(bankItems).where(eq(bankItems.plaidItemId, plaidItemId));
  if (!item) throw new Error(`Unknown Plaid item ${plaidItemId}`);

  const accessToken = decryptField(JSON.parse(item.accessTokenEncrypted));
  if (!accessToken) throw new Error('Failed to decrypt Plaid access token');

  const accounts: BankAccount[] = await db.select().from(bankAccounts).where(eq(bankAccounts.itemId, item.id));
  const accountIdByPlaidId = new Map(accounts.map((a: BankAccount) => [a.plaidAccountId, a.id]));

  let cursor = item.syncCursor ?? undefined;
  const totals: SyncTotals = { added: 0, modified: 0, removed: 0 };
  let hasMore = true;

  while (hasMore) {
    const { data } = await plaidClient().transactionsSync({ access_token: accessToken, cursor });
    for (const t of [...data.added, ...data.modified]) {
      const accountId = accountIdByPlaidId.get(t.account_id);
      if (!accountId) continue;
      // Plaid: negative amount = money in. Stored as positive cents for credits.
      const amountCents = Math.round(-t.amount * 100);
      await db
        .insert(bankTransactions)
        .values({
          practiceId: item.practiceId,
          accountId,
          plaidTransactionId: t.transaction_id,
          postedDate: t.date,
          descriptor: t.name ?? '',
          amountCents,
          pending: t.pending,
        })
        .onConflictDoUpdate({
          target: bankTransactions.plaidTransactionId,
          set: { postedDate: t.date, descriptor: t.name ?? '', amountCents, pending: t.pending },
        });
    }
    for (const r of data.removed) {
      await db
        .delete(bankTransactions)
        .where(
          and(
            eq(bankTransactions.plaidTransactionId, r.transaction_id),
            eq(bankTransactions.status, 'unmatched'),
          ),
        );
    }
    totals.added += data.added.length;
    totals.modified += data.modified.length;
    totals.removed += data.removed.length;
    cursor = data.next_cursor;
    hasMore = data.has_more;
    await db.update(bankItems).set({ syncCursor: cursor }).where(eq(bankItems.id, item.id));
  }
  return totals;
}

export async function markItemLoginRequired(plaidItemId: string): Promise<void> {
  await db
    .update(bankItems)
    .set({ status: 'login_required' })
    .where(eq(bankItems.plaidItemId, plaidItemId));
}

// ---- Webhook signature verification (Plaid-Verification JWT, ES256) ----

const webhookKeyCache = new Map<string, object>();

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verify a Plaid webhook: ES256 JWT in the Plaid-Verification header whose
 * request_body_sha256 claim must match the raw body. Returns true only when
 * the signature, freshness (iat <= 5 min old), and body hash all check out.
 */
export async function verifyPlaidWebhook(jwtHeader: string | undefined, rawBody: Buffer): Promise<boolean> {
  try {
    if (!jwtHeader) return false;
    const parts = jwtHeader.split('.');
    if (parts.length !== 3) return false;
    const header = JSON.parse(b64urlToBuffer(parts[0]!).toString('utf8'));
    if (header.alg !== 'ES256' || typeof header.kid !== 'string') return false;

    let jwk = webhookKeyCache.get(header.kid);
    if (!jwk) {
      const { data } = await plaidClient().webhookVerificationKeyGet({ key_id: header.kid });
      jwk = data.key as object;
      webhookKeyCache.set(header.kid, jwk);
    }
    const key = createPublicKey({ key: jwk as any, format: 'jwk' });
    const valid = cryptoVerify(
      'sha256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      { key, dsaEncoding: 'ieee-p1363' },
      b64urlToBuffer(parts[2]!),
    );
    if (!valid) return false;

    const claims = JSON.parse(b64urlToBuffer(parts[1]!).toString('utf8'));
    if (typeof claims.iat !== 'number' || Date.now() / 1000 - claims.iat > 300) return false;
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    return claims.request_body_sha256 === bodyHash;
  } catch (err) {
    logger.warn('Plaid webhook verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
