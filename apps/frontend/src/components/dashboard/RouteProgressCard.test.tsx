import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import RouteProgressCard from './RouteProgressCard';
import type { ActiveRoute } from '@/hooks/useActiveRoutes';

const MOCK_ROUTE: ActiveRoute = {
  id: 'route-1',
  external_route_id: '12345',
  driver_name: 'Juan Pérez',
  vehicle_id: 'vehicle-1',
  status: 'in_progress',
  start_time: '2026-03-10T08:00:00',
  total_stops: 10,
  completed_stops: 4,
  dispatches: [
    {
      id: 'dispatch-1',
      external_dispatch_id: '100',
      order_id: 'order-abc-123',
      status: 'delivered',
      planned_sequence: 1,
      estimated_at: '2026-03-10T09:00:00',
      arrived_at: '2026-03-10T09:05:00',
      completed_at: '2026-03-10T09:07:00',
      latitude: null,
      longitude: null,
      failure_reason: null,
    },
    {
      id: 'dispatch-2',
      external_dispatch_id: '101',
      order_id: 'order-def-456',
      status: 'pending',
      planned_sequence: 2,
      estimated_at: '2026-03-10T11:30:00',
      arrived_at: null,
      completed_at: null,
      latitude: null,
      longitude: null,
      failure_reason: null,
    },
  ],
};

describe('RouteProgressCard', () => {
  it('renders driver name', () => {
    render(<RouteProgressCard route={MOCK_ROUTE} />);
    expect(screen.getByTestId('driver-name')).toHaveTextContent('Juan Pérez');
  });

  it('renders progress label with stop counts', () => {
    render(<RouteProgressCard route={MOCK_ROUTE} />);
    expect(screen.getByTestId('progress-label')).toHaveTextContent('4 de 10 paradas');
  });

  it('renders progress bar at correct width', () => {
    render(<RouteProgressCard route={MOCK_ROUTE} />);
    const bar = screen.getByTestId('progress-bar');
    expect(bar).toHaveStyle({ width: '40%' });
  });

  it('renders next stop ETA from first pending dispatch', () => {
    render(<RouteProgressCard route={MOCK_ROUTE} />);
    expect(screen.getByTestId('next-stop-eta')).toBeInTheDocument();
  });

  it('does not show stop list initially', () => {
    render(<RouteProgressCard route={MOCK_ROUTE} />);
    expect(screen.queryByTestId('stop-list')).not.toBeInTheDocument();
  });

  it('expands to show stop list on click', async () => {
    render(<RouteProgressCard route={MOCK_ROUTE} />);
    await userEvent.click(screen.getByRole('button', { name: /Ver 2 paradas/ }));
    expect(screen.getByTestId('stop-list')).toBeInTheDocument();
  });

  it('shows fallback when driver_name is null', () => {
    const route = { ...MOCK_ROUTE, driver_name: null };
    render(<RouteProgressCard route={route} />);
    expect(screen.getByTestId('driver-name')).toHaveTextContent('Conductor desconocido');
  });

  it('shows 0% progress when no stops completed', () => {
    const route = { ...MOCK_ROUTE, completed_stops: 0 };
    render(<RouteProgressCard route={route} />);
    const bar = screen.getByTestId('progress-bar');
    expect(bar).toHaveStyle({ width: '0%' });
  });
});
