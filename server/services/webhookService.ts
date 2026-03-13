/**
 * Webhook Notification Service
 *
 * Manages webhook endpoints and sends event notifications to practices.
 * Uses HMAC-SHA256 for payload signing and fire-and-forget delivery.
 */

import * as crypto from 'crypto';
import { db } from '../db';
import { webhookEndpoints, type WebhookEndpoint } from '../../shared/schema';
import { eq, and } from 'drizzle-orm';
import logger from './logger';

// Supported webhook event types
export const WEBHOOK_EVENT_TYPES = [
  'claim.submitted',
  'claim.paid',
  'claim.denied',
  'appointment.created',
  'appointment.cancelled',
  'payment.received',
] as const;

export type WebhookEventType = typeof WEBHOOK_EVENT_TYPES[number];

/**
 * Generate HMAC-SHA256 signature for a webhook payload
 */
export function generateSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Register a new webhook endpoint for a practice
 */
export async function registerWebhook(
  practiceId: number,
  url: string,
  secret: string,
  events: string[],
) {
  const [endpoint] = await db
    .insert(webhookEndpoints)
    .values({
      practiceId,
      url,
      secret,
      events,
      isActive: true,
    })
    .returning();

  logger.info('Webhook endpoint registered', {
    webhookId: endpoint.id,
    practiceId,
    eventCount: events.length,
  });

  return endpoint;
}

/**
 * List all webhook endpoints for a practice
 */
export async function listWebhooks(practiceId: number) {
  return db
    .select()
    .from(webhookEndpoints)
    .where(eq(webhookEndpoints.practiceId, practiceId));
}

/**
 * Delete a webhook endpoint (must belong to the specified practice)
 */
export async function deleteWebhook(id: number, practiceId: number) {
  const result = await db
    .delete(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.id, id),
        eq(webhookEndpoints.practiceId, practiceId),
      ),
    )
    .returning();

  if (result.length === 0) {
    return false;
  }

  logger.info('Webhook endpoint deleted', { webhookId: id, practiceId });
  return true;
}

/**
 * Send a webhook event to all matching active endpoints for a practice.
 * Fire-and-forget: does not block the caller, errors are logged but not thrown.
 */
export function sendWebhookEvent(
  practiceId: number,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): void {
  // Run async delivery without awaiting - fire and forget
  deliverWebhookEvent(practiceId, eventType, payload).catch((err) => {
    logger.error('Webhook delivery orchestration failed', {
      practiceId,
      eventType,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Internal: delivers webhook events to all matching endpoints
 */
async function deliverWebhookEvent(
  practiceId: number,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.practiceId, practiceId),
        eq(webhookEndpoints.isActive, true),
      ),
    );

  const matchingEndpoints = endpoints.filter((ep: WebhookEndpoint) =>
    ep.events.includes(eventType),
  );

  if (matchingEndpoints.length === 0) {
    return;
  }

  const body = JSON.stringify({
    event: eventType,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const deliveryPromises = matchingEndpoints.map(async (endpoint: WebhookEndpoint) => {
    try {
      const signature = generateSignature(body, endpoint.secret);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
          },
          body,
          signal: controller.signal,
        });

        logger.info('Webhook delivered', {
          webhookId: endpoint.id,
          practiceId,
          eventType,
          statusCode: response.status,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      logger.error('Webhook delivery failed', {
        webhookId: endpoint.id,
        practiceId,
        eventType,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  await Promise.allSettled(deliveryPromises);
}
