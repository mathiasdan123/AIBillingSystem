import crypto from 'crypto';
import type { PayerCredential, InsertPayerCredential } from '@shared/schema';
import { storage } from '../storage';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

// Credential types that can be stored
export interface OAuthCredentials {
  type: 'oauth_client';
  clientId: string;
  clientSecret: string;
  tokenEndpoint?: string;
  scopes?: string[];
}

export interface ApiKeyCredentials {
  type: 'api_key';
  apiKey: string;
  apiKeyHeader?: string; // e.g., 'X-API-Key', 'Authorization'
}

export interface UsernamePasswordCredentials {
  type: 'username_password';
  username: string;
  password: string;
}

export interface CertificateCredentials {
  type: 'certificate';
  certificate: string; // PEM-encoded
  privateKey: string; // PEM-encoded
  passphrase?: string;
}

export type PayerCredentialData =
  | OAuthCredentials
  | ApiKeyCredentials
  | UsernamePasswordCredentials
  | CertificateCredentials;

export class PayerCredentialManager {
  private encryptionKey: Buffer;

  constructor() {
    const keyHex = process.env.PAYER_CREDENTIAL_ENCRYPTION_KEY;

    if (!keyHex) {
      console.warn(
        'PAYER_CREDENTIAL_ENCRYPTION_KEY not set. Using development key. DO NOT USE IN PRODUCTION!'
      );
      // Development-only fallback key (64 hex chars = 32 bytes)
      this.encryptionKey = Buffer.from(
        'a'.repeat(64),
        'hex'
      );
    } else if (keyHex.length !== 64) {
      throw new Error(
        'PAYER_CREDENTIAL_ENCRYPTION_KEY must be a 64-character hex string (256 bits)'
      );
    } else {
      this.encryptionKey = Buffer.from(keyHex, 'hex');
    }
  }

  /**
   * Encrypt credential data using AES-256-GCM
   */
  encrypt(data: PayerCredentialData): {
    encryptedCredentials: string;
    credentialsIv: string;
    credentialsTag: string;
  } {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);

    const plaintext = JSON.stringify(data);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return {
      encryptedCredentials: encrypted.toString('base64'),
      credentialsIv: iv.toString('hex'),
      credentialsTag: authTag.toString('hex'),
    };
  }

  /**
   * Decrypt credential data
   */
  decrypt(credential: Pick<PayerCredential, 'encryptedCredentials' | 'credentialsIv' | 'credentialsTag'>): PayerCredentialData {
    const iv = Buffer.from(credential.credentialsIv, 'hex');
    const authTag = Buffer.from(credential.credentialsTag, 'hex');
    const encrypted = Buffer.from(credential.encryptedCredentials, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString('utf8'));
  }

  /**
   * Store encrypted credentials for a practice-payer combination
   */
  async storeCredentials(
    practiceId: number,
    payerIntegrationId: number,
    credentials: PayerCredentialData,
    expiresAt?: Date
  ): Promise<PayerCredential> {
    const { encryptedCredentials, credentialsIv, credentialsTag } = this.encrypt(credentials);

    // Check if credentials already exist
    const existing = await storage.getPayerCredentialForPractice(practiceId, payerIntegrationId);

    if (existing) {
      // Update existing credentials
      return await storage.updatePayerCredential(existing.id, {
        encryptedCredentials,
        credentialsIv,
        credentialsTag,
        credentialType: credentials.type,
        lastRotated: new Date(),
        expiresAt: expiresAt || null,
        isActive: true,
        errorCount: 0,
        lastError: null,
      });
    }

    // Create new credentials
    const credentialData: InsertPayerCredential = {
      practiceId,
      payerIntegrationId,
      encryptedCredentials,
      credentialsIv,
      credentialsTag,
      credentialType: credentials.type,
      expiresAt: expiresAt || null,
    };

    return await storage.createPayerCredential(credentialData);
  }

  /**
   * Retrieve and decrypt credentials for a practice-payer combination
   */
  async getCredentials(
    practiceId: number,
    payerIntegrationId: number
  ): Promise<{ credential: PayerCredential; data: PayerCredentialData } | null> {
    const credential = await storage.getPayerCredentialForPractice(practiceId, payerIntegrationId);

    if (!credential) {
      return null;
    }

    // Check if credentials have expired
    if (credential.expiresAt && new Date(credential.expiresAt) < new Date()) {
      await storage.updatePayerCredential(credential.id, { isActive: false });
      return null;
    }

    try {
      const data = this.decrypt(credential);
      return { credential, data };
    } catch (error) {
      console.error('Failed to decrypt credentials:', error);
      await storage.updatePayerCredential(credential.id, {
        lastError: 'Decryption failed',
        errorCount: (credential.errorCount || 0) + 1,
      });
      return null;
    }
  }

  /**
   * Record successful credential usage
   */
  async recordUsage(credentialId: number): Promise<void> {
    await storage.updatePayerCredential(credentialId, {
      lastUsed: new Date(),
      errorCount: 0,
      lastError: null,
    });
  }

  /**
   * Record credential error
   */
  async recordError(credentialId: number, error: string): Promise<void> {
    const credential = await storage.getPayerCredentials(0).then((creds) =>
      creds.find((c) => c.id === credentialId)
    );

    const errorCount = (credential?.errorCount || 0) + 1;

    await storage.updatePayerCredential(credentialId, {
      lastError: error,
      errorCount,
      // Deactivate after 5 consecutive errors
      isActive: errorCount < 5,
    });
  }

  /**
   * Rotate credentials (store new ones, mark old as inactive)
   */
  async rotateCredentials(
    practiceId: number,
    payerIntegrationId: number,
    newCredentials: PayerCredentialData,
    expiresAt?: Date
  ): Promise<PayerCredential> {
    // Simply store the new credentials - the storeCredentials method handles updating existing
    return await this.storeCredentials(practiceId, payerIntegrationId, newCredentials, expiresAt);
  }

  /**
   * Generate a secure encryption key (for initial setup)
   */
  static generateEncryptionKey(): string {
    return crypto.randomBytes(KEY_LENGTH).toString('hex');
  }
}

// Singleton instance
export const credentialManager = new PayerCredentialManager();
