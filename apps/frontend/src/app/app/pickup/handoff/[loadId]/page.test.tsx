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

/**
 * Default useQRHandoff return shape used by every test. Tests that exercise
 * a specific guard or visual state override only the relevant fields via
 * `mockHandoff({ verifiedPackageCount: 7 })`.
 */
function mockHandoff(overrides: Record<string, unknown> = {}) {
  mockUseQRHandoff.mockReturnValue({
    manifest: { id: 'm1', retailer_name: 'Easy', reception_status: null },
    verifiedPackageCount: 3,
    isCountLoading: false,
    isLoading: false,
    isHandoffComplete: false,
    isSubmitting: false,
    qrPayload: null,
    error: null,
    initiateHandoff: vi.fn(),
    ...overrides,
  });
}

describe('HandoffPage', () => {
  beforeEach(() => {
    mockHandoff();
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

  it('displays verifiedPackageCount from the useQRHandoff hook', () => {
    // Regression: the page used to run its own Supabase query that filtered
    // packages by a non-existent manifest_id column and silently rendered 0.
    // The single source of truth is now the hook's verifiedPackageCount.
    mockHandoff({ verifiedPackageCount: 7 });
    render(<HandoffPage />);
    expect(screen.getByText(/7 paquetes verificados/i)).toBeInTheDocument();
  });

  it('disables "Entregar en bodega" when verifiedPackageCount is 0', () => {
    // Operator hasn't scanned anything yet — handing off with zero packages
    // would write a meaningless hub_receptions row promising no inventory.
    mockHandoff({ verifiedPackageCount: 0, isCountLoading: false });
    render(<HandoffPage />);
    const btn = screen.getByRole('button', { name: /entregar en bodega/i });
    expect(btn).toBeDisabled();
  });

  it('disables "Entregar en bodega" while the count is still loading', () => {
    // Brief race window between manifest load and pickup_scans fetch — the
    // count is 0 only because the fetch hasn't completed yet, NOT because
    // there are no verified packages. The button must not commit a phantom
    // 0-package handoff during this window.
    mockHandoff({ verifiedPackageCount: 0, isCountLoading: true });
    render(<HandoffPage />);
    const btn = screen.getByRole('button', { name: /entregar en bodega/i });
    expect(btn).toBeDisabled();
  });

  it('disables "Entregar en bodega" when the manifest already has reception_status set', () => {
    // The manifest has already been handed off once. Pressing the button
    // again would create a second hub_receptions row competing with the
    // first — the hub would see two pending receptions for the same load.
    mockHandoff({
      manifest: {
        id: 'm1',
        retailer_name: 'Easy',
        reception_status: 'awaiting_reception',
      },
      verifiedPackageCount: 5,
    });
    render(<HandoffPage />);
    const btn = screen.getByRole('button', { name: /entregar en bodega/i });
    expect(btn).toBeDisabled();
  });
});
