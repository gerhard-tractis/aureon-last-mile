import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuickSortScanner } from './QuickSortScanner';
import type { DockZone } from '@/lib/distribution/sectorization-engine';

const LC_ID = 'comuna-las-condes';

const zones: DockZone[] = [
  {
    id: 'zone-1', name: 'Andén 1', code: 'DOCK-001',
    is_consolidation: false, is_active: true,
    comunas: [{ id: LC_ID, nombre: 'Las Condes' }],
  },
  {
    id: 'consol', name: 'Consolidación', code: 'CONSOL',
    is_consolidation: true, is_active: true,
    comunas: [],
  },
];

const mockLimit = vi.fn();
const mockIs = vi.fn();
const mockEq = vi.fn();
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

const mockScanMutateAsync = vi
  .fn()
  .mockResolvedValue({ scanResult: 'accepted', packageId: 'pkg-1', packageLabel: 'PKG-001' });

vi.mock('@/hooks/distribution/useDockScans', () => ({
  useDockScanMutation: vi.fn(() => ({
    mutateAsync: mockScanMutateAsync,
    isPending: false,
  })),
}));

const mockUpdateBatchZone = vi.fn().mockResolvedValue({ error: null });
vi.mock('@/lib/distribution/batch-zone', () => ({
  updateBatchDockZone: (...args: unknown[]) => mockUpdateBatchZone(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockScanMutateAsync.mockResolvedValue({
    scanResult: 'accepted',
    packageId: 'pkg-1',
    packageLabel: 'PKG-001',
  });
  mockUpdateBatchZone.mockResolvedValue({ error: null });
  mockFrom.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, is: mockIs });
  mockIs.mockReturnValue({ limit: mockLimit });
  // Default: package found with matching order
  mockLimit.mockResolvedValue({
    data: [{
      id: 'pkg-1',
      label: 'PKG-001',
      status: 'en_bodega',
      order_id: 'ord-1',
      orders: { comuna_id: LC_ID, delivery_date: '2026-03-18' },
    }],
    error: null,
  });
});

describe('QuickSortScanner', () => {
  it('starts in scan_package state with scanner visible', () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    expect(screen.getByPlaceholderText(/escanear paquete/i)).toBeInTheDocument();
    expect(screen.getByText(/paquetes sectorizados/i)).toBeInTheDocument();
  });

  it('shows destination after scanning a valid package', async () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const input = screen.getByPlaceholderText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Wait for async lookup
    await screen.findByText('Andén 1');
    expect(screen.getByText('DOCK-001')).toBeInTheDocument();
  });

  it('shows error when package not found', async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null });
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const input = screen.getByPlaceholderText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'UNKNOWN' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText(/código no encontrado/i);
    // Still in scan_package state
    expect(screen.getByPlaceholderText(/escanear paquete/i)).toBeInTheDocument();
  });

  it('transitions to scan_anden state after clicking Confirmar andén', async () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const pkgInput = screen.getByPlaceholderText(/escanear paquete/i);
    fireEvent.change(pkgInput, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(pkgInput, { key: 'Enter' });
    // State B: show_destination — destination visible, no andén input yet
    await screen.findByText('Andén 1');
    await waitFor(() => expect(screen.queryByPlaceholderText(/escanear andén/i)).not.toBeInTheDocument());
    // Click Confirmar andén → state C: scan_anden
    fireEvent.click(screen.getByText(/confirmar andén/i));
    await screen.findByPlaceholderText(/escanear andén/i);
  });

  it('redirects to consolidación when CONSOL is scanned in state C and records redirect_reason', async () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const pkgInput = screen.getByPlaceholderText(/escanear paquete/i);
    fireEvent.change(pkgInput, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(pkgInput, { key: 'Enter' });
    await screen.findByText('Andén 1');
    fireEvent.click(screen.getByText(/confirmar andén/i));
    const andenInput = await screen.findByPlaceholderText(/escanear andén/i);
    fireEvent.change(andenInput, { target: { value: 'CONSOL' } });
    fireEvent.keyDown(andenInput, { key: 'Enter' });
    await waitFor(() =>
      expect(mockScanMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          barcode: 'PKG-001',
          redirectReason: 'manual_consolidation',
        })
      )
    );
    // Batch zone is switched to consolidation before recording the scan
    expect(mockUpdateBatchZone).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: 'batch-1', zoneId: 'consol', operatorId: 'op-1' })
    );
  });

  it('shows the explicit "Asignación fallida: andén incorrecto" error for a third dock', async () => {
    const threeZones: DockZone[] = [
      ...zones,
      {
        id: 'zone-2', name: 'Andén 2', code: 'DOCK-002',
        is_consolidation: false, is_active: true, comunas: [],
      },
    ];
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={threeZones} />);
    const pkgInput = screen.getByPlaceholderText(/escanear paquete/i);
    fireEvent.change(pkgInput, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(pkgInput, { key: 'Enter' });
    await screen.findByText('Andén 1');
    fireEvent.click(screen.getByText(/confirmar andén/i));
    const andenInput = await screen.findByPlaceholderText(/escanear andén/i);
    fireEvent.change(andenInput, { target: { value: 'DOCK-002' } });
    fireEvent.keyDown(andenInput, { key: 'Enter' });
    await screen.findByText(/asignación fallida.*andén incorrecto.*esperado.*consolidación/i);
  });

  it('shows wrong andén error when wrong code scanned in state C', async () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    // Get to state B (show_destination)
    const pkgInput = screen.getByPlaceholderText(/escanear paquete/i);
    fireEvent.change(pkgInput, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(pkgInput, { key: 'Enter' });
    await screen.findByText('Andén 1');
    // Transition to state C (scan_anden)
    fireEvent.click(screen.getByText(/confirmar andén/i));
    const andenInput = await screen.findByPlaceholderText(/escanear andén/i);
    // Scan wrong code
    fireEvent.change(andenInput, { target: { value: 'WRONG-CODE' } });
    fireEvent.keyDown(andenInput, { key: 'Enter' });
    await screen.findByText(/andén incorrecto/i);
  });

  it('increments counter and resets to scan_package on correct andén scan', async () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    // Scan package → state B
    const pkgInput = screen.getByPlaceholderText(/escanear paquete/i);
    fireEvent.change(pkgInput, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(pkgInput, { key: 'Enter' });
    await screen.findByText('Andén 1');
    // Confirm → state C
    fireEvent.click(screen.getByText(/confirmar andén/i));
    const andenInput = await screen.findByPlaceholderText(/escanear andén/i);
    // Scan correct andén code
    fireEvent.change(andenInput, { target: { value: 'DOCK-001' } });
    fireEvent.keyDown(andenInput, { key: 'Enter' });
    // Should go back to scan_package with counter = 1
    await screen.findByPlaceholderText(/escanear paquete/i);
    expect(screen.getByText(/1 paquetes sectorizados/i)).toBeInTheDocument();
  });

  it('shows consolidation warning for unmapped comuna', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [{
        id: 'pkg-2',
        label: 'PKG-002',
        status: 'en_bodega',
        order_id: 'ord-2',
        orders: { comuna_id: 'unknown-id', delivery_date: '2026-03-18' },
      }],
      error: null,
    });
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const input = screen.getByPlaceholderText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'PKG-002' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Zone name heading shows "Consolidación"
    await screen.findByText('Consolidación');
    // Warning banner appears because the zona is flagged (unmapped)
    expect(screen.getByText(/comuna sin andén asignado/i)).toBeInTheDocument();
  });
});
