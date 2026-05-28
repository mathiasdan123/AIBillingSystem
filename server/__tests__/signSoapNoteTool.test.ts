/**
 * Tests for the sign_soap_note Blanche tool.
 *
 * Behavior mirrors POST /api/soap-notes/:id/sign with extra guards
 * relevant to the conversational surface:
 *   - Tenant guard via the linked treatment session (soap_notes itself
 *     has no practiceId column — FK chain goes through treatmentSessions).
 *   - Idempotent re-signing: returns alreadySigned:true rather than
 *     erroring or re-stamping.
 *   - Pre-flight digital-signature check with a clear error message
 *     pointing at the Settings page where it's configured.
 *   - signatureIpAddress is set to "blanche" so the audit trail can
 *     distinguish conversational signing from web-UI signing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getSoapNote: vi.fn(),
    getTreatmentSession: vi.fn(),
    getUser: vi.fn(),
    signSoapNote: vi.fn(),
    getPatient: vi.fn(),
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
const USER_ID = 'therapist-1';
const NOTE_ID = 100;
const SESSION_ID = 50;

beforeEach(() => {
  vi.clearAllMocks();
  mockStorage.signSoapNote.mockImplementation(async (id: number, data: any) => ({
    id,
    therapistSignedAt: data.therapistSignedAt,
    therapistSignedName: data.therapistSignedName,
  }));
});

const goodNote = () => ({ id: NOTE_ID, sessionId: SESSION_ID, therapistSignedAt: null });
const goodSession = () => ({ id: SESSION_ID, practiceId: PRACTICE_ID });
const goodTherapist = () => ({
  id: USER_ID, firstName: 'Daniel', lastName: 'Kramer',
  digitalSignature: 'data:image/png;base64,abc...',
  credentials: 'OTR/L',
});

describe('sign_soap_note tool', () => {
  it('signs an unsigned note and stamps the signing fields', async () => {
    mockStorage.getSoapNote.mockResolvedValue(goodNote());
    mockStorage.getTreatmentSession.mockResolvedValue(goodSession());
    mockStorage.getUser.mockResolvedValue(goodTherapist());
    const out = JSON.parse(await executeTool('sign_soap_note', { noteId: NOTE_ID }, PRACTICE_ID, USER_ID));
    expect(out.success).toBe(true);
    expect(out.note.id).toBe(NOTE_ID);
    expect(out.note.signedBy).toBe('Daniel Kramer');
    const stamped = mockStorage.signSoapNote.mock.calls[0][1];
    expect(stamped.therapistId).toBe(USER_ID);
    expect(stamped.therapistSignature).toBe('data:image/png;base64,abc...');
    expect(stamped.therapistSignedName).toBe('Daniel Kramer');
    expect(stamped.therapistCredentials).toBe('OTR/L');
    expect(stamped.signatureIpAddress).toBe('blanche');
    expect(stamped.therapistSignedAt).toBeInstanceOf(Date);
  });

  it('returns alreadySigned:true and does NOT re-stamp when note is already signed', async () => {
    mockStorage.getSoapNote.mockResolvedValue({
      id: NOTE_ID, sessionId: SESSION_ID,
      therapistSignedAt: new Date('2026-05-20T10:00:00Z'),
      therapistSignedName: 'Original Signer',
    });
    mockStorage.getTreatmentSession.mockResolvedValue(goodSession());
    const out = JSON.parse(await executeTool('sign_soap_note', { noteId: NOTE_ID }, PRACTICE_ID, USER_ID));
    expect(out.success).toBe(true);
    expect(out.alreadySigned).toBe(true);
    expect(out.signedBy).toBe('Original Signer');
    expect(mockStorage.signSoapNote).not.toHaveBeenCalled();
    expect(mockStorage.getUser).not.toHaveBeenCalled();
  });

  it('rejects when the linked session is in another practice (tenant guard)', async () => {
    mockStorage.getSoapNote.mockResolvedValue(goodNote());
    mockStorage.getTreatmentSession.mockResolvedValue({ id: SESSION_ID, practiceId: OTHER_PRACTICE });
    const out = JSON.parse(await executeTool('sign_soap_note', { noteId: NOTE_ID }, PRACTICE_ID, USER_ID));
    expect(out.error).toMatch(/not in this practice/i);
    expect(mockStorage.signSoapNote).not.toHaveBeenCalled();
  });

  it('rejects 404 when noteId does not exist', async () => {
    mockStorage.getSoapNote.mockResolvedValue(undefined);
    const out = JSON.parse(await executeTool('sign_soap_note', { noteId: 999999 }, PRACTICE_ID, USER_ID));
    expect(out.error).toMatch(/not found/i);
    expect(mockStorage.signSoapNote).not.toHaveBeenCalled();
  });

  it('rejects with a clear actionable error when the therapist has no signature on file', async () => {
    mockStorage.getSoapNote.mockResolvedValue(goodNote());
    mockStorage.getTreatmentSession.mockResolvedValue(goodSession());
    mockStorage.getUser.mockResolvedValue({
      id: USER_ID, firstName: 'D', lastName: 'K',
      digitalSignature: null,
    });
    const out = JSON.parse(await executeTool('sign_soap_note', { noteId: NOTE_ID }, PRACTICE_ID, USER_ID));
    expect(out.error).toMatch(/no digital signature/i);
    expect(out.error).toMatch(/settings.*therapist profile/i);
    expect(mockStorage.signSoapNote).not.toHaveBeenCalled();
  });

  it('rejects when noteId is missing or non-numeric', async () => {
    const out = JSON.parse(await executeTool('sign_soap_note', {}, PRACTICE_ID, USER_ID));
    expect(out.error).toMatch(/noteId is required/i);
    expect(mockStorage.getSoapNote).not.toHaveBeenCalled();
  });
});
