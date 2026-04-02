import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original env
const originalEnv = process.env.PHI_ENCRYPTION_KEY;

// We need a stable test key (64 hex chars = 32 bytes)
const TEST_KEY_HEX = 'a'.repeat(64);

describe('PHI Encryption Service', () => {
  beforeEach(() => {
    // Set a valid hex key before each test
    process.env.PHI_ENCRYPTION_KEY = TEST_KEY_HEX;
    // Clear module cache so getEncryptionKey picks up new env
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    if (originalEnv !== undefined) {
      process.env.PHI_ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.PHI_ENCRYPTION_KEY;
    }
  });

  async function loadModule() {
    return await import('../services/phiEncryptionService');
  }

  // ---- encryptField / decryptField roundtrip ----

  it('should encrypt and decrypt a string field roundtrip', async () => {
    const { encryptField, decryptField } = await loadModule();
    const plaintext = 'John Doe';
    const encrypted = encryptField(plaintext);
    expect(encrypted).not.toBeNull();
    expect(encrypted!.ciphertext).toBeDefined();
    expect(encrypted!.iv).toBeDefined();
    expect(encrypted!.tag).toBeDefined();

    const decrypted = decryptField(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should return null when encrypting null, undefined, or empty string', async () => {
    const { encryptField } = await loadModule();
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeNull();
    expect(encryptField('')).toBeNull();
  });

  it('should produce ciphertext that differs from the plaintext', async () => {
    const { encryptField } = await loadModule();
    const plaintext = 'SensitivePHI-12345';
    const encrypted = encryptField(plaintext);
    expect(encrypted).not.toBeNull();
    expect(encrypted!.ciphertext).not.toBe(plaintext);
  });

  it('should produce different ciphertexts for the same input (IV uniqueness)', async () => {
    const { encryptField } = await loadModule();
    const plaintext = 'Same value encrypted twice';
    const enc1 = encryptField(plaintext);
    const enc2 = encryptField(plaintext);
    expect(enc1).not.toBeNull();
    expect(enc2).not.toBeNull();
    // IVs must differ
    expect(enc1!.iv).not.toBe(enc2!.iv);
    // Ciphertexts must differ due to different IVs
    expect(enc1!.ciphertext).not.toBe(enc2!.ciphertext);
  });

  it('should throw when PHI_ENCRYPTION_KEY is missing', async () => {
    delete process.env.PHI_ENCRYPTION_KEY;
    const { encryptField } = await loadModule();
    expect(() => encryptField('test')).toThrow('PHI_ENCRYPTION_KEY');
  });

  it('should throw when PHI_ENCRYPTION_KEY is not a valid 64-char hex string', async () => {
    // Non-hex keys should now throw an error (scrypt derivation removed for security)
    process.env.PHI_ENCRYPTION_KEY = 'my-short-passphrase';
    const { encryptField } = await loadModule();
    expect(() => encryptField('test data')).toThrow('PHI_ENCRYPTION_KEY must be a 64-character hex string');
  });

  // ---- Legacy / plaintext passthrough ----

  it('should return plaintext string as-is when decrypting legacy unencrypted data', async () => {
    const { decryptField } = await loadModule();
    // A plain string that is not valid JSON should pass through
    expect(decryptField('plain text value')).toBe('plain text value');
  });

  it('should return plaintext when JSON string lacks ciphertext/iv/tag fields', async () => {
    const { decryptField } = await loadModule();
    const jsonStr = JSON.stringify({ name: 'John', age: 30 });
    expect(decryptField(jsonStr)).toBe(jsonStr);
  });

  it('should return null when decrypting null or undefined', async () => {
    const { decryptField } = await loadModule();
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeNull();
  });

  it('should return null for an EncryptedField object with empty ciphertext', async () => {
    const { decryptField } = await loadModule();
    expect(decryptField({ ciphertext: '', iv: 'aa', tag: 'bb' })).toBeNull();
  });

  // ---- encryptValue / decryptValue ----

  it('should encrypt and decrypt a JSON object via encryptValue/decryptValue', async () => {
    const { encryptValue, decryptValue } = await loadModule();
    const obj = { diagnosis: 'F41.1', notes: 'Generalized anxiety' };
    const encrypted = encryptValue(obj);
    expect(encrypted).not.toBeNull();
    const decrypted = decryptValue(encrypted, true);
    expect(decrypted).toEqual(obj);
  });

  // ---- Record-level encrypt/decrypt ----

  it('should encrypt and decrypt a patient record preserving non-PHI fields', async () => {
    const { encryptPatientRecord, decryptPatientRecord } = await loadModule();
    const patient = {
      id: 1,
      practiceId: 5,
      firstName: 'Jane',
      lastName: 'Smith',
      dateOfBirth: '1990-01-01',
      email: 'jane@example.com',
      phone: '555-1234',
      insuranceProvider: 'Aetna',
      status: 'active', // non-PHI field
    };
    const encrypted = encryptPatientRecord(patient);
    // Non-PHI fields unchanged
    expect(encrypted.id).toBe(1);
    expect(encrypted.practiceId).toBe(5);
    expect(encrypted.status).toBe('active');
    // PHI fields are JSON-stringified encrypted objects for varchar column storage
    expect(typeof encrypted.firstName).toBe('string');
    expect(JSON.parse(encrypted.firstName)).toHaveProperty('ciphertext');
    // dateOfBirth should NOT be encrypted (date type column)
    expect(encrypted.dateOfBirth).toBe('1990-01-01');

    const decrypted = decryptPatientRecord(encrypted);
    expect(decrypted).not.toBeNull();
    expect(decrypted!.firstName).toBe('Jane');
    expect(decrypted!.lastName).toBe('Smith');
    expect(decrypted!.email).toBe('jane@example.com');
    expect(decrypted!.insuranceProvider).toBe('Aetna');
    expect(decrypted!.status).toBe('active');
  });

  it('should return null when decrypting a null patient record', async () => {
    const { decryptPatientRecord } = await loadModule();
    expect(decryptPatientRecord(null)).toBeNull();
    expect(decryptPatientRecord(undefined)).toBeNull();
  });

  it('should encrypt and decrypt a user record (therapist PII)', async () => {
    const { encryptUserRecord, decryptUserRecord } = await loadModule();
    const user = {
      id: 'u1',
      username: 'drsmith',
      licenseNumber: 'LIC-12345',
      npiNumber: '1234567890',
      digitalSignature: 'sig-data',
    };
    const encrypted = encryptUserRecord(user);
    expect(encrypted.username).toBe('drsmith');
    expect(typeof encrypted.licenseNumber).toBe('object');

    const decrypted = decryptUserRecord(encrypted);
    expect(decrypted!.licenseNumber).toBe('LIC-12345');
    expect(decrypted!.npiNumber).toBe('1234567890');
  });

  it('should encrypt and decrypt a practice record', async () => {
    const { encryptPracticeRecord, decryptPracticeRecord } = await loadModule();
    const practice = {
      id: 1,
      name: 'Test Practice',
      taxId: '12-3456789',
      phone: '555-9999',
      stediApiKey: 'sk-abc',
    };
    const encrypted = encryptPracticeRecord(practice);
    expect(encrypted.name).toBe('Test Practice');
    expect(typeof encrypted.taxId).toBe('object');

    const decrypted = decryptPracticeRecord(encrypted);
    expect(decrypted!.taxId).toBe('12-3456789');
    expect(decrypted!.phone).toBe('555-9999');
  });

  it('should encrypt and decrypt telehealth session and settings records', async () => {
    const {
      encryptTelehealthSessionRecord, decryptTelehealthSessionRecord,
      encryptTelehealthSettingsRecord, decryptTelehealthSettingsRecord,
    } = await loadModule();

    const session = { id: 1, recordingUrl: 'https://rec.example.com/1', notes: 'Session went well' };
    const encSession = encryptTelehealthSessionRecord(session);
    expect(typeof encSession.recordingUrl).toBe('object');
    const decSession = decryptTelehealthSessionRecord(encSession);
    expect(decSession!.recordingUrl).toBe('https://rec.example.com/1');

    const settings = { id: 1, providerApiKey: 'key123', providerApiSecret: 'secret456' };
    const encSettings = encryptTelehealthSettingsRecord(settings);
    expect(typeof encSettings.providerApiKey).toBe('object');
    const decSettings = decryptTelehealthSettingsRecord(encSettings);
    expect(decSettings!.providerApiKey).toBe('key123');
    expect(decSettings!.providerApiSecret).toBe('secret456');
  });

  it('should encrypt and decrypt SOAP note records', async () => {
    const { encryptSoapNoteRecord, decryptSoapNoteRecord } = await loadModule();
    const note = {
      id: 10,
      subjective: 'Patient reports anxiety',
      objective: 'Appears tense',
      assessment: 'GAD',
      plan: 'Continue CBT',
    };
    const encrypted = encryptSoapNoteRecord(note);
    expect(encrypted.id).toBe(10);
    expect(typeof encrypted.subjective).toBe('object');

    const decrypted = decryptSoapNoteRecord(encrypted);
    expect(decrypted!.subjective).toBe('Patient reports anxiety');
    expect(decrypted!.plan).toBe('Continue CBT');
  });

  it('should encrypt and decrypt treatment session records with JSONB fields', async () => {
    const { encryptTreatmentSessionRecord, decryptTreatmentSessionRecord } = await loadModule();
    const session = {
      id: 3,
      notes: 'Progress noted',
      aiExtractedData: { cptCodes: ['90837'], duration: 60 },
    };
    const encrypted = encryptTreatmentSessionRecord(session);
    expect(typeof encrypted.notes).toBe('object');
    expect(typeof encrypted.aiExtractedData).toBe('object');
    expect(encrypted.aiExtractedData).toHaveProperty('ciphertext');

    const decrypted = decryptTreatmentSessionRecord(encrypted);
    expect(decrypted!.notes).toBe('Progress noted');
    expect(decrypted!.aiExtractedData).toEqual({ cptCodes: ['90837'], duration: 60 });
  });

  it('should generate a valid 64-char hex encryption key', async () => {
    const { generateEncryptionKey } = await loadModule();
    const key = generateEncryptionKey();
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
  });
});
