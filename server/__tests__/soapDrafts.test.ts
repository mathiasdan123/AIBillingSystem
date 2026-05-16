import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Storage-layer tests for SOAP draft upsert + multi-tenant isolation.
 * Mocks the db layer; verifies the where-clause shape and that
 * PHI fields go through the encryption helper before insert/update.
 */

const mockDbState: {
  upserts: any[];
  conflictTargets: any[];
  deletes: any[];
  encryptCalls: any[];
  decryptCalls: any[];
} = {
  upserts: [],
  conflictTargets: [],
  deletes: [],
  encryptCalls: [],
  decryptCalls: [],
};

vi.mock('../services/phiEncryptionService', () => ({
  encryptSoapNoteRecord: (r: any) => r,
  decryptSoapNoteRecord: (r: any) => r,
  encryptSoapDraftRecord: (r: any) => {
    mockDbState.encryptCalls.push(r);
    return { ...r, __encrypted: true };
  },
  decryptSoapDraftRecord: (r: any) => {
    if (!r) return null;
    mockDbState.decryptCalls.push(r);
    return r;
  },
}));

vi.mock('../db', () => ({
  db: {
    insert: () => ({
      values: (vals: any) => ({
        onConflictDoUpdate: (opts: any) => ({
          returning: () => {
            const row = { id: 999, ...vals };
            mockDbState.upserts.push(row);
            mockDbState.conflictTargets.push(opts);
            return Promise.resolve([row]);
          },
        }),
        returning: () => {
          const row = { id: 999, ...vals };
          mockDbState.upserts.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve(mockDbState.deletes),
      }),
    }),
  },
}));

vi.mock('./users', () => ({ getUser: vi.fn(async () => null) }));

import { upsertSoapDraft, deleteSoapDraft } from '../storage/clinical';

beforeEach(() => {
  mockDbState.upserts = [];
  mockDbState.conflictTargets = [];
  mockDbState.deletes = [];
  mockDbState.encryptCalls = [];
  mockDbState.decryptCalls = [];
});

describe('upsertSoapDraft', () => {
  it('performs a single atomic upsert (no find-then-write race)', async () => {
    await upsertSoapDraft({
      practiceId: 1,
      therapistId: 'therapist-a',
      patientId: 42,
      subjective: 'patient reports headache',
      objective: 'observation X',
      assessment: 'tension headache',
      plan: 'rest + follow-up',
    });
    expect(mockDbState.upserts).toHaveLength(1);
    expect(mockDbState.conflictTargets).toHaveLength(1);
  });

  it('targets (therapistId, patientId) as the conflict key', async () => {
    await upsertSoapDraft({
      practiceId: 1,
      therapistId: 'therapist-a',
      patientId: 42,
      subjective: 'x',
    });
    const target = mockDbState.conflictTargets[0]?.target;
    expect(Array.isArray(target)).toBe(true);
    expect(target).toHaveLength(2);
  });

  it('routes PHI fields through encryptSoapDraftRecord before persistence', async () => {
    await upsertSoapDraft({
      practiceId: 1,
      therapistId: 'therapist-a',
      patientId: 42,
      subjective: 'sensitive content',
      plan: 'plan content',
    });
    expect(mockDbState.encryptCalls).toHaveLength(1);
    expect(mockDbState.encryptCalls[0]).toMatchObject({
      subjective: 'sensitive content',
      plan: 'plan content',
    });
  });

  it('refuses to save without practice + therapist + patient scope', async () => {
    await expect(
      upsertSoapDraft({ therapistId: 'a', patientId: 1 } as any),
    ).rejects.toThrow(/practiceId/);
    await expect(
      upsertSoapDraft({ practiceId: 1, patientId: 1 } as any),
    ).rejects.toThrow(/therapistId/);
    await expect(
      upsertSoapDraft({ practiceId: 1, therapistId: 'a' } as any),
    ).rejects.toThrow(/patientId/);
  });

  it('stamps lastSavedAt and updatedAt on every save', async () => {
    await upsertSoapDraft({
      practiceId: 1,
      therapistId: 'therapist-a',
      patientId: 42,
      subjective: 'x',
    });
    const persisted = mockDbState.upserts[0];
    expect(persisted.lastSavedAt).toBeInstanceOf(Date);
    expect(persisted.updatedAt).toBeInstanceOf(Date);
  });
});

describe('deleteSoapDraft', () => {
  it('reports false when no row was deleted (wrong therapist or practice)', async () => {
    mockDbState.deletes = [];
    const ok = await deleteSoapDraft(1, 'therapist-a', 999);
    expect(ok).toBe(false);
  });

  it('reports true when a row was deleted', async () => {
    mockDbState.deletes = [{ id: 5 }];
    const ok = await deleteSoapDraft(1, 'therapist-a', 5);
    expect(ok).toBe(true);
  });
});
