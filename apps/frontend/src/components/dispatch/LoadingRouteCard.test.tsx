import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LoadingRouteCard } from './LoadingRouteCard';
import type { LoadingMonitorRoute, CrewMember } from '@/hooks/dispatch/useLoadingMonitor';

vi.mock('./ScanFreshness', () => ({
  ScanFreshness: ({ lastScanAtIso, stalled }: { lastScanAtIso: string; stalled: boolean }) => (
    <p data-testid="scan-freshness" data-last-scan={lastScanAtIso} data-stalled={String(stalled)} />
  ),
}));

const NOW = new Date('2026-09-03T12:00:00Z').getTime();
const TODAY = '2026-09-03';

function makeRoute(overrides: Partial<LoadingMonitorRoute> = {}): LoadingMonitorRoute {
  return {
    id: 'r1',
    externalRouteId: 'DT-172',
    routeDate: TODAY,
    status: 'loading',
    loadPositionCode: 'POS-03',
    loadPositionLabel: 'A3 Sur Oriente',
    packagesTotal: 172,
    packagesLoaded: 148,
    firstScanAtIso: new Date(NOW - 41.5 * 60_000).toISOString(),
    lastScanAtIso: new Date(NOW - 8_000).toISOString(),
    ...overrides,
  };
}

function makeCrewMember(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    userId: 'u1',
    fullName: 'Ana Soto',
    routeId: 'r1',
    loadPositionLabel: 'A3 Sur Oriente',
    scanCount: 24,
    firstScanAtIso: new Date(NOW - 40 * 60_000).toISOString(),
    lastScanAtIso: new Date(NOW - 8_000).toISOString(),
    ...overrides,
  };
}

describe('LoadingRouteCard', () => {
  it('EN CARGA: shows scan freshness, progress, andén, rate, and a Ver carga action', () => {
    const onNavigate = vi.fn();
    render(<LoadingRouteCard route={makeRoute()} state="loading" now={NOW} today={TODAY} crew={[]} onNavigate={onNavigate} />);
    expect(screen.getByText('EN CARGA')).toBeInTheDocument();
    const freshness = screen.getByTestId('scan-freshness');
    expect(freshness).toHaveAttribute('data-stalled', 'false');
    expect(screen.getByText('148')).toBeInTheDocument();
    expect(screen.getByText(/de 172 paquetes/)).toBeInTheDocument();
    expect(screen.getByText('86 %')).toBeInTheDocument();
    expect(screen.getByText('A3 Sur Oriente')).toBeInTheDocument();
    expect(screen.getByText('214/h')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver carga' }));
    expect(onNavigate).toHaveBeenCalledWith('r1');
  });

  it('LISTA PARA DESPACHO: shows cerrada with NO close time (C1 — no reliable timestamp exists), offers Despachar a DispatchTrack ONLY here', () => {
    const onNavigate = vi.fn();
    render(
      <LoadingRouteCard
        route={makeRoute({ status: 'loaded', packagesTotal: 96, packagesLoaded: 96 })}
        state="ready"
        now={NOW}
        today={TODAY}
        crew={[]}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByText('LISTA PARA DESPACHO')).toBeInTheDocument();
    expect(screen.getByText('cerrada')).toBeInTheDocument();
    expect(screen.queryByText(/Cerró/)).not.toBeInTheDocument();
    const dispatchButton = screen.getByRole('button', { name: /Despachar a DispatchTrack/ });
    fireEvent.click(dispatchButton);
    expect(onNavigate).toHaveBeenCalledWith('r1');
  });

  it('does NOT offer Despachar a DispatchTrack on a loading (EN CARGA) route', () => {
    render(<LoadingRouteCard route={makeRoute()} state="loading" now={NOW} today={TODAY} crew={[]} onNavigate={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Despachar a DispatchTrack/ })).not.toBeInTheDocument();
  });

  it('DETENIDA: names the consequence with no guillemets, and shows the ScanFreshness component in stalled mode', () => {
    render(
      <LoadingRouteCard
        route={makeRoute({ packagesTotal: 130, packagesLoaded: 41 })}
        state="stalled"
        now={NOW}
        today={TODAY}
        crew={[]}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText('DETENIDA')).toBeInTheDocument();
    expect(screen.getByTestId('scan-freshness')).toHaveAttribute('data-stalled', 'true');
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText(/de 130/)).toBeInTheDocument();
    expect(screen.getByText('32 %')).toBeInTheDocument();
    const consequence = screen.getByText(/La cuadrilla dejó de escanear/);
    expect(consequence).toHaveTextContent('La cuadrilla dejó de escanear. Nadie cerró la ruta y quedan 89 paquetes en el andén.');
    expect(consequence.textContent).not.toMatch(/[«»]/);
  });

  it('BORRADOR: shows 0/N and Sin vehículo asignado, with an Asignar cuadrilla y vehículo action', () => {
    const onNavigate = vi.fn();
    render(
      <LoadingRouteCard
        route={makeRoute({
          status: 'draft', packagesTotal: 71, packagesLoaded: 0,
          loadPositionLabel: null, loadPositionCode: null, firstScanAtIso: null, lastScanAtIso: null,
        })}
        state="draft"
        now={NOW}
        today={TODAY}
        crew={[]}
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

  it('shortens a placeholder "draft_…" external id to a short uppercase id instead of the raw slug', () => {
    render(
      <LoadingRouteCard
        route={makeRoute({ status: 'draft', externalRouteId: 'draft_3f9c8e21', id: 'draft_3f9c8e21-aaaa-bbbb-cccc-000000000000' })}
        state="draft"
        now={NOW}
        today={TODAY}
        crew={[]}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.queryByText('draft_3f9c8e21')).not.toBeInTheDocument();
    expect(screen.getByText('DRAFT_3F')).toBeInTheDocument();
  });

  it('renders no rate figure when there is not yet enough elapsed loading time (rule 3: no invented figures)', () => {
    render(
      <LoadingRouteCard
        route={makeRoute({ firstScanAtIso: new Date(NOW - 30_000).toISOString() })}
        state="loading"
        now={NOW}
        today={TODAY}
        crew={[]}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.queryByText(/\/h$/)).not.toBeInTheDocument();
  });

  it('renders the andén code as a fallback when label is null (I5 minor — consistent with the crew panel)', () => {
    render(
      <LoadingRouteCard
        route={makeRoute({ loadPositionLabel: null, loadPositionCode: 'POS-03' })}
        state="loading"
        now={NOW}
        today={TODAY}
        crew={[]}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText('POS-03')).toBeInTheDocument();
  });

  it('renders no andén at all when the route has neither label nor code', () => {
    render(
      <LoadingRouteCard
        route={makeRoute({ loadPositionLabel: null, loadPositionCode: null })}
        state="loading"
        now={NOW}
        today={TODAY}
        crew={[]}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.queryByText('A3 Sur Oriente')).not.toBeInTheDocument();
    expect(screen.queryByText('POS-03')).not.toBeInTheDocument();
  });

  it('M1: renders the crew scanning on this route, by name', () => {
    render(
      <LoadingRouteCard
        route={makeRoute()}
        state="loading"
        now={NOW}
        today={TODAY}
        crew={[makeCrewMember({ fullName: 'Ana Soto' }), makeCrewMember({ userId: 'u2', fullName: 'Pedro Ruiz' })]}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText(/Ana Soto/)).toBeInTheDocument();
    expect(screen.getByText(/Pedro Ruiz/)).toBeInTheDocument();
  });

  it('I2: shows an amber "Atrasada" chip when the route is overdue, independent of stalled/loading state', () => {
    render(
      <LoadingRouteCard route={makeRoute({ routeDate: '2026-09-01' })} state="loading" now={NOW} today={TODAY} crew={[]} onNavigate={vi.fn()} />,
    );
    expect(screen.getByText('Atrasada')).toBeInTheDocument();
  });

  it('I2: does not show Atrasada for a route dated today', () => {
    render(<LoadingRouteCard route={makeRoute({ routeDate: TODAY })} state="loading" now={NOW} today={TODAY} crew={[]} onNavigate={vi.fn()} />);
    expect(screen.queryByText('Atrasada')).not.toBeInTheDocument();
  });

  it('I2: a stalled AND overdue route shows both signals — they compose, not override', () => {
    render(
      <LoadingRouteCard
        route={makeRoute({ routeDate: '2026-09-01', packagesLoaded: 41, packagesTotal: 130 })}
        state="stalled"
        now={NOW}
        today={TODAY}
        crew={[]}
        onNavigate={vi.fn()}
      />,
    );
    expect(screen.getByText('DETENIDA')).toBeInTheDocument();
    expect(screen.getByText('Atrasada')).toBeInTheDocument();
  });

  it('offers delete only for a draft/planned underlying status, never for loading/loaded', () => {
    const onDelete = vi.fn();
    const { rerender } = render(
      <LoadingRouteCard route={makeRoute({ status: 'draft' })} state="draft" now={NOW} today={TODAY} crew={[]} onNavigate={vi.fn()} onDelete={onDelete} />,
    );
    expect(screen.getByLabelText('Eliminar ruta')).toBeInTheDocument();

    rerender(
      <LoadingRouteCard route={makeRoute({ status: 'loading' })} state="loading" now={NOW} today={TODAY} crew={[]} onNavigate={vi.fn()} onDelete={onDelete} />,
    );
    expect(screen.queryByLabelText('Eliminar ruta')).not.toBeInTheDocument();
  });

  it('C2: the card is NOT exposed as a button — only the real action/delete buttons carry button semantics', () => {
    render(
      <LoadingRouteCard route={makeRoute({ status: 'draft' })} state="draft" now={NOW} today={TODAY} crew={[]} onNavigate={vi.fn()} onDelete={vi.fn()} />,
    );
    const card = screen.getByTestId('loading-route-card-r1');
    expect(card).not.toHaveAttribute('role');
    expect(card).not.toHaveAttribute('tabindex');
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2); // delete trigger + Asignar cuadrilla y vehículo
  });

  it('clicking the action button does not ALSO fire the card body click (rule 6)', () => {
    const onNavigate = vi.fn();
    render(<LoadingRouteCard route={makeRoute()} state="loading" now={NOW} today={TODAY} crew={[]} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver carga' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('opening the delete confirmation dialog does not ALSO navigate the card', () => {
    const onNavigate = vi.fn();
    render(
      <LoadingRouteCard route={makeRoute({ status: 'draft' })} state="draft" now={NOW} today={TODAY} crew={[]} onNavigate={onNavigate} onDelete={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText('Eliminar ruta'));
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('clicking the card body (not a button) also navigates — mouse convenience only, per C2', () => {
    const onNavigate = vi.fn();
    render(<LoadingRouteCard route={makeRoute()} state="loading" now={NOW} today={TODAY} crew={[]} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('loading-route-card-r1'));
    expect(onNavigate).toHaveBeenCalledWith('r1');
  });

  it('keeps showing the route date on the card, like the RouteListTile it replaces (rule 10)', () => {
    render(<LoadingRouteCard route={makeRoute({ routeDate: '2026-09-03' })} state="loading" now={NOW} today={TODAY} crew={[]} onNavigate={vi.fn()} />);
    const expected = new Date('2026-09-03T00:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
