import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { LoadingMonitorData, LoadingMonitorRoute, CrewMember } from '@/hooks/dispatch/useLoadingMonitor';

const mockUseLoadingMonitor = vi.fn();
vi.mock('@/hooks/dispatch/useLoadingMonitor', () => ({
  useLoadingMonitor: (...args: unknown[]) => mockUseLoadingMonitor(...args),
}));

const mockUseNowTick = vi.fn();
vi.mock('@/hooks/dispatch/useNowTick', () => ({
  useNowTick: (...args: unknown[]) => mockUseNowTick(...args),
}));

// I1 review — pin "today" so the header date assertion is not itself
// dependent on the machine's real clock/timezone.
vi.mock('@/lib/utils/dateFormat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/dateFormat')>();
  return { ...actual, todayISOInTimezone: () => '2026-09-03' };
});

vi.mock('./LoadingRouteCard', () => ({
  LoadingRouteCard: ({ route, state, today, crew, onNavigate, onDelete }: {
    route: LoadingMonitorRoute; state: string; today: string; crew: CrewMember[];
    onNavigate: (id: string) => void; onDelete?: (id: string) => void;
  }) => (
    <div data-testid={`card-${route.id}`} data-state={state} data-today={today} data-crew-count={crew.length}>
      <button onClick={() => onNavigate(route.id)}>open-{route.id}</button>
      {onDelete && <button onClick={() => onDelete(route.id)}>delete-{route.id}</button>}
    </div>
  ),
}));

vi.mock('./ActiveCrewPanel', () => ({
  ActiveCrewPanel: ({ crew }: { crew: unknown[] }) => <div data-testid="crew-panel">{crew.length} crew</div>,
}));

import { DispatchOpenRoutesTab } from './DispatchOpenRoutesTab';

const NOW = new Date('2026-09-03T12:00:00Z').getTime();

function makeRoute(overrides: Partial<LoadingMonitorRoute> = {}): LoadingMonitorRoute {
  return {
    id: 'r1', externalRouteId: 'DT-1', routeDate: '2026-09-03', status: 'loading',
    loadPositionCode: 'POS-03', loadPositionLabel: 'A3',
    packagesTotal: 172, packagesLoaded: 148,
    firstScanAtIso: new Date(NOW - 40 * 60_000).toISOString(),
    lastScanAtIso: new Date(NOW - 8_000).toISOString(),
    ...overrides,
  };
}

function makeCrewMember(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    userId: 'u1', fullName: 'Ana Soto', routeId: 'r1', loadPositionLabel: 'A3',
    scanCount: 10, firstScanAtIso: new Date(NOW - 40 * 60_000).toISOString(),
    lastScanAtIso: new Date(NOW - 8_000).toISOString(),
    ...overrides,
  };
}

function makeData(overrides: Partial<LoadingMonitorData> = {}): LoadingMonitorData {
  return { routes: [], crew: [], packagesWaitingOnDock: 0, ...overrides };
}

describe('DispatchOpenRoutesTab', () => {
  beforeEach(() => {
    mockUseLoadingMonitor.mockReset();
    mockUseNowTick.mockReset();
    mockUseNowTick.mockReturnValue(NOW);
  });

  it('queries useLoadingMonitor with operatorId', () => {
    mockUseLoadingMonitor.mockReturnValue({ data: makeData(), isLoading: false });
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(mockUseLoadingMonitor).toHaveBeenCalledWith('op-1');
  });

  it('I4: ticks on a 30s cadence, not 1s — ScanFreshness owns the fast tick now', () => {
    mockUseLoadingMonitor.mockReturnValue({ data: makeData(), isLoading: false });
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(mockUseNowTick).toHaveBeenCalledWith(30_000);
  });

  it('shows the shared route skeleton while loading', () => {
    mockUseLoadingMonitor.mockReturnValue({ data: undefined, isLoading: true });
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTestId('route-skeleton')).toBeInTheDocument();
  });

  it('shows an empty state with a create-route action when there are no open routes', () => {
    mockUseLoadingMonitor.mockReturnValue({ data: makeData(), isLoading: false });
    const onNewRoute = vi.fn();
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={onNewRoute} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Sin rutas en carga')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crear ruta' }));
    expect(onNewRoute).toHaveBeenCalled();
  });

  it('renders the header title, paquetes-en-andén line, and cuadrillas counter, using the timezone-safe today (I1)', () => {
    mockUseLoadingMonitor.mockReturnValue({
      data: makeData({
        routes: [makeRoute()],
        packagesWaitingOnDock: 418,
        crew: [makeCrewMember({ userId: 'u1' }), makeCrewMember({ userId: 'u2' }), makeCrewMember({ userId: 'u3' })],
      }),
      isLoading: false,
    });
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Rutas en carga')).toBeInTheDocument();
    expect(screen.getByText(/418 paquetes en andén esperando/)).toBeInTheDocument();
    expect(screen.getByText(/CUADRILLAS/)).toHaveTextContent('CUADRILLAS 3');
    expect(screen.getByTestId('card-r1')).toHaveAttribute('data-today', '2026-09-03');
  });

  it('renders a card per route, sorted stalled-first (rule: wrong ones visible first)', () => {
    const readyRoute = makeRoute({ id: 'r-ready', status: 'loaded', packagesLoaded: 96, packagesTotal: 96 });
    const draftRoute = makeRoute({ id: 'r-draft', status: 'draft', packagesLoaded: 0, lastScanAtIso: null, firstScanAtIso: null });
    const stalledRoute = makeRoute({
      id: 'r-stalled', status: 'loading', packagesLoaded: 41, packagesTotal: 130,
      lastScanAtIso: new Date(NOW - 14 * 60_000).toISOString(),
    });
    const loadingRoute = makeRoute({ id: 'r-loading' });

    mockUseLoadingMonitor.mockReturnValue({
      data: makeData({ routes: [readyRoute, draftRoute, stalledRoute, loadingRoute] }),
      isLoading: false,
    });
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={vi.fn()} onDelete={vi.fn()} />);

    const cards = screen.getAllByTestId(/^card-/);
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual([
      'card-r-stalled', 'card-r-loading', 'card-r-ready', 'card-r-draft',
    ]);
    expect(screen.getByTestId('card-r-stalled')).toHaveAttribute('data-state', 'stalled');
    expect(screen.getByTestId('card-r-ready')).toHaveAttribute('data-state', 'ready');
    expect(screen.getByTestId('card-r-draft')).toHaveAttribute('data-state', 'draft');
    expect(screen.getByTestId('card-r-loading')).toHaveAttribute('data-state', 'loading');
  });

  it('I2: an overdue route sorts first within its own state bucket (route_date ascending tiebreak)', () => {
    const loadingToday = makeRoute({ id: 'r-today', routeDate: '2026-09-03' });
    const loadingOverdue = makeRoute({ id: 'r-overdue', routeDate: '2026-09-01' });
    mockUseLoadingMonitor.mockReturnValue({
      data: makeData({ routes: [loadingToday, loadingOverdue] }),
      isLoading: false,
    });
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    const cards = screen.getAllByTestId(/^card-/);
    expect(cards.map((c) => c.getAttribute('data-testid'))).toEqual(['card-r-overdue', 'card-r-today']);
  });

  it('M1: passes each route only the crew currently scanning ON that route', () => {
    mockUseLoadingMonitor.mockReturnValue({
      data: makeData({
        routes: [makeRoute({ id: 'r1' }), makeRoute({ id: 'r2', packagesLoaded: 0 })],
        crew: [
          makeCrewMember({ userId: 'u1', routeId: 'r1' }),
          makeCrewMember({ userId: 'u2', routeId: 'r1' }),
          makeCrewMember({ userId: 'u3', routeId: 'r2' }),
        ],
      }),
      isLoading: false,
    });
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTestId('card-r1')).toHaveAttribute('data-crew-count', '2');
    expect(screen.getByTestId('card-r2')).toHaveAttribute('data-crew-count', '1');
  });

  it('wires navigate and delete through to the cards', () => {
    mockUseLoadingMonitor.mockReturnValue({ data: makeData({ routes: [makeRoute()] }), isLoading: false });
    const onNavigate = vi.fn();
    const onDelete = vi.fn();
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={onNavigate} onDelete={onDelete} />);
    fireEvent.click(screen.getByText('open-r1'));
    expect(onNavigate).toHaveBeenCalledWith('r1');
    fireEvent.click(screen.getByText('delete-r1'));
    expect(onDelete).toHaveBeenCalledWith('r1');
  });

  it('renders the active crew panel with the fetched crew', () => {
    const crew = [makeCrewMember({ userId: 'u1' })];
    mockUseLoadingMonitor.mockReturnValue({ data: makeData({ routes: [makeRoute()], crew }), isLoading: false });
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTestId('crew-panel')).toHaveTextContent('1 crew');
  });
});
