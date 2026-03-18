// src/lib/redis-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock state — must be declared before vi.mock() factory runs
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockOn = vi.fn();
const constructorCalls: Array<{ url: string; opts: Record<string, unknown> }> = [];

vi.mock('ioredis', () => {
  function MockRedis(this: Record<string, unknown>, url: string, opts: Record<string, unknown>) {
    constructorCalls.push({ url, opts });
    this.connect = mockConnect;
    this.on = mockOn;
  }
  return { default: MockRedis };
});

describe('redis-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructorCalls.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createRedisClient', () => {
    it('creates ioredis instance with lazyConnect: true', async () => {
      const { createRedisClient } = await import('./redis-client');
      createRedisClient('redis://localhost:6379');

      expect(constructorCalls).toHaveLength(1);
      expect(constructorCalls[0].url).toBe('redis://localhost:6379');
      expect(constructorCalls[0].opts.lazyConnect).toBe(true);
    });

    it('creates ioredis instance with maxRetriesPerRequest: null', async () => {
      const { createRedisClient } = await import('./redis-client');
      createRedisClient('redis://localhost:6379');

      expect(constructorCalls[0].opts.maxRetriesPerRequest).toBeNull();
    });

    it('retryStrategy returns increasing delays up to 10 retries', async () => {
      const { createRedisClient } = await import('./redis-client');
      createRedisClient('redis://localhost:6379');

      const retryStrategy = constructorCalls[0].opts.retryStrategy as (t: number) => number | null;
      expect(typeof retryStrategy).toBe('function');

      const delay1 = retryStrategy(1);
      const delay2 = retryStrategy(2);
      const delay5 = retryStrategy(5);
      expect(delay1).toBeGreaterThan(0);
      expect(delay2).toBeGreaterThan(delay1!);
      expect(delay5).toBeGreaterThan(delay2!);
    });

    it('retryStrategy returns null after 10 retries', async () => {
      const { createRedisClient } = await import('./redis-client');
      createRedisClient('redis://localhost:6379');

      const retryStrategy = constructorCalls[0].opts.retryStrategy as (t: number) => number | null;
      expect(retryStrategy(10)).toBeNull();
      expect(retryStrategy(11)).toBeNull();
      expect(retryStrategy(100)).toBeNull();
    });

    it('registers error event handler on the client', async () => {
      const { createRedisClient } = await import('./redis-client');
      createRedisClient('redis://localhost:6379');

      const calls = mockOn.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContain('error');
    });

    it('registers reconnecting event handler on the client', async () => {
      const { createRedisClient } = await import('./redis-client');
      createRedisClient('redis://localhost:6379');

      const calls = mockOn.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContain('reconnecting');
    });
  });

  describe('initRedis', () => {
    it('creates client and calls connect()', async () => {
      const { initRedis } = await import('./redis-client');
      await initRedis('redis://localhost:6379');

      expect(constructorCalls).toHaveLength(1);
      expect(mockConnect).toHaveBeenCalledOnce();
    });

    it('returns the redis client instance', async () => {
      const { initRedis } = await import('./redis-client');
      const result = await initRedis('redis://localhost:6379');

      expect(result).toBeDefined();
      expect(typeof result.connect).toBe('function');
    });
  });
});
