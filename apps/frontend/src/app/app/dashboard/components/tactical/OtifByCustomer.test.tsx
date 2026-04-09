import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/useIsMobile', () => ({ useIsMobile: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
}));

import { useIsMobile } from '@/hooks/useIsMobile';
import { useRouter } from 'next/navigation';
import { OtifByCustomer } from './OtifByCustomer';

const CUSTOMERS = [
  { customer_name: 'Acme Corp', total_orders: 40, delivered_orders: 38, otif_pct: 95 },
  { customer_name: 'Globex', total_orders: 25, delivered_orders: 22, otif_pct: 88 },
];

describe('OtifByCustomer', () => {
  beforeEach(() => {
    vi.mocked(useIsMobile).mockReturnValue(false);
  });

  it('renders table on desktop', () => {
    vi.mocked(useIsMobile).mockReturnValue(false);
    render(<OtifByCustomer data={CUSTOMERS} isLoading={false} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('renders card list on mobile', () => {
    vi.mocked(useIsMobile).mockReturnValue(true);
    const { container } = render(<OtifByCustomer data={CUSTOMERS} isLoading={false} />);
    expect(container.querySelector('table')).not.toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
  });

  it('clicking a row calls router.replace with ?drill=customer', () => {
    const mockReplace = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ replace: mockReplace } as ReturnType<typeof useRouter>);
    vi.mocked(useIsMobile).mockReturnValue(false);

    render(<OtifByCustomer data={CUSTOMERS} isLoading={false} />);
    const acmeRow = screen.getByText('Acme Corp').closest('tr');
    if (acmeRow) fireEvent.click(acmeRow);

    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining('drill=customer'),
      { scroll: false },
    );
  });

  it('shows skeleton when isLoading=true', () => {
    const { container } = render(<OtifByCustomer data={undefined} isLoading={true} />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
