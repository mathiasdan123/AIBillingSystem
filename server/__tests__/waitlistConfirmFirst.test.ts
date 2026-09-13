import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockStorage = vi.hoisted(() => ({
  getWaitlist: vi.fn(),
  updateWaitlistEntry: vi.fn(),
  getPatient: vi.fn(),
  getPractice: vi.fn(),
  getUser: vi.fn(),
  getWaitlistEntry: vi.fn(),
}));
vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../replitAuth', () => ({ isAuthenticated: (_req: any, _res: any, next: any) => next() }));
vi.mock('../email', () => ({ isEmailConfigured: () => false }));
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));
vi.mock('../services/smsService', () => ({ isSMSConfigured: () => false, sendSMS: vi.fn() }));

import { autoFillSlot } from '../routes/waitlist';

const SLOT = { therapistId: 'therapist-1', date: '2026-09-16', startTime: '15:30', endTime: '16:15' };
// The matcher derives the weekday via toLocaleDateString on new Date(date),
// which is timezone-dependent — compute it the same way so the test is
// stable in any TZ.
const SLOT_WEEKDAY = new Date(SLOT.date).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
const OTHER_WEEKDAY = SLOT_WEEKDAY === 'monday' ? 'tuesday' : 'monday';

const ENTRY = {
  id: 42,
  practiceId: 1,
  patientId: 7,
  therapistId: null,
  preferredDays: [SLOT_WEEKDAY],
  preferredTimeStart: '15:00',
  preferredTimeEnd: '18:00',
  appointmentType: null,
  priority: 1,
  status: 'waiting',
  createdAt: '2026-08-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getWaitlist.mockResolvedValue([ENTRY]);
  mockStorage.updateWaitlistEntry.mockResolvedValue({});
  mockStorage.getUser.mockResolvedValue({ id: 'therapist-1', email: null, firstName: 'Meg' });
  mockStorage.getPatient.mockResolvedValue({ id: 7, firstName: 'Kid', email: null, phone: null });
  mockStorage.getPractice.mockResolvedValue({ id: 1, name: 'Wonder Kids' });
});

describe('autoFillSlot — confirm-first flow', () => {
  it('holds the match for therapist confirmation and contacts no family', async () => {
    const result = await autoFillSlot(1, { ...SLOT, requireTherapistConfirmation: true });
    expect(result.matched).toBe(true);
    expect((result as any).pendingConfirmation).toBe(true);
    const [id, update] = mockStorage.updateWaitlistEntry.mock.calls[0];
    expect(id).toBe(42);
    expect(update.status).toBe('pending_confirmation');
    // slot JSON carries the therapist so skip-offer can cascade correctly
    expect(update.offeredSlot.therapistId).toBe('therapist-1');
    // the family is never touched in this branch
    expect(mockStorage.getPatient).not.toHaveBeenCalled();
  });

  it('offers directly when confirmation is not required (manual path)', async () => {
    const result = await autoFillSlot(1, SLOT);
    expect(result.matched).toBe(true);
    expect((result as any).pendingConfirmation).toBeUndefined();
    const [, update] = mockStorage.updateWaitlistEntry.mock.calls[0];
    expect(update.status).toBe('offered');
    expect(update.respondBy).toBeInstanceOf(Date);
  });

  it('still respects preferences: wrong day never matches', async () => {
    mockStorage.getWaitlist.mockResolvedValue([{ ...ENTRY, preferredDays: [OTHER_WEEKDAY] }]);
    const result = await autoFillSlot(1, { ...SLOT, requireTherapistConfirmation: true });
    expect(result.matched).toBe(false);
    expect(mockStorage.updateWaitlistEntry).not.toHaveBeenCalled();
  });
});
