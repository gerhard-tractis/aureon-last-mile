import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DistributionPage from './page';

// Mock all hooks used by the page
const mockKpis = { pending: 5, consolidation: 3, dueSoon: 2 };
const mockUseDistributionKPIs = vi.fn();
vi.mock('@/hooks/distribution/useDistributionKPIs', () => ({
  useDistributionKPIs: (...args: unknown[]) => mockUseDistributionKPIs(...args),
}));

vi.mock('@/hooks/distribution/useConsolidation', () => ({
  useConsolidation: () => ({ data: [] }),
  useReleaseFromConsolidation: () => ({ mutate: vi.fn() }),
}));

const mockZones = [
  { id: 'z1', name: 'Andén 1', code: 'D1', is_consolidation: false, comunas: [{ id: 'c1', nombre: 'las condes' }], is_active: true, operator_id: 'op1' },
];
const mockUseDockZones = vi.fn();
vi.mock('@/hooks/distribution/useDockZones', () => ({
  useDockZones: (...args: unknown[]) => mockUseDockZones(...args),
}));

const mockUseSectorizedByZone = vi.fn();
vi.mock('@/hooks/distribution/useSectorizedByZone', () => ({
  useSectorizedByZone: (...args: unknown[]) => mockUseSectorizedByZone(...args),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

vi.mock('@/components/distribution/UnmappedComunasBanner', () => ({
  UnmappedComunasBanner: () => null,
}));

// Mock next/link to render as <a>
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe('DistributionPage', () => {
  beforeEach(() => {
    mockUseDistributionKPIs.mockReturnValue({ data: mockKpis, isLoading: false });
    mockUseDockZones.mockReturnValue({ data: mockZones });
    mockUseSectorizedByZone.mockReturnValue({ data: {} });
  });

  describe('KPI cards', () => {
    it('renders three MetricCards with correct values', () => {
      const { container } = render(<DistributionPage />);
      // MetricCard renders values inside [data-value] elements
      const valueEls = container.querySelectorAll('[data-value]');
      expect(valueEls).toHaveLength(3);
      expect(valueEls[0].textContent).toBe('5');
      expect(valueEls[1].textContent).toBe('3');
      expect(valueEls[2].textContent).toBe('2');
    });

    it('renders KPI labels', () => {
      render(<DistributionPage />);
      expect(screen.getByText('Pendientes de sectorizar')).toBeInTheDocument();
      expect(screen.getByText('En consolidación')).toBeInTheDocument();
      expect(screen.getByText('Próximos a despachar')).toBeInTheDocument();
    });

    it('always applies amber styling to the dispatch KPI card', () => {
      // Even with dueSoon=0, the card should have warning styling
      mockUseDistributionKPIs.mockReturnValue({
        data: { pending: 0, consolidation: 0, dueSoon: 0 },
        isLoading: false,
      });
      const { container } = render(<DistributionPage />);
      const amberCard = container.querySelector('.border-status-warning-border.bg-status-warning-bg');
      expect(amberCard).toBeTruthy();
    });
  });

  describe('Action buttons', () => {
    it('renders action links with icons', () => {
      render(<DistributionPage />);
      expect(screen.getByRole('link', { name: /lote/i })).toHaveAttribute('href', '/app/distribution/batch');
      expect(screen.getByRole('link', { name: /rápido/i })).toHaveAttribute('href', '/app/distribution/quicksort');
      expect(screen.getByRole('link', { name: /andenes/i })).toHaveAttribute('href', '/app/distribution/settings');
    });
  });

  describe('Sectorized counts', () => {
    it('passes sectorized counts from hook to the zone grid', () => {
      mockUseSectorizedByZone.mockReturnValue({ data: { z1: 12 } });
      render(<DistributionPage />);
      expect(screen.getByText('12')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('shows EmptyState when no active zones exist', () => {
      mockUseDockZones.mockReturnValue({ data: [] });
      render(<DistributionPage />);
      expect(screen.getByText('Sin andenes configurados')).toBeInTheDocument();
      expect(screen.getByText(/configura tus andenes/i)).toBeInTheDocument();
    });

    it('still renders KPI cards even when no zones exist', () => {
      mockUseDockZones.mockReturnValue({ data: [] });
      const { container } = render(<DistributionPage />);
      const valueEls = container.querySelectorAll('[data-value]');
      expect(valueEls).toHaveLength(3);
    });
  });
});
