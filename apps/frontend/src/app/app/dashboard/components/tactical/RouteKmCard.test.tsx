import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouteKmCard } from './RouteKmCard';

const FULL_DATA = {
  fadr_pct: 94.2,
  avg_km_per_route: 120.5,
  avg_km_per_stop: 8.3,
  avg_orders_per_route: 14.5,
};

describe('RouteKmCard', () => {
  it('renders km/ruta label', () => {
    render(<RouteKmCard data={FULL_DATA} isLoading={false} />);
    expect(screen.getAllByText(/ruta/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders formatted km value', () => {
    render(<RouteKmCard data={FULL_DATA} isLoading={false} />);
    // formatNumber(120.5) rounds to integer in es-CL => '121'
    expect(screen.getByText('121')).toBeInTheDocument();
  });

  it('shows — when avg_km_per_route is null', () => {
    render(<RouteKmCard data={{ ...FULL_DATA, avg_km_per_route: null }} isLoading={false} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows skeleton on loading', () => {
    const { container } = render(<RouteKmCard data={null} isLoading={true} />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
