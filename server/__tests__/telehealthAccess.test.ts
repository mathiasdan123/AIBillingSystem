/**
 * Telehealth access control.
 *
 * The join code is the ONLY thing between an outsider and a live therapy
 * session: GET /api/public/telehealth/join/:code needs no auth by design,
 * because a patient joins from a link. Two things made that dangerous.
 *
 * 1. The code was generated with Math.random() — not a CSPRNG, so its
 *    internal state is recoverable from observed outputs — and was 6
 *    characters long.
 *
 * 2. GET /api/telehealth/sessions/:id was isAuthenticated only, with no
 *    practice check and serial ids, and it returns patientAccessCode. Any
 *    authenticated user of ANY practice could walk the id space and harvest
 *    join codes for other practices' sessions.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db', () => ({ db: {}, getDb: () => ({}) }));
vi.mock('../services/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import { generatePatientAccessCode, generateTelehealthRoomName } from '../storage/appointments';

describe('generatePatientAccessCode', () => {
  it('is 8 characters from the unambiguous alphabet', () => {
    const code = generatePatientAccessCode();
    expect(code).toHaveLength(8);
    // No 0/O/1/I — a patient reads this off a screen or hears it on a call.
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it('does not repeat across many draws', () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generatePatientAccessCode()));
    expect(codes.size).toBe(2000);
  });

  it('uses the whole alphabet — a biased generator shrinks the keyspace', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      for (const ch of generatePatientAccessCode()) seen.add(ch);
    }
    // All 32 characters should appear across 24k draws.
    expect(seen.size).toBe(32);
  });
});

describe('generateTelehealthRoomName', () => {
  it('is unique per call — the room name is part of the join URL', () => {
    const names = new Set(Array.from({ length: 1000 }, () => generateTelehealthRoomName()));
    expect(names.size).toBe(1000);
  });

  it('carries enough randomness to not be guessable from a neighbouring session', () => {
    const name = generateTelehealthRoomName();
    const random = name.split('-').pop()!;
    expect(random).toMatch(/^[0-9a-f]{12}$/);
  });
});
