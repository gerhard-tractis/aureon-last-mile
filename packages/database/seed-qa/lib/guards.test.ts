import { describe, it, expect } from 'vitest';
import {
  assertLocalQaTarget,
  assertNoCloudEnv,
  assertNotProductionData,
  mentionsSupabaseCloud,
  GuardError,
  PROD_OPERATOR_ID,
  type TargetConfig,
} from './guards';

const validTarget: TargetConfig = {
  host: 'localhost',
  port: 5433,
  database: 'postgres',
  user: 'postgres',
  password: 'qa-local-password',
};

describe('assertLocalQaTarget', () => {
  it('accepts the QA target', () => {
    expect(() => assertLocalQaTarget(validTarget)).not.toThrow();
  });

  it('accepts 127.0.0.1 as well as localhost', () => {
    expect(() => assertLocalQaTarget({ ...validTarget, host: '127.0.0.1' })).not.toThrow();
  });

  it('is case- and whitespace-insensitive about the host', () => {
    expect(() => assertLocalQaTarget({ ...validTarget, host: '  LocalHost ' })).not.toThrow();
  });

  it('refuses a remote host', () => {
    expect(() => assertLocalQaTarget({ ...validTarget, host: 'db.example.com' }))
      .toThrow(GuardError);
  });

  // The likeliest real mistake: prod Postgres sits on 5432 on the same VPS.
  it('refuses port 5432 and says why', () => {
    expect(() => assertLocalQaTarget({ ...validTarget, port: 5432 }))
      .toThrow(/PRODUCTION Postgres/);
  });

  it('refuses any other port', () => {
    expect(() => assertLocalQaTarget({ ...validTarget, port: 6543 })).toThrow(GuardError);
  });

  it('refuses a supabase.co host even on the right port', () => {
    expect(() => assertLocalQaTarget({ ...validTarget, host: 'db.wfwlcpnkkxxzdvhvvsxb.supabase.co' }))
      .toThrow(GuardError);
  });

  it('refuses when a non-host field smuggles in a cloud reference', () => {
    expect(() =>
      assertLocalQaTarget({ ...validTarget, database: 'proxy-to-wfwlcpnkkxxzdvhvvsxb.supabase.co' }),
    ).toThrow(/mentions the Supabase cloud/);
  });
});

describe('mentionsSupabaseCloud', () => {
  it.each([
    'https://wfwlcpnkkxxzdvhvvsxb.supabase.co',
    'postgresql://x@db.abc.supabase.co:5432/postgres',
    'SUPABASE.CO',
    'api.supabase.com',
  ])('detects %s', (value) => {
    expect(mentionsSupabaseCloud(value)).toBe(true);
  });

  it.each(['http://localhost:8100', 'redis://localhost:6379/1', '', undefined, null])(
    'does not flag %s',
    (value) => {
      expect(mentionsSupabaseCloud(value)).toBe(false);
    },
  );

  // "supabase" alone is fine — the self-hosted stack uses it everywhere.
  it('does not flag the self-hosted stack name', () => {
    expect(mentionsSupabaseCloud('supabase-qa-db-1')).toBe(false);
    expect(mentionsSupabaseCloud('supabase/postgres:17.6.1.136')).toBe(false);
  });
});

describe('assertNoCloudEnv', () => {
  it('passes for a QA environment', () => {
    expect(() =>
      assertNoCloudEnv({ SUPABASE_URL: 'http://localhost:8100', REDIS_URL: 'redis://localhost:6379/1' }),
    ).not.toThrow();
  });

  it('refuses and names every offending variable', () => {
    expect(() =>
      assertNoCloudEnv({
        SUPABASE_URL: 'https://wfwlcpnkkxxzdvhvvsxb.supabase.co',
        OTHER_URL: 'https://abc.supabase.co',
        SAFE: 'http://localhost:8100',
      }),
    ).toThrow(/SUPABASE_URL.*OTHER_URL|OTHER_URL.*SUPABASE_URL/);
  });
});

describe('assertNotProductionData', () => {
  it('passes when only QA operators exist', () => {
    expect(() =>
      assertNotProductionData([
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-9000-000000000002',
      ]),
    ).not.toThrow();
  });

  it('passes on an empty database', () => {
    expect(() => assertNotProductionData([])).not.toThrow();
  });

  // The last line of defence: a tunnel could make production look local.
  it('refuses when the production operator is present', () => {
    expect(() => assertNotProductionData(['00000000-0000-4000-8000-000000000001', PROD_OPERATOR_ID]))
      .toThrow(/production data/);
  });
});
