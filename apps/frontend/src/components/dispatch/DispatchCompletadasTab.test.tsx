import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DispatchCompletadasTab } from './DispatchCompletadasTab';
import type { EnRutaSnapshot } from '@/hooks/dispatch/useEnRutaSnapshot';

const mockUseEnRutaSnapshot = vi.fn();
vi.mock('@/hooks/dispatch/useEnRutaSnapshot', () => ({
  useEnRutaSnapshot: (...args: unknown[]) => mockUseEnRutaSnapshot(...args),
}));

function snapshot(overrides: Partial<EnRutaSnapshot> = {}): EnRutaSnapshot {
  return {
    enRuta: [],
    completadasHoy: [],
    completadasSemana: [
      {
        id: 'r2', externalRouteId: 'RUT-2', driverName: 'Ana', truckIdentifier: 'CAMION-2',
        status: 'completed', routeDate: '2026-08-30', comunas: ['La Florida'], paradasTotal: 10, paradasCompletadas: 10,
        fallidas: 0, lastEventAt: '2026-08-30T11:00:00Z',
      },
    ],
    metrics: { entregadas: 0, pendientes: 0, fallidas: 0, otifPct: null },
    fallidasSinReingreso: 0,
    ...overrides,
  };
}

describe('DispatchCompletadasTab', () => {
  it('renders a skeleton while loading', () => {
    mockUseEnRutaSnapshot.mockReturnValue({ data: undefined, isLoading: true });
    render(<DispatchCompletadasTab operatorId="op-1" />);
    expect(screen.getByTestId('route-skeleton')).toBeInTheDocument();
  });

  it('renders completadasSemana (last 7 days), not just today — D1', () => {
    mockUseEnRutaSnapshot.mockReturnValue({ data: snapshot(), isLoading: false });
    render(<DispatchCompletadasTab operatorId="op-1" />);
    // r2's own route_date (2026-08-30) is 5 days before "today" in the
    // fixture — it must still show here even though it's not "hoy".
    expect(screen.getByText('RUT-2')).toBeInTheDocument();
    // No metrics row — ENTREGADAS/PENDIENTES/FALLIDAS/OTIF belong to the
    // live "En ruta" header (they answer for the on-road cohort only).
    expect(screen.queryByText('Entregadas')).not.toBeInTheDocument();
  });

  it('renders an empty state tailored to "completadas", not the on-road copy', () => {
    mockUseEnRutaSnapshot.mockReturnValue({ data: snapshot({ completadasSemana: [] }), isLoading: false });
    render(<DispatchCompletadasTab operatorId="op-1" />);
    expect(screen.getByText(/Sin rutas completadas/i)).toBeInTheDocument();
    expect(screen.queryByText(/en camino/i)).not.toBeInTheDocument();
  });
});
