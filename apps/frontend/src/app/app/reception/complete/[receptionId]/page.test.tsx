import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReceptionCompletePage from './page';

const mockUseHubReception = vi.fn();
const mockUseCompleteReception = vi.fn();
vi.mock('@/hooks/reception/useHubReceptions', () => ({
  useHubReception: (...args: unknown[]) => mockUseHubReception(...args),
  useCompleteReception: (...args: unknown[]) => mockUseCompleteReception(...args),
}));
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));
vi.mock('@/components/reception/ReceptionSummary', () => ({
  ReceptionSummary: () => <div data-testid="reception-summary" />,
}));
vi.mock('@/components/reception/ReceptionStepBreadcrumb', () => ({
  ReceptionStepBreadcrumb: () => <div data-testid="breadcrumb" />,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ receptionId: 'r-1' }),
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
}));

describe('ReceptionCompletePage', () => {
  beforeEach(() => {
    mockUseHubReception.mockReturnValue({
      data: {
        id: 'r-1', manifest_id: 'm1', expected_count: 20, received_count: 18,
        status: 'in_progress', discrepancy_notes: null,
        manifests: { id: 'm1', external_load_id: 'CARGA-001', retailer_name: 'Easy' },
      },
      isLoading: false,
    });
    mockUseCompleteReception.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it('renders breadcrumb', () => {
    render(<ReceptionCompletePage />);
    expect(screen.getByTestId('breadcrumb')).toBeInTheDocument();
  });

  it('renders heading with proper accent — "Confirmar Recepción"', () => {
    render(<ReceptionCompletePage />);
    expect(screen.getByText('Confirmar Recepción')).toBeInTheDocument();
  });

  it('renders confirm button (AlertDialog trigger)', () => {
    render(<ReceptionCompletePage />);
    expect(screen.getByRole('button', { name: /confirmar recepción/i })).toBeInTheDocument();
  });

  it('renders back button as shadcn Button', () => {
    render(<ReceptionCompletePage />);
    expect(screen.getByRole('button', { name: /volver/i })).toBeInTheDocument();
  });

  it('has responsive padding', () => {
    const { container } = render(<ReceptionCompletePage />);
    expect(container.firstElementChild?.className).toContain('sm:p-6');
  });

  it('shows discrepancy section when missing packages', () => {
    render(<ReceptionCompletePage />);
    expect(screen.getByText(/paquetes faltantes/i)).toBeInTheDocument();
  });

  it('uses correct Spanish — "pérdida" with accent', () => {
    render(<ReceptionCompletePage />);
    expect(screen.getByText(/pérdida/)).toBeInTheDocument();
  });
});
