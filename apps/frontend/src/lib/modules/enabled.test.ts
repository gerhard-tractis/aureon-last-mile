import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ModuleKey } from './registry';

const rpcMock = vi.fn();
const getSessionMock = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(async () => ({
    auth: { getSession: getSessionMock },
    rpc: rpcMock,
  })),
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}));

beforeEach(() => {
  rpcMock.mockReset();
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({
    data: {
      session: {
        user: { app_metadata: { claims: { operator_id: 'op-1' } } },
      },
    },
  });
});

describe('getEnabledModulesForCurrentUser (spec-45)', () => {
  it('returns typed set of enabled modules', async () => {
    rpcMock.mockResolvedValue({ data: ['ops_control', 'pickup'], error: null });
    const { getEnabledModulesForCurrentUser } = await import('./enabled');
    const set = await getEnabledModulesForCurrentUser();
    expect(set.has(ModuleKey.OPS_CONTROL)).toBe(true);
    expect(set.has(ModuleKey.PICKUP)).toBe(true);
    expect(set.has(ModuleKey.DISPATCH)).toBe(false);
  });

  it('filters out unknown keys from DB', async () => {
    rpcMock.mockResolvedValue({
      data: ['ops_control', 'rogue_module'],
      error: null,
    });
    const { getEnabledModulesForCurrentUser } = await import('./enabled');
    const set = await getEnabledModulesForCurrentUser();
    expect(set.size).toBe(1);
    expect(set.has(ModuleKey.OPS_CONTROL)).toBe(true);
  });

  it('throws on RPC error (fail-closed)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { getEnabledModulesForCurrentUser } = await import('./enabled');
    await expect(getEnabledModulesForCurrentUser()).rejects.toThrow();
  });

  it('returns empty set when no session operator', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    const { getEnabledModulesForCurrentUser } = await import('./enabled');
    const set = await getEnabledModulesForCurrentUser();
    expect(set.size).toBe(0);
  });
});
