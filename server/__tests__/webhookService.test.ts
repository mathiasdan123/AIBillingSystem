import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';

// Mock the schema module to avoid the duplicate export issue in shared/schema.ts
vi.mock('../../shared/schema', () => ({
  webhookEndpoints: {
    practiceId: 'practice_id',
    isActive: 'is_active',
    id: 'id',
  },
}));

// Mock the database module before importing the service
vi.mock('../db', () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock drizzle-orm operators
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: any[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: any[]) => ({ type: 'and', args })),
}));

// Mock logger
vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('Webhook Service', () => {
  let webhookService: typeof import('../services/webhookService');
  let mockDb: any;

  beforeEach(async () => {
    vi.resetModules();

    // Re-import after resetting modules to get fresh mocks
    const dbModule = await import('../db');
    mockDb = dbModule.db;

    webhookService = await import('../services/webhookService');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateSignature', () => {
    it('should generate a valid HMAC-SHA256 signature', () => {
      const payload = '{"event":"claim.submitted","data":{}}';
      const secret = 'test-secret-key';

      const signature = webhookService.generateSignature(payload, secret);

      // Verify against Node crypto directly
      const expected = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      expect(signature).toBe(expected);
    });

    it('should produce different signatures for different payloads', () => {
      const secret = 'test-secret';
      const sig1 = webhookService.generateSignature('payload-1', secret);
      const sig2 = webhookService.generateSignature('payload-2', secret);

      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different secrets', () => {
      const payload = 'same-payload';
      const sig1 = webhookService.generateSignature(payload, 'secret-1');
      const sig2 = webhookService.generateSignature(payload, 'secret-2');

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('registerWebhook', () => {
    it('should insert a webhook endpoint and return it', async () => {
      const mockEndpoint = {
        id: 1,
        practiceId: 42,
        url: 'https://example.com/webhook',
        secret: 'my-secret',
        events: ['claim.submitted', 'claim.paid'],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const returningMock = vi.fn().mockResolvedValue([mockEndpoint]);
      const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
      mockDb.insert.mockReturnValue({ values: valuesMock });

      const result = await webhookService.registerWebhook(
        42,
        'https://example.com/webhook',
        'my-secret',
        ['claim.submitted', 'claim.paid'],
      );

      expect(result).toEqual(mockEndpoint);
      expect(mockDb.insert).toHaveBeenCalled();
      expect(valuesMock).toHaveBeenCalledWith({
        practiceId: 42,
        url: 'https://example.com/webhook',
        secret: 'my-secret',
        events: ['claim.submitted', 'claim.paid'],
        isActive: true,
      });
    });
  });

  describe('listWebhooks', () => {
    it('should return all webhooks for a practice', async () => {
      const mockWebhooks = [
        { id: 1, practiceId: 42, url: 'https://a.com/wh', events: ['claim.submitted'], isActive: true },
        { id: 2, practiceId: 42, url: 'https://b.com/wh', events: ['payment.received'], isActive: true },
      ];

      const whereMock = vi.fn().mockResolvedValue(mockWebhooks);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.select.mockReturnValue({ from: fromMock });

      const result = await webhookService.listWebhooks(42);

      expect(result).toEqual(mockWebhooks);
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('deleteWebhook', () => {
    it('should delete a webhook and return true when found', async () => {
      const returningMock = vi.fn().mockResolvedValue([{ id: 1 }]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      mockDb.delete.mockReturnValue({ where: whereMock });

      const result = await webhookService.deleteWebhook(1, 42);

      expect(result).toBe(true);
    });

    it('should return false when webhook not found', async () => {
      const returningMock = vi.fn().mockResolvedValue([]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      mockDb.delete.mockReturnValue({ where: whereMock });

      const result = await webhookService.deleteWebhook(999, 42);

      expect(result).toBe(false);
    });
  });

  describe('sendWebhookEvent', () => {
    it('should send POST request with correct headers and HMAC signature', async () => {
      const mockEndpoints = [
        {
          id: 1,
          practiceId: 42,
          url: 'https://example.com/webhook',
          secret: 'test-secret',
          events: ['claim.submitted'],
          isActive: true,
        },
      ];

      const whereMock = vi.fn().mockResolvedValue(mockEndpoints);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.select.mockReturnValue({ from: fromMock });

      // Mock global fetch
      const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      const payload = { claimId: 123, status: 'submitted' };

      // sendWebhookEvent is fire-and-forget, so we call it and then wait a tick
      webhookService.sendWebhookEvent(42, 'claim.submitted', payload);

      // Wait for the async delivery to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [calledUrl, calledOptions] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe('https://example.com/webhook');
      expect(calledOptions.method).toBe('POST');
      expect(calledOptions.headers['Content-Type']).toBe('application/json');

      // Verify the signature header is present and correct
      const sentBody = calledOptions.body;
      const expectedSignature = crypto
        .createHmac('sha256', 'test-secret')
        .update(sentBody)
        .digest('hex');
      expect(calledOptions.headers['X-Webhook-Signature']).toBe(expectedSignature);

      // Verify the body contains the event and data
      const parsedBody = JSON.parse(sentBody);
      expect(parsedBody.event).toBe('claim.submitted');
      expect(parsedBody.data).toEqual(payload);
      expect(parsedBody.timestamp).toBeDefined();

      vi.unstubAllGlobals();
    });

    it('should not send to endpoints that do not subscribe to the event type', async () => {
      const mockEndpoints = [
        {
          id: 1,
          practiceId: 42,
          url: 'https://example.com/webhook',
          secret: 'test-secret',
          events: ['payment.received'], // Does NOT include claim.submitted
          isActive: true,
        },
      ];

      const whereMock = vi.fn().mockResolvedValue(mockEndpoints);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.select.mockReturnValue({ from: fromMock });

      const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
      vi.stubGlobal('fetch', fetchMock);

      webhookService.sendWebhookEvent(42, 'claim.submitted', { claimId: 1 });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fetchMock).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('should handle fetch errors gracefully without throwing', async () => {
      const mockEndpoints = [
        {
          id: 1,
          practiceId: 42,
          url: 'https://example.com/webhook',
          secret: 'test-secret',
          events: ['claim.denied'],
          isActive: true,
        },
      ];

      const whereMock = vi.fn().mockResolvedValue(mockEndpoints);
      const fromMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.select.mockReturnValue({ from: fromMock });

      const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.stubGlobal('fetch', fetchMock);

      // Should not throw
      expect(() => {
        webhookService.sendWebhookEvent(42, 'claim.denied', { claimId: 1 });
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Fetch was attempted
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });
  });

  describe('WEBHOOK_EVENT_TYPES', () => {
    it('should contain the expected event types', () => {
      expect(webhookService.WEBHOOK_EVENT_TYPES).toContain('claim.submitted');
      expect(webhookService.WEBHOOK_EVENT_TYPES).toContain('claim.paid');
      expect(webhookService.WEBHOOK_EVENT_TYPES).toContain('claim.denied');
      expect(webhookService.WEBHOOK_EVENT_TYPES).toContain('appointment.created');
      expect(webhookService.WEBHOOK_EVENT_TYPES).toContain('appointment.cancelled');
      expect(webhookService.WEBHOOK_EVENT_TYPES).toContain('payment.received');
      expect(webhookService.WEBHOOK_EVENT_TYPES).toHaveLength(6);
    });
  });
});
