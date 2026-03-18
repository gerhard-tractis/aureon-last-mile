// src/lib/crypto.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('crypto', () => {
  const TEST_KEY = 'a'.repeat(64); // 32 bytes as hex

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    vi.resetModules();
  });

  it('returns plain value as-is if no ENCRYPTED: prefix', async () => {
    const { decryptField } = await import('./crypto');
    expect(decryptField('plain-value')).toBe('plain-value');
    expect(decryptField('')).toBe('');
    expect(decryptField('some:other:value')).toBe('some:other:value');
  });

  it('decrypt round-trip: encrypts and decrypts correctly', async () => {
    const { encryptField, decryptField } = await import('./crypto');
    const plaintext = 'my-secret-api-key-12345';
    const encrypted = encryptField(plaintext);

    expect(encrypted).toMatch(/^ENCRYPTED:/);
    expect(encrypted).not.toContain(plaintext);

    const decrypted = decryptField(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('rejects bad format (wrong number of parts)', async () => {
    const { decryptField } = await import('./crypto');
    expect(() => decryptField('ENCRYPTED:not-valid-data')).toThrow();
    expect(() => decryptField('ENCRYPTED:a:b:c:d')).toThrow();
  });

  it('throws when ENCRYPTION_KEY is missing', async () => {
    delete process.env.ENCRYPTION_KEY;
    const { decryptField } = await import('./crypto');
    expect(() => decryptField('ENCRYPTED:abc:def:ghi')).toThrow('ENCRYPTION_KEY');
  });

  it('throws when ENCRYPTION_KEY is wrong length (not 32 bytes)', async () => {
    process.env.ENCRYPTION_KEY = 'aa'.repeat(16); // 16 bytes, not 32
    const { decryptField } = await import('./crypto');
    expect(() => decryptField('ENCRYPTED:abc:def:ghi')).toThrow('32 bytes');
  });

  it('produces different ciphertext for same plaintext due to random IV', async () => {
    const { encryptField } = await import('./crypto');
    const a = encryptField('same-plaintext');
    const b = encryptField('same-plaintext');
    expect(a).not.toBe(b);
  });
});
