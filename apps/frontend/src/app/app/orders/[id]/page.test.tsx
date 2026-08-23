import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import OrderFichaPage from './page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'o-1' }),
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ push: vi.fn() }),
}));

const mockUseOperatorId = vi.fn();
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => mockUseOperatorId(),
}));

const mockUseOrderDossier = vi.fn();
vi.mock('@/hooks/useOrderDossier', () => ({
  useOrderDossier: (...args: unknown[]) => mockUseOrderDossier(...args),
}));

describe('OrderFichaPage (route wiring)', () => {
  it('gates access the same way as /app/orders: renders nothing for an unauthorized role', () => {
    mockUseOperatorId.mockReturnValue({ role: 'pickup_crew', permissions: ['pickup'] });
    mockUseOrderDossier.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<OrderFichaPage />);
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('passes the route param through to the dossier query for an authorized role', () => {
    mockUseOperatorId.mockReturnValue({ role: 'admin', permissions: ['admin'] });
    mockUseOrderDossier.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(<OrderFichaPage />);
    expect(mockUseOrderDossier).toHaveBeenCalledWith('o-1', undefined);
  });
});
