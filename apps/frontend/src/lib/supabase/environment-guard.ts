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

/**
 * How much authority the client being created carries.
 *
 * 'service-role' bypasses RLS entirely — a preview holding it could read or
 * write any tenant's production data. That is refused outright.
 *
 * 'anon' is bounded by RLS and the signed-in user's own permissions. It is
 * still wrong for a preview to use production, but refusing it breaks the build:
 * /app/operations-control is prerendered through requireModuleEnabled, which
 * calls createSSRClient, so a throw there fails the whole deployment with an
 * opaque prerender error. That blocks every PR rather than fixing anything, so
 * this path reports loudly and continues.
 */
export type SupabaseAccessLevel = 'service-role' | 'anon';

export interface EnvironmentCheckInput {
  /** Vercel's VERCEL_ENV: 'production' | 'preview' | 'development'. */
  vercelEnv?: string;
  /** The Supabase URL this process is about to connect to. */
  supabaseUrl?: string;
  /** Defaults to DEFAULT_PRODUCTION_PROJECT_REF. */
  productionProjectRef?: string;
}

/** True when this is a preview deployment aimed at the production project. */
export function isProductionFromPreview(input: EnvironmentCheckInput): boolean {
  const { vercelEnv, supabaseUrl } = input;
  const productionRef = input.productionProjectRef ?? DEFAULT_PRODUCTION_PROJECT_REF;

  if (vercelEnv !== 'preview') return false;
  if (!supabaseUrl || !productionRef) return false;

  return supabaseUrl.includes(productionRef);
}

/**
 * Throw when a preview deployment is pointed at the production Supabase project.
 *
 * Only 'preview' is rejected. Production must obviously reach production, and
 * anything off-platform (local, QA, tests) has no VERCEL_ENV at all.
 */
export function assertNotProductionFromPreview(input: EnvironmentCheckInput): void {
  const productionRef = input.productionProjectRef ?? DEFAULT_PRODUCTION_PROJECT_REF;

  if (!isProductionFromPreview(input)) return;

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

/** Emitted once per process so a prerender pass does not produce hundreds of lines. */
let warnedAboutPreview = false;

/** Test seam — reset the once-only warning. */
export function resetPreviewWarning(): void {
  warnedAboutPreview = false;
}

/**
 * Called by the client factories. Refuses service-role access to production
 * from a preview, and reports anon access without blocking the deployment.
 */
export function assertSafeSupabaseTarget(
  access: SupabaseAccessLevel,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const input = {
    vercelEnv: env.VERCEL_ENV,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    productionProjectRef: env.PRODUCTION_SUPABASE_PROJECT_REF,
  };

  if (!isProductionFromPreview(input)) return;

  if (access === 'service-role') {
    assertNotProductionFromPreview(input);
    return;
  }

  if (!warnedAboutPreview) {
    warnedAboutPreview = true;
    const productionRef = input.productionProjectRef ?? DEFAULT_PRODUCTION_PROJECT_REF;
    console.error(
      `[spec-51] WARNING: this PREVIEW deployment is reading the PRODUCTION Supabase ` +
        `project (${productionRef}). Access is bounded by RLS, and the service-role ` +
        `client is refused outright, but preview deployments should not touch ` +
        `production at all. Point the Vercel Preview environment's ` +
        `NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and ` +
        `SUPABASE_SERVICE_KEY at a non-production project.`,
    );
  }
}
