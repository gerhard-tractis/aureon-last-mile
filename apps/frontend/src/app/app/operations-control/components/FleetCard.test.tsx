import { render, screen } from '@testing-library/react';
import { FleetCard, routeTone } from './FleetCard';
import type { ActiveRoute } from '@/hooks/useActiveRoutes';

function route(over: Partial<ActiveRoute> = {}): ActiveRoute {
  return {
    id: 'r1',
    external_route_id: 'R-2481',
    driver_name: 'Cristian Muñoz',
    vehicle_id: null,
    status: 'in_progress',
    start_time: '2026-08-14T09:00:00Z',
    total_stops: 24,
    completed_stops: 18,
    dispatches: [],
    ...over,
  };
}

describe('FleetCard', () => {
  it('renders driver, route code and stop progress', () => {
    render(<FleetCard routes={[route()]} />);
    expect(screen.getByText('Cristian Muñoz · R-2481')).toBeInTheDocument();
    expect(screen.getByText('18/24 paradas')).toBeInTheDocument();
  });

  it('derives initials from the driver name', () => {
    render(<FleetCard routes={[route()]} />);
    expect(screen.getByText('CM')).toBeInTheDocument();
  });

  it('falls back rather than crashing when the driver is unknown', () => {
    render(<FleetCard routes={[route({ driver_name: null })]} />);
    expect(screen.getByText('··')).toBeInTheDocument();
    expect(screen.getByText(/Sin conductor/)).toBeInTheDocument();
  });

  it('handles a single-word driver name', () => {
    render(<FleetCard routes={[route({ driver_name: 'Cristian' })]} />);
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('counts only in-progress routes as active', () => {
    render(
      <FleetCard
        routes={[route(), route({ id: 'r2', status: 'planned' }), route({ id: 'r3', status: 'completed' })]}
      />,
    );
    expect(screen.getByText('1 activos · 3 rutas')).toBeInTheDocument();
  });

  it('shows an empty state rather than a bare card', () => {
    render(<FleetCard routes={[]} />);
    expect(screen.getByText('Ninguna ruta en calle todavía.')).toBeInTheDocument();
  });

  it('renders skeletons with the row geometry while loading', () => {
    render(<FleetCard routes={[]} isLoading />);
    expect(screen.queryByText('Ninguna ruta en calle todavía.')).toBeNull();
    expect(screen.queryByTestId('fleet-row')).toBeNull();
  });
});

describe('routeTone', () => {
  it('flags failed stops above everything else', () => {
    const r = route({
      dispatches: [{ status: 'failed' } as ActiveRoute['dispatches'][number]],
    });
    expect(routeTone(r)).toEqual({ tone: 'err', label: '1 FALLIDA' });
  });

  it('pluralises multiple failures', () => {
    const r = route({
      dispatches: [
        { status: 'failed' } as ActiveRoute['dispatches'][number],
        { status: 'failed' } as ActiveRoute['dispatches'][number],
      ],
    });
    expect(routeTone(r).label).toBe('2 FALLIDAS');
  });

  it('reads a barely-started route as at risk', () => {
    expect(routeTone(route({ completed_stops: 2, total_stops: 24 })).tone).toBe('warn');
  });

  it('reads a well-advanced route as on time', () => {
    expect(routeTone(route({ completed_stops: 18, total_stops: 24 })).tone).toBe('ok');
  });

  it('does not divide by zero on a route with no stops', () => {
    expect(routeTone(route({ total_stops: 0, completed_stops: 0 }))).toEqual({
      tone: 'idle',
      label: 'SIN PARADAS',
    });
  });

  it('reports non-active routes by their status, not their progress', () => {
    expect(routeTone(route({ status: 'planned' })).label).toBe('PLANIFICADA');
    expect(routeTone(route({ status: 'cancelled' })).label).toBe('CANCELADA');
  });
});
