import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import DistributionPage from './page';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';

const today = todayISOInTimezone(new Date());

function pendingOrderGroup(id: string, comunaId: string | null) {
  return {
    orderId: id,
    orderNumber: id,
    deliveryDate: today,
    comunaName: null,
    packages: [
      {
        id: `${id}-p1`,
        label: `${id}-p1`,
        order_id: id,
        orderNumber: id,
        comunaId,
        comunaName: null,
        delivery_date: today,
        skuItems: [],
      },
    ],
  };
}

const mockKpis = { pending: 5, consolidation: 3, dueSoon: 2 };
const mockUseDistributionKPIs = vi.fn();
vi.mock('@/hooks/distribution/useDistributionKPIs', () => ({
  useDistributionKPIs: (...args: unknown[]) => mockUseDistributionKPIs(...args),
}));

const mockUseDistributionOverview = vi.fn();
vi.mock('@/hooks/distribution/useDistributionOverview', () => ({
  useDistributionOverview: (...args: unknown[]) => mockUseDistributionOverview(...args),
}));

vi.mock('@/hooks/distribution/useConsolidation', () => ({
  useConsolidation: () => ({ data: [] }),
  useReleaseFromConsolidation: () => ({ mutate: vi.fn() }),
}));

const mockZones = [
  {
    id: 'z1', name: 'Andén 1', code: 'D1', is_consolidation: false,
    comunas: [{ id: 'c1', nombre: 'Las Condes' }], is_active: true, operator_id: 'op1',
  },
];
const mockUseDockZones = vi.fn();
vi.mock('@/hooks/distribution/useDockZones', () => ({
  useDockZones: (...args: unknown[]) => mockUseDockZones(...args),
}));

const mockUseSectorizedByZone = vi.fn();
vi.mock('@/hooks/distribution/useSectorizedByZone', () => ({
  useSectorizedByZone: (...args: unknown[]) => mockUseSectorizedByZone(...args),
}));

let mockUnmatched: unknown[] = [];
let mockUnmatchedLoading = false;
vi.mock('@/hooks/distribution/useUnmatchedComunas', () => ({
  useUnmatchedComunas: () => ({ data: mockUnmatched, isLoading: mockUnmatchedLoading }),
}));

const mockUsePendingSectorization = vi.fn();
vi.mock('@/hooks/distribution/usePendingSectorization', () => ({
  usePendingSectorization: (...args: unknown[]) => mockUsePendingSectorization(...args),
}));

const mockUseOpenBatchesByZone = vi.fn();
vi.mock('@/hooks/distribution/useOpenBatchesByZone', () => ({
  useOpenBatchesByZone: (...args: unknown[]) => mockUseOpenBatchesByZone(...args),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

let mockIsBelowLg = false;
vi.mock('@/hooks/useViewport', () => ({
  useIsBelowLg: () => mockIsBelowLg,
}));

vi.mock('@/hooks/useCurrentUserName', () => ({
  useCurrentUserName: () => ({ data: 'Marcela Rojas' }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

function tile(label: string): HTMLElement {
  return screen.getAllByTestId('stat-tile').find((t) => t.textContent?.startsWith(label))!;
}

describe('DistributionPage', () => {
  beforeEach(() => {
    mockIsBelowLg = false;
    mockUnmatched = [];
    mockUnmatchedLoading = false;
    mockUseDistributionKPIs.mockReturnValue({ data: mockKpis, isLoading: false });
    mockUseDockZones.mockReturnValue({ data: mockZones });
    mockUseSectorizedByZone.mockReturnValue({ data: { z1: 42 } });
    mockUsePendingSectorization.mockReturnValue({ data: [] });
    mockUseOpenBatchesByZone.mockReturnValue({ data: {} });
    mockUseDistributionOverview.mockReturnValue({
      data: {
        open_batches: 5,
        last_closed_at: '2026-08-17T14:40:00Z',
        sorted_today: 15,
        pace_per_hour: 214,
        operators: [
          { user_id: 'u1', name: 'J. Núñez', scans: 96, last_scan_at: '2026-08-17T15:41:00Z', zone_code: 'A3' },
        ],
      },
      isLoading: false,
    });
  });

  describe('header', () => {
    it('summarises andenes and open lotes', () => {
      render(<DistributionPage />);
      expect(screen.getByRole('heading', { name: 'Distribución' })).toBeInTheDocument();
      expect(screen.getByText(/lotes abiertos/)).toBeInTheDocument();
    });

    it('leads with Modo rápido — that is where the shift is spent', () => {
      render(<DistributionPage />);
      const link = screen.getByRole('link', { name: /entrar en modo rápido/i });
      expect(link).toHaveAttribute('href', '/app/distribution/quicksort');
    });
  });

  describe('KPI tiles', () => {
    it('reports pending, sorted, pace and exceptions', () => {
      render(<DistributionPage />);
      expect(tile('Por clasificar')).toHaveTextContent('5');
      expect(tile('Clasificados hoy')).toHaveTextContent('15');
      expect(tile('Ritmo')).toHaveTextContent('214');
      expect(tile('Comunas no reconocidas')).toHaveTextContent('0');
    });

    it('computes the sorted percentage against everything the shift touched', () => {
      // 15 sorted of 20 touched (15 + 5 pending) = 75%.
      render(<DistributionPage />);
      expect(tile('Clasificados hoy')).toHaveTextContent('75 %');
    });

    it('omits the percentage rather than dividing by zero on an idle shift', () => {
      mockUseDistributionKPIs.mockReturnValue({ data: { ...mockKpis, pending: 0 }, isLoading: false });
      mockUseDistributionOverview.mockReturnValue({
        data: { open_batches: 0, last_closed_at: null, sorted_today: 0, pace_per_hour: 0, operators: [] },
        isLoading: false,
      });
      render(<DistributionPage />);
      expect(tile('Clasificados hoy')).not.toHaveTextContent('%');
    });

    it('turns exceptions red when comunas have no zone', () => {
      mockUnmatched = [{ comuna_raw: 'Colina', order_count: 3 }];
      render(<DistributionPage />);
      expect(tile('Comunas no reconocidas').className).toContain('bg-status-error-bg');
    });
  });

  describe('andenes de salida', () => {
    it('renders a tile per active zone with its sorted count', () => {
      render(<DistributionPage />);
      const dock = screen.getByTestId('outbound-dock');
      expect(within(dock).getByText('D1')).toBeInTheDocument();
      expect(within(dock).getByText('42')).toBeInTheDocument();
    });

    it('shows an empty state when no zones are configured', () => {
      mockUseDockZones.mockReturnValue({ data: [] });
      render(<DistributionPage />);
      expect(screen.getByText('Sin andenes configurados')).toBeInTheDocument();
    });

    it('passes the real per-zone open-lote count through to the chip (active)', () => {
      mockUseOpenBatchesByZone.mockReturnValue({ data: { z1: 1 } });
      render(<DistributionPage />);
      const dock = screen.getByTestId('outbound-dock');
      expect(within(dock).getByTestId('outbound-dock-chip').dataset.state).toBe('active');
    });

    it('shows the unopened chip state when the zone has no open lote', () => {
      mockUseOpenBatchesByZone.mockReturnValue({ data: {} });
      render(<DistributionPage />);
      const dock = screen.getByTestId('outbound-dock');
      expect(within(dock).getByTestId('outbound-dock-chip').dataset.state).toBe('unopened');
    });
  });

  describe('operarios activos', () => {
    it('lists who is scanning and where', () => {
      render(<DistributionPage />);
      const row = screen.getByTestId('active-sorter');
      expect(within(row).getByText(/J. Núñez · andén A3/)).toBeInTheDocument();
      expect(within(row).getByText(/96 escaneos/)).toBeInTheDocument();
    });

    it('says so plainly when nobody is on the floor', () => {
      mockUseDistributionOverview.mockReturnValue({
        data: { open_batches: 0, last_closed_at: null, sorted_today: 0, pace_per_hour: 0, operators: [] },
        isLoading: false,
      });
      render(<DistributionPage />);
      expect(screen.getByText('Nadie está escaneando en este momento.')).toBeInTheDocument();
    });
  });

  // Review fix — both incident counts are order-level now. `unmatched`
  // used to feed the panel as `.length` (distinct comuna strings), while
  // `noDockCount` was always orders — two different units in one total.
  // `4a` draws the incidents badge and the StatTile with the same "9",
  // which only happens if the whole surface counts orders. The StatTile
  // itself is untouched (fase 4's own note says it's already correct);
  // only the incidents panel's feed changes.
  describe('incidencias de sectorización', () => {
    function withConsolidationZoneAndPending() {
      mockUseDockZones.mockReturnValue({
        data: [
          ...mockZones,
          {
            id: 'consol',
            name: 'Consolidación',
            code: 'CONSOL',
            is_consolidation: true,
            comunas: [],
            is_active: true,
            operator_id: 'op1',
          },
        ],
      });
      mockUsePendingSectorization.mockReturnValue({
        data: [
          {
            zone: { id: 'consol', is_consolidation: true },
            matchResult: { zone_id: 'consol', zone_name: 'Consolidación', zone_code: 'CONSOL', is_consolidation: true, reason: 'unmapped', flagged: true },
            orders: [
              pendingOrderGroup('o1', 'c-unmapped'),
              pendingOrderGroup('o2', 'c-unmapped-2'),
            ],
          },
        ],
      });
    }

    it('sources unrecognised-comuna and no-dock counts independently — they never share a number', () => {
      mockUnmatched = [{ comuna_raw: 'Colina', order_count: 3 }];
      withConsolidationZoneAndPending();
      render(<DistributionPage />);
      const unmatchedRow = screen.getByTestId('incident-unmatched-comuna');
      const noDockRow = screen.getByTestId('incident-no-dock');
      // 3 orders behind the one unmatched comuna string, not 1 (the
      // string count) — order-level throughout, matching noDockCount's 2.
      expect(within(unmatchedRow).getByText('3')).toBeInTheDocument();
      expect(within(noDockRow).getByText('2')).toBeInTheDocument();
    });

    it('sums order_count across multiple unmatched comuna strings, rather than counting the strings', () => {
      mockUnmatched = [
        { comuna_raw: 'Colina', order_count: 3 },
        { comuna_raw: 'Til Til', order_count: 1 },
      ];
      render(<DistributionPage />);
      expect(within(screen.getByTestId('incident-unmatched-comuna')).getByText('4')).toBeInTheDocument();
    });

    it('omits the wrong-dock row even while the panel is in its rows branch', () => {
      // Guard against `wrongDockCount={0}` at the call site: with every
      // fixture at 0 the panel takes its empty-state branch and no row
      // renders for ANY type, wrong-dock included — for the wrong reason.
      // Non-zero fixtures put the panel in its rows branch first.
      mockUnmatched = [{ comuna_raw: 'Colina', order_count: 3 }];
      withConsolidationZoneAndPending();
      render(<DistributionPage />);
      expect(screen.getByTestId('incident-unmatched-comuna')).toBeInTheDocument();
      expect(screen.getByTestId('incident-no-dock')).toBeInTheDocument();
      expect(screen.queryByTestId('incident-wrong-dock')).toBeNull();
    });

    it('shows the incidents panel loading state while unmatched comunas are still resolving', () => {
      mockUnmatchedLoading = true;
      render(<DistributionPage />);
      expect(screen.getByTestId('incident-panel-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('incident-panel-empty')).toBeNull();
    });
  });

  describe('mobile tree (useIsBelowLg)', () => {
    it('above lg (desktop) renders the desktop header and KPI grid, never the mobile greeting', () => {
      mockIsBelowLg = false;
      render(<DistributionPage />);
      expect(screen.getByRole('heading', { name: 'Distribución' })).toBeInTheDocument();
      expect(screen.getByTestId('outbound-dock')).toBeInTheDocument();
      expect(screen.queryByText('Hola, Marcela')).not.toBeInTheDocument();
      expect(screen.queryByText('TU TAREA AHORA')).not.toBeInTheDocument();
    });

    it('below lg renders the mobile greeting and never the desktop header or panels', () => {
      mockIsBelowLg = true;
      render(<DistributionPage />);
      expect(screen.getByText('Hola, Marcela')).toBeInTheDocument();
      expect(screen.getByText('TU TAREA AHORA')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Distribución' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('outbound-dock')).not.toBeInTheDocument();
      expect(screen.queryByText('Andenes de salida')).not.toBeInTheDocument();
      expect(screen.queryByText('Sin paquetes en consolidación')).not.toBeInTheDocument();
    });

    it('below lg, all three PROCESOS DE LA NAVE rows are live links', () => {
      // spec-68 Fase 2 review fix (finding 1) introduced a row that renders
      // non-navigable rather than as a Link that 404s, for whichever
      // process route hadn't shipped yet. Fase 3 (/pendientes), Fase 4
      // (/consolidacion) and now Fase 6 (/andenes) each turned on exactly
      // one row in turn — this is the final state, with the "still inert"
      // group empty: every row is a real link, none render
      // `aria-disabled`.
      mockIsBelowLg = true;
      render(<DistributionPage />);

      expect(screen.getByRole('link', { name: /pendientes de sectorizar/i })).toHaveAttribute(
        'href',
        '/app/distribution/pendientes',
      );

      expect(screen.getByRole('link', { name: /consolidación/i })).toHaveAttribute(
        'href',
        '/app/distribution/consolidacion',
      );

      expect(screen.getByRole('link', { name: /andenes/i })).toHaveAttribute(
        'href',
        '/app/distribution/andenes',
      );
    });

    // spec-68 review fix (finding 2) — page.tsx used to return the DESKTOP
    // skeleton before the isBelowLg branch, so DistributionMobileView's own
    // loading state (and its distribution-mobile-hero-skeleton testid) was
    // unreachable in the real app: a loading phone showed desktop skeleton
    // bars instead. This test fails against the old ordering because
    // isBelowLg was checked AFTER the `!operatorId || kpisLoading` early
    // return.
    it('below lg, while loading, shows the mobile skeleton — not the desktop one', () => {
      mockIsBelowLg = true;
      mockUseDistributionKPIs.mockReturnValue({ data: undefined, isLoading: true });
      render(<DistributionPage />);
      expect(screen.getByTestId('distribution-mobile-hero-skeleton')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Distribución' })).not.toBeInTheDocument();
    });

    it('above lg, while loading, still shows the desktop skeleton', () => {
      mockIsBelowLg = false;
      mockUseDistributionKPIs.mockReturnValue({ data: undefined, isLoading: true });
      render(<DistributionPage />);
      expect(screen.queryByTestId('distribution-mobile-hero-skeleton')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Distribución' })).not.toBeInTheDocument();
    });
  });
});
