import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EnRutaTable } from './EnRutaTable';
import type { EnRutaRoute } from '@/lib/dispatch/en-ruta';

function row(overrides: Partial<EnRutaRoute> = {}): EnRutaRoute {
  return {
    id: 'r1',
    externalRouteId: 'RUT-2026-0087',
    driverName: 'Mario González',
    truckIdentifier: 'ZALDUENDO',
    status: 'in_transit',
    comunas: ['Puente Alto', 'La Florida'],
    paradasTotal: 24,
    paradasCompletadas: 13,
    fallidas: 2,
    lastEventAt: '2026-09-04T12:19:00Z',
    ...overrides,
  };
}

describe('EnRutaTable', () => {
  it('renders one row per on-road route with its RUTA/CONDUCTOR·CAMIÓN/COMUNAS/PARADAS/FALLIDAS', () => {
    render(<EnRutaTable enRuta={[row()]} completadas={[]} />);
    expect(screen.getByText('RUT-2026-0087')).toBeInTheDocument();
    expect(screen.getByText(/Mario González/)).toBeInTheDocument();
    expect(screen.getByText(/ZALDUENDO/)).toBeInTheDocument();
    expect(screen.getByText('Puente Alto, La Florida')).toBeInTheDocument();
    expect(screen.getByText('13/24')).toBeInTheDocument();
  });

  it('renders a COMPLETADAS HOY divider with its count only when there are completed routes', () => {
    render(<EnRutaTable enRuta={[row()]} completadas={[row({ id: 'r2', status: 'completed' })]} />);
    expect(screen.getByText('COMPLETADAS HOY')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('omits the divider entirely when nothing completed today', () => {
    render(<EnRutaTable enRuta={[row()]} completadas={[]} />);
    expect(screen.queryByText('COMPLETADAS HOY')).not.toBeInTheDocument();
  });

  it('is one table, not two — completed rows share the same header/columns', () => {
    render(<EnRutaTable enRuta={[row()]} completadas={[row({ id: 'r2' })]} />);
    expect(screen.getAllByRole('table')).toHaveLength(1);
  });

  it('shows a driver-less route without crashing', () => {
    render(<EnRutaTable enRuta={[row({ driverName: null, truckIdentifier: null })]} completadas={[]} />);
    expect(screen.getByText('Sin conductor')).toBeInTheDocument();
  });

  it('shows an em dash for a route with no comunas resolved yet', () => {
    render(<EnRutaTable enRuta={[row({ comunas: [] })]} completadas={[]} />);
    const cells = screen.getAllByText('—');
    expect(cells.length).toBeGreaterThan(0);
  });

  it('preserves the caller-supplied order — sorting is the caller\'s job, not the table\'s', () => {
    const worst = row({ id: 'worst', externalRouteId: 'RUT-WORST', fallidas: 5 });
    const fine = row({ id: 'fine', externalRouteId: 'RUT-FINE', fallidas: 0 });
    render(<EnRutaTable enRuta={[worst, fine]} completadas={[]} />);
    const cells = screen.getAllByText(/^RUT-/);
    expect(cells[0]).toHaveTextContent('RUT-WORST');
    expect(cells[1]).toHaveTextContent('RUT-FINE');
  });

  it('renders an empty state with no on-road and no completed routes', () => {
    render(<EnRutaTable enRuta={[]} completadas={[]} />);
    expect(screen.getByText(/Sin rutas en camino/i)).toBeInTheDocument();
  });
});
