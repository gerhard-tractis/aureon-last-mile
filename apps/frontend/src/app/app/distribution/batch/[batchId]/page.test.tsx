import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BatchScanPage from './page';

const mockScanMutateAsync = vi.fn();
const mockRedirectMutateAsync = vi.fn();
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ batchId: 'batch-1' }),
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

vi.mock('@/lib/context/GlobalContext', () => ({
  useGlobal: () => ({ user: { id: 'user-1' }, role: 'warehouse_staff' }),
}));

vi.mock('@/hooks/distribution/useDockBatches', () => ({
  useDockBatch: () => ({
    data: {
      id: 'batch-1',
      dock_zone_id: 'zone-a',
      package_count: 5,
      dock_zones: { name: 'Andén A', code: 'A1' },
    },
  }),
}));

const mockScans: Array<Record<string, unknown>> = [];
vi.mock('@/hooks/distribution/useDockScans', () => ({
  useDockScans: () => ({ data: mockScans }),
  useDockScanMutation: () => ({
    mutateAsync: mockScanMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/hooks/distribution/useRedirectBatchScan', () => ({
  useRedirectBatchScanToConsolidation: () => ({
    mutateAsync: mockRedirectMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/hooks/distribution/useDockZones', () => ({
  useDockZones: () => ({
    data: [
      { id: 'zone-a', name: 'Andén A', code: 'A1', is_consolidation: false, is_active: true, comunas: [] },
      { id: 'zone-b', name: 'Andén B', code: 'B1', is_consolidation: false, is_active: true, comunas: [] },
      { id: 'zone-cons', name: 'Consolidación', code: 'CONS', is_consolidation: true, is_active: true, comunas: [] },
    ],
  }),
}));

vi.mock('@/hooks/distribution/usePendingSectorization', () => ({
  usePendingSectorization: () => ({ data: [] }),
}));

vi.mock('@/hooks/distribution/useDockVerifications', () => ({
  useDockVerifications: () => ({ data: new Set<string>() }),
  useDockVerificationMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/distribution/useManualDockAssignment', () => ({
  useManualDockAssignment: () => ({ mutateAsync: vi.fn(), canUse: false }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockScans.length = 0;
  mockScanMutateAsync.mockResolvedValue({
    scanResult: 'accepted',
    packageId: 'pkg-1',
    packageLabel: 'PKG-001',
  });
  mockRedirectMutateAsync.mockResolvedValue({});
});

describe('BatchScanPage', () => {
  it('routes a normal package barcode through scanMutation', async () => {
    render(<BatchScanPage />);
    const input = screen.getByLabelText(/escáner de lote/i);
    fireEvent.change(input, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockScanMutateAsync).toHaveBeenCalled());
    expect(mockRedirectMutateAsync).not.toHaveBeenCalled();
  });

  it('shows the explicit "andén incorrecto" message when a different anden code is scanned', async () => {
    render(<BatchScanPage />);
    const input = screen.getByLabelText(/escáner de lote/i);
    fireEvent.change(input, { target: { value: 'B1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText(/asignación fallida.*andén incorrecto.*A1.*consolidación/i);
    expect(mockScanMutateAsync).not.toHaveBeenCalled();
    expect(mockRedirectMutateAsync).not.toHaveBeenCalled();
  });

  it('redirects the most recent accepted package to consolidación when CONS is scanned', async () => {
    render(<BatchScanPage />);
    const input = screen.getByLabelText(/escáner de lote/i);

    // First scan a package successfully — the page should remember pkg-1 / scan id
    mockScans.push({
      id: 'scan-1',
      barcode: 'PKG-001',
      scan_result: 'accepted',
      scanned_at: '2026-04-28T10:00:00Z',
      package_id: 'pkg-1',
    });
    fireEvent.change(input, { target: { value: 'PKG-001' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockScanMutateAsync).toHaveBeenCalled());

    // Now scan consolidación
    fireEvent.change(input, { target: { value: 'CONS' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockRedirectMutateAsync).toHaveBeenCalled());

    expect(mockRedirectMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        scanId: 'scan-1',
        packageId: 'pkg-1',
        consolidationZoneId: 'zone-cons',
      })
    );
  });

  it('does nothing on a CONS scan when no package has been accepted yet', async () => {
    render(<BatchScanPage />);
    const input = screen.getByLabelText(/escáner de lote/i);
    fireEvent.change(input, { target: { value: 'CONS' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(mockRedirectMutateAsync).not.toHaveBeenCalled();
    });
    expect(mockScanMutateAsync).not.toHaveBeenCalled();
  });
});
