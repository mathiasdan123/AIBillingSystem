import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ENV_KEYS = ['EMAIL_PROVIDER', 'SMTP_USER', 'SMTP_PASS', 'AWS_REGION'] as const;
let savedEnv: Record<string, string | undefined>;

// The factory imports the preferences service (and through it the db) for the
// outbound guard; stub it so these tests need no DATABASE_URL.
const mockGetOutboundEmailBlock = vi.fn();
vi.mock('../services/notificationPreferencesService', () => ({
  getOutboundEmailBlock: (...args: any[]) => mockGetOutboundEmailBlock(...args),
}));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  mockGetOutboundEmailBlock.mockReset();
  mockGetOutboundEmailBlock.mockResolvedValue({ blocked: false });
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
    // The factory returns a guard wrapper whose prototype is the real transport.
    expect((result as any).__kind).toBe('ses-transport');
  });
});

describe('outbound guard (bounce/complaint suppression + demo isolation)', () => {
  const smtpConfig = { host: 'smtp.example.com', port: 587, secure: false, auth: { user: 'u', pass: 'p' } };

  async function buildGuarded() {
    delete process.env.EMAIL_PROVIDER;
    const realSendMail = vi.fn().mockResolvedValue({ messageId: 'real-id', accepted: ['x'], rejected: [] });
    vi.doMock('nodemailer', () => ({ default: { createTransport: vi.fn().mockReturnValue({ sendMail: realSendMail }) } }));
    const { createEmailTransporter } = await import('../services/emailTransportFactory');
    return { transporter: createEmailTransporter(smtpConfig), realSendMail };
  }

  it('passes an unblocked recipient straight through, with the original options object', async () => {
    const { transporter, realSendMail } = await buildGuarded();
    const options = { to: 'ok@example.com', subject: 'Hi', text: 'hello' };

    const info = await transporter.sendMail(options);

    expect(mockGetOutboundEmailBlock).toHaveBeenCalledWith('ok@example.com');
    expect(realSendMail).toHaveBeenCalledTimes(1);
    expect(realSendMail).toHaveBeenCalledWith(options);
    expect(info.messageId).toBe('real-id');
  });

  it('does not send at all when the only recipient is suppressed', async () => {
    mockGetOutboundEmailBlock.mockResolvedValue({ blocked: true, reason: 'suppressed' });
    const { transporter, realSendMail } = await buildGuarded();

    const info = await transporter.sendMail({ to: 'bounced@example.com', subject: 'Hi', text: 'hello' });

    expect(realSendMail).not.toHaveBeenCalled();
    expect(info.messageId).toBeNull();
    expect(info.rejected).toEqual(['bounced@example.com']);
  });

  it('does not send to a demo-practice patient address', async () => {
    mockGetOutboundEmailBlock.mockResolvedValue({ blocked: true, reason: 'demo-practice' });
    const { transporter, realSendMail } = await buildGuarded();

    await transporter.sendMail({ to: 'seeded@example.net', subject: 'Reminder', text: 'x' });

    expect(realSendMail).not.toHaveBeenCalled();
  });

  it('drops only the blocked recipients from a multi-recipient send', async () => {
    mockGetOutboundEmailBlock.mockImplementation(async (addr: string) =>
      addr === 'bad@example.com' ? { blocked: true, reason: 'suppressed' } : { blocked: false }
    );
    const { transporter, realSendMail } = await buildGuarded();

    await transporter.sendMail({ to: 'good@example.com, bad@example.com', subject: 'Hi', text: 'x' });

    expect(realSendMail).toHaveBeenCalledTimes(1);
    expect(realSendMail.mock.calls[0][0].to).toEqual(['good@example.com']);
  });

  it('fails open when the suppression lookup throws', async () => {
    mockGetOutboundEmailBlock.mockRejectedValue(new Error('db down'));
    const { transporter, realSendMail } = await buildGuarded();

    await transporter.sendMail({ to: 'someone@example.com', subject: 'Reset', text: 'x' });

    expect(realSendMail).toHaveBeenCalledTimes(1);
  });

  it('honours callback-style sendMail for a fully suppressed send', async () => {
    mockGetOutboundEmailBlock.mockResolvedValue({ blocked: true, reason: 'suppressed' });
    const { transporter, realSendMail } = await buildGuarded();

    const cb = vi.fn();
    await (transporter.sendMail as any)({ to: 'bounced@example.com', subject: 'Hi', text: 'x' }, cb);

    expect(realSendMail).not.toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith(null, expect.objectContaining({ rejected: ['bounced@example.com'] }));
  });
});
