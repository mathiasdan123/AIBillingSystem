import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

/**
 * POST /api/webhooks/ses-notifications - unauthenticated by necessity (SNS
 * calls this), so every message is instead cryptographically verified
 * before being trusted. These tests lock in: unverified messages are
 * dropped silently, subscription confirmations are auto-confirmed via a
 * safety-checked fetch, and valid bounce/complaint notifications trigger
 * suppression - except non-permanent bounces, which should not.
 */

const { validateSnsMessageMock, suppressEmailForAddressMock, assertSafeOutboundUrlMock, fetchMock } = vi.hoisted(() => ({
  validateSnsMessageMock: vi.fn(),
  suppressEmailForAddressMock: vi.fn(async () => ({ patientsSuppressed: 1, staffSuppressed: 0 })),
  assertSafeOutboundUrlMock: vi.fn(async (url: string) => new URL(url)),
  fetchMock: vi.fn(async () => ({ status: 200 })),
}));

vi.mock('../services/snsVerification', () => ({ validateSnsMessage: validateSnsMessageMock }));
vi.mock('../services/notificationPreferencesService', () => ({ suppressEmailForAddress: suppressEmailForAddressMock }));
vi.mock('../utils/ssrf', () => ({ assertSafeOutboundUrl: assertSafeOutboundUrlMock }));
vi.mock('../services/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.stubGlobal('fetch', fetchMock);

import sesNotificationsRouter from '../routes/sesNotifications';

function buildApp(): Express {
  const app = express();
  // Mirrors server/index.ts: raw body for this path, parsed as text.
  app.use('/api/webhooks/ses-notifications', express.raw({ type: ['text/plain', 'application/json'] }));
  app.use('/api/webhooks', sesNotificationsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  validateSnsMessageMock.mockReset();
  suppressEmailForAddressMock.mockReset().mockResolvedValue({ patientsSuppressed: 1, staffSuppressed: 0 });
  assertSafeOutboundUrlMock.mockReset().mockImplementation(async (url: string) => new URL(url));
  fetchMock.mockReset().mockResolvedValue({ status: 200 });
});

describe('POST /api/webhooks/ses-notifications', () => {
  it('returns 200 and does nothing further when signature verification fails', async () => {
    validateSnsMessageMock.mockRejectedValueOnce(new Error('bad signature'));

    const res = await request(buildApp())
      .post('/api/webhooks/ses-notifications')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ Type: 'Notification', Message: '{}' }));

    expect(res.status).toBe(200);
    expect(suppressEmailForAddressMock).not.toHaveBeenCalled();
  });

  it('auto-confirms a subscription confirmation via a safety-checked fetch', async () => {
    validateSnsMessageMock.mockResolvedValueOnce({
      Type: 'SubscriptionConfirmation',
      SubscribeURL: 'https://sns.us-east-1.amazonaws.com/confirm?token=abc',
      TopicArn: 'arn:aws:sns:us-east-1:123:topic',
    });

    const res = await request(buildApp())
      .post('/api/webhooks/ses-notifications')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ Type: 'SubscriptionConfirmation' }));

    expect(res.status).toBe(200);
    expect(assertSafeOutboundUrlMock).toHaveBeenCalledWith('https://sns.us-east-1.amazonaws.com/confirm?token=abc');
    expect(fetchMock).toHaveBeenCalledWith('https://sns.us-east-1.amazonaws.com/confirm?token=abc');
  });

  it('suppresses recipients of a permanent bounce', async () => {
    validateSnsMessageMock.mockResolvedValueOnce({
      Type: 'Notification',
      Message: JSON.stringify({
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [{ emailAddress: 'gone@example.com' }, { emailAddress: 'also-gone@example.com' }],
        },
      }),
    });

    const res = await request(buildApp())
      .post('/api/webhooks/ses-notifications')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ Type: 'Notification' }));

    expect(res.status).toBe(200);
    expect(suppressEmailForAddressMock).toHaveBeenCalledTimes(2);
    expect(suppressEmailForAddressMock).toHaveBeenCalledWith('gone@example.com', 'bounce');
    expect(suppressEmailForAddressMock).toHaveBeenCalledWith('also-gone@example.com', 'bounce');
  });

  it('does NOT suppress recipients of a transient bounce', async () => {
    validateSnsMessageMock.mockResolvedValueOnce({
      Type: 'Notification',
      Message: JSON.stringify({
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Transient',
          bouncedRecipients: [{ emailAddress: 'mailbox-full@example.com' }],
        },
      }),
    });

    await request(buildApp())
      .post('/api/webhooks/ses-notifications')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ Type: 'Notification' }));

    expect(suppressEmailForAddressMock).not.toHaveBeenCalled();
  });

  it('suppresses recipients of a complaint', async () => {
    validateSnsMessageMock.mockResolvedValueOnce({
      Type: 'Notification',
      Message: JSON.stringify({
        notificationType: 'Complaint',
        complaint: { complainedRecipients: [{ emailAddress: 'annoyed@example.com' }] },
      }),
    });

    await request(buildApp())
      .post('/api/webhooks/ses-notifications')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ Type: 'Notification' }));

    expect(suppressEmailForAddressMock).toHaveBeenCalledWith('annoyed@example.com', 'complaint');
  });

  it('does nothing for a Delivery notification', async () => {
    validateSnsMessageMock.mockResolvedValueOnce({
      Type: 'Notification',
      Message: JSON.stringify({ notificationType: 'Delivery' }),
    });

    const res = await request(buildApp())
      .post('/api/webhooks/ses-notifications')
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify({ Type: 'Notification' }));

    expect(res.status).toBe(200);
    expect(suppressEmailForAddressMock).not.toHaveBeenCalled();
  });
});
