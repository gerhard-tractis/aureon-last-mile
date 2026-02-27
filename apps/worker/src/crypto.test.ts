import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('crypto', () => {
  const TEST_KEY = 'a'.repeat(64); // 32 bytes hex

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    vi.resetModules();
  });

  it('round-trips encrypt and decrypt', async () => {
    const { encryptField, decryptField } = await import('./crypto');
    const plaintext = 'my-secret-password';
    const encrypted = encryptField(plaintext);

    expect(encrypted).toMatch(/^ENCRYPTED:/);
    expect(encrypted).not.toContain(plaintext);

    const decrypted = decryptField(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('returns plain value if no ENCRYPTED: prefix', async () => {
    const { decryptField } = await import('./crypto');
    expect(decryptField('plain-value')).toBe('plain-value');
  });

  it('throws on invalid encrypted data', async () => {
    const { decryptField } = await import('./crypto');
    expect(() => decryptField('ENCRYPTED:not-valid-data')).toThrow();
  });

  it('throws when ENCRYPTION_KEY is missing', async () => {
    delete process.env.ENCRYPTION_KEY;
    const { decryptField } = await import('./crypto');
    expect(() => decryptField('ENCRYPTED:abc')).toThrow('ENCRYPTION_KEY');
  });

  it('throws when ENCRYPTION_KEY is wrong length', async () => {
    process.env.ENCRYPTION_KEY = 'aa'.repeat(16); // 16 bytes, not 32
    const { decryptField } = await import('./crypto');
    expect(() => decryptField('ENCRYPTED:abc')).toThrow('32 bytes');
  });

  it('produces different ciphertext for same plaintext (random IV)', async () => {
    const { encryptField } = await import('./crypto');
    const a = encryptField('same-text');
    const b = encryptField('same-text');
    expect(a).not.toBe(b);
  });
});
