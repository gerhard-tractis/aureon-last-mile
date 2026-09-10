import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupMobileActiveRoute } from './PickupMobileActiveRoute';
import type { RouteManifestRow } from './RouteManifestList';
import type { ActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';

/**
 * spec-80 fase 2b (ronda 2) — this file used to test a "Pendientes de
 * firma" section rendered HERE, keyed off this route's own manifests
 * (`useRouteManifests`). Round 2 review proved that section could never
 * actually show a rescue in practice: `trg_route_receptions_status_sync`
 * flips the WHOLE route to `status: 'received'` in the same statement that
 * completes a manifest without a signature, and `get_my_active_pickup_route`
 * only returns routes still `in_progress` — so this component stops being
 * reachable at all the instant a rescue is born. The real entry moved to
 * `PickupMobileView.tsx` (operator-wide, via `get_completed_manifests`).
 * See `PickupMobileView.test.tsx` for that coverage.
 *
 * What's left worth testing here: `splitLoads` still keeps a hypothetical
 * signature-less completed load OUT of the CERRADAS tile (defense in depth
 * — see `pickupMobileHelpers.ts`), and this component renders no chip for
 * it at all (no dead "FALTA FIRMA" UI left behind by the round-1 revert).
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

function baseProps() {
  return {
    activeRoute,
    activeManifests: [] as RouteManifestRow[],
    onOpenRouteManifest: vi.fn(),
  };
}

describe('PickupMobileActiveRoute', () => {
  it('excludes a signature-less completed load from the CERRADAS tile (defense in depth)', () => {
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

  it('renders no FALTA FIRMA chip here — the rescue entry lives in PickupMobileView now', () => {
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
