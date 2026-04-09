import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
}));

import { useIsMobile } from '@/hooks/useIsMobile';
import { useRouter } from 'next/navigation';
import { OtifByRegion } from './OtifByRegion';

const REGIONS = [
  { region_name: 'Norte', total_orders: 50, delivered_orders: 47, otif_pct: 94 },
  { region_name: 'Sur', total_orders: 30, delivered_orders: 27, otif_pct: 90 },
  { region_name: 'Centro', total_orders: 3, delivered_orders: 3, otif_pct: 100 },
];

describe('OtifByRegion', () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(false);
  });

  it('renders table on desktop (not mobile)', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<OtifByRegion data={REGIONS} isLoading={false} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('renders card list on mobile', () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    const { container } = render(<OtifByRegion data={REGIONS} isLoading={false} />);
    // No table element on mobile
    expect(container.querySelector('table')).not.toBeInTheDocument();
    // Region names should still appear
    expect(screen.getByText('Norte')).toBeInTheDocument();
    expect(screen.getByText('Sur')).toBeInTheDocument();
  });

  it('shows "muestra insuficiente" for row with total_orders < 5', () => {
    render(<OtifByRegion data={REGIONS} isLoading={false} />);
    // Centro has 3 orders which is < 5
    expect(screen.getByText(/muestra insuficiente/i)).toBeInTheDocument();
  });

  it('clicking a row calls router.replace with ?drill=region', () => {
    const mockReplace = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ replace: mockReplace } as ReturnType<typeof useRouter>);
    vi.mocked(useIsMobile).mockReturnValue(false);

    render(<OtifByRegion data={REGIONS} isLoading={false} />);
    const northRow = screen.getByText('Norte').closest('tr');
    if (northRow) fireEvent.click(northRow);

    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining('drill=region'),
      { scroll: false },
    );
  });

  it('shows skeleton when isLoading=true', () => {
    const { container } = render(<OtifByRegion data={undefined} isLoading={true} />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
