import { describe, it, expect } from 'vitest';
import { ModuleKey } from '@/lib/modules/registry';
import {
  NAV_SECTIONS,
  OPERATION_ITEMS,
  buildNavSections,
  breadcrumbForPath,
  countKeyThresholds,
} from './navigation';

const ALL_MODULES = [
  ModuleKey.OPS_CONTROL,
  ModuleKey.PICKUP,
  ModuleKey.RECEPTION,
  ModuleKey.DISTRIBUTION,
  ModuleKey.DISPATCH,
  ModuleKey.CONVERSATIONS,
];

const ALL_PERMISSIONS = ['pickup', 'reception', 'distribution', 'dispatch', 'customer_service'];

function labels(sections: ReturnType<typeof buildNavSections>) {
  return sections.flatMap((s) => s.items.map((i) => i.label));
}

describe('nav structure', () => {
  it('groups into exactly two sections, OPERACIÓN then GESTIÓN', () => {
    expect(NAV_SECTIONS.map((s) => s.title)).toEqual(['OPERACIÓN', 'GESTIÓN']);
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

  it('puts the shift-paced modules in OPERACIÓN and the rest in GESTIÓN', () => {
    const operacion = NAV_SECTIONS[0].items.map((i) => i.href);
    expect(operacion).toEqual([
      '/app/operations-control',
      '/app/pickup',
      '/app/reception',
      '/app/distribution',
      '/app/dispatch',
    ]);

    const gestion = NAV_SECTIONS[1].items.map((i) => i.href);
    expect(gestion).toEqual([
      '/app/dashboard',
      '/app/capacity-planning',
      '/app/conversations',
      '/app/audit-logs',
      '/admin',
    ]);
  });

  it('gives every OPERACIÓN item except the tower a queue counter', () => {
    // The tower is the overview — a count there would double-report the rest.
    expect(OPERATION_ITEMS.filter((i) => i.countKey).map((i) => i.countKey)).toEqual([
      'pickup',
      'reception',
      'distribution',
      'dispatch',
    ]);
    expect(
      OPERATION_ITEMS.find((i) => i.href === '/app/operations-control')?.countKey,
    ).toBeUndefined();
  });

  it('defines a warning threshold for every counter', () => {
    for (const item of OPERATION_ITEMS) {
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
});

describe('breadcrumbForPath', () => {
  it('derives section and page from the nav definition', () => {
    expect(breadcrumbForPath('/app/operations-control')).toEqual({
      section: 'Operación',
      page: 'Torre de control',
    });
    expect(breadcrumbForPath('/app/audit-logs')).toEqual({
      section: 'Gestión',
      page: 'Auditoría',
    });
  });

  it('matches nested routes to their parent nav item', () => {
    expect(breadcrumbForPath('/app/distribution/quicksort')?.page).toBe('Distribución');
    expect(breadcrumbForPath('/app/dispatch/R-2491')?.page).toBe('Despacho');
  });

  it('prefers the most specific match when one href prefixes another', () => {
    // /app/pickup must not swallow a future /app/pickup-something route, and
    // /admin must not swallow /app/*.
    expect(breadcrumbForPath('/admin/users')?.page).toBe('Admin');
  });

  it('returns null for a route neither the nav nor EXTRA_CRUMBS covers', () => {
    expect(breadcrumbForPath('/app/ocr-test')).toBeNull();
  });
});

describe('breadcrumbForPath — routes with no nav entry (spec-54)', () => {
  it('resolves leaf routes that are reachable but not in the sidebar', () => {
    // These pages used to carry their own breadcrumb in the page body, which
    // put the crumb in two different places depending on the route.
    expect(breadcrumbForPath('/app/orders/new')).toEqual({
      section: 'Gestión',
      page: 'Nuevo pedido',
    });
    expect(breadcrumbForPath('/app/orders/import')).toEqual({
      section: 'Gestión',
      page: 'Importar pedidos',
    });
    expect(breadcrumbForPath('/app/user-settings')).toEqual({
      section: 'Gestión',
      page: 'Mi cuenta',
    });
  });

  it('lets a nav item win over an extra crumb on the same prefix', () => {
    expect(breadcrumbForPath('/app/audit-logs')?.page).toBe('Auditoría');
  });

  it('still returns null for a genuinely unknown route', () => {
    expect(breadcrumbForPath('/app/does-not-exist')).toBeNull();
  });
});
