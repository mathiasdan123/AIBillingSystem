import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ENV_KEYS = [
  'SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'AWS_REGION',
] as const;
let savedEnv: Record<string, string | undefined>;

vi.mock('../services/notificationPreferencesService', () => ({
  shouldSendNotification: vi.fn().mockResolvedValue({
    channels: { sms: true, email: true },
    inQuietHours: false,
  }),
}));

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
  vi.doUnmock('../services/awsSnsSmsService');
  vi.doUnmock('twilio');
  vi.doUnmock('@aws-sdk/client-sns');
  vi.restoreAllMocks();
});

describe('smsService provider switch', () => {
  it('defaults to Twilio (mock path) when SMS_PROVIDER is unset', async () => {
    delete process.env.SMS_PROVIDER;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    const snsSendMock = vi.fn();
    vi.doMock('../services/awsSnsSmsService', () => ({
      isSnsSmsAvailable: () => true,
      sendSMS: snsSendMock,
    }));

    const { sendSMS } = await import('../services/smsService');
    const result = await sendSMS('+15551234567', 'Reminder: appointment tomorrow.');

    expect(result.success).toBe(true);
    expect(snsSendMock).not.toHaveBeenCalled();
  });

  it('routes through Amazon SNS when SMS_PROVIDER=aws', async () => {
    process.env.SMS_PROVIDER = 'aws';
    const snsSendMock = vi.fn().mockResolvedValue({ success: true, messageId: 'sns-123' });
    vi.doMock('../services/awsSnsSmsService', () => ({
      isSnsSmsAvailable: () => true,
      sendSMS: snsSendMock,
    }));

    const { sendSMS, isSMSConfigured } = await import('../services/smsService');
    expect(isSMSConfigured()).toBe(true);

    const result = await sendSMS('+15551234567', 'Reminder: appointment tomorrow.');

    expect(snsSendMock).toHaveBeenCalledWith('+15551234567', 'Reminder: appointment tomorrow.');
    expect(result).toEqual({ success: true, messageId: 'sns-123' });
  });

  it('isSMSConfigured() does not require Twilio env vars when SMS_PROVIDER=aws', async () => {
    process.env.SMS_PROVIDER = 'aws';
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    vi.doMock('../services/awsSnsSmsService', () => ({
      isSnsSmsAvailable: () => true,
      sendSMS: vi.fn(),
    }));

    const { isSMSConfigured } = await import('../services/smsService');
    expect(isSMSConfigured()).toBe(true);
  });
});

describe('awsSnsSmsService', () => {
  it('formats a 10-digit US number to E.164 and publishes via SNS', async () => {
    const publishMock = vi.fn().mockResolvedValue({ MessageId: 'sns-abc' });
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn().mockImplementation(() => ({ send: publishMock })),
      PublishCommand: vi.fn().mockImplementation((input) => ({ input })),
    }));

    const { sendSMS } = await import('../services/awsSnsSmsService');
    const result = await sendSMS('5551234567', 'Your appointment is tomorrow.');

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('sns-abc');
    expect(publishMock).toHaveBeenCalledTimes(1);
    const sentCommand = publishMock.mock.calls[0][0];
    expect(sentCommand.input.PhoneNumber).toBe('+15551234567');
    expect(sentCommand.input.Message).toBe('Your appointment is tomorrow.');
  });

  it('rejects an unformattable phone number without calling SNS', async () => {
    const publishMock = vi.fn();
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn().mockImplementation(() => ({ send: publishMock })),
      PublishCommand: vi.fn(),
    }));

    const { sendSMS } = await import('../services/awsSnsSmsService');
    const result = await sendSMS('not-a-phone-number', 'Hello');

    expect(result.success).toBe(false);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('returns a failure result when SNS throws', async () => {
    const publishMock = vi.fn().mockRejectedValue(new Error('SNS unavailable'));
    vi.doMock('@aws-sdk/client-sns', () => ({
      SNSClient: vi.fn().mockImplementation(() => ({ send: publishMock })),
      PublishCommand: vi.fn().mockImplementation((input) => ({ input })),
    }));

    const { sendSMS } = await import('../services/awsSnsSmsService');
    const result = await sendSMS('+15551234567', 'Hello');

    expect(result.success).toBe(false);
    expect(result.error).toContain('SNS unavailable');
  });
});
