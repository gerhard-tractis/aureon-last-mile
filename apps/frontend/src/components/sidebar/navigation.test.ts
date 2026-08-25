import { describe, it, expect } from 'vitest';
import { ModuleKey } from '@/lib/modules/registry';
import {
  NAV_SECTIONS,
  OPERATION_ITEMS,
  TRACKING_ITEMS,
  MANAGEMENT_ITEMS,
  buildNavSections,
  countKeyThresholds,
  resolveLandingPath,
} from './navigation';
import { ALL_MODULES, ALL_PERMISSIONS, labels } from './navigation.test-helpers';

describe('nav structure', () => {
  it('groups into exactly three sections, SEGUIMIENTO then OPERACIÓN then GESTIÓN', () => {
    expect(NAV_SECTIONS.map((s) => s.title)).toEqual([
      'SEGUIMIENTO',
      'OPERACIÓN',
      'GESTIÓN',
    ]);
  });

  it('renames Ops Control to "Torre de control" and Pickup to "Recogida"', () => {
    // The code already used 'Recogida' in STAGE_LABELS while the nav said
    // 'Pickup'. Spec-54 unifies on Spanish.
    const all = NAV_SECTIONS.flatMap((s) => s.items);
    expect(all.find((i) => i.href === '/app/operations-control')?.label).toBe('Torre de control');
    expect(all.find((i) => i.href === '/app/pickup')?.label).toBe('Recogida');
    expect(all.map((i) => i.label)).not.toContain('Ops Control');
    expect(all.map((i) => i.label)).not.toContain('Pickup');
  });

  it('cuts the three sections by reading rhythm (spec-67)', () => {
    // SEGUIMIENTO descends by zoom: whole operation, one order, one customer.
    expect(NAV_SECTIONS[0].items.map((i) => i.href)).toEqual([
      '/app/operations-control',
      '/app/orders',
      '/app/conversations',
    ]);

    // OPERACIÓN is the four stations in physical flow order — nothing else.
    expect(NAV_SECTIONS[1].items.map((i) => i.href)).toEqual([
      '/app/pickup',
      '/app/reception',
      '/app/distribution',
      '/app/dispatch',
    ]);

    expect(NAV_SECTIONS[2].items.map((i) => i.href)).toEqual([
      '/app/dashboard',
      '/app/capacity-planning',
      '/app/audit-logs',
      '/admin',
    ]);
  });

  it('gives every OPERACIÓN item a module AND a countKey (spec-67 Invariante A)', () => {
    for (const item of OPERATION_ITEMS) {
      expect(item.module, `${item.label} needs a module`).toBeDefined();
      expect(item.countKey, `${item.label} needs a countKey`).toBeDefined();
    }
  });

  it('does NOT claim the converse — Pedidos keeps its counter from SEGUIMIENTO', () => {
    // The invariant is one-directional on purpose. Asserting "nothing outside
    // OPERACIÓN has a countKey" would force deleting the Pedidos badge, which
    // spec-67 explicitly preserves.
    const pedidos = TRACKING_ITEMS.find((i) => i.href === '/app/orders');
    expect(pedidos?.countKey).toBe('orders');
  });

  it('positions Pedidos second in SEGUIMIENTO — display order only, landing no longer depends on it', () => {
    // Before spec-67 this test's name ended "resolveLandingPath depends on
    // this order". It no longer does: landing walks LANDING_SCAN_ORDER, so
    // the sidebar can be re-sorted without moving anyone's start page.
    expect(TRACKING_ITEMS[0].href).toBe('/app/operations-control');
    expect(TRACKING_ITEMS[1]).toMatchObject({ href: '/app/orders', label: 'Pedidos' });
  });

  it('gives every OPERACIÓN station a queue counter', () => {
    expect(OPERATION_ITEMS.map((i) => i.countKey)).toEqual([
      'pickup',
      'reception',
      'distribution',
      'dispatch',
    ]);
    // The tower is the overview — a count there would double-report the rest.
    expect(
      TRACKING_ITEMS.find((i) => i.href === '/app/operations-control')?.countKey,
    ).toBeUndefined();
  });

  it('gives Pedidos no module — the cross-stage order list is not an optional module', () => {
    // Look it up in TRACKING_ITEMS and assert it was FOUND first. Querying
    // OPERATION_ITEMS here would pass vacuously after spec-67 moved Pedidos:
    // `find` returns undefined and `undefined?.module` is undefined too, so
    // the test would stay green while testing nothing.
    const pedidos = TRACKING_ITEMS.find((i) => i.href === '/app/orders');
    expect(pedidos).toBeDefined();
    expect(pedidos?.module).toBeUndefined();
    expect(OPERATION_ITEMS.map((i) => i.href)).not.toContain('/app/orders');
  });

  it('defines a warning threshold for every counter', () => {
    for (const item of [...TRACKING_ITEMS, ...OPERATION_ITEMS, ...MANAGEMENT_ITEMS]) {
      if (!item.countKey) continue;
      expect(countKeyThresholds[item.countKey]).toBeGreaterThan(0);
    }
  });
});

describe('buildNavSections — visibility rules are unchanged from the flat nav', () => {
  it('shows the tower to admin and operations_manager only', () => {
    for (const role of ['admin', 'operations_manager']) {
      const sections = buildNavSections({ role, permissions: [], enabledModules: ALL_MODULES });
      expect(labels(sections)).toContain('Torre de control');
    }
    for (const role of ['driver', 'viewer']) {
      const sections = buildNavSections({ role, permissions: [], enabledModules: ALL_MODULES });
      expect(labels(sections)).not.toContain('Torre de control');
    }
  });

  it('hides a module the user has RBAC for but the operator has not enabled', () => {
    const sections = buildNavSections({
      role: 'driver',
      permissions: ['pickup', 'reception'],
      enabledModules: [ModuleKey.PICKUP],
    });
    expect(labels(sections)).toContain('Recogida');
    expect(labels(sections)).not.toContain('Recepción');
  });

  it('hides a module the operator enabled but the user lacks RBAC for', () => {
    const sections = buildNavSections({
      role: 'driver',
      permissions: ['pickup'],
      enabledModules: [ModuleKey.PICKUP, ModuleKey.RECEPTION],
    });
    expect(labels(sections)).toContain('Recogida');
    expect(labels(sections)).not.toContain('Recepción');
  });

  it('keeps platform items when every module is disabled', () => {
    const sections = buildNavSections({
      role: 'admin',
      permissions: ALL_PERMISSIONS,
      enabledModules: [],
    });
    const visible = labels(sections);
    expect(visible).toEqual(
      expect.arrayContaining(['Dashboard ejecutivo', 'Capacidad', 'Auditoría']),
    );
    expect(visible).not.toContain('Torre de control');
    expect(visible).not.toContain('Recogida');
    expect(visible).not.toContain('Despacho');
  });

  it('shows Admin only to the admin role', () => {
    expect(
      labels(buildNavSections({ role: 'admin', permissions: [], enabledModules: [] })),
    ).toContain('Admin');
    expect(
      labels(buildNavSections({ role: 'operations_manager', permissions: [], enabledModules: [] })),
    ).not.toContain('Admin');
  });

  it('shows Despacho to a user with dispatch permission or admin permission', () => {
    for (const permissions of [['dispatch'], ['admin']]) {
      const sections = buildNavSections({
        role: 'driver',
        permissions,
        enabledModules: [ModuleKey.DISPATCH],
      });
      expect(labels(sections)).toContain('Despacho');
    }
  });

  it('drops a section entirely when none of its items are visible', () => {
    const sections = buildNavSections({ role: 'driver', permissions: [], enabledModules: [] });
    expect(sections.map((s) => s.title)).not.toContain('OPERACIÓN');
  });

  it('shows Pedidos to admin, operations_manager, and customer_service — no module gate', () => {
    for (const role of ['admin', 'operations_manager']) {
      expect(
        labels(buildNavSections({ role, permissions: [], enabledModules: [] })),
      ).toContain('Pedidos');
    }
    expect(
      labels(
        buildNavSections({ role: 'driver', permissions: ['customer_service'], enabledModules: [] }),
      ),
    ).toContain('Pedidos');
    expect(
      labels(buildNavSections({ role: 'driver', permissions: [], enabledModules: [] })),
    ).not.toContain('Pedidos');
  });
});

describe('resolveLandingPath (landing page removal)', () => {
  it('sends an admin to the control tower', () => {
    expect(
      resolveLandingPath({
        role: 'admin',
        permissions: ALL_PERMISSIONS,
        enabledModules: ALL_MODULES,
      }),
    ).toBe('/app/operations-control');
  });

  it('sends an operations manager to the control tower', () => {
    expect(
      resolveLandingPath({
        role: 'operations_manager',
        permissions: [],
        enabledModules: ALL_MODULES,
      }),
    ).toBe('/app/operations-control');
  });

  it('sends a warehouse user to their first reachable queue, not the tower', () => {
    // The tower is admin/manager only — landing there would show an empty page
    // with no sidebar entry to leave by.
    expect(
      resolveLandingPath({
        role: 'warehouse',
        permissions: ['reception', 'distribution'],
        enabledModules: ALL_MODULES,
      }),
    ).toBe('/app/reception');
  });

  it('skips the tower AND Pedidos when a module-gated queue is enabled, landing on that queue', () => {
    // Reversed ruling (final review round): a module-gated item the operator
    // is actually activated on beats the ungated Pedidos list, even though
    // Pedidos sits earlier in OPERATION_ITEMS. Pedidos has no `module`, so it
    // never satisfies "first item with a module that's enabled" — landing an
    // admin mid-rollout on only PICKUP should send them to their queue, not
    // to the global order list.
    expect(
      resolveLandingPath({
        role: 'admin',
        permissions: ALL_PERMISSIONS,
        enabledModules: [ModuleKey.PICKUP],
      }),
    ).toBe('/app/pickup');
  });

  it('skips both the tower and Pedidos when neither applies, landing on the first module-gated queue', () => {
    expect(
      resolveLandingPath({
        role: 'driver',
        permissions: ['pickup'],
        enabledModules: [ModuleKey.PICKUP],
      }),
    ).toBe('/app/pickup');
  });

  it('lands a customer_service user on Pedidos — they can never see the tower, but Pedidos is ungated', () => {
    // Before spec-65, a customer_service-only user had no visible OPERACIÓN
    // item at all (every item required admin/manager or a stage permission
    // they don't hold) and fell through to the Dashboard ejecutivo fallback.
    // Pedidos changes that: it is the role most likely to actually benefit
    // from landing straight on the order list instead of the dashboard.
    expect(
      resolveLandingPath({
        role: 'driver',
        permissions: ['customer_service'],
        enabledModules: [],
      }),
    ).toBe('/app/orders');
  });

  it('falls back to the executive dashboard when nothing else is visible', () => {
    expect(
      resolveLandingPath({ role: null, permissions: [], enabledModules: [] }),
    ).toBe('/app/dashboard');
  });

  it('never resolves to a path the sidebar would hide', () => {
    const ctx = { role: 'driver', permissions: ['pickup'], enabledModules: ALL_MODULES };
    const visible = buildNavSections(ctx).flatMap((s) => s.items.map((i) => i.href));
    expect(visible).toContain(resolveLandingPath(ctx));
  });

  describe('the rule directly: module-gated item wins over an earlier ungated one', () => {
    it('prefers a later module-gated item (Recogida) over the earlier ungated Pedidos', () => {
      expect(
        resolveLandingPath({
          role: 'admin',
          permissions: ALL_PERMISSIONS,
          enabledModules: [ModuleKey.PICKUP],
        }),
      ).toBe('/app/pickup');
    });

    it('falls back to the first visible item (Pedidos) when no visible item has an enabled module', () => {
      // customer_service has no module-gated item visible here (Conversations
      // is also customer_service-visible but its module is off) — Pedidos is
      // the only thing visible, so it wins by the fallback, not the module
      // rule.
      expect(
        resolveLandingPath({
          role: 'driver',
          permissions: ['customer_service'],
          enabledModules: [],
        }),
      ).toBe('/app/orders');
    });

    it('falls back to the first visible item when enabledModules is empty entirely', () => {
      expect(
        resolveLandingPath({
          role: 'admin',
          permissions: ALL_PERMISSIONS,
          enabledModules: [],
        }),
      ).toBe('/app/orders');
    });
  });
});
