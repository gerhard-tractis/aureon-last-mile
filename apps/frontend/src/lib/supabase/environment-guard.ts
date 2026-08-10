/**
 * spec-51 — refuse to talk to production from a preview deployment.
 *
 * Vercel generates a preview deployment per PR, and its Supabase variables are
 * configured per environment in the Vercel dashboard — outside this repo, where
 * nobody reviews them. If the Preview environment points at the production
 * project, every PR preview reads and writes production data, and
 * createServerAdminClient() does so with the service-role key.
 *
 * Auditing the dashboard is a point-in-time check. This is permanent: the code
 * refuses the combination, so the misconfiguration cannot go unnoticed.
 *
 * Production is deliberately unaffected — VERCEL_ENV is 'production' there.
 * Local and QA are unaffected too: they run against localhost, and VERCEL_ENV
 * is undefined off-platform.
 */

/**
 * The production Supabase project (apps/frontend/docs/deployment-runbook.md).
 * A project ref is not a secret — it is in the runbook and in PR check names.
 * Override with PRODUCTION_SUPABASE_PROJECT_REF if the project ever changes.
 */
export const DEFAULT_PRODUCTION_PROJECT_REF = 'wfwlcpnkkxxzdvhvvsxb';

export class ProductionAccessFromPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionAccessFromPreviewError';
  }
}

export interface EnvironmentCheckInput {
  /** Vercel's VERCEL_ENV: 'production' | 'preview' | 'development'. */
  vercelEnv?: string;
  /** The Supabase URL this process is about to connect to. */
  supabaseUrl?: string;
  /** Defaults to DEFAULT_PRODUCTION_PROJECT_REF. */
  productionProjectRef?: string;
}

/**
 * Throw when a preview deployment is pointed at the production Supabase project.
 *
 * Only 'preview' is rejected. Production must obviously reach production, and
 * anything off-platform (local, QA, tests) has no VERCEL_ENV at all.
 */
export function assertNotProductionFromPreview(input: EnvironmentCheckInput): void {
  const { vercelEnv, supabaseUrl } = input;
  const productionRef = input.productionProjectRef ?? DEFAULT_PRODUCTION_PROJECT_REF;

  if (vercelEnv !== 'preview') return;
  if (!supabaseUrl || !productionRef) return;

  if (!supabaseUrl.includes(productionRef)) return;

  throw new ProductionAccessFromPreviewError(
    `This is a Vercel PREVIEW deployment but NEXT_PUBLIC_SUPABASE_URL points at the ` +
      `production Supabase project (${productionRef}). Preview deployments must never ` +
      `read or write production data — createServerAdminClient() would do so with the ` +
      `service-role key.\n\n` +
      `Fix: in the Vercel dashboard, set NEXT_PUBLIC_SUPABASE_URL, ` +
      `NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY for the Preview ` +
      `environment to a non-production project. See docs/qa-environment.md for how ` +
      `QA is kept isolated.`,
  );
}

/** Convenience wrapper reading from process.env. Called by the client factories. */
export function assertSafeSupabaseTarget(env: NodeJS.ProcessEnv = process.env): void {
  assertNotProductionFromPreview({
    vercelEnv: env.VERCEL_ENV,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    productionProjectRef: env.PRODUCTION_SUPABASE_PROJECT_REF,
  });
}
