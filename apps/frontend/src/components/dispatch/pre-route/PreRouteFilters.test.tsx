import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ replace: mockReplace })),
  usePathname: vi.fn(() => '/app/dispatch'),
}));

import { PreRouteFilters } from './PreRouteFilters';

describe('PreRouteFilters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a date input', () => {
    render(<PreRouteFilters />);
    expect(screen.getByDisplayValue(new Date().toISOString().slice(0, 10))).toBeInTheDocument();
  });

  it('defaults date to today', () => {
    render(<PreRouteFilters />);
    const today = new Date().toISOString().slice(0, 10);
    const input = screen.getByDisplayValue(today) as HTMLInputElement;
    expect(input.value).toBe(today);
  });

  it('renders window selector options', () => {
    render(<PreRouteFilters />);
    expect(screen.getByText(/Todas/i)).toBeInTheDocument();
    expect(screen.getByText(/Mañana/i)).toBeInTheDocument();
    expect(screen.getByText(/Tarde/i)).toBeInTheDocument();
    expect(screen.getByText(/Noche/i)).toBeInTheDocument();
  });

  it('changing date calls router.replace with ?date= param', () => {
    render(<PreRouteFilters />);
    const today = new Date().toISOString().slice(0, 10);
    const input = screen.getByDisplayValue(today);
    fireEvent.change(input, { target: { value: '2026-05-01' } });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const calledUrl = mockReplace.mock.calls[0][0] as string;
    expect(calledUrl).toContain('date=2026-05-01');
  });

  it('shows totals chip when totals prop provided', () => {
    render(
      <PreRouteFilters
        totals={{ order_count: 12, package_count: 20, anden_count: 3, split_dock_zone_order_count: 0 }}
      />,
    );
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it('selecting a window option calls router.replace with ?window= param', () => {
    render(<PreRouteFilters />);
    const tardeBtn = screen.getByRole('button', { name: /Tarde/i });
    fireEvent.click(tardeBtn);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const calledUrl = mockReplace.mock.calls[0][0] as string;
    expect(calledUrl).toContain('window=tarde');
  });
});
