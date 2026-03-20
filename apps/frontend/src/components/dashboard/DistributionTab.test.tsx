import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DistributionTab } from './DistributionTab';

describe('DistributionTab', () => {
  it('renders three KPI cards', () => {
    render(<DistributionTab operatorId="op-1" />);
    expect(screen.getByText('Pendientes de sectorizar')).toBeInTheDocument();
    expect(screen.getByText('En consolidación')).toBeInTheDocument();
    expect(screen.getByText('Próximos a despachar')).toBeInTheDocument();
  });

  it('renders link to full distribution view', () => {
    render(<DistributionTab operatorId="op-1" />);
    expect(screen.getByRole('link', { name: /distribución completa/i })).toBeInTheDocument();
  });

  it('link points to /app/distribution', () => {
    render(<DistributionTab operatorId="op-1" />);
    const link = screen.getByRole('link', { name: /distribución completa/i }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/app/distribution');
  });
});
