import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConsolidationPageContent } from './ConsolidationPageContent';

// spec-68 Fase 4 review (finding #5) — the page threads `now` the same
// way ConsolidationMobileView's own tests do, so nothing here depends on
// the real calendar date. Without this, `pkg2` (delivery_date
// 2026-09-01) starts reading as "leaving soon" the moment the real clock
// crosses 2026-08-31, and these tests fail by date coincidence rather
// than by a real regression.
const NOW = new Date('2026-08-25T15:00:00.000Z');

function ConsolidationPage() {
  return <ConsolidationPageContent now={NOW} />;
}

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let mockRole = 'ops_leader';
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1', userId: 'user-1', role: mockRole }),
}));

const zoneA = {
  id: 'zone-a1',
  name: 'Zona Norte',
  code: 'A3',
  is_consolidation: false,
  is_active: true,
  comunas: [{ id: 'c-1', nombre: 'Quilicura' }],
  operator_id: 'op-1',
  capacity: 180,
};

// A second, distinct andén — needed for the mixed-comuna-batch case
// (finding #2): a Maipú package must NOT resolve onto A3.
const zoneB = {
  id: 'zone-b1',
  name: 'Zona Sur',
  code: 'B4',
  is_consolidation: false,
  is_active: true,
  comunas: [{ id: 'c-2', nombre: 'Maipú' }],
  operator_id: 'op-1',
  capacity: 90,
};

const consZone = {
  id: 'zone-cons',
  name: 'Consolidación',
  code: 'CNS',
  is_consolidation: true,
  is_active: true,
  comunas: [],
  operator_id: 'op-1',
  capacity: null,
};

let mockZones: unknown[] = [zoneA, zoneB, consZone];
let mockZonesLoading = false;
vi.mock('@/hooks/distribution/useDockZones', () => ({
  useDockZones: () => ({ data: mockZones, isLoading: mockZonesLoading }),
}));

vi.mock('@/hooks/distribution/useSectorizedByZone', () => ({
  useSectorizedByZone: () => ({ data: { 'zone-a1': 169 } }),
}));

const pkg1 = {
  id: 'pkg-1',
  label: 'BULTO-1',
  dock_zone_id: 'zone-cons',
  order_id: 'order-1',
  delivery_date: '2026-08-25', // hoy
  comunaId: 'c-1',
  comunaName: 'Quilicura',
};

const pkg2 = {
  id: 'pkg-2',
  label: 'BULTO-2',
  dock_zone_id: 'zone-cons',
  order_id: 'order-2',
  delivery_date: '2026-09-01', // próximo
  comunaId: 'c-1',
  comunaName: 'Quilicura',
};

// Maipú → zoneB, distinct from pkg1/pkg2's Quilicura → zoneA.
const pkgMaipu = {
  id: 'pkg-maipu',
  label: 'BULTO-M',
  dock_zone_id: 'zone-cons',
  order_id: 'order-3',
  delivery_date: '2026-08-25',
  comunaId: 'c-2',
  comunaName: 'Maipú',
};

// A comuna nothing claims — SIN ANDÉN (finding #1).
const pkgUnmapped = {
  id: 'pkg-unmapped',
  label: 'BULTO-U',
  dock_zone_id: 'zone-cons',
  order_id: 'order-4',
  delivery_date: '2026-08-25',
  comunaId: 'c-999',
  comunaName: 'Til Til',
};

let mockPackages: unknown[] = [pkg1, pkg2];
vi.mock('@/hooks/distribution/useConsolidation', () => ({
  useConsolidation: () => ({ data: mockPackages, isLoading: false }),
  useReleaseFromConsolidation: () => ({ mutate: mockRelease }),
}));

const mockMutateAsync = vi.fn().mockResolvedValue(undefined);
let mockCanUse = true;
const mockUseManualDockAssignment = vi.fn(() => ({ canUse: mockCanUse, mutateAsync: mockMutateAsync }));
vi.mock('@/hooks/distribution/useManualDockAssignment', () => ({
  useManualDockAssignment: (...args: unknown[]) => mockUseManualDockAssignment(...args),
}));

const mockRelease = vi.fn((_ids: string[], opts?: { onSuccess?: () => void; onError?: () => void }) => {
  opts?.onSuccess?.();
});

beforeEach(async () => {
  mockPush.mockClear();
  mockMutateAsync.mockClear();
  mockMutateAsync.mockResolvedValue(undefined);
  mockRelease.mockClear();
  mockRelease.mockImplementation((_ids: string[], opts?: { onSuccess?: () => void; onError?: () => void }) => {
    opts?.onSuccess?.();
  });
  mockCanUse = true;
  mockRole = 'ops_leader';
  mockPackages = [pkg1, pkg2];
  mockZones = [zoneA, zoneB, consZone];
  mockZonesLoading = false;
  const { toast } = await import('sonner');
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('ConsolidationPage (route: /app/distribution/consolidacion)', () => {
  it('renders the titled header with the bulto count and consolidation zone code', () => {
    render(<ConsolidationPage />);
    expect(screen.getByText('Consolidación')).toBeInTheDocument();
    expect(screen.getByText(/2 bultos retenidos · zona CNS/)).toBeInTheDocument();
  });

  it('shows a SALEN YA chip when at least one package is due today/tomorrow', () => {
    render(<ConsolidationPage />);
    expect(screen.getByText(/1 SALEN YA/)).toBeInTheDocument();
  });

  it('omits the SALEN YA chip when nothing is leaving soon', () => {
    mockPackages = [pkg2]; // due 2026-09-01, far out from the frozen NOW
    render(<ConsolidationPage />);
    expect(screen.queryByText(/SALEN YA/)).not.toBeInTheDocument();
  });

  it('the back arrow returns to the distribution home', async () => {
    const user = userEvent.setup();
    render(<ConsolidationPage />);
    await user.click(screen.getByRole('button', { name: /volver/i }));
    expect(mockPush).toHaveBeenCalledWith('/app/distribution');
  });

  // Fase 4 review (finding #0) — corrects the original Decisión 6
  // reading. Releasing only returns a package to the pending pool; it
  // carries none of manual assignment's bypass-the-scan risk, so it is
  // NOT gated on canUse. warehouse_staff must still see the footer, with
  // Liberar available and Mover a andén simply absent.
  describe('finding #0 — Liberar a sectorización is ungated', () => {
    it('warehouse_staff sees the footer with Liberar a sectorización, but not Mover a andén', () => {
      mockCanUse = false;
      mockRole = 'warehouse_staff';
      render(<ConsolidationPage />);
      expect(screen.getByRole('button', { name: /liberar a sectorización/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /mover a andén/i })).not.toBeInTheDocument();
    });

    it('warehouse_staff can still release a selected package', async () => {
      mockCanUse = false;
      mockRole = 'warehouse_staff';
      const user = userEvent.setup();
      render(<ConsolidationPage />);
      await user.click(screen.getByRole('checkbox', { name: /BULTO-1/i }));
      await user.click(screen.getByRole('button', { name: /liberar a sectorización/i }));
      expect(mockRelease).toHaveBeenCalledWith(['pkg-1'], expect.anything());
    });
  });

  it('ops_leader sees both actions, disabled with zero selection', () => {
    mockCanUse = true;
    mockRole = 'ops_leader';
    render(<ConsolidationPage />);
    expect(screen.getByRole('button', { name: /mover a andén/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /liberar a sectorización/i })).toBeDisabled();
  });

  it('selecting a package enables both actions', async () => {
    const user = userEvent.setup();
    render(<ConsolidationPage />);
    await user.click(screen.getByRole('checkbox', { name: /BULTO-1/i }));
    expect(screen.getByRole('button', { name: /mover a andén/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /liberar a sectorización/i })).toBeEnabled();
  });

  it('Mover a andén opens SendToDockSheet and confirming assigns via useManualDockAssignment', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    render(<ConsolidationPage />);
    await user.click(screen.getByRole('checkbox', { name: /BULTO-1/i }));
    await user.click(screen.getByRole('button', { name: /mover a andén/i }));
    expect(screen.getByText('Enviar BULTO-1 a')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enviar a A3' }));
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ packageId: 'pkg-1', zoneId: 'zone-a1', isConsolidation: false }),
    );
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
  });

  it('opts the shared hook into silentErrors — the page owns the one summary toast', () => {
    render(<ConsolidationPage />);
    expect(mockUseManualDockAssignment).toHaveBeenCalledWith('op-1', 'user-1', { silentErrors: true });
  });

  it('summarizes a partial multi-package "Mover a andén" failure in one toast', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    mockMutateAsync.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('blip'));

    render(<ConsolidationPage />);
    await user.click(screen.getByRole('checkbox', { name: /BULTO-1/i }));
    await user.click(screen.getByRole('checkbox', { name: /BULTO-2/i }));
    await user.click(screen.getByRole('button', { name: /mover a andén/i }));
    await user.click(screen.getByRole('button', { name: 'Enviar a A3' }));

    await vi.waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('Liberar a sectorización calls useReleaseFromConsolidation with the selected ids', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    render(<ConsolidationPage />);
    await user.click(screen.getByRole('checkbox', { name: /BULTO-1/i }));
    await user.click(screen.getByRole('checkbox', { name: /BULTO-2/i }));
    await user.click(screen.getByRole('button', { name: /liberar a sectorización/i }));
    expect(mockRelease).toHaveBeenCalledWith(['pkg-1', 'pkg-2'], expect.anything());
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  // Fase 4 review (finding #1) — a SIN ANDÉN package used to fall back to
  // whatever active andén sorted first, pre-selected and badged SUGERIDO.
  // Confirming that default would sectorize it onto a zone its own comuna
  // never matched. The safe fallback is consolidación itself.
  describe('finding #1 — SIN ANDÉN fallback never picks an arbitrary andén', () => {
    it('a package whose comuna matches nothing suggests consolidación, not the first active andén', async () => {
      mockPackages = [pkgUnmapped];
      const user = userEvent.setup();
      render(<ConsolidationPage />);
      await user.click(screen.getByRole('checkbox', { name: /BULTO-U/i }));
      await user.click(screen.getByRole('button', { name: /mover a andén/i }));
      expect(screen.getByRole('button', { name: 'Enviar a CNS' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Enviar a A3' })).not.toBeInTheDocument();
    });

    it('a package with no comuna at all also suggests consolidación', async () => {
      mockPackages = [{ ...pkgUnmapped, id: 'pkg-nocomuna', label: 'BULTO-N', comunaId: null, comunaName: null }];
      const user = userEvent.setup();
      render(<ConsolidationPage />);
      await user.click(screen.getByRole('checkbox', { name: /BULTO-N/i }));
      await user.click(screen.getByRole('button', { name: /mover a andén/i }));
      expect(screen.getByRole('button', { name: 'Enviar a CNS' })).toBeInTheDocument();
    });
  });

  // Fase 4 review (finding #2) — a batch spanning comunas that resolve to
  // different andenes must not present a comuna-justified suggestion for
  // the whole batch.
  describe('finding #2 — mixed-comuna batch', () => {
    it('passes mixedComunaBatch through to the sheet, replacing the "por comuna" subtitle', async () => {
      mockPackages = [pkg1, pkgMaipu]; // Quilicura → A3, Maipú → B4
      const user = userEvent.setup();
      render(<ConsolidationPage />);
      await user.click(screen.getByRole('checkbox', { name: /BULTO-1/i }));
      await user.click(screen.getByRole('checkbox', { name: /BULTO-M/i }));
      await user.click(screen.getByRole('button', { name: /mover a andén/i }));
      expect(screen.queryByText(/por comuna/i)).not.toBeInTheDocument();
      expect(screen.getByText(/comunas distintas/i)).toBeInTheDocument();
      expect(screen.queryByText('SUGERIDO')).not.toBeInTheDocument();
    });

    it('does NOT flag a same-comuna, same-zone batch as mixed', async () => {
      const user = userEvent.setup();
      render(<ConsolidationPage />);
      await user.click(screen.getByRole('checkbox', { name: /BULTO-1/i }));
      await user.click(screen.getByRole('checkbox', { name: /BULTO-2/i }));
      await user.click(screen.getByRole('button', { name: /mover a andén/i }));
      expect(screen.getByText(/sugerido A3 por comuna/i)).toBeInTheDocument();
    });

    it('a SIN ANDÉN package alongside a matched one is not itself "mixed"', async () => {
      mockPackages = [pkg1, pkgUnmapped]; // A3 match + no match — one real zone, not two
      const user = userEvent.setup();
      render(<ConsolidationPage />);
      await user.click(screen.getByRole('checkbox', { name: /BULTO-1/i }));
      await user.click(screen.getByRole('checkbox', { name: /BULTO-U/i }));
      await user.click(screen.getByRole('button', { name: /mover a andén/i }));
      expect(screen.getByText(/sugerido A3 por comuna/i)).toBeInTheDocument();
    });
  });

  // Fase 4 review (finding #4) — tapping Mover a andén while useDockZones
  // is still in flight used to no-op silently (no sheet, no toast, no
  // disabled state).
  describe('finding #4 — Mover a andén stays disabled until zones are loaded', () => {
    it('disables the button while zones are loading, even with a selection', async () => {
      mockZonesLoading = true;
      mockZones = [];
      const user = userEvent.setup();
      render(<ConsolidationPage />);
      await user.click(screen.getByRole('checkbox', { name: /BULTO-1/i }));
      expect(screen.getByRole('button', { name: /mover a andén/i })).toBeDisabled();
    });
  });

  // Fase 4 review (finding #3) — `selectedIds` used to persist ids the
  // packages list no longer carries, so the chip and the footer disagreed
  // with reality once a selected package left the list (partial failure,
  // or the hook's own refetch picking up someone else's scan).
  describe('finding #3 — selection is pruned when the packages list changes', () => {
    it('drops a selected id that disappears from the packages list on the next render', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<ConsolidationPage />);
      await user.click(screen.getByRole('checkbox', { name: /BULTO-1/i }));
      await user.click(screen.getByRole('checkbox', { name: /BULTO-2/i }));
      expect(screen.getByTestId('consolidation-selection-count')).toHaveTextContent('2 SELECCIONADOS');

      // Simulate a refetch that drops BULTO-2 (e.g. someone else moved it).
      mockPackages = [pkg1];
      rerender(<ConsolidationPage />);

      expect(screen.getByTestId('consolidation-selection-count')).toHaveTextContent('1 SELECCIONADO');
      // The footer must agree too — releasing now only sends pkg-1.
      await user.click(screen.getByRole('button', { name: /liberar a sectorización/i }));
      expect(mockRelease).toHaveBeenCalledWith(['pkg-1'], expect.anything());
    });
  });

  // spec-68 Fase 6 accessibility sweep (6.3) — regression guard: this
  // route's only heading used to be DistributionMobileHeader's <h2>, so it
  // shipped with zero <h1>s. Fixed by promoting the titled variant's title
  // to <h1> (Fase 6).
  it('carries exactly one top-level heading', () => {
    render(<ConsolidationPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
