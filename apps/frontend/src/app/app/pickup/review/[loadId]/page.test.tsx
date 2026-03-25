import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import DiscrepancyReviewPage from './page';

const mockUsePickupScans = vi.fn();
vi.mock('@/hooks/pickup/usePickupScans', () => ({
  usePickupScans: (...args: unknown[]) => mockUsePickupScans(...args),
}));

const mockUseMissingPackages = vi.fn();
const mockUseDiscrepancyNotes = vi.fn();
const mockUseSaveDiscrepancyNote = vi.fn();
vi.mock('@/hooks/pickup/useDiscrepancies', () => ({
  useMissingPackages: (...args: unknown[]) => mockUseMissingPackages(...args),
  useDiscrepancyNotes: (...args: unknown[]) => mockUseDiscrepancyNotes(...args),
  useSaveDiscrepancyNote: (...args: unknown[]) => mockUseSaveDiscrepancyNote(...args),
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
              single: () => Promise.resolve({ data: { id: 'm1' } }),
            }),
          }),
        }),
      }),
    }),
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }),
    },
  }),
}));

vi.mock('@/components/pickup/DiscrepancyItem', () => ({
  DiscrepancyItem: ({ packageLabel }: { packageLabel: string }) => (
    <div data-testid="discrepancy-item">{packageLabel}</div>
  ),
}));

vi.mock('@/components/pickup/PickupStepBreadcrumb', () => ({
  PickupStepBreadcrumb: () => <div data-testid="breadcrumb" />,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ loadId: 'CARGA-001' }),
  useRouter: () => ({ push: mockPush }),
}));

describe('DiscrepancyReviewPage', () => {
  beforeEach(() => {
    mockUsePickupScans.mockReturnValue({
      data: [
        { id: 's1', scan_result: 'verified', package_id: 'p1' },
        { id: 's2', scan_result: 'verified', package_id: 'p2' },
        { id: 's3', scan_result: 'not_found', package_id: null, barcode_scanned: 'BC999' },
      ],
    });
    mockUseMissingPackages.mockReturnValue({
      data: [{ id: 'pkg1', label: 'PKG-001', order_number: 'ORD-001' }],
    });
    mockUseDiscrepancyNotes.mockReturnValue({ data: [] });
    mockUseSaveDiscrepancyNote.mockReturnValue({ mutate: vi.fn() });
  });

  it('renders Spanish labels in MetricCards', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByText('Verificados')).toBeInTheDocument();
    expect(screen.getByText('Faltantes')).toBeInTheDocument();
    expect(screen.getByText('No en manifiesto')).toBeInTheDocument();
  });

  it('renders MetricCards with correct values via data-value', async () => {
    const { container } = render(<DiscrepancyReviewPage />);
    await screen.findByText('Verificados');
    const valueEls = container.querySelectorAll('[data-value]');
    expect(valueEls).toHaveLength(3);
    expect(valueEls[0].textContent).toBe('2');  // verified
    expect(valueEls[1].textContent).toBe('1');  // missing
    expect(valueEls[2].textContent).toBe('1');  // not found
  });

  it('renders "Revisión" in header', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByText('Revisión')).toBeInTheDocument();
  });

  it('renders "Continuar a entrega" button', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByRole('button', { name: /continuar a entrega/i })).toBeInTheDocument();
  });

  it('renders "Volver" back button', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByRole('button', { name: /volver/i })).toBeInTheDocument();
  });

  it('renders "Faltantes — notas obligatorias" section header', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByText(/faltantes — notas obligatorias/i)).toBeInTheDocument();
  });

  it('has responsive padding', () => {
    const { container } = render(<DiscrepancyReviewPage />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('sm:p-6');
  });
});
