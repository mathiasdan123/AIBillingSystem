/**
 * Amazon SES bounce/complaint notifications, delivered via SNS.
 *
 * POST /api/webhooks/ses-notifications
 *
 * Unauthenticated by necessity (SNS calls this, not a logged-in user) -
 * every message is instead cryptographically verified against its AWS
 * signing certificate (server/services/snsVerification.ts) before being
 * trusted. SNS also sends a one-time SubscriptionConfirmation message when
 * the subscription is first created (see infra/ses-bounce-complaint-sns.yaml),
 * which this auto-confirms by fetching its SubscribeURL.
 *
 * Needs the raw request body for signature verification - wired with
 * express.raw() in server/index.ts, same pattern as the Stripe webhook.
 */

import { Router } from 'express';
import logger from '../services/logger';
import { validateSnsMessage } from '../services/snsVerification';
import { suppressEmailForAddress } from '../services/notificationPreferencesService';
import { assertSafeOutboundUrl } from '../utils/ssrf';

const router = Router();

interface SesBounceNotification {
  notificationType: 'Bounce';
  bounce: {
    bounceType: 'Permanent' | 'Transient' | 'Undetermined';
    bouncedRecipients: Array<{ emailAddress: string }>;
  };
}

interface SesComplaintNotification {
  notificationType: 'Complaint';
  complaint: {
    complainedRecipients: Array<{ emailAddress: string }>;
  };
}

type SesNotification = SesBounceNotification | SesComplaintNotification | { notificationType: string };

router.post('/ses-notifications', async (req: any, res) => {
  // Always 200 quickly once the message is at least parseable - SNS
  // retries aggressively on non-2xx, and a transient downstream error
  // (e.g. a DB hiccup) shouldn't turn into a retry storm.
  res.status(200).end();

  let parsed: Record<string, unknown>;
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    logger.warn('SES notification webhook: unparseable body', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  let message: Record<string, unknown>;
  try {
    message = await validateSnsMessage(parsed);
  } catch (error) {
    logger.warn('SES notification webhook: signature verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const type = message.Type as string;

  if (type === 'SubscriptionConfirmation') {
    const subscribeUrl = message.SubscribeURL as string;
    try {
      await assertSafeOutboundUrl(subscribeUrl);
      const confirmResponse = await fetch(subscribeUrl);
      logger.info('SES notification webhook: SNS subscription confirmed', {
        topicArn: message.TopicArn,
        status: confirmResponse.status,
      });
    } catch (error) {
      logger.error('SES notification webhook: failed to confirm SNS subscription', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (type !== 'Notification') {
    logger.info('SES notification webhook: ignoring unexpected SNS message type', { type });
    return;
  }

  let notification: SesNotification;
  try {
    notification = JSON.parse(message.Message as string);
  } catch (error) {
    logger.warn('SES notification webhook: unparseable inner SES message', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  try {
    if (notification.notificationType === 'Bounce') {
      const bounce = (notification as SesBounceNotification).bounce;
      // Only permanent bounces (invalid/closed mailbox) mean "stop
      // sending" - transient bounces (mailbox full, server down) are
      // often temporary and shouldn't permanently disable notifications.
      if (bounce.bounceType === 'Permanent') {
        for (const recipient of bounce.bouncedRecipients) {
          await suppressEmailForAddress(recipient.emailAddress, 'bounce');
        }
      } else {
        logger.info('SES notification webhook: non-permanent bounce, not suppressing', {
          bounceType: bounce.bounceType,
        });
      }
    } else if (notification.notificationType === 'Complaint') {
      const complaint = (notification as SesComplaintNotification).complaint;
      for (const recipient of complaint.complainedRecipients) {
        await suppressEmailForAddress(recipient.emailAddress, 'complaint');
      }
    } else {
      // Delivery notifications and anything else - nothing to do.
    }
  } catch (error) {
    logger.error('SES notification webhook: failed to process notification', {
      notificationType: notification.notificationType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
