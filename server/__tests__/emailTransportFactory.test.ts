import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ENV_KEYS = ['EMAIL_PROVIDER', 'SMTP_USER', 'SMTP_PASS', 'AWS_REGION'] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.doUnmock('@aws-sdk/client-sesv2');
  vi.doUnmock('nodemailer');
  vi.restoreAllMocks();
});

describe('useAwsSes / isEmailTransportConfigured', () => {
  it('defaults to SMTP and requires SMTP_USER + SMTP_PASS', async () => {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const { useAwsSes, isEmailTransportConfigured } = await import('../services/emailTransportFactory');

    expect(useAwsSes()).toBe(false);
    expect(isEmailTransportConfigured()).toBe(false);

    process.env.SMTP_USER = 'user';
    process.env.SMTP_PASS = 'pass';
    expect(isEmailTransportConfigured()).toBe(true);
  });

  it('is configured via EMAIL_PROVIDER=aws with no SMTP credentials needed', async () => {
    process.env.EMAIL_PROVIDER = 'aws';
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const { useAwsSes, isEmailTransportConfigured } = await import('../services/emailTransportFactory');

    expect(useAwsSes()).toBe(true);
    expect(isEmailTransportConfigured()).toBe(true);
  });
});

describe('createEmailTransporter', () => {
  it('builds a plain SMTP transport by default, unchanged from prior behavior', async () => {
    delete process.env.EMAIL_PROVIDER;
    const createTransportMock = vi.fn().mockReturnValue({ __kind: 'smtp-transport' });
    vi.doMock('nodemailer', () => ({ default: { createTransport: createTransportMock } }));

    const { createEmailTransporter } = await import('../services/emailTransportFactory');
    const smtpConfig = { host: 'smtp.example.com', port: 587, secure: false, auth: { user: 'u', pass: 'p' } };
    createEmailTransporter(smtpConfig);

    expect(createTransportMock).toHaveBeenCalledWith(smtpConfig);
  });

  it('builds an SES transport when EMAIL_PROVIDER=aws, ignoring the SMTP config', async () => {
    process.env.EMAIL_PROVIDER = 'aws';
    const createTransportMock = vi.fn().mockReturnValue({ __kind: 'ses-transport' });
    vi.doMock('nodemailer', () => ({ default: { createTransport: createTransportMock } }));
    const sesClientInstance = { __kind: 'ses-client' };
    const SESv2ClientMock = vi.fn().mockImplementation(() => sesClientInstance);
    const SendEmailCommandMock = vi.fn();
    vi.doMock('@aws-sdk/client-sesv2', () => ({
      SESv2Client: SESv2ClientMock,
      SendEmailCommand: SendEmailCommandMock,
    }));

    const { createEmailTransporter } = await import('../services/emailTransportFactory');
    const smtpConfig = { host: 'smtp.example.com', port: 587, secure: false, auth: { user: 'u', pass: 'p' } };
    const result = createEmailTransporter(smtpConfig);

    expect(SESv2ClientMock).toHaveBeenCalledWith({ region: 'us-east-1' });
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        SES: expect.objectContaining({ sesClient: sesClientInstance, SendEmailCommand: SendEmailCommandMock }),
      })
    );
    expect(result).toEqual({ __kind: 'ses-transport' });
  });
});
