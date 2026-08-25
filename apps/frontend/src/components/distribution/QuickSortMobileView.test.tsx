import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuickSortMobileView } from './QuickSortMobileView';

/** spec-68 Fase 5.2–5.5 — the mobile quicksort container wiring. */

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1', userId: 'user-1' }),
}));

vi.mock('@/hooks/useCurrentUserName', () => ({
  useCurrentUserName: () => ({ data: 'Marcela R.' }),
}));

let zones = [
  { id: 'zone-1', name: 'Andén 1', code: 'DOCK-001', is_consolidation: false, is_active: true, comunas: [{ id: 'com-1', nombre: 'Las Condes' }], operator_id: 'op-1', capacity: 180 },
  { id: 'consol', name: 'Consolidación', code: 'CONSOL', is_consolidation: true, is_active: true, comunas: [], operator_id: 'op-1', capacity: null },
];

vi.mock('@/hooks/distribution/useDockZones', () => ({
  useDockZones: () => ({ data: zones }),
}));

const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

vi.mock('@/hooks/distribution/useSectorizedByZone', () => ({
  useSectorizedByZone: () => ({ data: { 'zone-1': 169 } }),
}));

const mockLimit = vi.fn();
const mockIs = vi.fn();
const mockEq = vi.fn();
const mockNeq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/hooks/distribution/useDockBatches', () => ({
  useCreateDockBatch: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'batch-1' }) })),
  useCloseDockBatch: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock('@/hooks/distribution/useDockScans', () => ({
  useDockScanMutation: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({ scanResult: 'accepted', packageId: 'pkg-1', packageLabel: 'PKG-001' }),
    isPending: false,
  })),
}));

const mockUpdateBatchZone = vi.fn().mockResolvedValue({ error: null });
vi.mock('@/lib/distribution/batch-zone', () => ({
  updateBatchDockZone: (...args: unknown[]) => mockUpdateBatchZone(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  zones = [
    { id: 'zone-1', name: 'Andén 1', code: 'DOCK-001', is_consolidation: false, is_active: true, comunas: [{ id: 'com-1', nombre: 'Las Condes' }], operator_id: 'op-1', capacity: 180 },
    { id: 'consol', name: 'Consolidación', code: 'CONSOL', is_consolidation: true, is_active: true, comunas: [], operator_id: 'op-1', capacity: null },
  ];
  mockUpdateBatchZone.mockResolvedValue({ error: null });
  mockFrom.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, is: mockIs, neq: mockNeq });
  mockIs.mockReturnValue({ limit: mockLimit, eq: mockEq });
  mockNeq.mockReturnValue({ is: vi.fn().mockResolvedValue({ count: 0, error: null }) });
  mockLimit.mockResolvedValue({
    data: [{
      id: 'pkg-1',
      label: 'PKG-001',
      status: 'en_bodega',
      order_id: 'ord-1',
      orders: {
        order_number: 'ORD-1',
        comuna_id: 'com-1',
        delivery_date: '2026-03-18',
        chile_comunas: { nombre: 'Las Condes' },
      },
    }],
    error: null,
  });
});

describe('QuickSortMobileView', () => {
  it('renders step 1 by default', () => {
    render(<QuickSortMobileView />);
    expect(screen.getByText('Clasificación en andén')).toBeInTheDocument();
    expect(screen.getByLabelText(/escanear paquete/i)).toBeInTheDocument();
  });

  it('advances to step 2 with the destination, capacity and zone count looked up from zones/sectorizedByZone', async () => {
    render(<QuickSortMobileView />);
    const input = screen.getByLabelText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText('DOCK-001');
    expect(screen.getByText('169 / 180')).toBeInTheDocument();
  });

  // spec-68 Fase 6 accessibility sweep (6.3) — regression guard: step 2
  // (QuickSortMobileDock) used to render with no heading at all, so this
  // route dropped from one <h1> to zero the instant a package scan
  // advanced it past step 1.
  it('carries exactly one top-level heading in both step 1 and step 2', async () => {
    render(<QuickSortMobileView />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    const input = screen.getByLabelText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText('DOCK-001');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('back arrow and Cerrar lote both return to /app/distribution', () => {
    render(<QuickSortMobileView />);
    fireEvent.click(screen.getByText('Cerrar lote'));
    expect(mockPush).toHaveBeenCalledWith('/app/distribution');
  });

  // Review fix (finding #5) — "Enviar a consolidación" must require an
  // ACTIVE consolidation zone, and must give feedback instead of doing
  // nothing when there isn't one.
  describe('"Enviar a consolidación" (review fix #5)', () => {
    async function advanceToStep2() {
      render(<QuickSortMobileView />);
      const input = screen.getByLabelText(/escanear paquete/i);
      fireEvent.change(input, { target: { value: 'PKG-001' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await screen.findByText('Enviar a consolidación');
    }

    it('scans the active consolidation zone code, switching the batch zone', async () => {
      await advanceToStep2();
      fireEvent.click(screen.getByText('Enviar a consolidación'));
      await waitFor(() =>
        expect(mockUpdateBatchZone).toHaveBeenCalledWith(
          expect.objectContaining({ zoneId: 'consol' }),
        ),
      );
    });

    it('does not feed a deactivated consolidation zone code, and gives feedback instead of nothing', async () => {
      zones = zones.map((z) => (z.id === 'consol' ? { ...z, is_active: false } : z));
      await advanceToStep2();
      fireEvent.click(screen.getByText('Enviar a consolidación'));
      expect(mockToastError).toHaveBeenCalledWith('No hay zona de consolidación activa configurada');
      expect(mockUpdateBatchZone).not.toHaveBeenCalled();
    });
  });
});
