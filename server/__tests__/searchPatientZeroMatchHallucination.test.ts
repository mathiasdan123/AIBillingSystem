/**
 * Regression test for the "Kristina → Janet" hallucination.
 *
 * The reviewer asked Blanche to schedule for "Kristina" — a patient who does
 * not exist in their practice — and Blanche proposed an appointment for
 * "Janet" instead (invented from her training/context).
 *
 * Defense: when search_patient finds zero matches, the tool result now
 * includes (a) the actual practice patient list and (b) an explicit
 * anti-hallucination hint telling Blanche she may not invent a patient.
 *
 * This test locks down the zero-match response shape so anyone who "fixes"
 * it back to a bare "No patients found" string will fail loudly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatients: vi.fn(),
    getPatient: vi.fn(),
    getAppointmentsByDateRange: vi.fn(() => Promise.resolve([])),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));

import { executeTool } from '../routes/ai-assistant';

const PRACTICE_ID = 1;
const USER_ID = 'demo-user-001';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('search_patient zero-match anti-hallucination', () => {
  it('returns availablePatientsInPractice + anti-hallucination hint when no match found', async () => {
    // Patients in this practice — none of them named Kristina.
    mockStorage.getPatients.mockResolvedValue([
      { id: 1, firstName: 'Sarah', lastName: 'Chen', practiceId: PRACTICE_ID },
      { id: 2, firstName: 'Marcus', lastName: 'Patel', practiceId: PRACTICE_ID },
      { id: 3, firstName: 'Aisha', lastName: 'Williams', practiceId: PRACTICE_ID },
    ]);

    const out = JSON.parse(await executeTool('search_patients', { name: 'Kristina' }, PRACTICE_ID, USER_ID));

    expect(out.message).toContain('No patients found');
    expect(out.message).toContain('Kristina');
    // Critical: the response lists actual patients so Blanche can disambiguate
    // without inventing one.
    expect(out.availablePatientsInPractice).toHaveLength(3);
    expect(out.availablePatientsInPractice[0]).toMatchObject({ patientId: 1, name: 'Sarah Chen' });
    expect(out.totalPatientsInPractice).toBe(3);
    // The anti-hallucination directive is the critical bit — without it,
    // Blanche has historically picked a name from context (the Janet bug).
    expect(out._nextActionHint).toMatch(/DO NOT invent or guess/i);
    expect(out._nextActionHint).toMatch(/NEVER propose create_appointment.*patient whose existence/i);
  });

  it('caps the available list at 20 patients so a 500-patient practice does not blow the response size', async () => {
    const manyPatients = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      firstName: `Patient${i + 1}`,
      lastName: 'Lastname',
      practiceId: PRACTICE_ID,
    }));
    mockStorage.getPatients.mockResolvedValue(manyPatients);

    const out = JSON.parse(await executeTool('search_patients', { name: 'NonexistentName' }, PRACTICE_ID, USER_ID));
    expect(out.availablePatientsInPractice).toHaveLength(20);
    expect(out.totalPatientsInPractice).toBe(50);
  });

  it('still returns matches normally when the name does exist', async () => {
    mockStorage.getPatients.mockResolvedValue([
      { id: 1, firstName: 'Kristina', lastName: 'Lopez', practiceId: PRACTICE_ID, dateOfBirth: '1985-01-01' },
      { id: 2, firstName: 'Marcus', lastName: 'Patel', practiceId: PRACTICE_ID, dateOfBirth: '1990-01-01' },
    ]);

    const out = JSON.parse(await executeTool('search_patients', { name: 'Kristina' }, PRACTICE_ID, USER_ID));

    // Should NOT take the zero-match path: no anti-hallucination payload.
    expect(out.availablePatientsInPractice).toBeUndefined();
    expect(out.totalPatientsInPractice).toBeUndefined();
    // The actual match should be in the response.
    expect(JSON.stringify(out)).toContain('Kristina');
  });
});
