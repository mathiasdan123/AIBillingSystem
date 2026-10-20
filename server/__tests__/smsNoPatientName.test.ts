import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Twilio is not a signed HIPAA Business Associate for this account (BAA
 * quoted at $1000/mo, declined 2026-10-20). Until/unless that changes,
 * nothing that identifies a patient by name may go into an outbound SMS
 * body - only generic appointment/practice details the recipient's own
 * phone number is already keyed to. Locking in that the patient's name is
 * never interpolated into any Twilio-bound message text.
 */

vi.mock('../services/notificationPreferencesService', () => ({
  shouldSendNotification: vi.fn().mockResolvedValue({
    channels: { sms: true, email: true },
    inQuietHours: false,
  }),
}));

const NAME = 'Jane Qxyzmortenson';

describe('smsService — no patient name in message body', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('omits the patient name from the appointment reminder SMS', async () => {
    const { sendAppointmentReminderSMS } = await import('../services/smsService');
    await sendAppointmentReminderSMS(
      '+15551234567',
      NAME,
      new Date('2026-11-01T15:00:00Z'),
      'Test Practice',
      '+15559998888',
    );
    const logged = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toContain(NAME);
    expect(logged).not.toContain('Jane');
  });

  it('omits the patient name from the appointment confirmation SMS', async () => {
    const { sendAppointmentConfirmationSMS } = await import('../services/smsService');
    await sendAppointmentConfirmationSMS(
      '+15551234567',
      NAME,
      new Date('2026-11-01T15:00:00Z'),
      'Test Practice',
    );
    const logged = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toContain(NAME);
    expect(logged).not.toContain('Jane');
  });

  it('omits the patient name from the appointment cancellation SMS', async () => {
    const { sendAppointmentCancellationSMS } = await import('../services/smsService');
    await sendAppointmentCancellationSMS(
      '+15551234567',
      NAME,
      new Date('2026-11-01T15:00:00Z'),
      'Test Practice',
      '+15559998888',
    );
    const logged = consoleLogSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toContain(NAME);
    expect(logged).not.toContain('Jane');
  });
});

describe('reviewResponseService — no patient name in SMS body', () => {
  it('omits the patient name from the feedback-request SMS', async () => {
    const { generateFeedbackRequestMessage } = await import('../services/reviewResponseService');
    const { body } = generateFeedbackRequestMessage(NAME, 'Test Practice', 'https://example.com/fb', 'sms');
    expect(body).not.toContain(NAME);
    expect(body).not.toContain('Jane');
  });

  it('omits the patient name from the Google-review-request SMS', async () => {
    const { generateGooglePostRequestMessage } = await import('../services/reviewResponseService');
    const { body } = generateGooglePostRequestMessage(NAME, 'Test Practice', 'https://example.com/gr', 'sms');
    expect(body).not.toContain(NAME);
    expect(body).not.toContain('Jane');
  });

  it('still includes the patient name in the email variant (email is not Twilio-bound)', async () => {
    const { generateFeedbackRequestMessage } = await import('../services/reviewResponseService');
    const { body } = generateFeedbackRequestMessage(NAME, 'Test Practice', 'https://example.com/fb', 'email');
    expect(body).toContain(NAME);
  });
});
