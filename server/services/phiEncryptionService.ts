import crypto from 'crypto';

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
    throw new Error('PHI_ENCRYPTION_KEY environment variable is required for PHI encryption');
  }
  // If the key is hex-encoded (64 chars for 32 bytes)
  if (key.length === 64) {
    return Buffer.from(key, 'hex');
  }
  // Otherwise derive a key from the string
  return crypto.scryptSync(key, 'therapybill-phi-salt', KEY_LENGTH);
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
    // If decryption fails, the data might be plaintext (migration scenario)
    if (typeof encrypted === 'object' && encrypted.ciphertext) {
      return null;
    }
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
] as const;

// Patient insurance fields on the patients table are already covered in PATIENT_PHI_STRING_FIELDS.
// Insurance provider name ('insuranceProvider') should also be encrypted as it reveals health plan info.
const PATIENT_INSURANCE_EXTRA_FIELDS = [
  'insuranceProvider',
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

  // Encrypt string fields (core PHI + insurance provider)
  for (const field of [...PATIENT_PHI_STRING_FIELDS, ...PATIENT_INSURANCE_EXTRA_FIELDS]) {
    if (encrypted[field] !== undefined) {
      encrypted[field] = encryptField(encrypted[field] as string);
    }
  }

  // Encrypt JSONB fields (objects need to be stringified first)
  for (const field of PATIENT_PHI_JSONB_FIELDS) {
    if (encrypted[field] !== undefined && encrypted[field] !== null) {
      encrypted[field] = encryptValue(encrypted[field]);
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

  return decrypted;
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
