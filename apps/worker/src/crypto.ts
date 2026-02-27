// src/crypto.ts — AES-256-GCM credential encryption/decryption
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const PREFIX = 'ENCRYPTED:';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error('ENCRYPTION_KEY env var is not set');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must be 32 bytes (64 hex chars), got ${key.length} bytes`);
  }
  return key;
}

export function encryptField(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: ENCRYPTED:<iv_hex>:<tag_hex>:<ciphertext_hex>
  return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptField(value: string): string {
  if (!value.startsWith(PREFIX)) return value;

  const key = getKey();
  const payload = value.slice(PREFIX.length);
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted field format');

  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const ciphertext = Buffer.from(parts[2], 'hex');

  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error('Invalid IV or auth tag length');
  }

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}
