/**
 * Tests for the update_patient_insurance Blanche tool.
 *
 * Mirror of the PATCH /api/patients/:id/insurance HTTP-route tests in
 * patientInsurancePatch.test.ts — same field allowlist, same tenant
 * guard, same empty-string-to-null coercion. Kept in lockstep deliberately
 * because both surfaces are user-facing and a regression in one shouldn't
 * silently affect the other.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPatient: vi.fn(),
    updatePatient: vi.fn(),
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
const USER_ID = 'user-1';
const PATIENT_ID = 42;

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.updatePatient.mockImplementation(async (id: number, patch: any) => ({
    id,
    firstName: 'Sarah',
    lastName: 'Chen',
    ...patch,
  }));
});

describe('update_patient_insurance tool', () => {
  it('persists allowed insurance fields and returns the updated field list', async () => {
    mockStorage.getPatient.mockResolvedValue({
      id: PATIENT_ID,
      practiceId: PRACTICE_ID,
      firstName: 'Sarah',
      lastName: 'Chen',
    });
    const out = JSON.parse(
      await executeTool(
        'update_patient_insurance',
        {
          patientId: PATIENT_ID,
          insuranceProvider: 'Aetna',
          insuranceId: 'ABC123',
          policyNumber: 'POL-1',
          effectiveDate: '2026-01-01',
        },
        PRACTICE_ID,
        USER_ID,
      ),
    );
    expect(out.success).toBe(true);
    expect(out.patient).toMatchObject({ id: PATIENT_ID, firstName: 'Sarah', lastName: 'Chen' });
    expect(out.updatedFields).toEqual(
      expect.arrayContaining(['insuranceProvider', 'insuranceId', 'policyNumber', 'effectiveDate']),
    );
    const patch = mockStorage.updatePatient.mock.calls[0][1];
    expect(patch).toEqual({
      insuranceProvider: 'Aetna',
      insuranceId: 'ABC123',
      policyNumber: 'POL-1',
      effectiveDate: '2026-01-01',
    });
  });

  it('drops non-insurance fields (allowlist guard)', async () => {
    mockStorage.getPatient.mockResolvedValue({
      id: PATIENT_ID, practiceId: PRACTICE_ID, firstName: 'S', lastName: 'C',
    });
    await executeTool(
      'update_patient_insurance',
      {
        patientId: PATIENT_ID,
        insuranceProvider: 'Cigna',
        firstName: 'EVIL',
        ssn: '000-00-0000',
        practiceId: OTHER_PRACTICE,
      },
      PRACTICE_ID, USER_ID,
    );
    const patch = mockStorage.updatePatient.mock.calls[0][1];
    expect(patch).toEqual({ insuranceProvider: 'Cigna' });
    expect(patch).not.toHaveProperty('firstName');
    expect(patch).not.toHaveProperty('ssn');
    expect(patch).not.toHaveProperty('practiceId');
  });

  it('coerces empty strings to null so a Clear gesture wipes the column', async () => {
    mockStorage.getPatient.mockResolvedValue({
      id: PATIENT_ID, practiceId: PRACTICE_ID, firstName: 'S', lastName: 'C',
    });
    await executeTool(
      'update_patient_insurance',
      { patientId: PATIENT_ID, terminationDate: '', groupNumber: '' },
      PRACTICE_ID, USER_ID,
    );
    const patch = mockStorage.updatePatient.mock.calls[0][1];
    expect(patch).toEqual({ terminationDate: null, groupNumber: null });
  });

  it('rejects cross-practice patient (tenant guard)', async () => {
    mockStorage.getPatient.mockResolvedValue({
      id: PATIENT_ID, practiceId: OTHER_PRACTICE, firstName: 'S', lastName: 'C',
    });
    const out = JSON.parse(
      await executeTool(
        'update_patient_insurance',
        { patientId: PATIENT_ID, insuranceProvider: 'X' },
        PRACTICE_ID, USER_ID,
      ),
    );
    expect(out.error).toMatch(/not in this practice/i);
    expect(mockStorage.updatePatient).not.toHaveBeenCalled();
  });

  it('rejects unknown patient id with a clear error', async () => {
    mockStorage.getPatient.mockResolvedValue(undefined);
    const out = JSON.parse(
      await executeTool(
        'update_patient_insurance',
        { patientId: 999999, insuranceProvider: 'X' },
        PRACTICE_ID, USER_ID,
      ),
    );
    expect(out.error).toMatch(/not found/i);
    expect(mockStorage.updatePatient).not.toHaveBeenCalled();
  });

  it('rejects when no insurance fields are supplied (all filtered out)', async () => {
    mockStorage.getPatient.mockResolvedValue({
      id: PATIENT_ID, practiceId: PRACTICE_ID, firstName: 'S', lastName: 'C',
    });
    const out = JSON.parse(
      await executeTool(
        'update_patient_insurance',
        { patientId: PATIENT_ID, firstName: 'Nope' },
        PRACTICE_ID, USER_ID,
      ),
    );
    expect(out.error).toMatch(/no insurance fields/i);
    expect(mockStorage.updatePatient).not.toHaveBeenCalled();
  });
});
