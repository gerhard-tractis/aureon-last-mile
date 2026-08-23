import { describe, it, expect } from 'vitest';
import { ModuleKey } from '@/lib/modules/registry';
import {
  OPERATIONS_ROLES,
  buildMobileTabs,
  isImmersiveMobileRoute,
  isOperationsRole,
  type NavContext,
} from './navigation';
import { ALL_MODULES, ALL_PERMISSIONS } from './navigation.test-helpers';

describe('isOperationsRole', () => {
  // The trap this test exists for: buildMobileTabs returns [] for any role
  // outside the set, so a floor role missing here gets NO bottom tab bar --
  // the only navigation a phone user has. spec-61 added pickup_leader.
  it('covers every floor role that works on a phone', () => {
    expect([...OPERATIONS_ROLES].sort()).toEqual(
      ['loading_crew', 'pickup_crew', 'pickup_leader', 'warehouse_staff'].sort(),
    );
  });

  it('gives every operations role the full four-tab bar', () => {
    for (const role of OPERATIONS_ROLES) {
      const tabs = buildMobileTabs({
        role,
        permissions: [],
        enabledModules: [],
      });
      expect(tabs).toHaveLength(4);
    }
  });

  it('is false for desk roles and for unknown input', () => {
    expect(isOperationsRole('operations_manager')).toBe(false);
    expect(isOperationsRole('admin')).toBe(false);
    expect(isOperationsRole('super_admin')).toBe(false);
    expect(isOperationsRole('some_future_role')).toBe(false);
    expect(isOperationsRole(null)).toBe(false);
  });
});

describe('buildMobileTabs', () => {
  it('returns nothing for management and unrecognised roles — they keep the hamburger', () => {
    for (const role of ['operations_manager', 'admin', 'super_admin', null, 'viewer']) {
      expect(
        buildMobileTabs({ role, permissions: ALL_PERMISSIONS, enabledModules: ALL_MODULES }),
      ).toEqual([]);
    }
  });

  it('gives an operations role with every permission and module all four tabs, in order', () => {
    const tabs = buildMobileTabs({
      role: 'pickup_crew',
      permissions: ALL_PERMISSIONS,
      enabledModules: ALL_MODULES,
    });
    expect(tabs.map((t) => ({ href: t.href, label: t.label }))).toEqual([
      { href: '/app/pickup', label: 'Recogida' },
      { href: '/app/reception', label: 'Recepción' },
      { href: '/app/distribution', label: 'Distribución' },
      { href: '/app/dispatch', label: 'Despacho' },
    ]);
    expect(tabs.some((t) => t.href === '/app/operations-control')).toBe(false);
  });

  it('excludes Pedidos specifically, not merely "a fifth item" — a wrong exclusion would still pass a bare length check', () => {
    const tabs = buildMobileTabs({
      role: 'pickup_crew',
      permissions: ALL_PERMISSIONS,
      enabledModules: ALL_MODULES,
    });
    expect(tabs.map((t) => t.href)).toEqual([
      '/app/pickup',
      '/app/reception',
      '/app/distribution',
      '/app/dispatch',
    ]);
    expect(tabs.some((t) => t.href === '/app/orders')).toBe(false);
  });

  it('still shows all four tabs on a partial permission set, but marks the rest disabled', () => {
    // 20260811000001_align_permission_vocabulary.sql: a freshly seeded
    // pickup_crew only carries 'pickup'. The tab bar shows the shape of the
    // app rather than hiding the other three — but a tab into a module the
    // driver cannot open would instant-bounce them back to /app
    // (_client-gate.tsx), so those three are disabled, not live links.
    const tabs = buildMobileTabs({
      role: 'pickup_crew',
      permissions: ['pickup'],
      enabledModules: ALL_MODULES,
    });
    expect(tabs.map((t) => t.href)).toEqual([
      '/app/pickup',
      '/app/reception',
      '/app/distribution',
      '/app/dispatch',
    ]);
    expect(tabs.map((t) => t.disabled)).toEqual([false, true, true, true]);
  });

  it('still returns all four when a module is disabled for the operator — that tab is disabled, not absent', () => {
    const tabs = buildMobileTabs({
      role: 'warehouse_staff',
      permissions: ['reception', 'distribution'],
      enabledModules: [ModuleKey.RECEPTION],
    });
    expect(tabs.map((t) => t.href)).toEqual([
      '/app/pickup',
      '/app/reception',
      '/app/distribution',
      '/app/dispatch',
    ]);
    const byHref = Object.fromEntries(tabs.map((t) => [t.href, t.disabled]));
    expect(byHref['/app/reception']).toBe(false);
    // Distribución: permission held, but the module itself is off — disabled.
    expect(byHref['/app/distribution']).toBe(true);
    // Pickup/Despacho: no permission either — also disabled.
    expect(byHref['/app/pickup']).toBe(true);
    expect(byHref['/app/dispatch']).toBe(true);
  });

  it('gives loading_crew its seeded distribution + dispatch tabs enabled, the rest disabled', () => {
    const tabs = buildMobileTabs({
      role: 'loading_crew',
      permissions: ['distribution', 'dispatch'],
      enabledModules: ALL_MODULES,
    });
    expect(tabs.map((t) => t.href)).toEqual([
      '/app/pickup',
      '/app/reception',
      '/app/distribution',
      '/app/dispatch',
    ]);
    expect(tabs.map((t) => t.disabled)).toEqual([true, true, false, false]);
  });

  it('can disable all four when the user holds none of the permissions', () => {
    const tabs = buildMobileTabs({
      role: 'pickup_crew',
      permissions: [],
      enabledModules: ALL_MODULES,
    });
    expect(tabs).toHaveLength(4);
    expect(tabs.every((t) => t.disabled)).toBe(true);
  });

  it('the four-tab invariant: every operations role always gets exactly four, whatever the permissions or module state', () => {
    const scenarios: NavContext[] = [
      { role: 'pickup_crew', permissions: [], enabledModules: [] },
      { role: 'pickup_crew', permissions: ['pickup'], enabledModules: ALL_MODULES },
      { role: 'warehouse_staff', permissions: ['reception', 'distribution'], enabledModules: [] },
      { role: 'loading_crew', permissions: ALL_PERMISSIONS, enabledModules: ALL_MODULES },
    ];
    for (const ctx of scenarios) {
      expect(buildMobileTabs(ctx)).toHaveLength(4);
    }
  });
});

describe('isImmersiveMobileRoute', () => {
  it('suppresses the tab bar on screens with their own fixed bottom action bar', () => {
    expect(isImmersiveMobileRoute('/app/pickup/scan/LOAD-1')).toBe(true);
    expect(isImmersiveMobileRoute('/app/pickup/review/LOAD-1')).toBe(true);
    expect(isImmersiveMobileRoute('/app/pickup/route/active')).toBe(true);
  });

  it('leaves ordinary tab destinations alone', () => {
    expect(isImmersiveMobileRoute('/app/pickup')).toBe(false);
    expect(isImmersiveMobileRoute('/app/reception')).toBe(false);
    expect(isImmersiveMobileRoute('/app/dispatch/R-2491')).toBe(false);
  });

  it('the reception session is immersive, the yard listing is not', () => {
    // The listing needs the tabs: it's where the operator switches modules.
    // The session and its record have their own fixed action bar.
    expect(isImmersiveMobileRoute('/app/reception')).toBe(false);
    expect(isImmersiveMobileRoute('/app/reception/route/abc-123')).toBe(true);
    expect(isImmersiveMobileRoute('/app/reception/route/abc-123/completa')).toBe(true);
  });
});
