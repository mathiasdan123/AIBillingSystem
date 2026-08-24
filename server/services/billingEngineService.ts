/**
 * Billing engine — TherapyBill's percentage-of-collections fee.
 *
 * The pricing model is a flat monthly plan fee PLUS a percentage of what the
 * practice actually collected from insurance ("you only pay when you get
 * paid"). The percentage half existed only as a number on the pricing page:
 * nothing computed a basis and nothing ever invoiced it, so that revenue line
 * collected $0. This is that half.
 *
 * Deliberate design decisions:
 *
 * - **Basis is insurance payments only.** `payment_postings.paymentAmount` is
 *   what the payer paid. `patientResponsibility` (copay/coinsurance/deductible
 *   owed by the patient) is NOT collections — it is a bill we may not have
 *   collected — and is excluded. Reversed postings are excluded too, so a
 *   clawback removes its own basis.
 *
 * - **Draft invoices only, never an automatic charge.** Every run leaves a
 *   DRAFT Stripe invoice for a human to review and send. Charging a customer
 *   a computed amount with nobody looking is how you turn an arithmetic bug
 *   into a chargeback and a lost account. `auto_advance: false` keeps Stripe
 *   from finalizing on its own.
 *
 * - **Idempotent per (practice, month).** Re-running recomputes the basis but
 *   never raises a second invoice for a month that already has one.
 *
 * - **Integer cents everywhere.** Decimal strings from Postgres are parsed to
 *   cents immediately; no float arithmetic touches money.
 */

import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../db';
import { billingEnginePeriods, paymentPostings, practices } from '@shared/schema';
import logger from './logger';
import { isStripeConfigured, getStripeInstance } from './stripeService';

/** Parse a Postgres decimal string ("1234.56") to integer cents. Never floats. */
export function decimalToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const s = String(value).trim();
  const negative = s.startsWith('-');
  const [whole, frac = ''] = s.replace(/^-/, '').split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isFinite(cents)) return 0;
  return negative ? -cents : cents;
}

/** Fee for a basis at a percentage, rounded half-up to the cent. */
export function feeForCollections(collectionsCents: number, percentage: number): number {
  if (!Number.isFinite(collectionsCents) || collectionsCents <= 0) return 0;
  if (!Number.isFinite(percentage) || percentage <= 0) return 0;
  return Math.round((collectionsCents * percentage) / 100);
}

/** First day of the month containing `d`, as a YYYY-MM-DD string. */
export function monthStart(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/** First day of the following month, as a YYYY-MM-DD string. */
export function nextMonthStart(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const ny = m === 11 ? y + 1 : y;
  const nm = m === 11 ? 0 : m + 1;
  return `${ny}-${String(nm + 1).padStart(2, '0')}-01`;
}

/**
 * Sum non-reversed insurance payments posted in [start, end) for a practice.
 * Summed in SQL as a decimal, then converted to cents once.
 */
export async function collectionsCentsForPeriod(
  practiceId: number,
  startDate: string,
  endDateExclusive: string,
): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${paymentPostings.paymentAmount}), 0)::text`,
    })
    .from(paymentPostings)
    .where(
      and(
        eq(paymentPostings.practiceId, practiceId),
        gte(paymentPostings.paymentDate, startDate),
        lt(paymentPostings.paymentDate, endDateExclusive),
        // A reversed posting is money we gave back — it must not be billed on.
        eq(paymentPostings.reversed, false),
      ),
    );
  return decimalToCents(row?.total ?? '0');
}

export interface BillingEngineRunResult {
  periodMonth: string;
  practicesConsidered: number;
  invoicesDrafted: number;
  skippedZero: number;
  errors: number;
  rows: Array<{
    practiceId: number;
    collectionsCents: number;
    feeCents: number;
    status: string;
    stripeInvoiceId?: string | null;
    error?: string;
  }>;
}

/**
 * Create a DRAFT Stripe invoice for one practice's fee.
 *
 * Creates the invoice first and attaches the line item to it explicitly,
 * rather than relying on Stripe sweeping pending invoice items — that sweep
 * would pull in unrelated items and bill the customer for them.
 */
async function draftInvoice(params: {
  stripeCustomerId: string;
  practiceId: number;
  periodMonth: string;
  collectionsCents: number;
  percentage: number;
  feeCents: number;
}): Promise<string> {
  const stripe = getStripeInstance();
  const collectionsDollars = (params.collectionsCents / 100).toFixed(2);

  const invoice = await stripe.invoices.create({
    customer: params.stripeCustomerId,
    // Draft, and it stays draft: a human reviews and sends it.
    auto_advance: false,
    collection_method: 'send_invoice',
    days_until_due: 14,
    description:
      `TherapyBill AI billing engine — ${params.periodMonth.slice(0, 7)}: ` +
      `${params.percentage}% of $${collectionsDollars} insurance collections`,
    metadata: {
      practiceId: String(params.practiceId),
      periodMonth: params.periodMonth,
      collectionsCents: String(params.collectionsCents),
      percentage: String(params.percentage),
      type: 'billing_engine',
    },
  });

  // Must hold a real invoice id BEFORE creating the line item. An item
  // created without one becomes a pending item that Stripe would sweep onto
  // the customer's next invoice — billing them for a fee whose own invoice
  // never existed.
  if (!invoice.id) {
    throw new Error('Stripe returned an invoice without an id');
  }

  await stripe.invoiceItems.create({
    customer: params.stripeCustomerId,
    invoice: invoice.id,
    amount: params.feeCents,
    currency: 'usd',
    description:
      `Billing engine fee — ${params.percentage}% of $${collectionsDollars} collected ` +
      `(${params.periodMonth.slice(0, 7)})`,
  });

  return invoice.id;
}

/**
 * Compute and draft the billing-engine fee for every real practice for the
 * month containing `whenInMonth`.
 *
 * `dryRun` computes and records the basis without creating any Stripe
 * invoice — useful for checking the numbers before money is involved.
 */
export async function runBillingEngineForMonth(
  whenInMonth: Date,
  opts: { dryRun?: boolean } = {},
): Promise<BillingEngineRunResult> {
  const periodMonth = monthStart(whenInMonth);
  const periodEnd = nextMonthStart(whenInMonth);
  const dryRun = opts.dryRun === true;

  const result: BillingEngineRunResult = {
    periodMonth,
    practicesConsidered: 0,
    invoicesDrafted: 0,
    skippedZero: 0,
    errors: 0,
    rows: [],
  };

  // Real practices only — the demo practice must never be invoiced.
  const realPractices = await db
    .select({
      id: practices.id,
      name: practices.name,
      billingPercentage: practices.billingPercentage,
      stripeCustomerId: practices.stripeCustomerId,
    })
    .from(practices)
    .where(eq(practices.isDemo, false));

  result.practicesConsidered = realPractices.length;

  for (const practice of realPractices) {
    try {
      const collectionsCents = await collectionsCentsForPeriod(practice.id, periodMonth, periodEnd);
      const percentage = Number(practice.billingPercentage ?? 6);
      const feeCents = feeForCollections(collectionsCents, percentage);

      // Has this month already been invoiced? Never bill it twice.
      const [existing] = await db
        .select()
        .from(billingEnginePeriods)
        .where(
          and(
            eq(billingEnginePeriods.practiceId, practice.id),
            eq(billingEnginePeriods.periodMonth, periodMonth),
          ),
        )
        .limit(1);

      if (existing?.stripeInvoiceId) {
        result.rows.push({
          practiceId: practice.id,
          collectionsCents,
          feeCents,
          status: 'already_invoiced',
          stripeInvoiceId: existing.stripeInvoiceId,
        });
        continue;
      }

      let status = 'computed';
      let stripeInvoiceId: string | null = null;
      let errorMessage: string | null = null;

      if (feeCents <= 0) {
        // No collections, no fee. Don't send anyone a $0 invoice.
        status = 'skipped_zero';
        result.skippedZero++;
      } else if (dryRun) {
        status = 'computed';
      } else if (!isStripeConfigured() || !practice.stripeCustomerId) {
        status = 'error';
        errorMessage = !practice.stripeCustomerId
          ? 'Practice has no Stripe customer — cannot raise an invoice'
          : 'Stripe is not configured';
        result.errors++;
      } else {
        try {
          stripeInvoiceId = await draftInvoice({
            stripeCustomerId: practice.stripeCustomerId,
            practiceId: practice.id,
            periodMonth,
            collectionsCents,
            percentage,
            feeCents,
          });
          status = 'invoice_drafted';
          result.invoicesDrafted++;
        } catch (err: any) {
          status = 'error';
          errorMessage = err?.message ?? 'Stripe invoice creation failed';
          result.errors++;
          logger.error('Billing engine: draft invoice failed', {
            practiceId: practice.id,
            periodMonth,
            error: errorMessage,
          });
        }
      }

      const row = {
        practiceId: practice.id,
        periodMonth,
        collectionsCents,
        percentageApplied: String(percentage),
        feeCents,
        status,
        stripeInvoiceId,
        errorMessage,
        computedAt: new Date(),
      };

      if (existing) {
        await db
          .update(billingEnginePeriods)
          .set(row)
          .where(eq(billingEnginePeriods.id, existing.id));
      } else {
        await db.insert(billingEnginePeriods).values(row);
      }

      result.rows.push({
        practiceId: practice.id,
        collectionsCents,
        feeCents,
        status,
        stripeInvoiceId,
        error: errorMessage ?? undefined,
      });
    } catch (err: any) {
      result.errors++;
      result.rows.push({
        practiceId: practice.id,
        collectionsCents: 0,
        feeCents: 0,
        status: 'error',
        error: err?.message ?? String(err),
      });
      logger.error('Billing engine: practice failed', {
        practiceId: practice.id,
        periodMonth,
        error: err?.message,
      });
    }
  }

  logger.info('Billing engine run complete', {
    periodMonth,
    practicesConsidered: result.practicesConsidered,
    invoicesDrafted: result.invoicesDrafted,
    skippedZero: result.skippedZero,
    errors: result.errors,
    dryRun,
  });

  return result;
}

/** The month just ended, relative to `now`. What the monthly cron bills. */
export function previousMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
}
