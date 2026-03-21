import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DistributionTab } from './DistributionTab';
import * as useDistributionKPIsModule from '@/hooks/distribution/useDistributionKPIs';

const mockUseDistributionKPIs = vi.spyOn(useDistributionKPIsModule, 'useDistributionKPIs');

beforeEach(() => {
  mockUseDistributionKPIs.mockReturnValue({
    data: { pending: 4, consolidation: 2, dueSoon: 1 },
    isLoading: false,
  } as ReturnType<typeof useDistributionKPIsModule.useDistributionKPIs>);
});

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

  it('renders KPI values from hook data', () => {
    render(<DistributionTab operatorId="op-1" />);
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders skeleton when loading', () => {
    mockUseDistributionKPIs.mockReturnValueOnce({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useDistributionKPIsModule.useDistributionKPIs>);
    render(<DistributionTab operatorId="op-1" />);
    expect(screen.queryByText('Pendientes de sectorizar')).toBeNull();
  });
});
