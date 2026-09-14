import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => {
  const returning = vi.fn();
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  return { insert, values, returning };
});
vi.mock('../db', () => ({ db: { insert: mockDb.insert } }));
vi.mock('../email', () => ({ isEmailConfigured: () => false }));
vi.mock('../services/emailService', () => ({ sendEmail: vi.fn() }));

import { createSupportTicket } from '../services/supportTicketService';

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.returning.mockResolvedValue([
    { id: 101, practiceId: 1, severity: 'normal', source: 'app', userId: 'u1', userRole: 'therapist', page: '/soap-notes', release: 'abc1234' },
  ]);
});

describe('createSupportTicket', () => {
  it('creates a ticket with enrichment fields and defaults severity', async () => {
    const t = await createSupportTicket({
      practiceId: 1,
      userId: 'u1',
      userRole: 'therapist',
      description: 'The save button spins forever on the notes page.',
      page: '/soap-notes',
      severity: 'catastrophic', // invalid -> normal
    });
    expect(t.id).toBe(101);
    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.severity).toBe('normal');
    expect(inserted.source).toBe('app');
    expect(inserted.description).toContain('save button');
  });

  it('rejects empty descriptions', async () => {
    await expect(createSupportTicket({ practiceId: 1, description: '  ' })).rejects.toThrow(/describe the problem/);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('tags blanche-sourced tickets', async () => {
    await createSupportTicket({ practiceId: 1, description: 'Reported via assistant conversation.', source: 'blanche' });
    expect(mockDb.values.mock.calls[0][0].source).toBe('blanche');
  });
});
