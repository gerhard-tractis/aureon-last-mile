import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupMobileView } from './PickupMobileView';
import type { ManifestRow } from './ManifestTable';
import type { RouteManifestRow } from './RouteManifestList';
import type { ActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';

vi.mock('@/components/pickup/PickupRouteDraftPanel', () => ({
  PickupRouteDraftPanel: ({ selected }: { selected: ManifestRow[] }) => (
    <div data-testid="draft-panel">{selected.length} seleccionados</div>
  ),
}));

const noop = () => {};

const pendingRows: ManifestRow[] = [
  {
    id: 'm1',
    externalLoadId: 'CARGA-001',
    pickupPoint: 'Easy Vespucio',
    retailerName: 'Easy',
    orderCount: 5,
    packageCount: 12,
    verifiedCount: 0,
  },
  {
    id: 'm2',
    externalLoadId: 'CARGA-002',
    pickupPoint: 'Sodimac Puente Alto',
    retailerName: 'Sodimac',
    orderCount: 3,
    packageCount: 8,
    verifiedCount: 2,
  },
];

const activeRoute: ActivePickupRoute = {
  id: 'route-1',
  code: 'PR-2026-0042',
  operator_id: 'op-1',
  driver_id: 'driver-1',
  status: 'in_progress',
  started_at: new Date().toISOString(),
  vehicle: { plate: 'AB-CD-12' },
} as unknown as ActivePickupRoute;

const activeManifests: RouteManifestRow[] = [
  {
    id: 'rm1',
    external_load_id: 'CARGA-A',
    retailer_name: 'Easy',
    pickup_location: 'Bodega Central',
    total_orders: 4,
    total_packages: 8,
    verified_count: 8,
    status: 'completed',
  },
  {
    id: 'rm2',
    external_load_id: 'CARGA-B',
    retailer_name: 'Falabella',
    pickup_location: 'Bodega Norte',
    total_orders: 2,
    total_packages: null,
    verified_count: 0,
    status: 'pending',
  },
];

function baseProps() {
  return {
    activeRoute: null,
    activeManifests: [],
    pendingRows,
    closuresCount: 1,
    selectedIds: new Set<string>(),
    onToggleSelect: vi.fn(),
    selectedManifests: [],
    onOpenPending: vi.fn(),
    onOpenRouteManifest: vi.fn(),
    operatorId: 'op-1',
    onCreateRoute: vi.fn(),
    isCreatingRoute: false,
  };
}

describe('PickupMobileView', () => {
  describe('no active route — pending manifests', () => {
    it('renders a card per pending manifest', () => {
      render(<PickupMobileView {...baseProps()} />);
      expect(screen.getByText('CARGA-001')).toBeInTheDocument();
      expect(screen.getByText('CARGA-002')).toBeInTheDocument();
    });

    it('reports the real closed-today count, not a client-cache figure', () => {
      render(<PickupMobileView {...baseProps()} closuresCount={3} />);
      expect(screen.getByText(/3 cerradas hoy/)).toBeInTheDocument();
    });

    it('badges a card with verified scans as "En progreso", others as "Pendiente"', () => {
      render(<PickupMobileView {...baseProps()} />);
      const badges = screen.getAllByTestId('card-status-badge');
      expect(badges[0]).toHaveTextContent('Pendiente');
      expect(badges[1]).toHaveTextContent('En progreso');
    });

    it('tapping the checkbox toggles selection', async () => {
      const onToggleSelect = vi.fn();
      render(<PickupMobileView {...baseProps()} onToggleSelect={onToggleSelect} />);
      await userEvent.click(screen.getAllByRole('checkbox')[0]);
      expect(onToggleSelect).toHaveBeenCalledWith('m1');
    });

    it('tapping the load id opens the manifest instead of toggling selection', async () => {
      const onOpenPending = vi.fn();
      const onToggleSelect = vi.fn();
      render(
        <PickupMobileView
          {...baseProps()}
          onOpenPending={onOpenPending}
          onToggleSelect={onToggleSelect}
        />,
      );
      await userEvent.click(screen.getAllByTestId('mobile-manifest-open')[0]);
      expect(onOpenPending).toHaveBeenCalledWith(pendingRows[0]);
      expect(onToggleSelect).not.toHaveBeenCalled();
    });

    it('renders the route draft panel so a route can still be assembled from a phone', () => {
      render(<PickupMobileView {...baseProps()} selectedManifests={[pendingRows[0]]} />);
      expect(screen.getByTestId('draft-panel')).toHaveTextContent('1 seleccionados');
    });

    it('shows an empty state when there are no pending manifests', () => {
      render(<PickupMobileView {...baseProps()} pendingRows={[]} />);
      expect(screen.getByText('Sin recogidas pendientes')).toBeInTheDocument();
    });

    it('never renders a "guardadas"/downloaded-cache summary or a SIN DESCARGAR chip', () => {
      render(<PickupMobileView {...baseProps()} />);
      expect(screen.queryByText(/guardad/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/SIN DESCARGAR/i)).not.toBeInTheDocument();
    });
  });

  describe('active route — route manifests', () => {
    it('shows the route code and manifest counts in the header', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      expect(screen.getByText(/PR-2026-0042/)).toBeInTheDocument();
      expect(screen.getByText(/2 manifiestos/)).toBeInTheDocument();
      expect(screen.getByText(/1 cerradas/)).toBeInTheDocument();
    });

    it('sorts closed manifests to the bottom, pending/active ones on top', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      const cards = screen.getAllByTestId('mobile-manifest-card');
      // activeManifests[0] (CARGA-A) is 'completed'; activeManifests[1]
      // (CARGA-B) is 'pending' — pending must render first despite arriving
      // second in the array.
      expect(within(cards[0]).getByText('CARGA-B')).toBeInTheDocument();
      expect(within(cards[1]).getByText('CARGA-A')).toBeInTheDocument();
    });

    it('badges the completed card "Cerrada" and treats an unknown total as unknown, not zero', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      const badges = screen.getAllByTestId('card-status-badge');
      expect(badges.some((b) => b.textContent === 'Cerrada')).toBe(true);
      // CARGA-B has total_packages: null, verified_count: 0 → "0/—".
      expect(screen.getByText('0/—')).toBeInTheDocument();
    });

    // spec-54 3h review fix (critical #1) — the mobile card tap no longer
    // writes the pending→in_progress flip to Supabase, so `status` alone
    // can lag reality. verified_count is always live, so it must still
    // drive the badge even while `status` says 'pending'.
    it('badges a manifest "En progreso" from verified_count even while status is still pending', () => {
      const scanning: RouteManifestRow = {
        id: 'rm3',
        external_load_id: 'CARGA-C',
        retailer_name: 'Falabella',
        pickup_location: 'Bodega Sur',
        total_orders: 2,
        total_packages: 4,
        verified_count: 2,
        status: 'pending',
      };
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={[scanning]}
        />,
      );
      expect(screen.getByTestId('card-status-badge')).toHaveTextContent('En progreso');
    });

    it('tapping a card opens that manifest', async () => {
      const onOpenRouteManifest = vi.fn();
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
          onOpenRouteManifest={onOpenRouteManifest}
        />,
      );
      await userEvent.click(screen.getAllByTestId('mobile-manifest-card')[0]);
      expect(onOpenRouteManifest).toHaveBeenCalledWith('CARGA-B');
    });

    it('does not render the route draft panel while a route is already active', () => {
      render(
        <PickupMobileView
          {...baseProps()}
          activeRoute={activeRoute}
          activeManifests={activeManifests}
        />,
      );
      expect(screen.queryByTestId('draft-panel')).not.toBeInTheDocument();
    });

    it('shows an empty state when the active route has no manifests yet', () => {
      render(<PickupMobileView {...baseProps()} activeRoute={activeRoute} activeManifests={[]} />);
      expect(screen.getByText('Sin manifiestos en la ruta')).toBeInTheDocument();
    });
  });
});
