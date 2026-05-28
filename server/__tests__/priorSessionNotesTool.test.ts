/**
 * Tests for the get_prior_session_notes Blanche tool (P0.3 pre-charting).
 *
 * Read-only tool. Tenant guard at the patient level so the model can't
 * probe out-of-practice patients via a "no notes found" 200. Section
 * fields trimmed to 600 chars in the response so a chatty note doesn't
 * blow Blanche's context window.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatient: vi.fn(),
    getRecentSoapNotesForPatient: vi.fn(),
    getPatients: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));

import { executeTool } from '../routes/ai-assistant';

const PRACTICE_ID = 1;
const OTHER_PRACTICE = 99;
const USER_ID = 'user-1';
const PATIENT_ID = 42;

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.getPatient.mockResolvedValue({
    id: PATIENT_ID, practiceId: PRACTICE_ID, firstName: 'Sarah', lastName: 'Chen',
  });
});

describe('get_prior_session_notes tool', () => {
  it('returns a trimmed summary of the most recent notes for a patient', async () => {
    mockStorage.getRecentSoapNotesForPatient.mockResolvedValue([
      {
        id: 101, sessionId: 51, createdAt: new Date('2026-05-22'),
        subjective: 'Caregiver reported anxiety at home.',
        objective: 'Session conducted for 45 min. Obstacle course traversal.',
        assessment: 'Motor planning deficit observed; skilled OT necessary.',
        plan: 'Continue current frequency. Home program reviewed.',
        therapistSignedAt: new Date('2026-05-22'),
        therapistSignedName: 'Daniel Kramer',
        interventions: ['sensory integration', 'gross motor'],
      },
    ]);
    const out = JSON.parse(
      await executeTool('get_prior_session_notes', { patientId: PATIENT_ID, limit: 3 }, PRACTICE_ID, USER_ID),
    );
    expect(out.patient.id).toBe(PATIENT_ID);
    expect(out.patient.name).toBe('Sarah Chen');
    expect(out.noteCount).toBe(1);
    expect(out.notes[0]).toMatchObject({
      noteId: 101, sessionId: 51,
      subjective: 'Caregiver reported anxiety at home.',
      signedBy: 'Daniel Kramer',
    });
    expect(mockStorage.getRecentSoapNotesForPatient).toHaveBeenCalledWith(PATIENT_ID, PRACTICE_ID, 3);
  });

  it('trims long section text to ~600 chars so the response stays small', async () => {
    const long = 'x'.repeat(2000);
    mockStorage.getRecentSoapNotesForPatient.mockResolvedValue([
      { id: 1, sessionId: 1, subjective: long, objective: long, assessment: long, plan: long },
    ]);
    const out = JSON.parse(
      await executeTool('get_prior_session_notes', { patientId: PATIENT_ID }, PRACTICE_ID, USER_ID),
    );
    expect(out.notes[0].subjective.endsWith('…')).toBe(true);
    expect(out.notes[0].subjective.length).toBeLessThanOrEqual(700);
    expect(out.notes[0].objective.length).toBeLessThanOrEqual(700);
  });

  it('returns noteCount 0 with a friendly message when no notes on file', async () => {
    mockStorage.getRecentSoapNotesForPatient.mockResolvedValue([]);
    const out = JSON.parse(
      await executeTool('get_prior_session_notes', { patientId: PATIENT_ID }, PRACTICE_ID, USER_ID),
    );
    expect(out.noteCount).toBe(0);
    expect(out.notes).toEqual([]);
    expect(out.message).toMatch(/no prior soap notes/i);
  });

  it('defaults limit to 5 when not supplied', async () => {
    mockStorage.getRecentSoapNotesForPatient.mockResolvedValue([]);
    await executeTool('get_prior_session_notes', { patientId: PATIENT_ID }, PRACTICE_ID, USER_ID);
    expect(mockStorage.getRecentSoapNotesForPatient).toHaveBeenCalledWith(PATIENT_ID, PRACTICE_ID, 5);
  });

  it('rejects cross-practice patient — does NOT call storage', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, practiceId: OTHER_PRACTICE, firstName: 'X', lastName: 'Y' });
    const out = JSON.parse(
      await executeTool('get_prior_session_notes', { patientId: PATIENT_ID }, PRACTICE_ID, USER_ID),
    );
    expect(out.error).toMatch(/not in this practice/i);
    expect(mockStorage.getRecentSoapNotesForPatient).not.toHaveBeenCalled();
  });

  it('rejects unknown patient id', async () => {
    mockStorage.getPatient.mockResolvedValue(undefined);
    const out = JSON.parse(
      await executeTool('get_prior_session_notes', { patientId: 999999 }, PRACTICE_ID, USER_ID),
    );
    expect(out.error).toMatch(/not found/i);
    expect(mockStorage.getRecentSoapNotesForPatient).not.toHaveBeenCalled();
  });

  it('rejects missing/non-numeric patientId', async () => {
    const out = JSON.parse(await executeTool('get_prior_session_notes', {}, PRACTICE_ID, USER_ID));
    expect(out.error).toMatch(/patientId is required/i);
    expect(mockStorage.getPatient).not.toHaveBeenCalled();
  });
});
