import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuickSortScanner } from './QuickSortScanner';
import type { DockZone } from '@/lib/distribution/sectorization-engine';

/**
 * spec-68 Fase 5.1 — the state-machine tests moved to
 * `useQuickSortFlow.test.ts` when the hook was extracted. What remains
 * here is desktop-rendering wiring: does this component actually render
 * what the hook reports, in each of its states.
 */

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

const mockScanMutateAsync = vi
  .fn()
  .mockResolvedValue({ scanResult: 'accepted', packageId: 'pkg-1', packageLabel: 'PKG-001' });

vi.mock('@/hooks/distribution/useDockScans', () => ({
  useDockScanMutation: vi.fn(() => ({
    mutateAsync: mockScanMutateAsync,
    isPending: false,
  })),
}));

vi.mock('@/lib/distribution/batch-zone', () => ({
  updateBatchDockZone: vi.fn().mockResolvedValue({ error: null }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockScanMutateAsync.mockResolvedValue({
    scanResult: 'accepted',
    packageId: 'pkg-1',
    packageLabel: 'PKG-001',
  });
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
        comuna_id: LC_ID,
        delivery_date: '2026-03-18',
        chile_comunas: { nombre: 'Las Condes' },
      },
    }],
    error: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('QuickSortScanner', () => {
  it('starts in scan_package state with scanner visible', () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    expect(screen.getByLabelText(/escanear paquete/i)).toBeInTheDocument();
    expect(screen.getByText(/paquetes sectorizados/i)).toBeInTheDocument();
  });

  it('shows destination and arms the andén field after scanning a valid package — no confirm tap', async () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const input = screen.getByLabelText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await screen.findByText(/Andén 1/);
    expect(screen.getAllByText(/DOCK-001/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/escanear andén/i)).toBeInTheDocument();
    expect(screen.queryByText(/confirmar andén/i)).not.toBeInTheDocument();
  });

  it('shows error when package not found', async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null });
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const input = screen.getByLabelText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'UNKNOWN' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText(/código no encontrado/i);
    expect(screen.getByLabelText(/escanear paquete/i)).toBeInTheDocument();
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

    await screen.findByText(/Andén 1/);
    vi.useRealTimers();
  });

  it('completes a full cycle and increments the session counter', async () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const input = screen.getByLabelText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const andenInput = await screen.findByLabelText(/escanear andén/i);

    fireEvent.change(andenInput, { target: { value: 'DOCK-001' } });
    fireEvent.keyDown(andenInput, { key: 'Enter' });

    await screen.findByLabelText(/escanear paquete/i);
    expect(screen.getByText(/1 paquetes sectorizados/i)).toBeInTheDocument();
  });

  it('shows the explicit "Asignación fallida: andén incorrecto" error for the wrong dock', async () => {
    render(<QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} />);
    const input = screen.getByLabelText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const andenInput = await screen.findByLabelText(/escanear andén/i);

    fireEvent.change(andenInput, { target: { value: 'WRONG-CODE' } });
    fireEvent.keyDown(andenInput, { key: 'Enter' });
    await screen.findByText(/asignación fallida.*andén incorrecto/i);
  });

  it('reports a completed scan so the session history can show it', async () => {
    const onScanEvent = vi.fn();
    render(
      <QuickSortScanner operatorId="op-1" userId="user-1" zones={zones} onScanEvent={onScanEvent} />,
    );
    const input = screen.getByLabelText(/escanear paquete/i);
    fireEvent.change(input, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const andenInput = await screen.findByLabelText(/escanear andén/i);

    fireEvent.change(andenInput, { target: { value: 'DOCK-001' } });
    fireEvent.keyDown(andenInput, { key: 'Enter' });

    await waitFor(() => expect(onScanEvent).toHaveBeenCalled());
    expect(onScanEvent.mock.calls[0][0]).toMatchObject({
      code: 'PKG-001',
      zoneCode: 'DOCK-001',
      status: 'ok',
    });
  });
});
