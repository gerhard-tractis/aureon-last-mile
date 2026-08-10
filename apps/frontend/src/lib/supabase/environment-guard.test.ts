import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  assertNotProductionFromPreview,
  assertSafeSupabaseTarget,
  resetPreviewWarning,
  ProductionAccessFromPreviewError,
  DEFAULT_PRODUCTION_PROJECT_REF,
} from './environment-guard';

const PROD_URL = `https://${DEFAULT_PRODUCTION_PROJECT_REF}.supabase.co`;
const OTHER_URL = 'https://someotherproject.supabase.co';

describe('assertNotProductionFromPreview', () => {
  // The case this exists for.
  it('refuses a preview deployment pointed at production', () => {
    expect(() =>
      assertNotProductionFromPreview({ vercelEnv: 'preview', supabaseUrl: PROD_URL }),
    ).toThrow(ProductionAccessFromPreviewError);
  });

  it('explains the fix, not just the failure', () => {
    try {
      assertNotProductionFromPreview({ vercelEnv: 'preview', supabaseUrl: PROD_URL });
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('PREVIEW');
      expect(message).toContain(DEFAULT_PRODUCTION_PROJECT_REF);
      expect(message).toContain('service-role');
      expect(message).toContain('Vercel dashboard');
    }
  });

  // Production must reach production — the guard must not break the real site.
  it('allows production to reach production', () => {
    expect(() =>
      assertNotProductionFromPreview({ vercelEnv: 'production', supabaseUrl: PROD_URL }),
    ).not.toThrow();
  });

  it('allows a preview pointed at a non-production project', () => {
    expect(() =>
      assertNotProductionFromPreview({ vercelEnv: 'preview', supabaseUrl: OTHER_URL }),
    ).not.toThrow();
  });

  it('allows a preview pointed at a local stack', () => {
    expect(() =>
      assertNotProductionFromPreview({ vercelEnv: 'preview', supabaseUrl: 'http://localhost:8100' }),
    ).not.toThrow();
  });

  // Off-platform: local dev, QA on the VPS, CI. No VERCEL_ENV at all.
  it('is inert when VERCEL_ENV is undefined', () => {
    expect(() => assertNotProductionFromPreview({ supabaseUrl: PROD_URL })).not.toThrow();
  });

  it('is inert for vercel development builds', () => {
    expect(() =>
      assertNotProductionFromPreview({ vercelEnv: 'development', supabaseUrl: PROD_URL }),
    ).not.toThrow();
  });

  it('does not throw when the URL is missing', () => {
    expect(() => assertNotProductionFromPreview({ vercelEnv: 'preview' })).not.toThrow();
  });

  it('honours an overridden production project ref', () => {
    expect(() =>
      assertNotProductionFromPreview({
        vercelEnv: 'preview',
        supabaseUrl: OTHER_URL,
        productionProjectRef: 'someotherproject',
      }),
    ).toThrow(ProductionAccessFromPreviewError);
  });

  it('matches the ref anywhere in the URL, including a pooler host', () => {
    expect(() =>
      assertNotProductionFromPreview({
        vercelEnv: 'preview',
        supabaseUrl: `postgresql://postgres.${DEFAULT_PRODUCTION_PROJECT_REF}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
      }),
    ).toThrow(ProductionAccessFromPreviewError);
  });
});

describe('assertSafeSupabaseTarget', () => {
  beforeEach(() => {
    resetPreviewWarning();
    vi.restoreAllMocks();
  });

  const previewOnProd = { VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: PROD_URL };

  // service-role bypasses RLS — a preview holding it could read or write any
  // tenant's production data. Never allowed.
  it('refuses service-role access to production from a preview', () => {
    expect(() => assertSafeSupabaseTarget('service-role', previewOnProd)).toThrow(
      ProductionAccessFromPreviewError,
    );
  });

  // anon is bounded by RLS. Throwing here would fail the build during prerender
  // of /app/operations-control and block every PR, which fixes nothing.
  it('reports but does not throw for anon access', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => assertSafeSupabaseTarget('anon', previewOnProd)).not.toThrow();
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain('PREVIEW');
  });

  it('warns only once per process', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    assertSafeSupabaseTarget('anon', previewOnProd);
    assertSafeSupabaseTarget('anon', previewOnProd);
    assertSafeSupabaseTarget('anon', previewOnProd);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('stays silent for a correctly configured preview', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      assertSafeSupabaseTarget('anon', {
        VERCEL_ENV: 'preview',
        NEXT_PUBLIC_SUPABASE_URL: OTHER_URL,
      }),
    ).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it('allows service-role in production', () => {
    expect(() =>
      assertSafeSupabaseTarget('service-role', {
        VERCEL_ENV: 'production',
        NEXT_PUBLIC_SUPABASE_URL: PROD_URL,
      }),
    ).not.toThrow();
  });

  it('passes for an empty environment', () => {
    expect(() => assertSafeSupabaseTarget('service-role', {})).not.toThrow();
    expect(() => assertSafeSupabaseTarget('anon', {})).not.toThrow();
  });
});
