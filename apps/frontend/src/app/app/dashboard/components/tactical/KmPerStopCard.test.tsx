import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KmPerStopCard } from './KmPerStopCard';

const FULL_DATA = {
  fadr_pct: 94.2,
  avg_km_per_route: 120.5,
  avg_km_per_stop: 8.3,
  avg_orders_per_route: 14.5,
};

describe('KmPerStopCard', () => {
  it('renders km/parada label', () => {
    render(<KmPerStopCard data={FULL_DATA} isLoading={false} />);
    expect(screen.getAllByText(/parada/i).length).toBeGreaterThanOrEqual(1);
  });

  it('renders formatted km/stop value', () => {
    render(<KmPerStopCard data={FULL_DATA} isLoading={false} />);
    // formatNumber(8.3) rounds to integer in es-CL => '8'
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('shows — when avg_km_per_stop is null', () => {
    render(<KmPerStopCard data={{ ...FULL_DATA, avg_km_per_stop: null }} isLoading={false} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows skeleton on loading', () => {
    const { container } = render(<KmPerStopCard data={null} isLoading={true} />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
