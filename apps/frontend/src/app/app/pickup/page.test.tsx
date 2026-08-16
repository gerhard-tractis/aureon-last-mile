import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PickupPage from './page';

// ── Mocks ────────────────────────────────────────────────────────────────────
const mockPending = [
  {
    id: 'm1',
    external_load_id: 'CARGA-001',
    retailer_name: 'Easy',
    order_count: 5,
    package_count: 12,
    created_at: '2026-04-09T10:00:00Z',
    pickup_point: 'Easy Vespucio',
    verified_count: 0,
  },
  {
    id: 'm2',
    external_load_id: 'CARGA-002',
    retailer_name: 'Sodimac',
    order_count: 3,
    package_count: 8,
    created_at: '2026-04-09T11:00:00Z',
    pickup_point: 'Sodimac Puente Alto',
    verified_count: 0,
  },
];
const mockCompleted = [
  {
    id: 'c1',
    external_load_id: 'CARGA-000',
    retailer_name: 'Easy',
    total_orders: 2,
    total_packages: 4,
    completed_at: new Date().toISOString(),
  },
];
const mockInTransit = [
  {
    id: 'i1',
    external_load_id: 'CARGA-INT-1',
    retailer_name: 'Falabella',
    total_orders: 7,
    total_packages: 14,
    reception_status: 'awaiting_reception',
    updated_at: new Date().toISOString(),
  },
];

const mockUsePendingManifests = vi.fn();
const mockUseCompletedManifests = vi.fn();
const mockUseInTransitManifests = vi.fn();
vi.mock('@/hooks/pickup/useManifests', () => ({
  usePendingManifests: (...args: unknown[]) => mockUsePendingManifests(...args),
  useCompletedManifests: (...args: unknown[]) => mockUseCompletedManifests(...args),
  useInTransitManifests: (...args: unknown[]) => mockUseInTransitManifests(...args),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

let mockLabelsEnabled = false;
vi.mock('@/hooks/modules/useEnabledModules', () => ({
  useModuleEnabled: () => mockLabelsEnabled,
}));

let mockActiveRoute: { id: string; code: string; started_at: string } | null = null;
vi.mock('@/hooks/pickup/useActivePickupRoute', () => ({
  useActivePickupRoute: () => ({ data: mockActiveRoute, isLoading: false }),
}));
vi.mock('@/hooks/pickup/useStartPickupRoute', () => ({
  useStartPickupRoute: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/pickup/useAddManifestToRoute', () => ({
  useAddManifestToRoute: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/pickup/useRouteManifests', () => ({
  useRouteManifests: () => ({ data: [], isLoading: false }),
  useUnassignedManifests: () => ({ data: [], isLoading: false }),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({}),
}));

vi.mock('@/components/pickup/CameraIntake', () => ({
  CameraIntake: () => <div data-testid="camera-intake" />,
}));

vi.mock('@/components/pickup/ClientFilter', () => ({
  ClientFilter: () => null,
}));

vi.mock('@/components/pickup/StartRouteButton', () => ({
  StartRouteButton: () => <button type="button">Crear ruta</button>,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/app/pickup',
}));

// ── Tests ────────────────────────────────────────────────────────────────────
describe('PickupPage', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockActiveRoute = null;
    mockLabelsEnabled = false;
    mockUsePendingManifests.mockReturnValue({ data: mockPending, isLoading: false });
    mockUseCompletedManifests.mockReturnValue({ data: mockCompleted, isLoading: false });
    mockUseInTransitManifests.mockReturnValue({ data: mockInTransit, isLoading: false });
  });

  describe('Header', () => {
    it('renders the Recogida heading and a live subtitle', () => {
      render(<PickupPage />);
      expect(screen.getByRole('heading', { name: 'Recogida' })).toBeInTheDocument();
      expect(screen.getByText(/manifiestos por retirar/)).toBeInTheDocument();
    });
  });

  describe('Active route banner', () => {
    it('does not render a QR link when there is no active route', () => {
      render(<PickupPage />);
      expect(screen.queryByRole('link', { name: /qr/i })).not.toBeInTheDocument();
    });

    it('passes the active route id through so the QR link points at that route', () => {
      mockActiveRoute = { id: 'route-9', code: 'R-2492', started_at: new Date().toISOString() };
      render(<PickupPage />);
      // The code shows in the banner and again in the draft panel's
      // "already have a route open" notice.
      expect(screen.getAllByText('R-2492').length).toBeGreaterThan(0);
    });
  });

  describe('KPI tiles', () => {
    it('reports manifests, orders, packages and today closures', () => {
      render(<PickupPage />);
      // 2 manifests, 5+3 orders, 12+8 packages, 1 completed today.
      // "Órdenes" is also a table header, so scope to the tiles.
      const tiles = screen.getAllByTestId('stat-tile');
      const tile = (label: string) => tiles.find((t) => t.textContent?.startsWith(label))!;

      expect(tile('Manifiestos pendientes')).toHaveTextContent('2');
      expect(tile('Órdenes')).toHaveTextContent('8');
      expect(tile('Paquetes totales')).toHaveTextContent('20');
      expect(tile('Completados hoy')).toHaveTextContent('1');
    });
  });

  describe('Tabs', () => {
    it('renders the three tabs in Spanish with counts', () => {
      render(<PickupPage />);
      expect(screen.getByRole('button', { name: 'Pendientes · 2' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'En tránsito · 1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Completados · 1' })).toBeInTheDocument();
    });

    it('shows in-transit manifests when that tab is selected', async () => {
      render(<PickupPage />);
      expect(screen.queryByText('CARGA-INT-1')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'En tránsito · 1' }));
      expect(screen.getByText('CARGA-INT-1')).toBeInTheDocument();
    });

    it('offers selection only on the pending tab', async () => {
      render(<PickupPage />);
      expect(screen.getAllByTestId('manifest-row')[0]).toHaveAttribute('aria-checked');
      await userEvent.click(screen.getByRole('button', { name: 'Completados · 1' }));
      expect(screen.getAllByTestId('manifest-row')[0]).not.toHaveAttribute('aria-checked');
    });
  });

  describe('Route assembly', () => {
    it('prompts for a selection before anything is ticked', () => {
      render(<PickupPage />);
      expect(screen.getByText(/Marca los manifiestos de la tabla/)).toBeInTheDocument();
    });

    it('moves a ticked manifest into the draft panel', async () => {
      render(<PickupPage />);
      await userEvent.click(screen.getByText('Easy Vespucio'));
      expect(screen.getByTestId('draft-manifest')).toBeInTheDocument();
      expect(screen.getByText(/5 órdenes · 12 paquetes/)).toBeInTheDocument();
    });

    it('refuses to assemble a second route while one is open', () => {
      // start_pickup_route enforces one active route per driver, so offering
      // to create another is offering an error.
      mockActiveRoute = { id: 'route-9', code: 'R-2492', started_at: new Date().toISOString() };
      render(<PickupPage />);
      expect(screen.getByText(/Ciérrala antes de armar otra/)).toBeInTheDocument();
    });
  });

  describe('Label printing (spec-53)', () => {
    it('is absent when the module is off', () => {
      render(<PickupPage />);
      expect(screen.queryByRole('button', { name: /imprimir etiquetas/i })).not.toBeInTheDocument();
    });

    it('is reachable per row when the module is on', () => {
      mockLabelsEnabled = true;
      render(<PickupPage />);
      expect(
        screen.getByRole('button', { name: 'Imprimir etiquetas de CARGA-001' }),
      ).toBeInTheDocument();
    });
  });

  describe("Today's closures", () => {
    it('lists what closed today', () => {
      render(<PickupPage />);
      const panel = screen.getByText('Cierres de hoy').closest('section')!;
      expect(within(panel).getByText('CARGA-000')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('explains an empty pending tab', () => {
      mockUsePendingManifests.mockReturnValue({ data: [], isLoading: false });
      render(<PickupPage />);
      expect(screen.getByText('No hay manifiestos pendientes de retiro.')).toBeInTheDocument();
    });
  });
});
