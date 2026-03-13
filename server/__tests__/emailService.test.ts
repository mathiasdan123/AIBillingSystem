import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mocks
const mockSendMail = vi.hoisted(() => vi.fn());
const mockCreateTransport = vi.hoisted(() => vi.fn(() => ({ sendMail: mockSendMail })));

vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
  createTransport: mockCreateTransport,
}));

vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// We need fresh module state for each test to reset internal singletons
let sendEmail: typeof import('../services/emailService').sendEmail;
let sendEmailImmediate: typeof import('../services/emailService').sendEmailImmediate;
let isSmtpConfigured: typeof import('../services/emailService').isSmtpConfigured;

async function loadModule() {
  vi.resetModules();
  const mod = await import('../services/emailService');
  sendEmail = mod.sendEmail;
  sendEmailImmediate = mod.sendEmailImmediate;
  isSmtpConfigured = mod.isSmtpConfigured;
}

const emailParams = {
  to: 'test@example.com',
  subject: 'Test Email',
  html: '<p>Hello</p>',
  text: 'Hello',
};

describe('Email Service', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSendMail.mockResolvedValue({ messageId: 'test-id' });
  });

  afterEach(() => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  describe('isSmtpConfigured', () => {
    it('returns false when SMTP_USER and SMTP_PASS are not set', async () => {
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      await loadModule();
      expect(isSmtpConfigured()).toBe(false);
    });

    it('returns true when both SMTP_USER and SMTP_PASS are set', async () => {
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'password123';
      await loadModule();
      expect(isSmtpConfigured()).toBe(true);
    });

    it('returns false when only SMTP_USER is set', async () => {
      process.env.SMTP_USER = 'user@test.com';
      delete process.env.SMTP_PASS;
      await loadModule();
      expect(isSmtpConfigured()).toBe(false);
    });
  });

  describe('sendEmail', () => {
    it('returns error when SMTP is not configured', async () => {
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      await loadModule();
      const result = await sendEmail(emailParams);
      expect(result.success).toBe(false);
      expect(result.error).toBe('SMTP not configured');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('sends email successfully when SMTP is configured', async () => {
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'password123';
      await loadModule();
      const result = await sendEmail(emailParams);
      expect(result.success).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });

    it('includes fromName in the from field when provided', async () => {
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'password123';
      await loadModule();
      await sendEmail({ ...emailParams, fromName: 'My Practice' });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: expect.stringContaining('My Practice'),
        }),
      );
    });

    it('returns failure on permanent send error', async () => {
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'password123';
      mockSendMail.mockRejectedValue(new Error('550 Mailbox not found'));
      await loadModule();
      const result = await sendEmail(emailParams);
      expect(result.success).toBe(false);
      expect(result.error).toContain('550');
    });

    it('retries on transient ECONNRESET error', async () => {
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'password123';
      mockSendMail
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({ messageId: 'retry-ok' });
      await loadModule();
      const result = await sendEmail(emailParams);
      expect(result.success).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendEmailImmediate', () => {
    it('returns error when SMTP is not configured', async () => {
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;
      await loadModule();
      const result = await sendEmailImmediate(emailParams);
      expect(result.success).toBe(false);
      expect(result.error).toBe('SMTP not configured');
    });

    it('sends email immediately when SMTP is configured', async () => {
      process.env.SMTP_USER = 'user@test.com';
      process.env.SMTP_PASS = 'password123';
      await loadModule();
      const result = await sendEmailImmediate(emailParams);
      expect(result.success).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(1);
    });
  });
});
