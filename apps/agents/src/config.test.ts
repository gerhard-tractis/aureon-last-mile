// src/config.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'REDIS_URL',
  'OPENROUTER_API_KEY',
  'ENCRYPTION_KEY',
  'SENTRY_DSN',
];

const OPTIONAL_VARS = [
  'ANTHROPIC_API_KEY',
  'GROQ_API_KEY',
  'BETTERSTACK_HEARTBEAT_URL',
  'WA_PHONE_NUMBER_ID',
  'WA_ACCESS_TOKEN',
  'WA_VERIFY_TOKEN',
  'WA_APP_SECRET',
];

const FULL_ENV: Record<string, string> = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  REDIS_URL: 'redis://localhost:6379',
  OPENROUTER_API_KEY: 'test-openrouter-key',
  ENCRYPTION_KEY: 'a'.repeat(64),
  SENTRY_DSN: 'https://sentry.io/test',
};

describe('loadConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear all relevant vars
    for (const k of [...REQUIRED_VARS, ...OPTIONAL_VARS]) {
      delete process.env[k];
    }
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original env
    for (const k of [...REQUIRED_VARS, ...OPTIONAL_VARS]) {
      delete process.env[k];
    }
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  it('returns a valid Config when all required vars are set', async () => {
    Object.assign(process.env, FULL_ENV);
    const { loadConfig } = await import('./config');
    const config = loadConfig();
    expect(config.SUPABASE_URL).toBe(FULL_ENV.SUPABASE_URL);
    expect(config.REDIS_URL).toBe(FULL_ENV.REDIS_URL);
    expect(config.OPENROUTER_API_KEY).toBe(FULL_ENV.OPENROUTER_API_KEY);
    expect(config.ENCRYPTION_KEY).toBe(FULL_ENV.ENCRYPTION_KEY);
  });

  it.each(REQUIRED_VARS)('throws with var name in message when %s is missing', async (varName) => {
    const envWithout = { ...FULL_ENV };
    delete (envWithout as Record<string, string>)[varName];
    Object.assign(process.env, envWithout);
    delete process.env[varName];

    const { loadConfig } = await import('./config');
    expect(() => loadConfig()).toThrow(varName);
  });

  it('optional vars are undefined when not set', async () => {
    Object.assign(process.env, FULL_ENV);
    const { loadConfig } = await import('./config');
    const config = loadConfig();
    for (const k of OPTIONAL_VARS) {
      expect((config as Record<string, unknown>)[k]).toBeUndefined();
    }
  });

  it('optional vars are populated when set', async () => {
    Object.assign(process.env, FULL_ENV);
    process.env.BETTERSTACK_HEARTBEAT_URL = 'https://betterstack.example.com';
    process.env.WA_PHONE_NUMBER_ID = '1234567890';
    process.env.WA_ACCESS_TOKEN = 'wa-token';
    process.env.WA_VERIFY_TOKEN = 'wa-verify';
    process.env.WA_APP_SECRET = 'wa-secret';

    const { loadConfig } = await import('./config');
    const config = loadConfig();
    expect(config.BETTERSTACK_HEARTBEAT_URL).toBe('https://betterstack.example.com');
    expect(config.WA_PHONE_NUMBER_ID).toBe('1234567890');
    expect(config.WA_ACCESS_TOKEN).toBe('wa-token');
    expect(config.WA_VERIFY_TOKEN).toBe('wa-verify');
    expect(config.WA_APP_SECRET).toBe('wa-secret');
  });

  it('error message is descriptive (includes "missing" or "required" context)', async () => {
    // Only set some vars, omit OPENROUTER_API_KEY
    const partial = { ...FULL_ENV };
    delete (partial as Record<string, string>).OPENROUTER_API_KEY;
    Object.assign(process.env, partial);

    const { loadConfig } = await import('./config');
    let err: Error | null = null;
    try {
      loadConfig();
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err!.message).toContain('OPENROUTER_API_KEY');
  });
});
