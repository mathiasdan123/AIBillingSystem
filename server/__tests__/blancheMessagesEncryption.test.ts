import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Round-trip test for Blanche chat history encryption. The `messages` JSONB
 * blob is encrypted as a single AES-256-GCM payload; we want to verify that
 * an arbitrary message array survives the encrypt → JSON.stringify (jsonb
 * coercion) → JSON.parse → decrypt round trip and comes back identical.
 */

beforeAll(() => {
  // The encryption module needs a key. Use a deterministic test key.
  if (!process.env.PHI_ENCRYPTION_KEY) {
    process.env.PHI_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  }
});

import {
  encryptBlancheMessages,
  decryptBlancheMessages,
} from '../services/phiEncryptionService';

describe('encryptBlancheMessages / decryptBlancheMessages round trip', () => {
  it('returns [] for null/undefined/empty', () => {
    expect(decryptBlancheMessages(null)).toEqual([]);
    expect(decryptBlancheMessages(undefined)).toEqual([]);
  });

  it('round-trips a simple conversation', () => {
    const messages = [
      { role: 'user', content: 'how do I add a patient?' },
      { role: 'assistant', content: 'Click + New Patient on the Patients page.' },
    ];
    const encrypted = encryptBlancheMessages(messages);
    expect(encrypted).not.toEqual(messages); // not plaintext
    expect(decryptBlancheMessages(encrypted)).toEqual(messages);
  });

  it('round-trips after JSONB coercion (stringify → parse, as Postgres does)', () => {
    const messages = [
      { role: 'user', content: 'PHI: Jane Doe, DOB 1985-04-12, denied claim #4711' },
      { role: 'assistant', content: 'I can appeal that claim.', proposals: [{ id: 'p1' }] },
      { role: 'user', content: 'yes', hidden: true },
    ];
    const encrypted = encryptBlancheMessages(messages);
    const afterJsonb = JSON.parse(JSON.stringify(encrypted));
    const decrypted = decryptBlancheMessages(afterJsonb);
    expect(decrypted).toEqual(messages);
  });

  it('returns [] (not the plaintext) if a raw array somehow appears on disk', () => {
    // Defense in depth: we never want to silently serve unencrypted PHI.
    const plaintext = [{ role: 'user', content: 'sensitive thing' }];
    expect(decryptBlancheMessages(plaintext)).toEqual([]);
  });

  it('returns [] if the encrypted payload is malformed', () => {
    expect(decryptBlancheMessages({ ciphertext: 'garbage', iv: 'xx', tag: 'yy' })).toEqual([]);
  });

  it('handles a large conversation (200 messages)', () => {
    const messages = Array.from({ length: 200 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message ${i} — some PHI-ish content`,
    }));
    const encrypted = encryptBlancheMessages(messages);
    const decrypted = decryptBlancheMessages(JSON.parse(JSON.stringify(encrypted)));
    expect(decrypted).toEqual(messages);
  });
});
