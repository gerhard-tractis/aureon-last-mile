import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModuleKey } from '@/lib/modules/registry';
import { ALL_PERMISSIONS } from '@/components/sidebar/navigation.test-helpers';

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

/**
 * spec-67 Task 1 — the landing matrix.
 *
 * This block exists to make the sidebar regrouping provably neutral. It is
 * written and run GREEN against the pre-spec-67 structure first, then the
 * sections move, then `LANDING_SCAN_ORDER` lands — and it must come back green
 * WITHOUT any expectation here being edited. If a value has to be touched to
 * make it pass, the restructure chose wrong and the spec says to stop.
 *
 * Permissions are load-bearing in every row, not decoration: all four stations
 * are gated by `hasPermission`, not by role, so a row that omits them proves
 * nothing (`navigation.ts` — `Recogida` is `hasPermission('pickup')`).
 */
const M = ModuleKey;

const LANDING_MATRIX: {
  name: string;
  role: string;
  permissions: string[];
  modules: ModuleKey[];
  expected: string;
}[] = [
  {
    name: 'admin with everything enabled starts in the tower',
    role: 'admin',
    permissions: ALL_PERMISSIONS,
    modules: [M.OPS_CONTROL, M.PICKUP, M.RECEPTION, M.DISTRIBUTION, M.DISPATCH, M.CONVERSATIONS],
    expected: '/app/operations-control',
  },
  {
    // The spec-65 regression: an admin mid-rollout on one module belongs in
    // that queue, not in the ungated cross-stage Pedidos list.
    name: 'admin activated only on PICKUP starts in the pickup queue',
    role: 'admin',
    permissions: ALL_PERMISSIONS,
    modules: [M.PICKUP],
    expected: '/app/pickup',
  },
  {
    name: 'admin activated only on OPS_CONTROL starts in the tower',
    role: 'admin',
    permissions: ALL_PERMISSIONS,
    modules: [M.OPS_CONTROL],
    expected: '/app/operations-control',
  },
  {
    name: 'operations manager with everything enabled starts in the tower',
    role: 'operations_manager',
    permissions: ALL_PERMISSIONS,
    modules: [M.OPS_CONTROL, M.PICKUP, M.RECEPTION, M.DISTRIBUTION, M.DISPATCH, M.CONVERSATIONS],
    expected: '/app/operations-control',
  },
  {
    // spec-67 Decisión 8, row 1. Without OPS_CONTROL the tower drops out, and
    // Conversaciones must NOT inherit the slot just because it moved sections.
    name: 'operations manager without the tower starts in their station, not Conversaciones',
    role: 'operations_manager',
    permissions: ['distribution'],
    modules: [M.CONVERSATIONS, M.DISTRIBUTION],
    expected: '/app/distribution',
  },
  {
    // spec-67 Decisión 8, row 2 — same trap reached via permissions instead of role.
    name: 'a floor user with customer_service still starts in their station',
    role: 'warehouse_staff',
    permissions: ['distribution', 'customer_service'],
    modules: [M.CONVERSATIONS, M.DISTRIBUTION],
    expected: '/app/distribution',
  },
  {
    // Conversaciones is this user's only module-gated screen, so it wins today
    // and must keep winning after the move.
    name: 'customer service with Conversaciones enabled starts there',
    role: 'customer_service',
    permissions: ['customer_service'],
    modules: [M.CONVERSATIONS],
    expected: '/app/conversations',
  },
  {
    name: 'customer service without Conversaciones falls back to Pedidos',
    role: 'customer_service',
    permissions: ['customer_service'],
    modules: [],
    expected: '/app/orders',
  },
  {
    name: 'pickup crew start in Recogida',
    role: 'pickup_crew',
    permissions: ['pickup'],
    modules: [M.PICKUP],
    expected: '/app/pickup',
  },
  {
    name: 'pickup leader start in Recogida',
    role: 'pickup_leader',
    permissions: ['pickup'],
    modules: [M.PICKUP],
    expected: '/app/pickup',
  },
  {
    // ops_leader works all four stations; the first in flow order wins.
    name: 'ops leader start at the first station in flow order',
    role: 'ops_leader',
    permissions: ['pickup', 'reception', 'distribution', 'dispatch'],
    modules: [M.PICKUP, M.RECEPTION, M.DISTRIBUTION, M.DISPATCH],
    expected: '/app/pickup',
  },
  {
    name: 'warehouse staff start in Recepción',
    role: 'warehouse_staff',
    permissions: ['reception'],
    modules: [M.RECEPTION],
    expected: '/app/reception',
  },
  {
    name: 'loading crew start in Despacho',
    role: 'loading_crew',
    permissions: ['dispatch'],
    modules: [M.DISPATCH],
    expected: '/app/dispatch',
  },
];

describe('/app landing matrix (spec-67 Task 1 — must survive the regrouping unedited)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it.each(LANDING_MATRIX)('$name', async ({ role, permissions, modules, expected }) => {
    expect(await landingFor({ role, permissions }, new Set(modules))).toBe(expected);
  });
});
