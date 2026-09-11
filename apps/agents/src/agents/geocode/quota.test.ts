// src/agents/geocode/quota.test.ts — Redis-backed monthly quota counter,
// spec-58 fase 5. MAPTILER_MONTHLY_QUOTA is optional: unset, the guard is
// inert and the provider itself is the stop condition (2026-09-11 decision).
import { describe, it, expect, vi } from 'vitest';
import { createQuotaGuard } from './quota';

function makeRedis(initial: Record<string, number> = {}) {
  const store = new Map<string, number>(Object.entries(initial));
  return {
    incr: vi.fn(async (key: string) => {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    }),
    decr: vi.fn(async (key: string) => {
      const next = (store.get(key) ?? 0) - 1;
      store.set(key, next);
      return next;
    }),
    expireat: vi.fn(async () => 1),
    _store: store,
  };
}

const NOW = new Date('2026-09-11T12:00:00.000Z');

describe('createQuotaGuard — no MAPTILER_MONTHLY_QUOTA configured', () => {
  it('tryConsume always allows, and never touches redis', async () => {
    const redis = makeRedis();
    const guard = createQuotaGuard(redis as never, undefined, () => NOW);

    expect(await guard.tryConsume()).toBe(true);
    expect(await guard.tryConsume()).toBe(true);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('is inert even with a null redis client', async () => {
    const guard = createQuotaGuard(null, undefined, () => NOW);
    expect(await guard.tryConsume()).toBe(true);
  });
});

describe('createQuotaGuard — MAPTILER_MONTHLY_QUOTA configured', () => {
  it('allows calls under the cap', async () => {
    const redis = makeRedis();
    const guard = createQuotaGuard(redis as never, 2, () => NOW);

    expect(await guard.tryConsume()).toBe(true);
    expect(await guard.tryConsume()).toBe(true);
  });

  it('blocks once the cap is reached, and does not grow the counter past it', async () => {
    const redis = makeRedis();
    const guard = createQuotaGuard(redis as never, 2, () => NOW);

    await guard.tryConsume();
    await guard.tryConsume();
    expect(await guard.tryConsume()).toBe(false);
    expect(redis._store.get('geocode:quota:2026-09')).toBe(2);
  });

  it('keys the counter by year-month', async () => {
    const redis = makeRedis();
    const guard = createQuotaGuard(redis as never, 10, () => NOW);
    await guard.tryConsume();
    expect(redis.incr).toHaveBeenCalledWith('geocode:quota:2026-09');
  });

  it('sets an expiry past month end on the first increment only', async () => {
    const redis = makeRedis();
    const guard = createQuotaGuard(redis as never, 10, () => NOW);
    await guard.tryConsume();
    await guard.tryConsume();
    expect(redis.expireat).toHaveBeenCalledTimes(1);
  });
});
