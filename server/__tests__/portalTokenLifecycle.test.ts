/**
 * Portal token lifecycle: rotation, revocation, and a sliding expiry.
 *
 * Three defects, all in the same area:
 *
 * 1. Redeeming a magic link returned the SAME portal token every time, so a
 *    token that leaked once stayed valid for its whole life — and re-inviting
 *    the patient handed the leaker's copy straight back, which is exactly what
 *    a practice would do on being told a link went to the wrong person.
 *
 * 2. Nothing in the codebase ever set isActive=false. getPatientPortalByToken
 *    checks the flag, so revocation was designed for but never implemented:
 *    a leaked link could not be stopped by the patient or the practice.
 *
 * 3. portalTokenExpiresAt was set once at creation and never extended, so an
 *    active patient was locked out on day 90 and re-inviting could not fix it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, chain } = vi.hoisted(() => {
  const state: any = { access: null, updates: [] };
  return { state, chain: {} };
});

vi.mock('../db', () => {
  const db: any = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(state.access ? [state.access] : []),
      }),
    }),
    update: () => ({
      set: (values: any) => ({
        where: () => ({
          returning: () => {
            state.updates.push(values);
            // Mirror Postgres: an UPDATE that matches no row returns no rows.
            if (!state.access) return Promise.resolve([]);
            const merged = { ...state.access, ...values };
            state.access = merged;
            return Promise.resolve([merged]);
          },
        }),
      }),
    }),
  };
  return { db, getDb: () => db };
});
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('./patients', () => ({ getPatient: vi.fn(), getPatientStatements: vi.fn() }));
vi.mock('../storage/patients', () => ({ getPatient: vi.fn(), getPatientStatements: vi.fn() }));

import { useMagicLink, revokePortalAccess, PORTAL_TOKEN_TTL_MS } from '../storage/audit';

const ORIGINAL_TOKEN = 'original-portal-token';

beforeEach(() => {
  state.updates = [];
  state.access = {
    id: 1,
    patientId: 10,
    portalToken: ORIGINAL_TOKEN,
    portalTokenExpiresAt: new Date(Date.now() + 1000),
    isActive: true,
    accessCount: 3,
  };
});

describe('useMagicLink rotates the portal token', () => {
  it('issues a NEW token, so an older copy of the link stops working', async () => {
    const result = await useMagicLink('magic-abc');

    expect(result).not.toBeNull();
    expect(result!.portalToken).not.toBe(ORIGINAL_TOKEN);
    expect(result!.portalToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refreshes the expiry so an active patient is not locked out on day 90', async () => {
    const before = Date.now();
    const result = await useMagicLink('magic-abc');

    const expiry = new Date(result!.portalTokenExpiresAt as any).getTime();
    expect(expiry).toBeGreaterThan(before + PORTAL_TOKEN_TTL_MS - 5000);
  });

  it('still records the login', async () => {
    const result = await useMagicLink('magic-abc');
    expect(result!.accessCount).toBe(4);
    expect(result!.magicLinkUsedAt).toBeInstanceOf(Date);
  });

  it('returns null for an unknown link rather than minting a session', async () => {
    state.access = null;
    expect(await useMagicLink('nope')).toBeNull();
  });
});

describe('revokePortalAccess is the stop button that did not exist', () => {
  it('deactivates access so the token check refuses it', async () => {
    await revokePortalAccess(10);

    const written = state.updates.at(-1);
    expect(written.isActive).toBe(false);
  });

  it('also rotates the token, so reactivating cannot resurrect the leaked one', async () => {
    await revokePortalAccess(10);

    const written = state.updates.at(-1);
    expect(written.portalToken).toBeDefined();
    expect(written.portalToken).not.toBe(ORIGINAL_TOKEN);
  });

  it('reports false when there was nothing to revoke', async () => {
    state.access = null;
    // With no row, the update returns nothing.
    const anyRevoked = await revokePortalAccess(999).catch(() => false);
    expect(anyRevoked).toBe(false);
  });
});
