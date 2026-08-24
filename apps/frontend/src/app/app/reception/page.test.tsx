import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReceptionPage from './page';

const onTheRoad = [
  { id: 'r0', code: 'PR-2026-0002', driver_id: 'd0', driver_name: 'Luis Soto',
    plate: null, in_transit_at: null, started_at: '2026-06-25T06:00:00Z',
    manifest_count: 3, expected_packages: 21 },
];
const inYard = [
  { id: 'r1', code: 'PR-2026-0001', driver_id: 'd1', driver_name: 'Ana Ruiz',
    plate: 'AAA-111', in_transit_at: '2026-06-25T08:00:00Z',
    started_at: '2026-06-25T05:00:00Z',
    manifest_count: 2, expected_packages: 15 },
];
const completed = [
  { id: 'r2', code: 'PR-2026-0000', driver_id: 'd2', driver_name: 'Pedro Lopez',
    plate: null, in_transit_at: '2026-06-24T08:00:00Z',
    started_at: '2026-06-24T05:00:00Z',
    manifest_count: 1, expected_packages: 10 },
];

const mockUseIncomingRoutes = vi.fn();
let mockDiscrepancies: unknown[] = [];

vi.mock('@/hooks/reception/useIncomingRoutes', () => ({
  useIncomingRoutes: (...args: unknown[]) => mockUseIncomingRoutes(...args),
}));
vi.mock('@/hooks/reception/useOpenDiscrepancies', () => ({
  useOpenDiscrepancies: () => ({ data: mockDiscrepancies, isLoading: false }),
}));
const mockOperatorId = 'op-1';
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: mockOperatorId }),
}));
vi.mock('@/hooks/useCurrentUserName', () => ({
  useCurrentUserName: () => ({ data: 'Marcela Rojas' }),
}));
vi.mock('@/components/reception/RouteQRScannerEntry', () => ({
  RouteQRScannerEntry: () => <div data-testid="route-qr-scanner" />,
}));
vi.mock('./ReturnRouteList', () => ({
  ReturnRouteList: () => <div data-testid="return-route-list" />,
}));
vi.mock('./ReturnReceptionSession', () => ({
  ReturnReceptionSession: () => <div data-testid="return-reception-session" />,
}));
const mockRouterPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockRouterPush }) }));

const mockUseIsBelowLg = vi.fn();
vi.mock('@/hooks/useViewport', () => ({
  useIsBelowLg: () => mockUseIsBelowLg(),
}));

// Mounted transitively by ReceptionMobileView's footer
// (ReceiveWithoutQRSheet → ReceiveWithoutQRButton). Mocked exactly as in
// ReceptionMobileView's own test, so a stray call fails loudly instead of
// hitting a real Supabase client.
const mockOpenRouteReceptionMutate = vi.fn();
vi.mock('@/hooks/reception/useOpenRouteReception', () => ({
  useOpenRouteReception: () => ({ mutate: mockOpenRouteReceptionMutate, isPending: false }),
}));

/** Reads the figure out of the StatTile carrying the given label. */
function tile(label: string): HTMLElement {
  return screen
    .getAllByTestId('stat-tile')
    .find((t) => t.textContent?.startsWith(label))!;
}

describe('ReceptionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscrepancies = [];
    mockUseIsBelowLg.mockReturnValue(false);
    mockUseIncomingRoutes.mockImplementation((_op: string, status: string) => {
      if (status === 'in_progress') return { data: onTheRoad, isLoading: false };
      if (status === 'in_transit') return { data: inYard, isLoading: false };
      if (status === 'received') return { data: completed, isLoading: false };
      return { data: [], isLoading: false };
    });
  });

  describe('spec-52 lifecycle semantics', () => {
    it('treats in_transit as "in the yard" and in_progress as still driving', () => {
      // A route only reaches in_transit once its QR is scanned at the hub, so
      // in_transit is the truck standing in the yard — not one on the road.
      render(<ReceptionPage />);
      const rows = screen.getAllByTestId('arrival-row');
      expect(within(rows[0]).getByText('PR-2026-0001')).toBeInTheDocument();
      expect(within(rows[0]).getByText('EN PATIO')).toBeInTheDocument();
      expect(within(rows[1]).getByText('EN TRÁNSITO')).toBeInTheDocument();
    });

    it('lists every lifecycle state in one table', () => {
      render(<ReceptionPage />);
      expect(screen.getAllByTestId('arrival-row')).toHaveLength(3);
      expect(screen.getByText('PR-2026-0000')).toBeInTheDocument();
    });
  });

  describe('KPI tiles', () => {
    it('counts only open routes as expected today', () => {
      // The closed route has already been counted; including it double-counts.
      render(<ReceptionPage />);
      expect(tile('Rutas esperadas hoy')).toHaveTextContent('2');
      expect(tile('Rutas esperadas hoy')).toHaveTextContent('36 paq.');
    });

    it('warns on trucks waiting in the yard', () => {
      render(<ReceptionPage />);
      const yard = tile('En patio sin contar');
      expect(yard).toHaveTextContent('1');
      expect(yard.className).toContain('bg-status-warning-bg');
    });

    it('reports closures separately', () => {
      render(<ReceptionPage />);
      expect(tile('Cerradas · turno')).toHaveTextContent('1');
    });

    it('stays neutral when there are no open discrepancies', () => {
      render(<ReceptionPage />);
      const diff = tile('Diferencias abiertas');
      expect(diff).toHaveTextContent('0');
      expect(diff.className).not.toContain('bg-status-error-bg');
    });

    it('turns the discrepancy tile red when receptions closed short', () => {
      mockDiscrepancies = [
        { id: 'd1', routeCode: 'PR-2026-0000', expected: 10, received: 8, delta: 2, completedAt: null },
      ];
      render(<ReceptionPage />);
      expect(tile('Diferencias abiertas').className).toContain('bg-status-error-bg');
    });
  });

  describe('the primary action', () => {
    it('invites a QR scan as the way in', () => {
      render(<ReceptionPage />);
      expect(
        screen.getByText('Escanea el QR de la ruta para abrir el conteo'),
      ).toBeInTheDocument();
    });

    it('opens the scanner from the banner', async () => {
      render(<ReceptionPage />);
      expect(screen.queryByTestId('route-qr-scanner')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /escanear qr de ruta/i }));
      expect(screen.getByTestId('route-qr-scanner')).toBeInTheDocument();
    });

    it('offers to start counting a yard route and only to view one still driving', () => {
      render(<ReceptionPage />);
      const rows = screen.getAllByTestId('arrival-row');
      expect(within(rows[0]).getByRole('link', { name: 'Iniciar conteo' })).toHaveAttribute(
        'href',
        '/app/reception/route/r1',
      );
      expect(within(rows[1]).getByRole('link', { name: 'Ver ruta' })).toBeInTheDocument();
    });

    it('offers no action on a closed route', () => {
      render(<ReceptionPage />);
      const rows = screen.getAllByTestId('arrival-row');
      expect(within(rows[2]).queryByRole('link')).toBeNull();
    });
  });

  describe('filters', () => {
    it('narrows the table to the yard', async () => {
      render(<ReceptionPage />);
      await userEvent.click(screen.getByRole('button', { name: 'En patio 1' }));
      expect(screen.getAllByTestId('arrival-row')).toHaveLength(1);
    });
  });

  describe('returns', () => {
    it('keeps returns in their own tab, not in the arrivals table', () => {
      render(<ReceptionPage />);
      expect(screen.getByTestId('return-route-list')).toBeInTheDocument();
    });

    it('names the desktop tab Reingresos, matching the mobile eyebrow and labels.es.ts', () => {
      render(<ReceptionPage />);
      expect(screen.getByRole('tab', { name: /Reingresos/i })).toBeInTheDocument();
    });
  });

  describe('viewport branching (spec-62 task 13)', () => {
    it('below lg renders the mobile field tree, not the desktop arrivals table or StatTiles', () => {
      mockUseIsBelowLg.mockReturnValue(true);
      render(<ReceptionPage />);
      // Only the mobile tree renders this header/avatar combo.
      expect(screen.getByTestId('reception-mobile-avatar')).toBeInTheDocument();
      // The desktop-only chrome must be entirely absent.
      expect(screen.queryAllByTestId('arrival-row')).toHaveLength(0);
      expect(screen.queryAllByTestId('stat-tile')).toHaveLength(0);
      expect(screen.queryByText('Rutas esperadas hoy')).not.toBeInTheDocument();
    });

    it('at or above lg renders the desktop tree, not the mobile field header', () => {
      mockUseIsBelowLg.mockReturnValue(false);
      render(<ReceptionPage />);
      expect(screen.getAllByTestId('arrival-row').length).toBeGreaterThan(0);
      expect(screen.getAllByTestId('stat-tile').length).toBeGreaterThan(0);
      expect(screen.queryByTestId('reception-mobile-avatar')).not.toBeInTheDocument();
    });

    it('reingresos stay reachable on mobile', () => {
      // ReturnRouteList and ReturnReceptionSession hang ONLY off this page.
      // A mobile tree that does not mount them leaves reingresos
      // unreachable below 1024px — and they were only just restyled for
      // mobile (1k, #449).
      mockUseIsBelowLg.mockReturnValue(true);
      render(<ReceptionPage />);
      expect(screen.getByText(/Reingresos/i)).toBeInTheDocument();
      expect(screen.getByTestId('return-route-list')).toBeInTheDocument();
    });

    it('the QR scanner dialog opens from the mobile tree too', async () => {
      mockUseIsBelowLg.mockReturnValue(true);
      render(<ReceptionPage />);
      expect(screen.queryByTestId('route-qr-scanner')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /Escanear QR de ruta/i }));
      expect(screen.getByTestId('route-qr-scanner')).toBeInTheDocument();
    });

    it('mounts the mobile tree inside the page padding wrapper, flush to nothing', () => {
      // Regression: this branch used to return ReceptionMobileView bare,
      // escaping the `px-6 py-[22px]` wrapper the desktop branch (and
      // /app/pickup's mobile view) sit inside. On a real phone the title,
      // the avatar and every card ran into both screen edges, with the
      // avatar clipped at the right. jsdom has no layout, so the assertion
      // has to be on the wrapper itself.
      mockUseIsBelowLg.mockReturnValue(true);
      const { container } = render(<ReceptionPage />);

      const padded = screen.getByTestId('reception-mobile-avatar').closest('.px-6');
      expect(padded).not.toBeNull();
      expect(padded).toHaveClass('py-[22px]');
      // The padding must be on the OUTERMOST element, otherwise an
      // unpadded ancestor would still put content against the edge.
      expect(container.firstElementChild).toBe(padded);
    });

    it('never calls open_route_reception on mount of the mobile tree', () => {
      mockUseIsBelowLg.mockReturnValue(true);
      render(<ReceptionPage />);
      expect(mockOpenRouteReceptionMutate).not.toHaveBeenCalled();
    });
  });
});
