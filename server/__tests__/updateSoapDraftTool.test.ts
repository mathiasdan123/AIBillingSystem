/**
 * Tests for the update_soap_draft Blanche tool.
 *
 * Mirrors PUT /api/soap-drafts behavior — upsert keyed on (therapistId,
 * patientId), field allowlist matches the HTTP route exactly. Deliberately
 * NOT in MUTATION_TOOLS — draft saves are auto-save-style; the confirm
 * card fires at sign time, not on every keystroke-equivalent save.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatient: vi.fn(),
    upsertSoapDraft: vi.fn(),
    getPatients: vi.fn(),
    getPractice: vi.fn(),
  },
}));

vi.mock('../storage', () => ({ storage: mockStorage }));
vi.mock('../db', () => ({
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })) })) },
}));

import { executeTool } from '../routes/ai-assistant';

const PRACTICE_ID = 1;
const OTHER_PRACTICE = 99;
const USER_ID = 'therapist-1';
const PATIENT_ID = 42;

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.upsertSoapDraft.mockImplementation(async (data: any) => ({
    id: 7,
    ...data,
    lastSavedAt: new Date('2026-05-29T12:00:00Z'),
  }));
});

describe('update_soap_draft tool', () => {
  it('saves allowed SOAP section fields and returns lastSavedAt + updated list', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, practiceId: PRACTICE_ID, firstName: 'Sarah', lastName: 'Chen' });
    const out = JSON.parse(
      await executeTool(
        'update_soap_draft',
        {
          patientId: PATIENT_ID,
          subjective: 'Caregiver report: anxious at home.',
          objective: 'Session conducted for 45 min. Patient engaged in obstacle course.',
          assessment: 'Patient demonstrated motor planning deficit; skilled OT remains medically necessary.',
        },
        PRACTICE_ID, USER_ID,
      ),
    );
    expect(out.success).toBe(true);
    expect(out.draft).toMatchObject({ id: 7, patientId: PATIENT_ID });
    expect(out.draft.lastSavedAt).toBeDefined();
    expect(out.updatedFields).toEqual(['subjective', 'objective', 'assessment']);
    const call = mockStorage.upsertSoapDraft.mock.calls[0][0];
    expect(call.therapistId).toBe(USER_ID);
    expect(call.practiceId).toBe(PRACTICE_ID);
    expect(call.patientId).toBe(PATIENT_ID);
    expect(call.subjective).toBe('Caregiver report: anxious at home.');
  });

  it('only updates supplied fields — omitted fields are not written', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, practiceId: PRACTICE_ID, firstName: 'S', lastName: 'C' });
    await executeTool(
      'update_soap_draft',
      { patientId: PATIENT_ID, plan: 'Continue current frequency.' },
      PRACTICE_ID, USER_ID,
    );
    const call = mockStorage.upsertSoapDraft.mock.calls[0][0];
    expect(call).toHaveProperty('plan', 'Continue current frequency.');
    expect(call).not.toHaveProperty('subjective');
    expect(call).not.toHaveProperty('objective');
  });

  it('drops non-SOAP fields (allowlist guard)', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, practiceId: PRACTICE_ID, firstName: 'S', lastName: 'C' });
    await executeTool(
      'update_soap_draft',
      {
        patientId: PATIENT_ID,
        subjective: 'OK',
        ssn: '000-00-0000',
        signedAt: '2026-05-29',
        therapistId: 'attacker',  // attempt to override scope
      },
      PRACTICE_ID, USER_ID,
    );
    const call = mockStorage.upsertSoapDraft.mock.calls[0][0];
    expect(call).toHaveProperty('subjective', 'OK');
    expect(call).not.toHaveProperty('ssn');
    expect(call).not.toHaveProperty('signedAt');
    // therapistId comes from authed userId, not args — must be the real one
    expect(call.therapistId).toBe(USER_ID);
  });

  it('rejects cross-practice patient (tenant guard)', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, practiceId: OTHER_PRACTICE, firstName: 'S', lastName: 'C' });
    const out = JSON.parse(
      await executeTool(
        'update_soap_draft',
        { patientId: PATIENT_ID, subjective: 'X' },
        PRACTICE_ID, USER_ID,
      ),
    );
    expect(out.error).toMatch(/not in this practice/i);
    expect(mockStorage.upsertSoapDraft).not.toHaveBeenCalled();
  });

  it('rejects unknown patient id', async () => {
    mockStorage.getPatient.mockResolvedValue(undefined);
    const out = JSON.parse(
      await executeTool(
        'update_soap_draft',
        { patientId: 999999, subjective: 'X' },
        PRACTICE_ID, USER_ID,
      ),
    );
    expect(out.error).toMatch(/not found/i);
    expect(mockStorage.upsertSoapDraft).not.toHaveBeenCalled();
  });

  it('rejects when no SOAP fields are supplied (all filtered out)', async () => {
    mockStorage.getPatient.mockResolvedValue({ id: PATIENT_ID, practiceId: PRACTICE_ID, firstName: 'S', lastName: 'C' });
    const out = JSON.parse(
      await executeTool(
        'update_soap_draft',
        { patientId: PATIENT_ID, ssn: 'nope' },
        PRACTICE_ID, USER_ID,
      ),
    );
    expect(out.error).toMatch(/no soap draft fields/i);
    expect(mockStorage.upsertSoapDraft).not.toHaveBeenCalled();
  });
});
