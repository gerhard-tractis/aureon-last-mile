import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchEnRutaTab } from './DispatchEnRutaTab';
import type { EnRutaSnapshot } from '@/hooks/dispatch/useEnRutaSnapshot';

const mockUseEnRutaSnapshot = vi.fn();
vi.mock('@/hooks/dispatch/useEnRutaSnapshot', () => ({
  useEnRutaSnapshot: (...args: unknown[]) => mockUseEnRutaSnapshot(...args),
}));

function snapshot(overrides: Partial<EnRutaSnapshot> = {}): EnRutaSnapshot {
  return {
    enRuta: [
      {
        id: 'r1', externalRouteId: 'RUT-1', driverName: 'Mario', truckIdentifier: 'ZALDUENDO',
        status: 'in_transit', routeDate: '2026-09-04', comunas: ['Puente Alto'], paradasTotal: 24, paradasCompletadas: 13,
        fallidas: 2, lastEventAt: '2026-09-04T12:19:00Z',
      },
    ],
    completadasHoy: [
      {
        id: 'r2', externalRouteId: 'RUT-2', driverName: 'Ana', truckIdentifier: 'CAMION-2',
        status: 'completed', routeDate: '2026-09-04', comunas: ['La Florida'], paradasTotal: 10, paradasCompletadas: 10,
        fallidas: 0, lastEventAt: '2026-09-04T11:00:00Z',
      },
    ],
    completadasSemana: [],
    metrics: { entregadas: 184, pendientes: 71, fallidas: 13, otifPct: 94.2 },
    fallidasSinReingreso: 2,
    ...overrides,
  };
}

describe('DispatchEnRutaTab', () => {
  it('renders a skeleton while loading', () => {
    mockUseEnRutaSnapshot.mockReturnValue({ data: undefined, isLoading: true });
    render(<DispatchEnRutaTab operatorId="op-1" />);
    expect(screen.getByTestId('route-skeleton')).toBeInTheDocument();
  });

  it('renders the header count line from real route/paradas totals', () => {
    mockUseEnRutaSnapshot.mockReturnValue({ data: snapshot(), isLoading: false });
    render(<DispatchEnRutaTab operatorId="op-1" />);
    // 1 on-road route, 24 paradas (the route's own dispatch count — never
    // routes.planned_stops) — no fabricated "cierre estimado" or
    // "DT SINCRONIZADO" figure anywhere.
    expect(screen.getByText(/1 ruta.*24 paradas/)).toBeInTheDocument();
    expect(screen.queryByText(/cierre estimado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/SINCRONIZADO/i)).not.toBeInTheDocument();
  });

  it('renders the metrics row', () => {
    mockUseEnRutaSnapshot.mockReturnValue({ data: snapshot(), isLoading: false });
    render(<DispatchEnRutaTab operatorId="op-1" />);
    expect(screen.getByText('184')).toBeInTheDocument();
  });

  it('renders "completadas hoy" (not the week) in the foot section and footer count', () => {
    mockUseEnRutaSnapshot.mockReturnValue({
      data: snapshot({ completadasHoy: [], completadasSemana: [{ id: 'old' } as never] }),
      isLoading: false,
    });
    render(<DispatchEnRutaTab operatorId="op-1" />);
    expect(screen.getByText(/0 completadas/)).toBeInTheDocument();
  });

  it('renders the footer summary with real counts, and a reingresos link when there are any', () => {
    mockUseEnRutaSnapshot.mockReturnValue({ data: snapshot(), isLoading: false });
    render(<DispatchEnRutaTab operatorId="op-1" />);
    expect(screen.getByText(/1 en ruta/)).toBeInTheDocument();
    expect(screen.getByText(/1 completadas/)).toBeInTheDocument();
    expect(screen.getByText(/2 fallidas sin reingreso registrado/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ver reingresos pendientes/i })).toHaveAttribute(
      'href',
      '/app/orders?vista=reingresos',
    );
  });

  it('omits the reingresos link when there are none pending', () => {
    mockUseEnRutaSnapshot.mockReturnValue({ data: snapshot({ fallidasSinReingreso: 0 }), isLoading: false });
    render(<DispatchEnRutaTab operatorId="op-1" />);
    expect(screen.queryByRole('link', { name: /ver reingresos pendientes/i })).not.toBeInTheDocument();
  });
});
