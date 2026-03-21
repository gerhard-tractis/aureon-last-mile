// src/agents/intake/intake-fallback.test.ts
import { describe, it, expect, vi } from 'vitest';
import { intakeFallback } from './intake-fallback';

function makeDb(error: unknown = null) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockResolvedValue({ error }),
  };
  return { from: vi.fn().mockReturnValue(chain) };
}

describe('intakeFallback', () => {
  it('marks submission as failed when LLM is unavailable', async () => {
    const db = makeDb();
    await intakeFallback(db as never, 'sub-1', 'op-1', new Error('LLM timeout'));
    expect(db.from).toHaveBeenCalledWith('intake_submissions');
  });

  it('sets status to failed in the update payload', async () => {
    const db = makeDb();
    await intakeFallback(db as never, 'sub-1', 'op-1', new Error('rate limit'));
    const updateCall = db.from('intake_submissions').update;
    const payload = updateCall.mock.calls[0][0];
    expect(payload.status).toBe('failed');
  });

  it('includes error message in validation_errors', async () => {
    const db = makeDb();
    const err = new Error('groq unavailable');
    await intakeFallback(db as never, 'sub-1', 'op-1', err);
    const updateCall = db.from('intake_submissions').update;
    const payload = updateCall.mock.calls[0][0];
    expect(JSON.stringify(payload.validation_errors)).toContain('groq unavailable');
  });

  it('does not throw even when DB update fails (fire-and-forget)', async () => {
    const db = makeDb({ message: 'write failed' });
    await expect(
      intakeFallback(db as never, 'sub-1', 'op-1', new Error('LLM down')),
    ).resolves.not.toThrow();
  });
});
