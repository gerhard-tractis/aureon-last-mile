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

vi.mock('@/components/pickup/MissingPackageRow', () => ({
  MissingPackageRow: ({ packageLabel }: { packageLabel: string }) => (
    <div data-testid="missing-package-row">{packageLabel}</div>
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
        {
          id: 's3',
          scan_result: 'not_found',
          package_id: null,
          barcode_scanned: 'BC999',
          scanned_at: '2026-09-08T08:47:00Z',
        },
      ],
    });
    mockUseMissingPackages.mockReturnValue({
      data: [{ id: 'pkg1', label: 'PKG-001', order_number: 'ORD-001' }],
    });
    mockUseDiscrepancyNotes.mockReturnValue({ data: [] });
    mockUseSaveDiscrepancyNote.mockReturnValue({ mutate: vi.fn() });
    mockPush.mockClear();
  });

  it('shows the "Falta 1 paquete" heading inside the warning card (singular)', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByText('Falta 1 paquete')).toBeInTheDocument();
  });

  it('shows the "X de Y verificados" subheading', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByText('2 de 3 verificados')).toBeInTheDocument();
  });

  it('renders the SIN VERIFICAR · N list from UnverifiedPackagesBlock', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByText('SIN VERIFICAR · 1')).toBeInTheDocument();
    expect(screen.getByTestId('missing-package-row')).toHaveTextContent('PKG-001');
  });

  it('renders the NO ESTABAN EN LA CARGA · N block', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByText('NO ESTABAN EN LA CARGA · 1')).toBeInTheDocument();
  });

  it('"Seguir escaneando" is the gold/primary CTA while there are missing packages', async () => {
    render(<DiscrepancyReviewPage />);
    const btn = await screen.findByRole('button', { name: /seguir escaneando/i });
    fireEvent.click(btn);
    expect(mockPush).toHaveBeenCalledWith('/app/pickup/scan/CARGA-001');
  });

  // Mutation guard (spec-80 fase 2 review, bloqueante 1): a prior round had
  // these two CTAs' labels correctly wired to navigation but their
  // primary/secondary STYLING inverted — every existing test still passed
  // because none of them looked at variant/class or DOM order, only at
  // label+navigation. These two assertions fail if that mutation recurs.
  it('"Seguir escaneando" renders as the solid gold primary button, before the red-outlined secondary one, in DOM order', async () => {
    render(<DiscrepancyReviewPage />);
    const primary = await screen.findByRole('button', { name: /seguir escaneando/i });
    const secondary = await screen.findByRole('button', { name: /cerrar con 1 faltante/i });

    // Primary: default (solid/gold) variant — Button's default variant class.
    expect(primary.className).toMatch(/bg-primary/);
    expect(primary.className).not.toMatch(/border-status-error-border/);

    // Secondary: red-outlined `variant="outline"` styling, not solid.
    expect(secondary.className).toMatch(/border-status-error-border/);
    expect(secondary.className).not.toMatch(/^bg-primary\b/);

    const buttons = screen.getAllByRole('button');
    const primaryIndex = buttons.indexOf(primary);
    const secondaryIndex = buttons.indexOf(secondary);
    expect(primaryIndex).toBeGreaterThanOrEqual(0);
    expect(secondaryIndex).toBeGreaterThan(primaryIndex);
  });

  // Decisión del usuario (2026-09-08): la nota del faltante es OPCIONAL — "Es
  // opcional, y la dejaría editable en el futuro". El mock 5e muestra el CTA
  // "Cerrar con 3 faltantes" totalmente opaco con dos bultos SIN nota; no hay
  // atenuación de deshabilitado en ningún estado del mock. Pin: el CTA nunca
  // se bloquea por falta de notas, con o sin ellas.
  it('"Cerrar con N faltantes" is the secondary CTA and is never disabled by missing notes', async () => {
    render(<DiscrepancyReviewPage />);
    const cta = await screen.findByRole('button', { name: /cerrar con 1 faltante/i });
    expect(cta).not.toBeDisabled();

    fireEvent.click(cta);
    expect(mockPush).toHaveBeenCalledWith('/app/pickup/complete/CARGA-001');
  });

  it('closing with a missing package that already has a note still navigates to Firma', async () => {
    mockUseDiscrepancyNotes.mockReturnValue({
      data: [{ package_id: 'pkg1', note: 'El local no lo encontró en bodega.' }],
    });

    render(<DiscrepancyReviewPage />);
    const cta = await screen.findByRole('button', { name: /cerrar con 1 faltante/i });
    expect(cta).not.toBeDisabled();

    fireEvent.click(cta);
    expect(mockPush).toHaveBeenCalledWith('/app/pickup/complete/CARGA-001');
  });

  it('passes straight through with zero missing packages: single gold CTA "Continuar a firma", no "Seguir escaneando", no warning', async () => {
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
    expect(screen.queryByRole('button', { name: /seguir escaneando/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/sin verificar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/quedan registrados como faltantes/i)).not.toBeInTheDocument();

    fireEvent.click(cta);
    expect(mockPush).toHaveBeenCalledWith('/app/pickup/complete/CARGA-001');
  });
});
