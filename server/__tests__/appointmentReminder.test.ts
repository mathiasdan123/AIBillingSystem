import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies before importing the module under test
const mockGetPractice = vi.fn();
const mockGetPatient = vi.fn();
const mockGetAppointmentsForReminder = vi.fn();
const mockUpdateAppointment = vi.fn();
const mockGetUpcomingAppointmentsForReminders = vi.fn();
const mockMarkReminderSent = vi.fn();

vi.mock('../storage', () => ({
  storage: {
    getPractice: (...args: any[]) => mockGetPractice(...args),
    getPatient: (...args: any[]) => mockGetPatient(...args),
    getAppointmentsForReminder: (...args: any[]) => mockGetAppointmentsForReminder(...args),
    updateAppointment: (...args: any[]) => mockUpdateAppointment(...args),
    getUpcomingAppointmentsForReminders: (...args: any[]) => mockGetUpcomingAppointmentsForReminders(...args),
    markReminderSent: (...args: any[]) => mockMarkReminderSent(...args),
  },
}));

const mockSendSMS = vi.fn();
const mockSendAppointmentReminderSMS = vi.fn();
const mockIsSMSConfigured = vi.fn();

vi.mock('../services/smsService', () => ({
  sendAppointmentReminderSMS: (...args: any[]) => mockSendAppointmentReminderSMS(...args),
  isSMSConfigured: () => mockIsSMSConfigured(),
  sendSMS: (...args: any[]) => mockSendSMS(...args),
}));

const mockIsEmailConfigured = vi.fn();

vi.mock('../email', () => ({
  isEmailConfigured: () => mockIsEmailConfigured(),
}));

const mockSendEmail = vi.fn();

vi.mock('../services/emailService', () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
}));

vi.mock('../services/emailTemplates', () => ({
  appointmentReminder: () => ({ subject: 'Reminder', html: '<p>reminder</p>', text: 'reminder' }),
}));

vi.mock('../services/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  processAppointmentReminders,
  sendAppointmentReminders,
  getReminderStatus,
} from '../services/appointmentReminderService';

describe('getReminderStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns email and SMS configuration status', () => {
    mockIsEmailConfigured.mockReturnValue(true);
    mockIsSMSConfigured.mockReturnValue(false);

    const status = getReminderStatus();
    expect(status).toEqual({ emailConfigured: true, smsConfigured: false });
  });
});

describe('processAppointmentReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when practice is not found', async () => {
    mockGetPractice.mockResolvedValue(null);
    const results = await processAppointmentReminders(999);
    expect(results).toEqual([]);
  });

  it('returns empty array when no appointments need reminders', async () => {
    mockGetPractice.mockResolvedValue({ id: 1, name: 'Test Practice' });
    mockGetAppointmentsForReminder.mockResolvedValue([]);

    const results = await processAppointmentReminders(1);
    expect(results).toEqual([]);
  });

  it('sends email reminder when patient has email', async () => {
    mockGetPractice.mockResolvedValue({ id: 1, name: 'Test Practice' });
    mockGetAppointmentsForReminder.mockResolvedValue([
      { id: 10, patientId: 1, startTime: new Date().toISOString() },
    ]);
    mockGetPatient.mockResolvedValue({
      id: 1,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: null,
    });
    mockIsEmailConfigured.mockReturnValue(true);
    mockSendEmail.mockResolvedValue({ success: true });

    const results = await processAppointmentReminders(1);
    expect(results).toHaveLength(1);
    expect(results[0].appointmentId).toBe(10);
    expect(results[0].emailSent).toBe(true);
    expect(results[0].patientName).toBe('Jane Doe');
  });

  it('sends SMS reminder when patient has phone', async () => {
    mockGetPractice.mockResolvedValue({ id: 1, name: 'Test Practice' });
    mockGetAppointmentsForReminder.mockResolvedValue([
      { id: 11, patientId: 2, startTime: new Date().toISOString() },
    ]);
    mockGetPatient.mockResolvedValue({
      id: 2,
      firstName: 'John',
      lastName: 'Smith',
      email: null,
      phone: '5551234567',
    });
    mockSendAppointmentReminderSMS.mockResolvedValue({ success: true });

    const results = await processAppointmentReminders(1);
    expect(results).toHaveLength(1);
    expect(results[0].smsSent).toBe(true);
    expect(mockSendAppointmentReminderSMS).toHaveBeenCalled();
  });

  it('marks appointment as reminded when at least one notification succeeds', async () => {
    mockGetPractice.mockResolvedValue({ id: 1, name: 'Test Practice' });
    mockGetAppointmentsForReminder.mockResolvedValue([
      { id: 12, patientId: 3, startTime: new Date().toISOString() },
    ]);
    mockGetPatient.mockResolvedValue({
      id: 3,
      firstName: 'Bob',
      lastName: 'Jones',
      email: 'bob@example.com',
      phone: null,
    });
    mockIsEmailConfigured.mockReturnValue(true);
    mockSendEmail.mockResolvedValue({ success: true });

    await processAppointmentReminders(1);
    expect(mockUpdateAppointment).toHaveBeenCalledWith(12, { reminderSent: true });
  });

  it('records error when patient is not found', async () => {
    mockGetPractice.mockResolvedValue({ id: 1, name: 'Test Practice' });
    mockGetAppointmentsForReminder.mockResolvedValue([
      { id: 13, patientId: null, startTime: new Date().toISOString() },
    ]);

    const results = await processAppointmentReminders(1);
    expect(results).toHaveLength(1);
    expect(results[0].error).toBe('Patient not found');
  });

  it('handles errors for individual appointments without stopping', async () => {
    mockGetPractice.mockResolvedValue({ id: 1, name: 'Test Practice' });
    mockGetAppointmentsForReminder.mockResolvedValue([
      { id: 14, patientId: 4, startTime: new Date().toISOString() },
    ]);
    mockGetPatient.mockRejectedValue(new Error('DB error'));

    const results = await processAppointmentReminders(1);
    expect(results).toHaveLength(1);
    expect(results[0].error).toBe('DB error');
  });
});

describe('sendAppointmentReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when neither email nor SMS is configured', async () => {
    mockIsEmailConfigured.mockReturnValue(false);
    mockIsSMSConfigured.mockReturnValue(false);

    const results = await sendAppointmentReminders();
    expect(results).toEqual([]);
    expect(mockGetUpcomingAppointmentsForReminders).not.toHaveBeenCalled();
  });

  it('processes upcoming appointments and marks reminders sent', async () => {
    mockIsEmailConfigured.mockReturnValue(true);
    mockIsSMSConfigured.mockReturnValue(false);
    mockGetUpcomingAppointmentsForReminders.mockResolvedValue([
      { id: 20, patientId: 5, practiceId: 1, startTime: new Date().toISOString() },
    ]);
    mockGetPatient.mockResolvedValue({
      id: 5,
      firstName: 'Alice',
      lastName: 'Wonder',
      email: 'alice@example.com',
      phone: null,
    });
    mockGetPractice.mockResolvedValue({ id: 1, name: 'Wellness Center' });
    mockSendEmail.mockResolvedValue({ success: true });

    const results = await sendAppointmentReminders();
    expect(results).toHaveLength(1);
    expect(results[0].emailSent).toBe(true);
    expect(mockMarkReminderSent).toHaveBeenCalledWith(20);
  });

  it('handles storage errors gracefully', async () => {
    mockIsEmailConfigured.mockReturnValue(true);
    mockIsSMSConfigured.mockReturnValue(true);
    mockGetUpcomingAppointmentsForReminders.mockRejectedValue(new Error('Connection lost'));

    const results = await sendAppointmentReminders();
    expect(results).toEqual([]);
  });
});
