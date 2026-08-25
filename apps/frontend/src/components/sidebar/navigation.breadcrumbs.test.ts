import { describe, it, expect } from 'vitest';
import { breadcrumbForPath } from './navigation';

describe('breadcrumbForPath', () => {
  it('derives section and page from the nav definition', () => {
    expect(breadcrumbForPath('/app/operations-control')).toEqual({
      section: 'Seguimiento',
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
    // spec-67 moved this tool under /admin and gave it a real crumb, so the
    // old route resolves to nothing while the new one is explicit.
    expect(breadcrumbForPath('/app/ocr-test')).toBeNull();
    expect(breadcrumbForPath('/admin/tools/ocr')).toEqual({
      section: 'Gestión',
      page: 'Herramientas · OCR',
    });
    expect(breadcrumbForPath('/admin/tools/wismo')).toEqual({
      section: 'Gestión',
      page: 'Herramientas · WISMO',
    });
  });
});

describe('breadcrumbForPath — routes with no nav entry (spec-54)', () => {
  it('resolves leaf routes that are reachable but not in the sidebar', () => {
    // These pages used to carry their own breadcrumb in the page body, which
    // put the crumb in two different places depending on the route.
    expect(breadcrumbForPath('/app/orders/new')).toEqual({
      section: 'Seguimiento',
      page: 'Nuevo pedido',
    });
    expect(breadcrumbForPath('/app/orders/import')).toEqual({
      section: 'Seguimiento',
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

describe('breadcrumbForPath — Pedidos (spec-65) vs. its longer EXTRA_CRUMBS siblings', () => {
  it('resolves the Pedidos list itself to the new nav item', () => {
    expect(breadcrumbForPath('/app/orders')).toEqual({
      section: 'Seguimiento',
      page: 'Pedidos',
    });
  });

  it('still lets /app/orders/new beat the now-real /app/orders nav item', () => {
    expect(breadcrumbForPath('/app/orders/new')).toEqual({
      section: 'Seguimiento',
      page: 'Nuevo pedido',
    });
  });

  it('still lets /app/orders/import beat it too', () => {
    expect(breadcrumbForPath('/app/orders/import')).toEqual({
      section: 'Seguimiento',
      page: 'Importar pedidos',
    });
  });

  it('resolves an order detail route to Pedidos (Task 9)', () => {
    expect(breadcrumbForPath('/app/orders/3fa85f64-5717-4562-b3fc-2c963f66afa6')).toEqual({
      section: 'Seguimiento',
      page: 'Pedidos',
    });
  });
});
