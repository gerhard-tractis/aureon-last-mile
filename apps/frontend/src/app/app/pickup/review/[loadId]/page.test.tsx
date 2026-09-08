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
              single: () =>
                Promise.resolve({
                  data: {
                    id: 'm1',
                    retailer_name: 'Falabella',
                    pickup_location: 'Mall Plaza Vespucio',
                  },
                }),
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
  MissingPackageRow: ({
    packageId,
    packageLabel,
    onSaveNote,
  }: {
    packageId: string;
    packageLabel: string;
    onSaveNote: (packageId: string, note: string) => Promise<void>;
  }) => (
    <div data-testid="missing-package-row">
      {packageLabel}
      <button onClick={() => onSaveNote(packageId, 'nota de prueba').catch(() => {})}>
        save-note-stub
      </button>
    </div>
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
      isLoading: false,
      isError: false,
    });
    mockUseMissingPackages.mockReturnValue({
      data: [{ id: 'pkg1', label: 'PKG-001', order_number: 'ORD-001' }],
      isLoading: false,
      isError: false,
    });
    mockUseDiscrepancyNotes.mockReturnValue({ data: [] });
    mockUseSaveDiscrepancyNote.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockResolvedValue(undefined),
    });
    mockPush.mockClear();
  });

  // Medio 5a (review PR #686): the 5e mock draws "Falabella · Mall Plaza
  // Vespucio" under the load id — the retailer and pickup point, sourced
  // from manifests.retailer_name/pickup_location. Only the load id itself
  // was rendered.
  it('shows the retailer and pickup point under the load id, as the mock draws it', async () => {
    render(<DiscrepancyReviewPage />);
    expect(await screen.findByText('Falabella · Mall Plaza Vespucio')).toBeInTheDocument();
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

  // Medio 6 (review PR #686): the mock draws the primary CTA at 60px tall
  // and the secondary at 52px — both were the Button default's h-10 (40px),
  // under the touch-target minimum on the two most important taps of the
  // screen.
  it('the two footer CTAs meet the mock\'s touch-target sizes (60px primary, 52px secondary)', async () => {
    render(<DiscrepancyReviewPage />);
    const primary = await screen.findByRole('button', { name: /seguir escaneando/i });
    const secondary = await screen.findByRole('button', { name: /cerrar con 1 faltante/i });
    expect(primary.className).toMatch(/min-h-\[60px\]/);
    expect(secondary.className).toMatch(/min-h-\[52px\]/);
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

  // Bloqueante 2 (review PR #686, ronda 3): each gate must stand on its OWN
  // hook. A test that puts BOTH hooks in the same state at once (as the
  // ronda-2 version of this test did) can't tell which half of
  // `scans === undefined || missingPackages === undefined` is actually
  // doing the work — the reviewer's mutation to drop either half stayed
  // green against that test. These two put exactly ONE hook's data at
  // undefined while the OTHER is fully resolved — the shape that actually
  // happens in production: `scans` comes back warm from cache (same query
  // key already fetched on scan/[loadId]) while `missing` is still
  // resolving.
  it('shows a loading state, not the clean-close CTA, while missingPackages has no data yet (scans already resolved)', async () => {
    mockUseMissingPackages.mockReturnValue({ data: undefined, isError: false });

    render(<DiscrepancyReviewPage />);

    expect(await screen.findByTestId('review-loading')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continuar a firma/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /seguir escaneando/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cerrar con/i })).not.toBeInTheDocument();
  });

  it('shows a loading state, not the clean-close CTA, while scans has no data yet (missingPackages already resolved)', async () => {
    mockUsePickupScans.mockReturnValue({ data: undefined, isError: false });

    render(<DiscrepancyReviewPage />);

    expect(await screen.findByTestId('review-loading')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continuar a firma/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /seguir escaneando/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cerrar con/i })).not.toBeInTheDocument();
  });

  // Bloqueante 1 (spec-80 fase 2 review, ronda 3, PR #686): the actual bug —
  // a query PAUSED by networkMode:'online' while offline (not "loading" in
  // the isLoading sense: isLoading/isError both read FALSE, data simply
  // never arrives). This is the exact shape TanStack Query returns in that
  // state; if page.tsx ever goes back to gating on isLoading instead of on
  // data presence, this is the test that catches it.
  it('shows a loading state, not the clean-close CTA, when a query is paused offline (isLoading and isError both false, data undefined)', async () => {
    mockUseMissingPackages.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    render(<DiscrepancyReviewPage />);

    expect(await screen.findByTestId('review-loading')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continuar a firma/i })).not.toBeInTheDocument();
  });

  // Medio 4 (review PR #686): handleSaveNote used to fire-and-forget via
  // `.mutate()`, which has no way to tell MissingPackageRow the save
  // failed. Wiring it through `.mutateAsync()` is what lets the row keep
  // the typed note instead of discarding it on a failed save.
  it('saves a note via mutateAsync (not the fire-and-forget mutate) so a failure can propagate back to the row', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    const mutate = vi.fn();
    mockUseSaveDiscrepancyNote.mockReturnValue({ mutate, mutateAsync });

    render(<DiscrepancyReviewPage />);
    const stub = await screen.findByText('save-note-stub');
    fireEvent.click(stub);

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorId: 'op-1',
        manifestId: 'm1',
        packageId: 'pkg1',
        note: 'nota de prueba',
        userId: 'u1',
      })
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  // Bloqueante 2: each half of `scansError || missingError` tested alone —
  // a mutation dropping `|| missingError` would still pass the first test
  // (scansError alone already trips it) but fail the second.
  it('shows an explicit error state when scans fails to load (missingPackages unaffected)', async () => {
    mockUsePickupScans.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    mockUseMissingPackages.mockReturnValue({ data: undefined, isLoading: false, isError: false });

    render(<DiscrepancyReviewPage />);

    expect(await screen.findByTestId('review-error')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continuar a firma/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /seguir escaneando/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cerrar con/i })).not.toBeInTheDocument();
  });

  it('shows an explicit error state when missingPackages fails to load (scans unaffected)', async () => {
    mockUsePickupScans.mockReturnValue({
      data: [{ id: 's1', scan_result: 'verified', package_id: 'p1' }],
      isLoading: false,
      isError: false,
    });
    mockUseMissingPackages.mockReturnValue({ data: undefined, isLoading: false, isError: true });

    render(<DiscrepancyReviewPage />);

    expect(await screen.findByTestId('review-error')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continuar a firma/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /seguir escaneando/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cerrar con/i })).not.toBeInTheDocument();
  });
});
