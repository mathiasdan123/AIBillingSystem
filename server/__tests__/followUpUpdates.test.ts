/**
 * claimFollowUpService.updateFollowUp: what the work-queue actions write
 * (QA sweep 2026-11-18). The db is mocked to capture the SET payload and the
 * WHERE so tenant scoping is visible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured = vi.hoisted(() => ({ set: null as any, where: null as any }));

vi.mock('../db', () => ({
  db: {
    update: () => ({
      set: (data: any) => {
        captured.set = data;
        return {
          where: (cond: any) => {
            captured.where = cond;
            return { returning: async () => [{ id: 12, ...data }] };
          },
        };
      },
    }),
  },
}));
vi.mock('../services/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  eq: vi.fn((a, b) => ({ op: 'eq', col: a?.name, b })),
  and: vi.fn((...args: any[]) => ({ op: 'and', args })),
}));

import { updateFollowUp, completeFollowUp, snoozeFollowUp } from '../services/claimFollowUpService';

beforeEach(() => {
  captured.set = null;
  captured.where = null;
});

describe('updateFollowUp work-queue fields', () => {
  it('completing stamps completedAt + completedBy and clears any snooze', async () => {
    await completeFollowUp(12, 7, 'biller-a');
    expect(captured.set.status).toBe('completed');
    expect(captured.set.completedAt).toBeInstanceOf(Date);
    expect(captured.set.completedBy).toBe('biller-a');
    expect(captured.set.snoozedUntil).toBeNull();
  });

  it('reopening (pending) clears completedAt and completedBy', async () => {
    await updateFollowUp(12, 7, { status: 'pending' });
    expect(captured.set).toMatchObject({ status: 'pending', completedAt: null, completedBy: null });
  });

  it('snoozing writes snoozedUntil only and leaves status alone', async () => {
    const until = new Date('2026-11-21T05:00:00.000Z');
    await snoozeFollowUp(12, 7, until);
    expect(captured.set.snoozedUntil).toBe(until);
    expect('status' in captured.set).toBe(false);
    await snoozeFollowUp(12, 7, null);
    expect(captured.set.snoozedUntil).toBeNull();
  });

  it('due date is written as given (UTC midnight Date) and cleared with null, never touched when absent', async () => {
    const due = new Date('2027-01-17T00:00:00.000Z');
    await updateFollowUp(12, 7, { dueDate: due });
    expect(captured.set.dueDate).toBe(due);
    await updateFollowUp(12, 7, { dueDate: null });
    expect(captured.set.dueDate).toBeNull();
    await updateFollowUp(12, 7, { notes: 'x' });
    expect('dueDate' in captured.set).toBe(false);
  });

  it('every write is scoped by id AND practiceId', async () => {
    await updateFollowUp(12, 7, { notes: 'x' });
    const eqs = captured.where.args.map((a: any) => `${a.col}=${a.b}`);
    expect(eqs).toContain('id=12');
    expect(eqs).toContain('practice_id=7');
  });
});
