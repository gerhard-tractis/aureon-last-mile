import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import HandoffPage from './page';

const mockUseQRHandoff = vi.fn();
vi.mock('@/hooks/reception/useQRHandoff', () => ({
  useQRHandoff: (...args: unknown[]) => mockUseQRHandoff(...args),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              then: (cb: (r: { data: { id: string }[] }) => void) => cb({ data: [{ id: 'p1' }, { id: 'p2' }] }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/components/reception/QRHandoff', () => ({
  QRHandoff: () => <div data-testid="qr-handoff" />,
}));

vi.mock('@/components/pickup/PickupStepBreadcrumb', () => ({
  PickupStepBreadcrumb: () => <div data-testid="breadcrumb" />,
}));

const mockPush = vi.fn();
const mockBack = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ loadId: 'CARGA-001' }),
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

describe('HandoffPage', () => {
  beforeEach(() => {
    mockUseQRHandoff.mockReturnValue({
      manifest: { id: 'm1', retailer_name: 'Easy', reception_status: null },
      isLoading: false,
      isHandoffComplete: false,
      isSubmitting: false,
      qrPayload: null,
      error: null,
      initiateHandoff: vi.fn(),
    });
  });

  it('renders "Entrega en bodega" header', () => {
    render(<HandoffPage />);
    expect(screen.getByText('Entrega en bodega')).toBeInTheDocument();
  });

  it('renders shadcn Button for "Entregar en bodega"', () => {
    render(<HandoffPage />);
    const btn = screen.getByRole('button', { name: /entregar en bodega/i });
    expect(btn).toBeInTheDocument();
  });

  it('renders shadcn Button for "Volver"', () => {
    render(<HandoffPage />);
    const btn = screen.getByRole('button', { name: /volver/i });
    expect(btn).toBeInTheDocument();
  });

  it('has max-w-2xl container', () => {
    const { container } = render(<HandoffPage />);
    const wrapper = container.querySelector('.max-w-2xl');
    expect(wrapper).toBeTruthy();
  });

  it('has responsive padding', () => {
    const { container } = render(<HandoffPage />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('sm:p-6');
  });
});
