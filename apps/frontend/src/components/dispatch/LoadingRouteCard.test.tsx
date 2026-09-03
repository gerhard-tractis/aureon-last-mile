import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoadingRouteCard } from './LoadingRouteCard';
import type { LoadingMonitorRoute } from '@/hooks/dispatch/useLoadingMonitor';

const NOW = new Date('2026-09-03T12:00:00Z').getTime();

function makeRoute(overrides: Partial<LoadingMonitorRoute> = {}): LoadingMonitorRoute {
  return {
    id: 'r1',
    externalRouteId: 'DT-172',
    routeDate: '2026-09-03',
    status: 'loading',
    driverName: 'Mario González',
    vehiclePlate: 'JKPT-45',
    vehicleType: 'Furgón',
    loadPositionCode: 'POS-03',
    loadPositionLabel: 'A3 Sur Oriente',
    packagesTotal: 172,
    packagesLoaded: 148,
    firstScanAtIso: new Date(NOW - 41.5 * 60_000).toISOString(),
    lastScanAtIso: new Date(NOW - 8_000).toISOString(),
    updatedAtIso: new Date(NOW - 60_000).toISOString(),
    ...overrides,
  };
}

describe('LoadingRouteCard', () => {
  it('EN CARGA: shows freshness, progress, andén, rate, and driver/vehicle, with a Ver carga action', () => {
    const onNavigate = vi.fn();
    render(
      <LoadingRouteCard route={makeRoute()} state="loading" now={NOW} onNavigate={onNavigate} />,
    );
    expect(screen.getByText('EN CARGA')).toBeInTheDocument();
    expect(screen.getByText(/último escaneo/)).toHaveTextContent('último escaneo 8 s');
    expect(screen.getByText('148')).toBeInTheDocument();
    expect(screen.getByText(/de 172 paquetes/)).toBeInTheDocument();
    expect(screen.getByText('86 %')).toBeInTheDocument();
    expect(screen.getByText('A3 Sur Oriente')).toBeInTheDocument();
    expect(screen.getByText('214/h')).toBeInTheDocument();
    expect(screen.getByText(/Mario González/)).toHaveTextContent('Mario González · JKPT-45 · Furgón');
    fireEvent.click(screen.getByRole('button', { name: 'Ver carga' }));
    expect(onNavigate).toHaveBeenCalledWith('r1');
  });

  it('LISTA PARA DESPACHO: shows cerrada + close time, offers Despachar a DispatchTrack ONLY here', () => {
    const onNavigate = vi.fn();
    render(
      <LoadingRouteCard
        route={makeRoute({ status: 'loaded', packagesTotal: 96, packagesLoaded: 96, updatedAtIso: '2026-09-03T08:41:00Z' })}
        state="ready"
        now={NOW}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByText('LISTA PARA DESPACHO')).toBeInTheDocument();
    expect(screen.getByText('cerrada')).toBeInTheDocument();
    // Local-timezone rendering, like RouteListTile's formatCreationTime —
    // compute the expected string the same way rather than assume UTC.
    const expectedCloseTime = new Date('2026-09-03T08:41:00Z')
      .toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
    expect(screen.getByText(/Cerró/)).toHaveTextContent(`Cerró ${expectedCloseTime}`);
    const dispatchButton = screen.getByRole('button', { name: 'Despachar a DispatchTrack' });
    fireEvent.click(dispatchButton);
    expect(onNavigate).toHaveBeenCalledWith('r1');
  });

  it('does NOT offer Despachar a DispatchTrack on a loading (EN CARGA) route', () => {
    render(<LoadingRouteCard route={makeRoute()} state="loading" now={NOW} onNavigate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Despachar a DispatchTrack' })).not.toBeInTheDocument();
  });

  it('DETENIDA: names the consequence and shows staleness, not a live freshness figure', () => {
    render(
      <LoadingRouteCard
        route={makeRoute({
          packagesTotal: 130,
          packagesLoaded: 41,
          lastScanAtIso: new Date(NOW - 14 * 60_000).toISOString(),
        })}
        state="stalled"
        now={NOW}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText('DETENIDA')).toBeInTheDocument();
    expect(screen.getByText(/sin escaneos/)).toHaveTextContent('sin escaneos 14 min');
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText(/de 130/)).toBeInTheDocument();
    expect(screen.getByText('32 %')).toBeInTheDocument();
    expect(
      screen.getByText(/La cuadrilla dejó de escanear\. Nadie cerró la ruta y quedan 89 paquetes en el andén\./),
    ).toBeInTheDocument();
  });

  it('BORRADOR: shows 0/N and Sin vehículo asignado, with an Asignar cuadrilla y vehículo action', () => {
    const onNavigate = vi.fn();
    render(
      <LoadingRouteCard
        route={makeRoute({
          status: 'draft', packagesTotal: 71, packagesLoaded: 0, driverName: null,
          vehiclePlate: null, vehicleType: null, loadPositionLabel: null, loadPositionCode: null,
          firstScanAtIso: null, lastScanAtIso: null,
        })}
        state="draft"
        now={NOW}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByText('BORRADOR')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText(/de 71 paquetes/)).toBeInTheDocument();
    expect(screen.getByText('Sin vehículo asignado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Asignar cuadrilla y vehículo' }));
    expect(onNavigate).toHaveBeenCalledWith('r1');
  });

  it('renders no rate figure when there is not yet enough elapsed loading time (rule 3: no invented figures)', () => {
    render(
      <LoadingRouteCard
        route={makeRoute({ firstScanAtIso: new Date(NOW - 30_000).toISOString() })}
        state="loading"
        now={NOW}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.queryByText(/\/h$/)).not.toBeInTheDocument();
  });

  it('keeps showing the route date on the card, like the RouteListTile it replaces (rule 10)', () => {
    render(<LoadingRouteCard route={makeRoute({ routeDate: '2026-09-03' })} state="loading" now={NOW} onNavigate={vi.fn()} />);
    const expected = new Date('2026-09-03T00:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('renders no andén when the route has none assigned', () => {
    render(
      <LoadingRouteCard
        route={makeRoute({ loadPositionLabel: null, loadPositionCode: null })}
        state="loading"
        now={NOW}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.queryByText('A3 Sur Oriente')).not.toBeInTheDocument();
  });

  it('offers delete only for a draft/planned underlying status, never for loading/loaded', () => {
    const onDelete = vi.fn();
    const { rerender } = render(
      <LoadingRouteCard route={makeRoute({ status: 'draft' })} state="draft" now={NOW} onNavigate={vi.fn()} onDelete={onDelete} />,
    );
    expect(screen.getByLabelText('Eliminar ruta')).toBeInTheDocument();

    rerender(
      <LoadingRouteCard route={makeRoute({ status: 'loading' })} state="loading" now={NOW} onNavigate={vi.fn()} onDelete={onDelete} />,
    );
    expect(screen.queryByLabelText('Eliminar ruta')).not.toBeInTheDocument();
  });

  it('clicking the action button does not ALSO fire the card body click (rule 6)', () => {
    const onNavigate = vi.fn();
    render(<LoadingRouteCard route={makeRoute()} state="loading" now={NOW} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver carga' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('clicking the card body (not a button) also navigates', () => {
    const onNavigate = vi.fn();
    render(<LoadingRouteCard route={makeRoute()} state="loading" now={NOW} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('loading-route-card-r1'));
    expect(onNavigate).toHaveBeenCalledWith('r1');
  });

  it('Enter on the card body navigates once', () => {
    const onNavigate = vi.fn();
    render(<LoadingRouteCard route={makeRoute()} state="loading" now={NOW} onNavigate={onNavigate} />);
    fireEvent.keyDown(screen.getByTestId('loading-route-card-r1'), { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('Enter on a nested button does not ALSO trigger the card body navigation (rule 5 guard)', () => {
    const onNavigate = vi.fn();
    render(<LoadingRouteCard route={makeRoute()} state="loading" now={NOW} onNavigate={onNavigate} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Ver carga' }), { key: 'Enter', bubbles: true });
    // The button's own Enter handling (native or none) is not this
    // component's concern; what matters is the card-level handler did not
    // ALSO fire from the bubbled event.
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
