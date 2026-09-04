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
    completadas: [
      {
        id: 'r2', externalRouteId: 'RUT-2', driverName: 'Ana', truckIdentifier: 'CAMION-2',
        status: 'completed', comunas: ['La Florida'], paradasTotal: 10, paradasCompletadas: 10,
        fallidas: 0, lastEventAt: '2026-09-04T11:00:00Z',
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

  it('renders the same EnRutaTable, filtered to only the completed cohort — one table, not a second tree', () => {
    mockUseEnRutaSnapshot.mockReturnValue({ data: snapshot(), isLoading: false });
    render(<DispatchCompletadasTab operatorId="op-1" />);
    expect(screen.getByText('RUT-2')).toBeInTheDocument();
    // No metrics row — ENTREGADAS/PENDIENTES/FALLIDAS/OTIF belong to the
    // live "En ruta" header (they answer for the on-road cohort only).
    expect(screen.queryByText('Entregadas')).not.toBeInTheDocument();
  });

  it('renders an empty state tailored to "completadas", not the on-road copy', () => {
    mockUseEnRutaSnapshot.mockReturnValue({ data: snapshot({ completadas: [] }), isLoading: false });
    render(<DispatchCompletadasTab operatorId="op-1" />);
    expect(screen.getByText(/Sin rutas completadas hoy/i)).toBeInTheDocument();
    expect(screen.queryByText(/en camino/i)).not.toBeInTheDocument();
  });
});
