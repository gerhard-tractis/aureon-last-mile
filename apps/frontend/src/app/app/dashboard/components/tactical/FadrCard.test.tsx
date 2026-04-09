import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FadrCard } from './FadrCard';

const FULL_DATA = {
  fadr_pct: 94.2,
  avg_km_per_route: 120.5,
  avg_km_per_stop: 8.3,
  avg_orders_per_route: 14.5,
};

describe('FadrCard', () => {
  it('renders FADR label', () => {
    render(<FadrCard data={FULL_DATA} isLoading={false} />);
    expect(screen.getAllByText(/FADR/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders formatted percent value', () => {
    render(<FadrCard data={FULL_DATA} isLoading={false} />);
    // formatPercent(94.2) => '94,2%'
    expect(screen.getByText('94,2%')).toBeInTheDocument();
  });

  it('shows — when fadr_pct is null', () => {
    render(<FadrCard data={{ ...FULL_DATA, fadr_pct: null }} isLoading={false} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows skeleton on loading', () => {
    const { container } = render(<FadrCard data={null} isLoading={true} />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
