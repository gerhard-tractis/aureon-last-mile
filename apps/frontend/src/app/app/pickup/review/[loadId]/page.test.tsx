import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('DiscrepancyReviewPage (5e)', () => {
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

  it('shows the "Faltan N paquetes" header', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByText('Faltan 1 paquetes')).toBeInTheDocument();
  });

  it('shows the "X de Y verificados" subheading', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByText('2 de 3 verificados')).toBeInTheDocument();
  });

  it('renders the SIN VERIFICAR list from UnverifiedPackagesBlock', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByText(/sin verificar \(1\)/i)).toBeInTheDocument();
    expect(screen.getByTestId('discrepancy-item')).toHaveTextContent('PKG-001');
  });

  it('renders the NO ESTABAN EN LA CARGA block', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByText(/no estaban en la carga \(1\)/i)).toBeInTheDocument();
  });

  it('the primary CTA reads "Cerrar con 1 faltante" while missing packages exist', async () => {
    render(<DiscrepancyReviewPage />);
    expect(
      await screen.findByRole('button', { name: /cerrar con 1 faltante/i })
    ).toBeInTheDocument();
  });

  it('keeps the close CTA disabled while a missing package has no note', async () => {
    render(<DiscrepancyReviewPage />);
    const cta = await screen.findByRole('button', { name: /cerrar con 1 faltante/i });
    expect(cta).toBeDisabled();
    fireEvent.click(cta);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('enables the close CTA and navigates to Firma once every missing package has a note', async () => {
    mockUseDiscrepancyNotes.mockReturnValue({
      data: [{ package_id: 'pkg1', note: 'El local no lo encontró en bodega.' }],
    });

    render(<DiscrepancyReviewPage />);
    const cta = await screen.findByRole('button', { name: /cerrar con 1 faltante/i });
    expect(cta).not.toBeDisabled();

    fireEvent.click(cta);
    expect(mockPush).toHaveBeenCalledWith('/app/pickup/complete/CARGA-001');
  });

  it('renders the "Seguir escaneando" exit back to scanning', async () => {
    render(<DiscrepancyReviewPage />);
    const btn = await screen.findByRole('button', { name: /seguir escaneando/i });
    fireEvent.click(btn);
    expect(mockPush).toHaveBeenCalledWith('/app/pickup/scan/CARGA-001');
  });

  it('passes straight through with zero missing packages: no warning, CTA reads "Continuar a firma" and is enabled', async () => {
    mockUseMissingPackages.mockReturnValue({ data: [] });
    mockUsePickupScans.mockReturnValue({
      data: [
        { id: 's1', scan_result: 'verified', package_id: 'p1' },
        { id: 's2', scan_result: 'verified', package_id: 'p2' },
      ],
    });

    render(<DiscrepancyReviewPage />);
    const cta = await screen.findByRole('button', { name: /continuar a firma/i });
    expect(cta).not.toBeDisabled();
    expect(screen.queryByText(/sin verificar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/quedan registrados como faltantes/i)).not.toBeInTheDocument();

    fireEvent.click(cta);
    expect(mockPush).toHaveBeenCalledWith('/app/pickup/complete/CARGA-001');
  });
});
