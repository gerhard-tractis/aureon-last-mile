import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupMobileActiveRoute } from './PickupMobileActiveRoute';
import type { RouteManifestRow } from './RouteManifestList';
import type { ActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';

/**
 * spec-80 fase 2b — this file's rescue coverage moved twice. Ronda 1 tested
 * a "Pendientes de firma" section keyed off THIS route's own manifests
 * (`activeManifests`, via `useRouteManifests`) — proven unreachable in
 * practice (ronda 2: the route flips to `status: 'received'` the instant a
 * rescue is born). Ronda 2 then asserted this file renders NO rescue UI at
 * all. Ronda 3 (A2) puts it back, via a DIFFERENT, correctly-scoped prop
 * (`rescueManifests`, sourced operator-side from
 * `get_signature_rescue_manifests` — see `PickupMobileView.tsx`), shown
 * regardless of route state.
 *
 * The two are not the same thing and must not be confused: a rescue-shaped
 * row inside `activeManifests` (this route's own data) still produces no
 * chip here — `splitLoads`'s `rescueLoads` bucket is defense-in-depth for
 * the CERRADAS count only, not a second rendering path.
 */

const activeRoute: ActivePickupRoute = {
  id: 'route-1',
  code: 'PR-2026-0042',
  operator_id: 'op-1',
  driver_id: 'driver-1',
  status: 'in_progress',
  started_at: new Date().toISOString(),
  vehicle: { plate: 'AB-CD-12' },
  driver: { full_name: 'M. Rojas' },
  crew: [],
} as unknown as ActivePickupRoute;

function manifest(overrides: Partial<RouteManifestRow>): RouteManifestRow {
  return {
    id: 'm1',
    external_load_id: 'CARGA-1',
    retailer_name: 'Falabella',
    pickup_location: 'Mall Plaza Vespucio',
    total_orders: 10,
    total_packages: 20,
    verified_count: 20,
    status: 'pending',
    ...overrides,
  };
}

function byFullText(text: string) {
  return (_content: string, node: Element | null) => node?.textContent === text;
}

function baseProps() {
  return {
    activeRoute,
    activeManifests: [] as RouteManifestRow[],
    onOpenRouteManifest: vi.fn(),
  };
}

describe('PickupMobileActiveRoute — splitLoads defense in depth (route-scoped)', () => {
  it('excludes a signature-less completed load from the CERRADAS tile', () => {
    const rescueShaped = manifest({
      id: 'a',
      external_load_id: 'CARGA-RESCUE',
      status: 'completed',
      signature_operator: null,
    });
    const signed = manifest({
      id: 'b',
      external_load_id: 'CARGA-SIGNED',
      status: 'completed',
      signature_operator: 'M. Rojas',
    });
    render(<PickupMobileActiveRoute {...baseProps()} activeManifests={[rescueShaped, signed]} />);
    expect(screen.getByText('CERRADAS').closest('div')?.textContent).toContain('1');
  });

  it('a rescue-shaped row inside activeManifests (this route\'s own data) renders no chip on its own', () => {
    const rescueShaped = manifest({
      id: 'a',
      external_load_id: 'CARGA-RESCUE',
      status: 'completed',
      signature_operator: null,
    });
    render(<PickupMobileActiveRoute {...baseProps()} activeManifests={[rescueShaped]} />);
    expect(screen.queryByText('FALTA FIRMA')).toBeNull();
  });

  it('still renders an ordinary signed completed load as COMPLETADA', () => {
    const signed = manifest({
      id: 'b',
      external_load_id: 'CARGA-SIGNED',
      status: 'completed',
      signature_operator: 'M. Rojas',
    });
    render(<PickupMobileActiveRoute {...baseProps()} activeManifests={[signed]} />);
    expect(screen.getByText('COMPLETADA')).toBeInTheDocument();
  });
});

describe('PickupMobileActiveRoute — rescate de firma vía rescueManifests (ronda 3, A2)', () => {
  function rescueRow(): RouteManifestRow {
    return {
      id: 'r1',
      external_load_id: 'CARGA-RESCUE',
      retailer_name: 'Falabella',
      pickup_location: 'Bodega Norte',
      total_orders: 4,
      total_packages: 8,
      verified_count: 0,
      status: 'completed',
      signature_operator: null,
    };
  }

  it('shows FALTA FIRMA even though a route is active, when rescueManifests is non-empty', () => {
    render(
      <PickupMobileActiveRoute
        {...baseProps()}
        rescueManifests={[rescueRow()]}
        rescueAvailability="known"
      />,
    );
    expect(screen.getByText('FALTA FIRMA')).toBeInTheDocument();
  });

  it('opens via onOpenRescueManifest, not onOpenRouteManifest', async () => {
    const onOpenRescueManifest = vi.fn();
    const onOpenRouteManifest = vi.fn();
    render(
      <PickupMobileActiveRoute
        {...baseProps()}
        onOpenRouteManifest={onOpenRouteManifest}
        rescueManifests={[rescueRow()]}
        rescueAvailability="known"
        onOpenRescueManifest={onOpenRescueManifest}
      />,
    );
    await userEvent.click(screen.getByText(byFullText('CARGA-RESCUE')).closest('button')!);
    expect(onOpenRescueManifest).toHaveBeenCalledWith('CARGA-RESCUE');
    expect(onOpenRouteManifest).not.toHaveBeenCalled();
  });

  it('wires "Reintentar" through once retries are exhausted (A3)', async () => {
    const onRetryRescue = vi.fn();
    render(
      <PickupMobileActiveRoute
        {...baseProps()}
        rescueAvailability="error"
        onRetryRescue={onRetryRescue}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(onRetryRescue).toHaveBeenCalledTimes(1);
  });

  it('shows a silent skeleton, not the connection warning, while merely loading', () => {
    render(<PickupMobileActiveRoute {...baseProps()} rescueAvailability="loading" />);
    expect(screen.queryByText(/revisa tu conexión/i)).toBeNull();
  });
});
