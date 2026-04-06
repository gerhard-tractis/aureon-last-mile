// src/config.ts — Env var validation using Zod. Exports typed Config singleton.
import { z } from 'zod';

const configSchema = z.object({
  // Required vars
  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  REDIS_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  SENTRY_DSN: z.string().min(1),

  // Optional vars
  OCR_API_SECRET: z.string().min(1).optional(),
  BETTERSTACK_HEARTBEAT_URL: z.string().optional(),
  WA_PHONE_NUMBER_ID: z.string().optional(),
  WA_ACCESS_TOKEN: z.string().optional(),
  WA_VERIFY_TOKEN: z.string().optional(),
  WA_APP_SECRET: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => issue.path.join('.'))
      .join(', ');
    throw new Error(`Missing required environment variables: ${missing}`);
  }
  return result.data;
}

// Singleton — populated once at startup when this module is first imported
// with the full environment present. Tests use loadConfig() directly.
let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

// Export as `config` alias for convenience; callers import { config } and
// rely on the module being initialised with env vars already set.
export const config: Config = (() => {
  try {
    return loadConfig();
  } catch {
    // During test runs modules are reset and env may not be set.
    // Tests call loadConfig() directly; don't crash at import time.
    return null as unknown as Config;
  }
})();
