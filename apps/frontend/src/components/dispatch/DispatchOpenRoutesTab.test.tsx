import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { LoadingMonitorData, LoadingMonitorRoute } from '@/hooks/dispatch/useLoadingMonitor';

const mockUseLoadingMonitor = vi.fn();
vi.mock('@/hooks/dispatch/useLoadingMonitor', () => ({
  useLoadingMonitor: (...args: unknown[]) => mockUseLoadingMonitor(...args),
}));

const mockUseNowTick = vi.fn();
vi.mock('@/hooks/dispatch/useNowTick', () => ({
  useNowTick: (...args: unknown[]) => mockUseNowTick(...args),
}));

vi.mock('./LoadingRouteCard', () => ({
  LoadingRouteCard: ({ route, state, onNavigate, onDelete }: {
    route: LoadingMonitorRoute; state: string; onNavigate: (id: string) => void; onDelete?: (id: string) => void;
  }) => (
    <div data-testid={`card-${route.id}`} data-state={state}>
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
    driverName: 'Mario González', vehiclePlate: 'JKPT-45', vehicleType: 'Furgón',
    loadPositionCode: 'POS-03', loadPositionLabel: 'A3',
    packagesTotal: 172, packagesLoaded: 148,
    firstScanAtIso: new Date(NOW - 40 * 60_000).toISOString(),
    lastScanAtIso: new Date(NOW - 8_000).toISOString(),
    updatedAtIso: new Date(NOW - 60_000).toISOString(),
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

  it('renders the header title, paquetes-en-andén line, and cuadrillas counter', () => {
    mockUseLoadingMonitor.mockReturnValue({
      data: makeData({
        routes: [makeRoute()],
        packagesWaitingOnDock: 418,
        crew: [{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }] as unknown as LoadingMonitorData['crew'],
      }),
      isLoading: false,
    });
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Rutas en carga')).toBeInTheDocument();
    expect(screen.getByText(/418 paquetes en andén esperando/)).toBeInTheDocument();
    expect(screen.getByText(/CUADRILLAS/)).toHaveTextContent('CUADRILLAS 3');
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
    const crew = [{ userId: 'u1' }] as unknown as LoadingMonitorData['crew'];
    mockUseLoadingMonitor.mockReturnValue({ data: makeData({ routes: [makeRoute()], crew }), isLoading: false });
    render(<DispatchOpenRoutesTab operatorId="op-1" onNewRoute={vi.fn()} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTestId('crew-panel')).toHaveTextContent('1 crew');
  });
});
