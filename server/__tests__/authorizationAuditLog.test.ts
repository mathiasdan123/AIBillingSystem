import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression test: createAuditLogEntry must write to
 * `authorization_audit_log`, not the generic `audit_log` table.
 * (The previous delegation silently dropped authorization-specific fields.)
 */

const mockDbState: { inserts: any[] } = { inserts: [] };

vi.mock('../db', () => ({
  db: {
    insert: (table: any) => ({
      values: (vals: any) => {
        mockDbState.inserts.push({ table, vals });
        return {
          returning: () => ({
            then: (resolve: any) => resolve([{ id: 1, ...vals }]),
          }),
        };
      },
    }),
    select: () => ({
      from: () => ({
        orderBy: () => ({
          limit: () => ({ then: (r: any) => r([]) }),
        }),
        where: () => ({
          orderBy: () => ({
            limit: () => ({
              offset: () => ({ then: (r: any) => r([]) }),
            }),
          }),
        }),
      }),
    }),
  },
}));

import { createAuditLogEntry } from '../storage/audit';
import { authorizationAuditLog } from '../../shared/schema';

beforeEach(() => {
  mockDbState.inserts = [];
});

describe('createAuditLogEntry', () => {
  it('writes to authorization_audit_log (not the generic audit_log)', async () => {
    await createAuditLogEntry({
      practiceId: 7,
      patientId: 42,
      authorizationId: 100,
      actorType: 'user',
      actorId: 'user-1',
      eventType: 'authorization_requested',
      success: true,
    });

    expect(mockDbState.inserts).toHaveLength(1);
    expect(mockDbState.inserts[0].table).toBe(authorizationAuditLog);
  });

  it('preserves every authorization-specific field passed in', async () => {
    const entry = {
      practiceId: 7,
      patientId: 42,
      authorizationId: 100,
      actorType: 'user' as const,
      actorId: 'user-abc',
      actorEmail: 'biller@example.com',
      actorIpAddress: '10.0.0.1',
      actorUserAgent: 'Mozilla/5.0',
      eventType: 'data_accessed',
      eventDetails: { reason: 'eligibility refresh' },
      dataType: 'eligibility',
      dataScope: { fields: ['copay', 'deductible'] },
      success: true,
    };

    await createAuditLogEntry(entry);

    expect(mockDbState.inserts[0].vals).toMatchObject(entry);
  });
});
