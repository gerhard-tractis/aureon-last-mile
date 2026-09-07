import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
    mockPush.mockClear();
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

  // spec-80 fase 0. This used to assert "Continuar a ruta" -> /app/pickup/route/active,
  // which is the spec-47 regression: it skipped the Firma step entirely, so no
  // manifest was ever signed or completed. The DESTINATION is what matters here,
  // not the label — a test that only checked the wording would have passed
  // throughout the whole period the step was unreachable.
  it('sends the crew on to Firma, not back to the route', async () => {
    // The CTA is gated on every missing package carrying a note, so the note
    // has to be present for this to test navigation rather than the gate.
    mockUseDiscrepancyNotes.mockReturnValue({
      data: [{ package_id: 'pkg1', note: 'El local no lo encontró en bodega.' }],
    });

    render(<DiscrepancyReviewPage />);
    const cta = await screen.findByRole('button', { name: /continuar a firma/i });

    fireEvent.click(cta);

    expect(mockPush).toHaveBeenCalledWith('/app/pickup/complete/CARGA-001');
  });

  it('never routes the crew straight to the active route from Revisión', async () => {
    mockUseDiscrepancyNotes.mockReturnValue({
      data: [{ package_id: 'pkg1', note: 'El local no lo encontró en bodega.' }],
    });

    render(<DiscrepancyReviewPage />);
    fireEvent.click(await screen.findByRole('button', { name: /continuar a firma/i }));

    expect(mockPush).not.toHaveBeenCalledWith('/app/pickup/route/active');
  });

  // Pinning the gate spec-80 fase 0 must not weaken: a missing package without
  // a note cannot be signed over, because the client signs against that count.
  it('keeps Firma unreachable while a missing package has no note', async () => {
    render(<DiscrepancyReviewPage />);
    const cta = await screen.findByRole('button', { name: /continuar a firma/i });

    expect(cta).toBeDisabled();
    fireEvent.click(cta);
    expect(mockPush).not.toHaveBeenCalled();
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
