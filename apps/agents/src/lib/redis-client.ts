// src/lib/redis-client.ts — ioredis client with reconnect logic and error logging
import Redis from 'ioredis';
import { log } from './logger';

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 100;

function retryStrategy(times: number): number | null {
  if (times >= MAX_RETRIES) return null;
  // Exponential backoff: 100ms, 200ms, 400ms, ... capped at ~10s
  return Math.min(BASE_DELAY_MS * Math.pow(2, times - 1), 10_000);
}

let _instance: Redis | null = null;

export function createRedisClient(url: string): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    retryStrategy,
  });

  client.on('error', (error: Error) => {
    log('error', 'redis_error', { error: error.message });
  });

  client.on('reconnecting', (attempt: number) => {
    log('warn', 'redis_reconnecting', { attempt });
  });

  return client;
}

export async function initRedis(url: string): Promise<Redis> {
  _instance = createRedisClient(url);
  await _instance.connect();
  return _instance;
}

export async function disconnectRedis(): Promise<void> {
  if (_instance) {
    await _instance.quit();
    _instance = null;
  }
}
