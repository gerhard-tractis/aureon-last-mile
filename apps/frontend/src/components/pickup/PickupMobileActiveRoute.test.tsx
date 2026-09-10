import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupMobileActiveRoute } from './PickupMobileActiveRoute';
import type { RouteManifestRow } from './RouteManifestList';
import type { ActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';

/**
 * spec-80 fase 2b — the mobile rescue entry for a manifest
 * `trg_route_receptions_status_sync` closed (spec-80 fase 1's H1 rescue)
 * WITHOUT ever routing the crew through Firma. On desktop that manifest is
 * reachable via Completados → escanear → revisión → firma; mobile has no
 * Completados tab at all, so this screen has to surface it directly.
 *
 * Decision (this fase, written into the spec): the entry lives HERE, inside
 * the active-route screen the crew is already on — not on a sibling screen,
 * which would need its own point of entry (exactly the thing that doesn't
 * exist today).
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

describe('PickupMobileActiveRoute — rescate de firma (spec-80 fase 2b)', () => {
  it('shows nothing extra when no manifest needs a rescue signature', () => {
    const signed = manifest({
      id: 'a',
      external_load_id: 'CARGA-A',
      status: 'completed',
      signature_operator: 'M. Rojas',
    });
    render(<PickupMobileActiveRoute {...baseProps()} activeManifests={[signed]} />);
    expect(screen.queryByText('FALTA FIRMA')).toBeNull();
    expect(screen.queryByText(/pendiente.*firma/i)).toBeNull();
  });

  it('surfaces a manifest closed without signature as needing a rescue signature', () => {
    const rescue = manifest({
      id: 'a',
      external_load_id: 'CARGA-RESCUE',
      status: 'completed',
      signature_operator: null,
    });
    render(<PickupMobileActiveRoute {...baseProps()} activeManifests={[rescue]} />);
    expect(screen.getByText('FALTA FIRMA')).toBeInTheDocument();
    expect(screen.getByText(byFullText('CARGA-RESCUE'))).toBeInTheDocument();
  });

  // Asymmetric fixture: one rescue, one properly-closed manifest, one
  // still-pending manifest — a fixture with only one of each state cannot
  // tell a mislabelled swap from a coincidence.
  it('keeps a rescue load out of the ordinary completed section', () => {
    const rescue = manifest({
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
    const pending = manifest({ id: 'c', external_load_id: 'CARGA-PENDING', status: 'pending' });
    render(
      <PickupMobileActiveRoute
        {...baseProps()}
        activeManifests={[rescue, signed, pending]}
      />,
    );
    const rescueRow = screen.getByText(byFullText('CARGA-RESCUE')).closest('button');
    const signedRow = screen.getByText(byFullText('CARGA-SIGNED')).closest('button');
    expect(rescueRow?.textContent).toContain('FALTA FIRMA');
    expect(signedRow?.textContent).toContain('COMPLETADA');
    expect(signedRow?.textContent).not.toContain('FALTA FIRMA');
    expect(rescueRow?.textContent).not.toContain('COMPLETADA');
  });

  it('opens the rescue manifest via onOpenRescueManifest, straight to review — not onOpenRouteManifest (which goes through scan)', async () => {
    const rescue = manifest({
      id: 'a',
      external_load_id: 'CARGA-RESCUE',
      status: 'completed',
      signature_operator: null,
    });
    const onOpenRouteManifest = vi.fn();
    const onOpenRescueManifest = vi.fn();
    render(
      <PickupMobileActiveRoute
        {...baseProps()}
        activeManifests={[rescue]}
        onOpenRouteManifest={onOpenRouteManifest}
        onOpenRescueManifest={onOpenRescueManifest}
      />,
    );
    await userEvent.click(screen.getByText(byFullText('CARGA-RESCUE')).closest('button')!);
    expect(onOpenRescueManifest).toHaveBeenCalledWith('CARGA-RESCUE');
    expect(onOpenRouteManifest).not.toHaveBeenCalled();
  });

  it('falls back to onOpenRouteManifest when onOpenRescueManifest is not provided (backward compatible)', async () => {
    const rescue = manifest({
      id: 'a',
      external_load_id: 'CARGA-RESCUE',
      status: 'completed',
      signature_operator: null,
    });
    const onOpenRouteManifest = vi.fn();
    render(
      <PickupMobileActiveRoute
        {...baseProps()}
        activeManifests={[rescue]}
        onOpenRouteManifest={onOpenRouteManifest}
      />,
    );
    await userEvent.click(screen.getByText(byFullText('CARGA-RESCUE')).closest('button')!);
    expect(onOpenRouteManifest).toHaveBeenCalledWith('CARGA-RESCUE');
  });

  it('does not count a rescue load in the CERRADAS tile — it is not really closed without a signature', () => {
    const rescue = manifest({
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
    render(<PickupMobileActiveRoute {...baseProps()} activeManifests={[rescue, signed]} />);
    expect(screen.getByText('CERRADAS').closest('div')?.textContent).toContain('1');
  });

  // The trap that bit five other rounds of this same spec: TanStack Query
  // PAUSES a query with no network (networkMode: 'online') rather than
  // erroring — `data` stays undefined, and page.tsx's `?? []` turns that
  // into an empty `activeManifests` indistinguishable from a route that
  // genuinely has none. An absent FALTA FIRMA banner would then read as
  // "nothing to rescue" when the truth is "we could not check".
  it('says it does not know, rather than silently showing nothing, when manifestsUnknown is true', () => {
    render(
      <PickupMobileActiveRoute
        {...baseProps()}
        activeManifests={[]}
        manifestsUnknown
      />,
    );
    expect(screen.getByText(/no pudimos comprobar/i)).toBeInTheDocument();
    // And it must not ALSO claim there is nothing to add to the route —
    // that empty state is the other side of the same lie.
    expect(screen.queryByText('Sin manifiestos en la ruta')).toBeNull();
  });

  it('does not show the "no sabemos" notice once real data has arrived, even if it is empty', () => {
    render(
      <PickupMobileActiveRoute {...baseProps()} activeManifests={[]} manifestsUnknown={false} />,
    );
    expect(screen.queryByText(/no pudimos comprobar/i)).toBeNull();
  });

  it('a manifest whose signature_operator was never fetched by an older caller is not treated as a rescue', () => {
    const legacyRow = manifest({
      id: 'a',
      external_load_id: 'CARGA-LEGACY',
      status: 'completed',
    });
    delete (legacyRow as { signature_operator?: unknown }).signature_operator;
    render(<PickupMobileActiveRoute {...baseProps()} activeManifests={[legacyRow]} />);
    expect(screen.queryByText('FALTA FIRMA')).toBeNull();
    expect(screen.getByText('COMPLETADA')).toBeInTheDocument();
  });
});
