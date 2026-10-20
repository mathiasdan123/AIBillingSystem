import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * suppressEmailForAddress is called from the SES bounce/complaint webhook
 * (server/routes/sesNotifications.ts) to stop future emails to an address
 * that hard-bounced or complained, by reusing the existing emailEnabled
 * notification-preference flag rather than a new table.
 */

const { dbStub, storageStub } = vi.hoisted(() => {
  // A queue of canned results for db.select(...) calls, consumed in the
  // exact order the real code issues them: first the patients-by-email
  // lookup in suppressEmailForAddress itself, then one "does a prefs row
  // already exist" lookup per getPatientPreferences/getStaffPreferences
  // call. Defaults to [] (not found -> create path) when the queue runs out.
  const selectQueue: unknown[][] = [];
  const updatedRows: Array<{ id: number; emailEnabled: boolean }> = [];

  function chain(resolveValue: unknown) {
    const c: any = {
      from: vi.fn(() => c),
      where: vi.fn(() => c),
      limit: vi.fn(() => Promise.resolve(resolveValue)),
      then: (resolve: any, reject: any) => Promise.resolve(resolveValue).then(resolve, reject),
    };
    return c;
  }

  let nextPrefsId = 1;

  return {
    dbStub: {
      __selectQueue: selectQueue,
      __updatedRows: updatedRows,
      select: vi.fn(() => chain(selectQueue.length > 0 ? selectQueue.shift() : [])),
      insert: vi.fn(() => ({
        values: vi.fn((values: any) => ({
          returning: vi.fn(async () => [{ id: nextPrefsId++, emailEnabled: true, ...values }]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((updates: any) => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => {
              updatedRows.push({ id: -1, ...updates });
              return [{ id: -1, ...updates }];
            }),
          })),
        })),
      })),
    },
    storageStub: {
      getUserByEmail: vi.fn(async () => undefined),
    },
  };
});

vi.mock('../db', () => ({ db: dbStub }));
vi.mock('../storage', () => ({ storage: storageStub }));
vi.mock('../services/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import * as svc from '../services/notificationPreferencesService';

beforeEach(() => {
  vi.clearAllMocks();
  dbStub.__selectQueue.length = 0;
  dbStub.__updatedRows.length = 0;
});

describe('suppressEmailForAddress', () => {
  it('suppresses every patient matching the address, creating a default prefs row for each', async () => {
    // 1st select: patients matching the email -> 2 matches.
    dbStub.__selectQueue.push([{ id: 10, practiceId: 1 }, { id: 11, practiceId: 1 }]);
    // 2nd/3rd select: "existing prefs?" check inside getPatientPreferences
    // for each of the 2 patients -> none exist yet, forces the insert path.
    dbStub.__selectQueue.push([]);
    dbStub.__selectQueue.push([]);

    const result = await svc.suppressEmailForAddress('Patient@Example.com', 'bounce');

    expect(result.patientsSuppressed).toBe(2);
    expect(result.staffSuppressed).toBe(0);
    // Both newly-created prefs rows started emailEnabled: true (the
    // default), so both should have been explicitly updated to false.
    expect(dbStub.__updatedRows).toHaveLength(2);
    expect(dbStub.__updatedRows.every((r) => r.emailEnabled === false)).toBe(true);
  });

  it('does not re-update a patient whose email is already suppressed', async () => {
    dbStub.__selectQueue.push([{ id: 20, practiceId: 1 }]);
    // Existing prefs row already has emailEnabled: false.
    dbStub.__selectQueue.push([{ id: 99, patientId: 20, practiceId: 1, emailEnabled: false }]);

    const result = await svc.suppressEmailForAddress('already-off@example.com', 'bounce');

    expect(result.patientsSuppressed).toBe(0);
    expect(dbStub.__updatedRows).toHaveLength(0);
  });

  it('suppresses a matching staff user when one exists', async () => {
    dbStub.__selectQueue.push([]); // no patients match
    dbStub.__selectQueue.push([]); // no existing staff prefs -> create path
    storageStub.getUserByEmail.mockResolvedValueOnce({ id: 'user-1', practiceId: 2 });

    const result = await svc.suppressEmailForAddress('staff@example.com', 'complaint');

    expect(result.staffSuppressed).toBe(1);
    expect(storageStub.getUserByEmail).toHaveBeenCalledWith('staff@example.com');
    expect(dbStub.__updatedRows).toHaveLength(1);
  });

  it('does not suppress a staff user with no practiceId (not yet assigned)', async () => {
    dbStub.__selectQueue.push([]); // no patients match
    storageStub.getUserByEmail.mockResolvedValueOnce({ id: 'user-2', practiceId: null });

    const result = await svc.suppressEmailForAddress('unassigned@example.com', 'bounce');

    expect(result.staffSuppressed).toBe(0);
    expect(dbStub.__updatedRows).toHaveLength(0);
  });
});
