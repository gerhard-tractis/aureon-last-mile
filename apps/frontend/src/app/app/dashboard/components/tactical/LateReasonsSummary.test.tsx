import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
}));

import { useRouter } from 'next/navigation';
import { LateReasonsSummary } from './LateReasonsSummary';

const REASONS = [
  { reason: 'Tráfico', count: 30, pct: 40 },
  { reason: 'Dirección incorrecta', count: 20, pct: 27 },
  { reason: 'Cliente ausente', count: 15, pct: 20 },
  { reason: 'Clima', count: 7, pct: 9 },
  { reason: 'Mecánica', count: 3, pct: 4 },
  { reason: 'Otro', count: 1, pct: 1 },
];

describe('LateReasonsSummary', () => {
  beforeEach(() => {
    vi.mocked(useRouter).mockReturnValue({ replace: vi.fn() } as ReturnType<typeof useRouter>);
  });

  it('renders up to 5 reasons', () => {
    render(<LateReasonsSummary data={REASONS} isLoading={false} />);
    // Only first 5 should appear
    expect(screen.getByText('Tráfico')).toBeInTheDocument();
    expect(screen.getByText('Dirección incorrecta')).toBeInTheDocument();
    expect(screen.getByText('Cliente ausente')).toBeInTheDocument();
    expect(screen.getByText('Clima')).toBeInTheDocument();
    expect(screen.getByText('Mecánica')).toBeInTheDocument();
    // 6th reason should NOT be rendered
    expect(screen.queryByText('Otro')).not.toBeInTheDocument();
  });

  it('each reason shows count as mono text', () => {
    render(<LateReasonsSummary data={REASONS} isLoading={false} />);
    // count 30 for Tráfico
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('"Ver todas →" button is visible', () => {
    render(<LateReasonsSummary data={REASONS} isLoading={false} />);
    expect(screen.getByRole('button', { name: /ver todas/i })).toBeInTheDocument();
  });

  it('clicking "Ver todas →" calls router.replace with ?drill=late_reasons', () => {
    const mockReplace = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ replace: mockReplace } as ReturnType<typeof useRouter>);

    render(<LateReasonsSummary data={REASONS} isLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /ver todas/i }));

    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining('drill=late_reasons'),
      { scroll: false },
    );
  });

  it('shows skeleton when loading', () => {
    const { container } = render(<LateReasonsSummary data={undefined} isLoading={true} />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
