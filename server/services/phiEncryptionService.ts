import crypto from 'crypto';
import logger from './logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

interface EncryptedField {
  ciphertext: string;
  iv: string;
  tag: string;
}

function getEncryptionKey(): Buffer {
  const key = process.env.PHI_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('PHI_ENCRYPTION_KEY environment variable is required');
  }
  if (key.length !== 64 || !/^[0-9a-fA-F]+$/.test(key)) {
    throw new Error('PHI_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return Buffer.from(key, 'hex');
}

export function encryptField(plaintext: string | null | undefined): EncryptedField | null {
  if (plaintext === null || plaintext === undefined || plaintext === '') {
    return null;
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return {
    ciphertext,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

// Encrypt any value (handles objects by JSON stringifying them first)
export function encryptValue(value: any): EncryptedField | null {
  if (value === null || value === undefined) {
    return null;
  }

  // If it's an object, stringify it first
  const plaintext = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (plaintext === '') {
    return null;
  }

  return encryptField(plaintext);
}

// Decrypt to original value (parses JSON if applicable)
export function decryptValue(encrypted: EncryptedField | string | null | undefined, parseJson: boolean = false): any {
  const decrypted = decryptField(encrypted);
  if (decrypted === null || !parseJson) {
    return decrypted;
  }

  // Try to parse as JSON if requested
  try {
    return JSON.parse(decrypted);
  } catch {
    return decrypted;
  }
}

/**
 * Resolve a patient date-of-birth to a 'YYYY-MM-DD' string from the encrypted
 * column (preferred) or the legacy plaintext `date` column. Raw-join readers
 * that select patients.dateOfBirth directly should use this (selecting
 * dateOfBirthEnc alongside) so they keep working after the plaintext column is
 * dropped in the expand→contract migration.
 */
export function resolveEncryptedDob(
  dateOfBirthEnc: string | null | undefined,
  plaintextDob?: string | Date | null,
): string | null {
  const decrypted = dateOfBirthEnc ? decryptField(dateOfBirthEnc) : null;
  const raw: string | Date | null = decrypted ?? (plaintextDob ?? null);
  if (raw == null) return null;
  if (raw instanceof Date) return raw.toISOString().split('T')[0];
  const s = String(raw);
  return s.length >= 10 ? s.slice(0, 10) : s; // normalize 'YYYY-MM-DD...' → 'YYYY-MM-DD'
}

export function decryptField(encrypted: EncryptedField | string | null | undefined): string | null {
  if (!encrypted) return null;

  // If it's a plain string (not yet encrypted / legacy data), return as-is
  let enc: EncryptedField;
  if (typeof encrypted === 'string') {
    try {
      const parsed = JSON.parse(encrypted);
      if (parsed && parsed.ciphertext && parsed.iv && parsed.tag) {
        enc = parsed as EncryptedField;
      } else {
        return encrypted;
      }
    } catch {
      return encrypted;
    }
  } else {
    enc = encrypted as EncryptedField;
  }
  if (!enc.ciphertext || !enc.iv || !enc.tag) {
    return null;
  }

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(enc.iv, 'hex');
    const tag = Buffer.from(enc.tag, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let plaintext = decipher.update(enc.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');
    return plaintext;
  } catch (error) {
    // We only reach here with a well-formed EncryptedField (ciphertext+iv+tag);
    // legacy plaintext was already returned as-is above. So a failure here is a
    // GCM auth-tag mismatch — tampering, corruption, or a wrong/rotated key — NOT
    // a migration plaintext case. That used to be swallowed as a silent null,
    // defeating the integrity guarantee GCM exists to provide. Emit a CRITICAL
    // alert (no PHI) so monitoring can page on it; return null rather than throw
    // to avoid turning a single bad row into a full read-path outage.
    logger.error('CRITICAL: PHI decryption integrity failure (auth-tag mismatch)', {
      reason: error instanceof Error ? error.message : 'unknown',
      ivLen: enc.iv?.length, tagLen: enc.tag?.length,
    });
    return null;
  }
}

// PHI fields on each table that need encryption
const PATIENT_PHI_STRING_FIELDS = [
  'firstName', 'lastName', 'dateOfBirth', 'email', 'phone',
  'address', 'insuranceId', 'policyNumber', 'groupNumber',
] as const;

// JSONB fields that contain PHI and need encryption (stored as JSON objects)
const PATIENT_PHI_JSONB_FIELDS = [
  'intakeData',
] as const;

// Date-typed PHI columns mapped to their encrypted text counterpart. These can't
// be encrypted in place (the column is a Postgres `date`), so the ciphertext goes
// in a sibling `*_enc` text column (expand→contract). plaintext date col -> enc col.
const PATIENT_DATE_ENC_MAP: Record<string, string> = {
  dateOfBirth: 'dateOfBirthEnc',
  secondaryInsuranceSubscriberDob: 'secondaryInsuranceSubscriberDobEnc',
};

const SOAP_NOTE_PHI_FIELDS = [
  'subjective', 'objective', 'assessment', 'plan',
  'progressNotes', 'homeProgram',
] as const;

const TREATMENT_SESSION_PHI_STRING_FIELDS = [
  'notes', 'originalDocumentText', 'voiceTranscriptionUrl',
] as const;

const TREATMENT_SESSION_PHI_JSONB_FIELDS = [
  'aiExtractedData',
] as const;

// Voice recording metadata - therapist PII stored alongside recordings
const TELEHEALTH_SESSION_PHI_STRING_FIELDS = [
  'recordingUrl', 'notes', 'technicalIssues',
] as const;

// Telehealth settings - provider secrets
const TELEHEALTH_SETTINGS_PHI_STRING_FIELDS = [
  'providerApiKey', 'providerApiSecret',
] as const;

// Therapist/User PII fields that need encryption
const USER_PHI_STRING_FIELDS = [
  'licenseNumber', 'npiNumber', 'digitalSignature',
] as const;

// Practice sensitive fields - tax IDs, API keys, contact info
const PRACTICE_PHI_STRING_FIELDS = [
  'taxId', 'phone', 'stediApiKey', 'stediPartnerId',
  'itContactPhone', 'billingContactPhone',
  // Typed enrollment-authorization e-signature (legal attestation).
  'ownerSignature',
] as const;

// Patient insurance fields on the patients table are already covered in PATIENT_PHI_STRING_FIELDS.
// Insurance provider name ('insuranceProvider') should also be encrypted as it reveals health plan info.
// Secondary-insurance + employer fields are the same class of insurance PHI as the primary fields
// and were previously stored in plaintext (audit finding). Encrypt them too.
// NOTE: secondaryInsuranceSubscriberDob and dateOfBirth are `date` columns and cannot be
// string-encrypted without a schema migration to text (tracked separately); they remain protected
// at rest by RDS encryption in the meantime.
const PATIENT_INSURANCE_EXTRA_FIELDS = [
  'insuranceProvider',
  'insuranceEmployerName',
  'secondaryInsuranceProvider',
  'secondaryInsurancePolicyNumber',
  'secondaryInsuranceMemberId',
  'secondaryInsuranceGroupNumber',
  'secondaryInsuranceSubscriberName',
] as const;

// Data capture events may contain PHI in original/extracted data
const DATA_CAPTURE_EVENT_PHI_STRING_FIELDS = [
  'originalData',
] as const;

const DATA_CAPTURE_EVENT_PHI_JSONB_FIELDS = [
  'extractedData',
] as const;

export function encryptPatientRecord(patient: Record<string, any>): Record<string, any> {
  const encrypted = { ...patient };

  // Fields stored as date type in DB — cannot be encrypted (not varchar/text)
  const DATE_TYPE_FIELDS = ['dateOfBirth'];

  // Encrypt string fields (core PHI + insurance provider)
  for (const field of [...PATIENT_PHI_STRING_FIELDS, ...PATIENT_INSURANCE_EXTRA_FIELDS]) {
    if (encrypted[field] !== undefined && !DATE_TYPE_FIELDS.includes(field)) {
      const result = encryptField(encrypted[field] as string);
      // JSON-stringify the encrypted object for storage in varchar/text columns
      encrypted[field] = result ? JSON.stringify(result) : null;
    }
  }

  // Encrypt JSONB fields (objects need to be stringified first)
  for (const field of PATIENT_PHI_JSONB_FIELDS) {
    if (encrypted[field] !== undefined && encrypted[field] !== null) {
      encrypted[field] = encryptValue(encrypted[field]);
    }
  }

  // Date-typed PHI columns: dual-write an encrypted text copy (`*_enc`) alongside
  // the plaintext `date` column. Expand→contract — the plaintext date column is
  // dropped in a follow-up release once all readers prefer the encrypted copy.
  // We keep writing the plaintext column so old code in the rolling-deploy window
  // still sees the value. A partial update that omits the date leaves both alone;
  // an explicit null clears both.
  for (const [plain, enc] of Object.entries(PATIENT_DATE_ENC_MAP)) {
    if (encrypted[plain] === undefined) continue;
    if (encrypted[plain] === null || encrypted[plain] === '') {
      encrypted[enc] = null;
    } else {
      const result = encryptField(String(encrypted[plain]));
      encrypted[enc] = result ? JSON.stringify(result) : null;
    }
  }

  return encrypted;
}

export function decryptPatientRecord(patient: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!patient) return null;
  const decrypted = { ...patient };

  // Decrypt string fields (core PHI + insurance provider)
  for (const field of [...PATIENT_PHI_STRING_FIELDS, ...PATIENT_INSURANCE_EXTRA_FIELDS]) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptField(decrypted[field]);
    }
  }

  // Decrypt JSONB fields (parse back to objects)
  for (const field of PATIENT_PHI_JSONB_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptValue(decrypted[field], true); // parseJson = true
    }
  }

  // Date PHI: prefer the encrypted copy when present, falling back to the
  // plaintext date column (for rows not yet backfilled). Strip the `*_enc`
  // helper column from the returned record so the API shape is unchanged.
  for (const [plain, enc] of Object.entries(PATIENT_DATE_ENC_MAP)) {
    if (decrypted[enc] !== undefined && decrypted[enc] !== null) {
      const val = decryptField(decrypted[enc]);
      if (val !== null) decrypted[plain] = val;
    }
    delete decrypted[enc];
  }

  return decrypted;
}

// Blanche chat history: the messages array is treated as a single PHI blob.
// Chat content can contain anything the user typed (patient names, complaints,
// claim details, etc.) so we encrypt the whole array rather than trying to
// classify individual messages. Stored as an encrypted JSON object in the
// `messages` jsonb column.
export function encryptBlancheMessages(messages: any[]): any {
  return encryptValue(messages);
}

export function decryptBlancheMessages(encrypted: any): any[] {
  if (encrypted === null || encrypted === undefined) return [];
  // The table is new in this release — there should never be a plaintext
  // array on disk. If we ever see one, treat it as corrupt and return [] so
  // unencrypted PHI is not silently accepted and served back to the client.
  if (Array.isArray(encrypted)) return [];
  const value = decryptValue(encrypted, true);
  return Array.isArray(value) ? value : [];
}

export function encryptSoapNoteRecord(note: Record<string, any>): Record<string, any> {
  const encrypted = { ...note };
  for (const field of SOAP_NOTE_PHI_FIELDS) {
    if (encrypted[field] !== undefined) {
      encrypted[field] = encryptField(encrypted[field] as string);
    }
  }
  return encrypted;
}

// Drafts use the same PHI fields as signed soap notes — they're the same
// clinical content, just in-progress. Reuse the field list.
export const encryptSoapDraftRecord = encryptSoapNoteRecord;
export const decryptSoapDraftRecord = decryptSoapNoteRecord;

export function decryptSoapNoteRecord(note: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!note) return null;
  const decrypted = { ...note };
  for (const field of SOAP_NOTE_PHI_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptField(decrypted[field]);
    }
  }
  return decrypted;
}

// Remittance (835/ERA) line items carry the patient's name and insurance member
// ID parsed from the payer file — both PHI. varchar columns, so store the
// EncryptedField JSON-stringified like the patient fields (decryptField tolerates
// legacy plaintext, so existing rows keep working until re-saved/backfilled).
const REMITTANCE_LINE_ITEM_PHI_FIELDS = ['patientName', 'memberId'] as const;

export function encryptRemittanceLineItem(item: Record<string, any>): Record<string, any> {
  const encrypted = { ...item };
  for (const field of REMITTANCE_LINE_ITEM_PHI_FIELDS) {
    if (encrypted[field] !== undefined && encrypted[field] !== null && encrypted[field] !== '') {
      const result = encryptField(String(encrypted[field]));
      encrypted[field] = result ? JSON.stringify(result) : null;
    }
  }
  return encrypted;
}

export function decryptRemittanceLineItem(item: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!item) return null;
  const decrypted = { ...item };
  for (const field of REMITTANCE_LINE_ITEM_PHI_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptField(decrypted[field]);
    }
  }
  return decrypted;
}

export function encryptTreatmentSessionRecord(session: Record<string, any>): Record<string, any> {
  const encrypted = { ...session };
  for (const field of TREATMENT_SESSION_PHI_STRING_FIELDS) {
    if (encrypted[field] !== undefined) {
      encrypted[field] = encryptField(encrypted[field] as string);
    }
  }
  for (const field of TREATMENT_SESSION_PHI_JSONB_FIELDS) {
    if (encrypted[field] !== undefined && encrypted[field] !== null) {
      encrypted[field] = encryptValue(encrypted[field]);
    }
  }
  return encrypted;
}

export function decryptTreatmentSessionRecord(session: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!session) return null;
  const decrypted = { ...session };
  for (const field of TREATMENT_SESSION_PHI_STRING_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptField(decrypted[field]);
    }
  }
  for (const field of TREATMENT_SESSION_PHI_JSONB_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptValue(decrypted[field], true);
    }
  }
  return decrypted;
}

// ==================== TELEHEALTH SESSION ENCRYPTION ====================
// Encrypts voice recording metadata and therapist PII stored alongside recordings

export function encryptTelehealthSessionRecord(session: Record<string, any>): Record<string, any> {
  const encrypted = { ...session };
  for (const field of TELEHEALTH_SESSION_PHI_STRING_FIELDS) {
    if (encrypted[field] !== undefined) {
      encrypted[field] = encryptField(encrypted[field] as string);
    }
  }
  return encrypted;
}

export function decryptTelehealthSessionRecord(session: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!session) return null;
  const decrypted = { ...session };
  for (const field of TELEHEALTH_SESSION_PHI_STRING_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptField(decrypted[field]);
    }
  }
  return decrypted;
}

// ==================== TELEHEALTH SETTINGS ENCRYPTION ====================
// Encrypts provider API credentials

export function encryptTelehealthSettingsRecord(settings: Record<string, any>): Record<string, any> {
  const encrypted = { ...settings };
  for (const field of TELEHEALTH_SETTINGS_PHI_STRING_FIELDS) {
    if (encrypted[field] !== undefined) {
      encrypted[field] = encryptField(encrypted[field] as string);
    }
  }
  return encrypted;
}

export function decryptTelehealthSettingsRecord(settings: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!settings) return null;
  const decrypted = { ...settings };
  for (const field of TELEHEALTH_SETTINGS_PHI_STRING_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptField(decrypted[field]);
    }
  }
  return decrypted;
}

// ==================== USER/THERAPIST PII ENCRYPTION ====================
// Encrypts therapist personal info (license numbers, NPI, digital signatures)

export function encryptUserRecord(user: Record<string, any>): Record<string, any> {
  const encrypted = { ...user };
  for (const field of USER_PHI_STRING_FIELDS) {
    if (encrypted[field] !== undefined) {
      encrypted[field] = encryptField(encrypted[field] as string);
    }
  }
  return encrypted;
}

export function decryptUserRecord(user: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!user) return null;
  const decrypted = { ...user };
  for (const field of USER_PHI_STRING_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptField(decrypted[field]);
    }
  }
  return decrypted;
}

// ==================== PRACTICE ENCRYPTION ====================
// Encrypts practice tax IDs, API keys, and sensitive contact info

export function encryptPracticeRecord(practice: Record<string, any>): Record<string, any> {
  const encrypted = { ...practice };
  for (const field of PRACTICE_PHI_STRING_FIELDS) {
    if (encrypted[field] !== undefined) {
      encrypted[field] = encryptField(encrypted[field] as string);
    }
  }
  return encrypted;
}

export function decryptPracticeRecord(practice: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!practice) return null;
  const decrypted = { ...practice };
  for (const field of PRACTICE_PHI_STRING_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptField(decrypted[field]);
    }
  }
  return decrypted;
}

// ==================== DATA CAPTURE EVENT ENCRYPTION ====================
// Encrypts voice recording transcription data and extracted PHI

export function encryptDataCaptureEventRecord(event: Record<string, any>): Record<string, any> {
  const encrypted = { ...event };
  for (const field of DATA_CAPTURE_EVENT_PHI_STRING_FIELDS) {
    if (encrypted[field] !== undefined) {
      encrypted[field] = encryptField(encrypted[field] as string);
    }
  }
  for (const field of DATA_CAPTURE_EVENT_PHI_JSONB_FIELDS) {
    if (encrypted[field] !== undefined && encrypted[field] !== null) {
      encrypted[field] = encryptValue(encrypted[field]);
    }
  }
  return encrypted;
}

export function decryptDataCaptureEventRecord(event: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!event) return null;
  const decrypted = { ...event };
  for (const field of DATA_CAPTURE_EVENT_PHI_STRING_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptField(decrypted[field]);
    }
  }
  for (const field of DATA_CAPTURE_EVENT_PHI_JSONB_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptValue(decrypted[field], true);
    }
  }
  return decrypted;
}

// ==================== PRACTICE PAYMENT SETTINGS ENCRYPTION ====================
// Encrypts Stripe secret keys and webhook secrets

const PRACTICE_PAYMENT_SETTINGS_SECRET_FIELDS = [
  'stripeSecretKeyEncrypted', 'stripeWebhookSecret',
] as const;

export function encryptPracticePaymentSettingsRecord(settings: Record<string, any>): Record<string, any> {
  const encrypted = { ...settings };
  for (const field of PRACTICE_PAYMENT_SETTINGS_SECRET_FIELDS) {
    if (encrypted[field] !== undefined) {
      encrypted[field] = encryptField(encrypted[field] as string);
    }
  }
  return encrypted;
}

export function decryptPracticePaymentSettingsRecord(settings: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!settings) return null;
  const decrypted = { ...settings };
  for (const field of PRACTICE_PAYMENT_SETTINGS_SECRET_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptField(decrypted[field]);
    }
  }
  return decrypted;
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}
