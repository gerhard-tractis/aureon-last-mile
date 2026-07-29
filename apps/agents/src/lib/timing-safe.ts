// src/lib/timing-safe.ts — constant-time secret comparison
import crypto from 'crypto';

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * A plain `a !== b` short-circuits at the first differing byte, so response
 * time correlates with how many leading characters an attacker guessed right.
 * Lives in its own module so the auth paths (health, bull-board, dev router)
 * can share it without importing each other's heavier dependencies.
 *
 * Length is not secret here — a mismatch returns early — but the byte-by-byte
 * comparison of equal-length inputs is constant time.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}
