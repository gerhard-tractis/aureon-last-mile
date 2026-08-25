import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import DistributionPage from './page';

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
vi.mock('@/hooks/distribution/useUnmatchedComunas', () => ({
  useUnmatchedComunas: () => ({ data: mockUnmatched }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
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
    mockUseDistributionKPIs.mockReturnValue({ data: mockKpis, isLoading: false });
    mockUseDockZones.mockReturnValue({ data: mockZones });
    mockUseSectorizedByZone.mockReturnValue({ data: { z1: 42 } });
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
      expect(tile('Excepciones de andén')).toHaveTextContent('0');
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
      expect(tile('Excepciones de andén').className).toContain('bg-status-error-bg');
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

  // spec-68 Fase 2 (Decisión 1) — `useIsBelowLg` picks exactly one tree.
  // Regression guard for the bug that has already shipped twice (spec-62,
  // spec-54 3h): both headers must never mount together at 390px.
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

    it('below lg a PROCESOS DE LA NAVE row is navigable only once its route exists', () => {
      // spec-68 Fase 2 review fix (finding 1): a row whose route does not
      // exist yet renders non-navigable rather than as a Link that 404s.
      // Each later phase turns exactly one row on by supplying its href.
      // Fase 3 shipped /app/distribution/pendientes, so that row is a real
      // link now, while /consolidacion (Fase 4) and /andenes (Fase 6) stay
      // inert. Expect to move one row down here as each phase lands — that
      // churn is the point: it is what proves a row never links to a route
      // that does not exist.
      mockIsBelowLg = true;
      render(<DistributionPage />);

      expect(screen.getByRole('link', { name: /pendientes de sectorizar/i })).toHaveAttribute(
        'href',
        '/app/distribution/pendientes',
      );

      expect(screen.getByText('Consolidación')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /consolidación/i })).not.toBeInTheDocument();
      expect(screen.getByText('Andenes')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /andenes/i })).not.toBeInTheDocument();
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
