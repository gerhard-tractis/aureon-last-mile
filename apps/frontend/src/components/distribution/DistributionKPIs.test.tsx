import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DistributionKPIs } from './DistributionKPIs';

describe('DistributionKPIs', () => {
  it('renders three KPI cards with values', () => {
    render(<DistributionKPIs pending={5} consolidation={3} dueSoon={2} />);
    expect(screen.getByText('Pendientes de sectorizar')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('En consolidación')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Próximos a despachar')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows urgency styling when dueSoon > 0', () => {
    const { container } = render(
      <DistributionKPIs pending={0} consolidation={0} dueSoon={1} />
    );
    // Either a data-urgent attribute or a specific CSS class signals urgency
    const urgent = container.querySelector('[data-urgent="true"]');
    expect(urgent).toBeTruthy();
  });

  it('does not show urgency when dueSoon is 0', () => {
    const { container } = render(
      <DistributionKPIs pending={0} consolidation={0} dueSoon={0} />
    );
    const urgent = container.querySelector('[data-urgent="true"]');
    expect(urgent).toBeNull();
  });
});
