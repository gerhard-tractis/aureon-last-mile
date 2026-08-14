import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

afterEach(() => {
  vi.useRealTimers();
});

/** Scan a package via Enter and wait for the destination + armed andén field. */
async function scanPackage(label = 'PKG-001') {
  const pkgInput = screen.getByLabelText(/escanear paquete/i);
  fireEvent.change(pkgInput, { target: { value: label } });
  fireEvent.keyDown(pkgInput, { key: 'Enter' });
  await screen.findByText(/Andén 1/);
  return screen.findByLabelText(/escanear andén/i);
}

describe('QuickSortScanner', () => {
  it('starts in scan_package state with scanner visible', () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    expect(screen.getByLabelText(/escanear paquete/i)).toBeInTheDocument();
    expect(screen.getByText(/paquetes sectorizados/i)).toBeInTheDocument();
  });

  it('shows destination after scanning a valid package', async () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const input = screen.getByLabelText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Wait for async lookup
    await screen.findByText(/Andén 1/);
    expect(screen.getAllByText(/DOCK-001/).length).toBeGreaterThan(0);
  });

  it('shows error when package not found', async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null });
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const input = screen.getByLabelText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'UNKNOWN' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText(/código no encontrado/i);
    // Still in scan_package state
    expect(screen.getByLabelText(/escanear paquete/i)).toBeInTheDocument();
  });

  it('arms the andén scan immediately after the package scan — no confirm button', async () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    await scanPackage();
    // Destination and andén field appear together in one step
    expect(screen.getByLabelText(/escanear andén/i)).toBeInTheDocument();
    expect(screen.queryByText(/confirmar andén/i)).not.toBeInTheDocument();
  });

  it('auto-submits a package scan burst with no Enter suffix', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const input = screen.getByLabelText(/escanear paquete/i);

    const code = 'PKG-001';
    for (let i = 1; i <= code.length; i++) {
      fireEvent.change(input, { target: { value: code.slice(0, i) } });
      await vi.advanceTimersByTimeAsync(25);
    }
    await vi.advanceTimersByTimeAsync(150);

    // Destination appears without any Enter keypress
    await screen.findByText(/Andén 1/);
    vi.useRealTimers();
  });

  it('auto-submits an andén scan burst with no Enter suffix', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const andenInput = await scanPackage();

    const code = 'DOCK-001';
    for (let i = 1; i <= code.length; i++) {
      fireEvent.change(andenInput, { target: { value: code.slice(0, i) } });
      await vi.advanceTimersByTimeAsync(25);
    }
    await vi.advanceTimersByTimeAsync(150);

    // Cycle completes back to scan_package and the counter increments
    await screen.findByText(/1 paquetes sectorizados/i);
    expect(mockScanMutateAsync).toHaveBeenCalledWith({ barcode: 'PKG-001' });
    vi.useRealTimers();
  });

  it('redirects to consolidación when CONSOL is scanned and records redirect_reason', async () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const andenInput = await scanPackage();
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
    const andenInput = await scanPackage();
    fireEvent.change(andenInput, { target: { value: 'DOCK-002' } });
    fireEvent.keyDown(andenInput, { key: 'Enter' });
    await screen.findByText(/asignación fallida.*andén incorrecto.*esperado.*consolidación/i);
  });

  it('shows wrong andén error when wrong code scanned', async () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const andenInput = await scanPackage();
    fireEvent.change(andenInput, { target: { value: 'WRONG-CODE' } });
    fireEvent.keyDown(andenInput, { key: 'Enter' });
    await screen.findByText(/andén incorrecto/i);
  });

  it('increments counter and resets to scan_package on correct andén scan', async () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const andenInput = await scanPackage();
    fireEvent.change(andenInput, { target: { value: 'DOCK-001' } });
    fireEvent.keyDown(andenInput, { key: 'Enter' });
    // Should go back to scan_package with counter = 1
    await screen.findByLabelText(/escanear paquete/i);
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
    const input = screen.getByLabelText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'PKG-002' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // The destination block names the consolidation dock.
    await screen.findByText('ANDÉN CONSOL · Consolidación');
    // Warning banner appears because the zona is flagged (unmapped)
    expect(screen.getByText(/comuna sin andén asignado/i)).toBeInTheDocument();
  });

  it('reports a completed scan so the session history can show it', async () => {
    const onScanEvent = vi.fn();
    render(
      <QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} onScanEvent={onScanEvent} />,
    );
    const andenInput = await scanPackage();
    fireEvent.change(andenInput, { target: { value: 'DOCK-001' } });
    fireEvent.keyDown(andenInput, { key: 'Enter' });

    await waitFor(() => expect(onScanEvent).toHaveBeenCalled());
    expect(onScanEvent.mock.calls[0][0]).toMatchObject({
      code: 'PKG-001',
      zoneCode: 'DOCK-001',
      status: 'ok',
    });
  });

  it('reports an unknown code as an error event, not silently', async () => {
    const onScanEvent = vi.fn();
    mockLimit.mockResolvedValueOnce({ data: [], error: null });
    render(
      <QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} onScanEvent={onScanEvent} />,
    );
    const input = screen.getByLabelText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'NOPE' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onScanEvent).toHaveBeenCalled());
    expect(onScanEvent.mock.calls[0][0]).toMatchObject({ code: 'NOPE', status: 'error' });
  });
});
