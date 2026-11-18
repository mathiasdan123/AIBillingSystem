import { describe, it, expect, beforeAll } from 'vitest';

/**
 * soap_note_drafts.billing is PHI: the suggested billing carries the
 * session's activity descriptions and the rationale prose next to
 * patient_id. It must leave the process the same way the prose draft
 * columns do -- as an AES-256-GCM EncryptedField -- never as plaintext JSON
 * (PR #463 review). Round-trips through the jsonb coercion Postgres applies
 * (stringify → parse) and refuses to serve a plaintext object back.
 */

beforeAll(() => {
  if (!process.env.PHI_ENCRYPTION_KEY) {
    process.env.PHI_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  }
});

import { encryptSoapDraftRecord, decryptSoapDraftRecord } from '../services/phiEncryptionService';

const BILLING = {
  v: 1,
  cptCodes: [{ code: '97110', name: 'Therapeutic Exercise', units: 3, rationale: 'Trampoline jumping is timed therapeutic exercise', reimbursement: 300 }],
  activityCptPairings: [{ activity: 'Trampoline - Strengthening', code: '97110', rationale: 'strengthening, timed' }],
  timeBlocks: [{ blockNumber: 1, startMinute: 0, endMinute: 45, code: '97110', codeName: 'Therapeutic Exercise', rate: 100, activities: ['Trampoline - Strengthening'] }],
  billingRationale: 'Five sets of ten jumps with one-minute pauses supports 3 units of 97110.',
  auditNotes: [],
  totalReimbursement: 300,
  generationMode: 'ai',
};

const draft = (billing: unknown) => ({
  practiceId: 1,
  therapistId: 'therapist-a',
  patientId: 42,
  subjective: 'Caregiver reported a good week.',
  objective: 'Five sets of ten jumps, one-minute pauses, no pain.',
  billing,
});

describe('encryptSoapDraftRecord / decryptSoapDraftRecord: billing column', () => {
  it('stores billing as an EncryptedField object, with no activity or rationale text visible', () => {
    const encrypted = encryptSoapDraftRecord(draft(BILLING));
    expect(encrypted.billing).toMatchObject({ ciphertext: expect.any(String), iv: expect.any(String), tag: expect.any(String) });
    const onDisk = JSON.stringify(encrypted.billing);
    expect(onDisk).not.toContain('Trampoline');
    expect(onDisk).not.toContain('jumps');
    expect(onDisk).not.toContain('97110');
    // The prose columns are still encrypted exactly as before.
    expect(JSON.stringify(encrypted.objective)).not.toContain('jumps');
  });

  it('round-trips billing intact through the jsonb coercion Postgres applies', () => {
    const encrypted = encryptSoapDraftRecord(draft(BILLING));
    const row = JSON.parse(JSON.stringify({ id: 7, ...encrypted }));
    const decrypted = decryptSoapDraftRecord(row)!;
    expect(decrypted.billing).toEqual(BILLING);
    expect(decrypted.objective).toBe('Five sets of ten jumps, one-minute pauses, no pain.');
  });

  it('keeps null billing as null in both directions ("no billing saved yet")', () => {
    const encrypted = encryptSoapDraftRecord(draft(null));
    expect(encrypted.billing).toBeNull();
    expect(decryptSoapDraftRecord({ id: 7, ...encrypted })!.billing).toBeNull();
  });

  it('leaves billing untouched when the field is absent (older callers)', () => {
    const { billing: _omit, ...withoutBilling } = draft(BILLING);
    const encrypted = encryptSoapDraftRecord(withoutBilling);
    expect('billing' in encrypted).toBe(false);
    expect(decryptSoapDraftRecord({ id: 7, ...encrypted })!.billing).toBeUndefined();
  });

  it('refuses to serve a plaintext billing object found on disk (treats it as absent)', () => {
    // The column has only ever been written encrypted, so plaintext here is
    // corrupt or hand-written. Returning it would hand unencrypted PHI to the
    // client; returning null costs the user one "Generate".
    const decrypted = decryptSoapDraftRecord({ id: 7, patientId: 42, billing: BILLING })!;
    expect(decrypted.billing).toBeNull();
  });

  it('treats a bare string or an array in the column as absent too', () => {
    expect(decryptSoapDraftRecord({ id: 7, billing: 'not json' })!.billing).toBeNull();
    expect(decryptSoapDraftRecord({ id: 7, billing: [1, 2] })!.billing).toBeNull();
  });

  it('uses a fresh IV per save, so identical billing never produces identical ciphertext', () => {
    const a = encryptSoapDraftRecord(draft(BILLING)).billing;
    const b = encryptSoapDraftRecord(draft(BILLING)).billing;
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
});
