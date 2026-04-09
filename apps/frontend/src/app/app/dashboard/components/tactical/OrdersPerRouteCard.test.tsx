import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrdersPerRouteCard } from './OrdersPerRouteCard';

const FULL_DATA = {
  fadr_pct: 94.2,
  avg_km_per_route: 120.5,
  avg_km_per_stop: 8.3,
  avg_orders_per_route: 14.5,
};

describe('OrdersPerRouteCard', () => {
  it('renders órdenes/ruta label', () => {
    render(<OrdersPerRouteCard data={FULL_DATA} isLoading={false} />);
    expect(screen.getAllByText(/rdenes/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders formatted orders per route value', () => {
    render(<OrdersPerRouteCard data={FULL_DATA} isLoading={false} />);
    // formatNumber(14.5) rounds to integer in es-CL => '15'
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('shows — when avg_orders_per_route is null', () => {
    render(<OrdersPerRouteCard data={{ ...FULL_DATA, avg_orders_per_route: null }} isLoading={false} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows skeleton on loading', () => {
    const { container } = render(<OrdersPerRouteCard data={null} isLoading={true} />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
