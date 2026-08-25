import { describe, it, expect } from 'vitest';

/**
 * spec-70 phase 3: `/close` is now a deprecated alias for `/seal`, kept for
 * one release so a cached PWA bundle still pointed at the old route keeps
 * working. This asserts the alias, not close's old semantics — those moved
 * to seal/route.test.ts wholesale when `/close` stopped being its own
 * endpoint.
 */
describe('POST /routes/[id]/close — deprecated alias', () => {
  it('re-exports the exact same handler as /seal', async () => {
    const closeModule = await import('@/app/api/dispatch/routes/[id]/close/route');
    const sealModule = await import('@/app/api/dispatch/routes/[id]/seal/route');
    expect(closeModule.POST).toBe(sealModule.POST);
  });
});
