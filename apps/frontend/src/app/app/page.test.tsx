import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModuleKey } from '@/lib/modules/registry';

/**
 * `/app` used to be a boilerplate welcome card. With the landing page gone it
 * becomes the single place that decides where a signed-in user starts, so the
 * answer stays consistent whether they arrive from `/`, from login, or from a
 * bookmark.
 */

const getSession = vi.fn();
const getEnabledModulesForCurrentUser = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirect(path),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: async () => ({ auth: { getSession } }),
}));

vi.mock('@/lib/modules/enabled', () => ({
  getEnabledModulesForCurrentUser: () => getEnabledModulesForCurrentUser(),
}));

const ALL_MODULES = new Set([
  ModuleKey.OPS_CONTROL,
  ModuleKey.PICKUP,
  ModuleKey.RECEPTION,
  ModuleKey.DISTRIBUTION,
  ModuleKey.DISPATCH,
  ModuleKey.CONVERSATIONS,
]);

async function landingFor(claims: Record<string, unknown> | null, modules = ALL_MODULES) {
  getSession.mockResolvedValue({
    data: { session: claims ? { user: { app_metadata: { claims } } } : null },
  });
  getEnabledModulesForCurrentUser.mockResolvedValue(modules);
  const { default: AppIndexPage } = await import('./page');
  try {
    await AppIndexPage();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('REDIRECT:')) throw error;
  }
  return redirect.mock.calls.at(-1)?.[0];
}

describe('/app (entry route)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('starts an admin in the control tower', async () => {
    expect(
      await landingFor({ role: 'admin', permissions: ['pickup', 'reception'] }),
    ).toBe('/app/operations-control');
  });

  it('starts an operations manager in the control tower', async () => {
    expect(await landingFor({ role: 'operations_manager', permissions: [] })).toBe(
      '/app/operations-control',
    );
  });

  it('starts a warehouse user in their own queue', async () => {
    expect(await landingFor({ role: 'warehouse', permissions: ['reception'] })).toBe(
      '/app/reception',
    );
  });

  it('falls back to the executive dashboard when the user has no queues', async () => {
    expect(await landingFor({ role: 'viewer', permissions: [] })).toBe('/app/dashboard');
  });

  it('respects module activation over role', async () => {
    expect(
      await landingFor(
        { role: 'admin', permissions: ['pickup'] },
        new Set([ModuleKey.PICKUP]),
      ),
    ).toBe('/app/pickup');
  });

  it('still resolves a landing route when the session carries no claims', async () => {
    expect(await landingFor(null)).toBe('/app/dashboard');
  });

  it('always redirects — it never renders a page of its own', async () => {
    await landingFor({ role: 'admin', permissions: [] });
    expect(redirect).toHaveBeenCalledOnce();
  });
});
