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
const PATIENT_PHI_FIELDS = [
  'firstName', 'lastName', 'dateOfBirth', 'email', 'phone',
  'address', 'insuranceId', 'policyNumber', 'groupNumber',
] as const;

const SOAP_NOTE_PHI_FIELDS = [
  'subjective', 'objective', 'assessment', 'plan',
  'progressNotes', 'homeProgram',
] as const;

const TREATMENT_SESSION_PHI_FIELDS = [
  'notes', 'originalDocumentText',
] as const;

export function encryptPatientRecord(patient: Record<string, any>): Record<string, any> {
  const encrypted = { ...patient };
  for (const field of PATIENT_PHI_FIELDS) {
    if (encrypted[field] !== undefined) {
      encrypted[field] = encryptField(encrypted[field] as string);
    }
  }
  return encrypted;
}

export function decryptPatientRecord(patient: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!patient) return null;
  const decrypted = { ...patient };
  for (const field of PATIENT_PHI_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptField(decrypted[field]);
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
  for (const field of TREATMENT_SESSION_PHI_FIELDS) {
    if (encrypted[field] !== undefined) {
      encrypted[field] = encryptField(encrypted[field] as string);
    }
  }
  return encrypted;
}

export function decryptTreatmentSessionRecord(session: Record<string, any> | null | undefined): Record<string, any> | null {
  if (!session) return null;
  const decrypted = { ...session };
  for (const field of TREATMENT_SESSION_PHI_FIELDS) {
    if (decrypted[field] !== undefined && decrypted[field] !== null) {
      decrypted[field] = decryptField(decrypted[field]);
    }
  }
  return decrypted;
}

export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}
