/**
 * Tests for the notification template renderer (P0.5).
 *
 * Three behaviors locked down:
 *   1. {{variable}} substitution works and tolerates missing/undefined vars
 *      gracefully.
 *   2. When no custom template exists, the supplied default is rendered.
 *   3. When a custom + active template exists, it wins — and inactive
 *      templates fall through to the default.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getNotificationTemplate: vi.fn(),
  },
}));
vi.mock('../storage', () => ({ storage: mockStorage }));

import { renderNotification, __test_substitute } from '../services/notificationTemplateRenderer';

const PRACTICE_ID = 1;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('substitute (internal helper)', () => {
  it('replaces {{var}} with the matching value', () => {
    expect(__test_substitute('Hi {{patientName}}, see you at {{appointmentTime}}.', {
      patientName: 'Sarah',
      appointmentTime: '3 PM',
    })).toBe('Hi Sarah, see you at 3 PM.');
  });

  it('renders an empty string for missing or undefined vars (does not leave the placeholder)', () => {
    expect(__test_substitute('Hi {{patientName}} from {{practiceName}}', {
      patientName: 'Sarah',
      practiceName: undefined,
    })).toBe('Hi Sarah from ');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(__test_substitute('Hi {{ patientName }} at {{  appointmentTime }}', {
      patientName: 'X',
      appointmentTime: 'Y',
    })).toBe('Hi X at Y');
  });
});

describe('renderNotification', () => {
  it('uses the default template when no custom row exists', async () => {
    mockStorage.getNotificationTemplate.mockResolvedValue(undefined);
    const out = await renderNotification({
      practiceId: PRACTICE_ID,
      type: 'appointment_reminder',
      channel: 'email',
      defaultSubject: 'Reminder for {{patientName}}',
      defaultBody: 'See you {{appointmentTime}}.',
      variables: { patientName: 'Sarah', appointmentTime: '3 PM' },
    });
    expect(out.customTemplateUsed).toBe(false);
    expect(out.subject).toBe('Reminder for Sarah');
    expect(out.body).toBe('See you 3 PM.');
  });

  it('uses the custom template when one exists and is active', async () => {
    mockStorage.getNotificationTemplate.mockResolvedValue({
      id: 1, practiceId: PRACTICE_ID, notificationType: 'appointment_reminder', channel: 'email',
      subject: 'Custom subject for {{patientName}}',
      body: 'Hey {{patientName}} — see you at {{appointmentTime}} at {{practiceName}}.',
      isActive: true,
    });
    const out = await renderNotification({
      practiceId: PRACTICE_ID,
      type: 'appointment_reminder',
      channel: 'email',
      defaultSubject: 'IGNORE ME',
      defaultBody: 'IGNORE ME',
      variables: { patientName: 'Sarah', appointmentTime: '3 PM', practiceName: 'Clinic' },
    });
    expect(out.customTemplateUsed).toBe(true);
    expect(out.subject).toBe('Custom subject for Sarah');
    expect(out.body).toBe('Hey Sarah — see you at 3 PM at Clinic.');
  });

  it('falls back to default when storage throws (never blocks a notification over a template lookup)', async () => {
    mockStorage.getNotificationTemplate.mockRejectedValue(new Error('DB hiccup'));
    const out = await renderNotification({
      practiceId: PRACTICE_ID,
      type: 'appointment_reminder',
      channel: 'sms',
      defaultBody: 'Reminder: {{appointmentTime}}',
      variables: { appointmentTime: '3 PM' },
    });
    expect(out.customTemplateUsed).toBe(false);
    expect(out.body).toBe('Reminder: 3 PM');
  });
});
