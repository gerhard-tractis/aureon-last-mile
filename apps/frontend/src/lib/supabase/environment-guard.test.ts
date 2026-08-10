import { describe, it, expect } from 'vitest';
import {
  assertNotProductionFromPreview,
  assertSafeSupabaseTarget,
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
  it('reads VERCEL_ENV and the Supabase URL from the environment', () => {
    expect(() =>
      assertSafeSupabaseTarget({ VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: PROD_URL }),
    ).toThrow(ProductionAccessFromPreviewError);
  });

  it('passes for a correctly configured preview', () => {
    expect(() =>
      assertSafeSupabaseTarget({ VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: OTHER_URL }),
    ).not.toThrow();
  });

  it('passes for an empty environment', () => {
    expect(() => assertSafeSupabaseTarget({})).not.toThrow();
  });
});
