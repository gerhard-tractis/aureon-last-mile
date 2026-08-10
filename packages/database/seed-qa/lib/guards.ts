/**
 * spec-51 — QA seed guardrails.
 *
 * This script connects with superuser/service-role privileges and writes
 * business data. Pointed at the wrong database it would corrupt production, so
 * every check below is a hard refusal, never a warning.
 *
 * Mirrors infra/supabase-qa/apply-migrations.sh, which refuses any target other
 * than localhost:5433. Kept as pure functions so they are unit-testable without
 * a database.
 */

/** The QA Postgres published by infra/supabase-qa/docker-compose.yml. */
export const QA_HOST_ALLOWLIST = ['localhost', '127.0.0.1'] as const;
export const QA_PORT = 5433;

/**
 * The production operator. If this row exists we are connected to production,
 * whatever the host says — a tunnel or a proxy could make prod look local.
 * Hardcoded in beetrack-webhook/index.ts and the Easy WMS n8n workflow.
 */
export const PROD_OPERATOR_ID = '92dc5797-047d-458d-bbdb-63f18c0dd1e7';

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardError';
  }
}

export interface TargetConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
}

/** True if the value mentions Supabase's managed cloud in any form. */
export function mentionsSupabaseCloud(value: string | undefined | null): boolean {
  if (!value) return false;
  return /supabase\.(co|com|in)\b/i.test(value);
}

/**
 * Refuse anything that is not the local QA Postgres.
 *
 * Host and port are checked separately so the error says which one is wrong —
 * pointing at :5432 (production Postgres on the same VPS) is the likeliest
 * mistake and deserves a specific message.
 */
export function assertLocalQaTarget(config: TargetConfig): void {
  const host = config.host.trim().toLowerCase();

  if (!(QA_HOST_ALLOWLIST as readonly string[]).includes(host)) {
    throw new GuardError(
      `Refusing to seed: host must be one of ${QA_HOST_ALLOWLIST.join(', ')}, got "${config.host}". ` +
        `The QA seed only ever runs against the local QA stack on the VPS.`,
    );
  }

  if (config.port !== QA_PORT) {
    const hint =
      config.port === 5432
        ? ' Port 5432 is the PRODUCTION Postgres on the VPS — QA is 5433.'
        : '';
    throw new GuardError(
      `Refusing to seed: port must be ${QA_PORT}, got ${config.port}.${hint}`,
    );
  }

  for (const [label, value] of Object.entries(config)) {
    if (typeof value === 'string' && mentionsSupabaseCloud(value)) {
      throw new GuardError(
        `Refusing to seed: connection field "${label}" mentions the Supabase cloud. ` +
          `QA must never contact the production project.`,
      );
    }
  }
}

/** Refuse if any environment variable points at the Supabase cloud. */
export function assertNoCloudEnv(env: NodeJS.ProcessEnv): void {
  const offenders = Object.entries(env)
    .filter(([, value]) => mentionsSupabaseCloud(value))
    .map(([key]) => key);

  if (offenders.length > 0) {
    throw new GuardError(
      `Refusing to seed: these environment variables mention the Supabase cloud: ${offenders.join(', ')}. ` +
        `Run this with the QA environment only (/home/aureon/.env.qa).`,
    );
  }
}

/**
 * Final check, run against the connected database rather than the config.
 * `operatorIds` is the result of selecting ids from public.operators.
 */
export function assertNotProductionData(operatorIds: string[]): void {
  if (operatorIds.includes(PROD_OPERATOR_ID)) {
    throw new GuardError(
      `Refusing to seed: the production operator ${PROD_OPERATOR_ID} exists in this database. ` +
        `This is production data — aborting before any write.`,
    );
  }
}
