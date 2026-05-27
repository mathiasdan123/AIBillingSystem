/**
 * Tests for the appointment lifecycle tools added to Blanche so the front
 * desk can ask the assistant to check patients in / out instead of hunting
 * for the calendar button.
 *
 * Locks down:
 *   - cross-practice tenant isolation on every tool
 *   - prerequisite ordering (can't session_start without check-in, etc.)
 *   - idempotent re-calls return `alreadyX: true` rather than erroring
 *   - mark_no_show routes through cancelAppointment with reason "no-show"
 *     so the no-show report keeps working
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getAppointment: vi.fn(),
    updateAppointment: vi.fn(),
    cancelAppointment: vi.fn(),
    // Tools we don't exercise but the module may touch on import:
    getPatient: vi.fn(),
    getPatients: vi.fn(),
    getPractice: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })),
  },
}));

import { executeTool } from '../routes/ai-assistant';

const PRACTICE_ID = 1;
const OTHER_PRACTICE_ID = 2;
const USER_ID = 'user1';
const APPT_ID = 100;

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.updateAppointment.mockImplementation(async (_id: number, patch: any) => ({
    id: APPT_ID,
    practiceId: PRACTICE_ID,
    status: patch.status ?? 'scheduled',
  }));
  mockStorage.cancelAppointment.mockResolvedValue({ id: APPT_ID, status: 'cancelled' });
});

const baseAppt = (overrides: Partial<any> = {}) => ({
  id: APPT_ID,
  practiceId: PRACTICE_ID,
  status: 'scheduled',
  checkedInAt: null,
  checkedOutAt: null,
  sessionStartedAt: null,
  sessionEndedAt: null,
  ...overrides,
});

describe('check_in_appointment', () => {
  it('checks a scheduled appointment in and persists timestamp + user', async () => {
    mockStorage.getAppointment.mockResolvedValue(baseAppt());
    const out = JSON.parse(await executeTool('check_in_appointment', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID));
    expect(out.success).toBe(true);
    const patch = mockStorage.updateAppointment.mock.calls[0][1];
    expect(patch.checkedInAt).toBeInstanceOf(Date);
    expect(patch.checkedInBy).toBe(USER_ID);
    expect(patch.status).toBe('checked_in');
  });

  it('rejects an appointment in another practice', async () => {
    mockStorage.getAppointment.mockResolvedValue(baseAppt({ practiceId: OTHER_PRACTICE_ID }));
    const out = JSON.parse(await executeTool('check_in_appointment', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID));
    expect(out.error).toMatch(/not found in this practice/i);
    expect(mockStorage.updateAppointment).not.toHaveBeenCalled();
  });

  it('refuses to check in a cancelled appointment', async () => {
    mockStorage.getAppointment.mockResolvedValue(baseAppt({ status: 'cancelled' }));
    const out = JSON.parse(await executeTool('check_in_appointment', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID));
    expect(out.error).toMatch(/cancelled/i);
    expect(mockStorage.updateAppointment).not.toHaveBeenCalled();
  });

  it('is idempotent on re-call — already checked in returns alreadyCheckedIn:true', async () => {
    mockStorage.getAppointment.mockResolvedValue(baseAppt({ checkedInAt: new Date() }));
    const out = JSON.parse(await executeTool('check_in_appointment', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID));
    expect(out.success).toBe(true);
    expect(out.alreadyCheckedIn).toBe(true);
    expect(mockStorage.updateAppointment).not.toHaveBeenCalled();
  });
});

describe('session_start', () => {
  it('requires the patient to be checked in first', async () => {
    mockStorage.getAppointment.mockResolvedValue(baseAppt({ checkedInAt: null }));
    const out = JSON.parse(await executeTool('session_start', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID));
    expect(out.error).toMatch(/check.?in/i);
    expect(mockStorage.updateAppointment).not.toHaveBeenCalled();
  });

  it('marks status in_progress and stamps sessionStartedAt', async () => {
    mockStorage.getAppointment.mockResolvedValue(baseAppt({ checkedInAt: new Date() }));
    const out = JSON.parse(await executeTool('session_start', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID));
    expect(out.success).toBe(true);
    const patch = mockStorage.updateAppointment.mock.calls[0][1];
    expect(patch.sessionStartedAt).toBeInstanceOf(Date);
    expect(patch.status).toBe('in_progress');
  });
});

describe('session_end', () => {
  it('refuses if session was never started', async () => {
    mockStorage.getAppointment.mockResolvedValue(baseAppt({ checkedInAt: new Date(), sessionStartedAt: null }));
    const out = JSON.parse(await executeTool('session_end', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID));
    expect(out.error).toMatch(/not been started/i);
  });

  it('stamps sessionEndedAt without changing status (check_out finalizes)', async () => {
    mockStorage.getAppointment.mockResolvedValue(baseAppt({ checkedInAt: new Date(), sessionStartedAt: new Date(), status: 'in_progress' }));
    const out = JSON.parse(await executeTool('session_end', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID));
    expect(out.success).toBe(true);
    const patch = mockStorage.updateAppointment.mock.calls[0][1];
    expect(patch.sessionEndedAt).toBeInstanceOf(Date);
    expect(patch.status).toBeUndefined();
  });
});

describe('check_out_appointment', () => {
  it('requires prior check-in', async () => {
    mockStorage.getAppointment.mockResolvedValue(baseAppt({ checkedInAt: null }));
    const out = JSON.parse(await executeTool('check_out_appointment', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID));
    expect(out.error).toMatch(/checked in/i);
  });

  it('moves status to completed and stamps checkedOutAt', async () => {
    mockStorage.getAppointment.mockResolvedValue(baseAppt({ checkedInAt: new Date() }));
    const out = JSON.parse(await executeTool('check_out_appointment', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID));
    expect(out.success).toBe(true);
    const patch = mockStorage.updateAppointment.mock.calls[0][1];
    expect(patch.checkedOutAt).toBeInstanceOf(Date);
    expect(patch.status).toBe('completed');
  });
});

describe('mark_no_show', () => {
  it('cancels via storage.cancelAppointment with reason "no-show" so the no-show report picks it up', async () => {
    mockStorage.getAppointment.mockResolvedValue(baseAppt());
    const out = JSON.parse(await executeTool('mark_no_show', { appointmentId: APPT_ID, notes: 'called twice' }, PRACTICE_ID, USER_ID));
    expect(out.success).toBe(true);
    expect(mockStorage.cancelAppointment).toHaveBeenCalledWith(APPT_ID, 'no-show', 'called twice', USER_ID);
  });

  it('is idempotent — already cancelled returns alreadyCancelled:true', async () => {
    mockStorage.getAppointment.mockResolvedValue(baseAppt({ status: 'cancelled' }));
    const out = JSON.parse(await executeTool('mark_no_show', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID));
    expect(out.success).toBe(true);
    expect(out.alreadyCancelled).toBe(true);
    expect(mockStorage.cancelAppointment).not.toHaveBeenCalled();
  });

  it('rejects an appointment in another practice', async () => {
    mockStorage.getAppointment.mockResolvedValue(baseAppt({ practiceId: OTHER_PRACTICE_ID }));
    const out = JSON.parse(await executeTool('mark_no_show', { appointmentId: APPT_ID }, PRACTICE_ID, USER_ID));
    expect(out.error).toMatch(/not found in this practice/i);
  });
});
