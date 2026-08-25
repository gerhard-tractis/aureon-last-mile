import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConsolidationPage from './page';

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

vi.mock('@/hooks/distribution/useDockZones', () => ({
  useDockZones: () => ({ data: [zoneA, consZone] }),
}));

vi.mock('@/hooks/distribution/useSectorizedByZone', () => ({
  useSectorizedByZone: () => ({ data: { 'zone-a1': 169 } }),
}));

const pkg1 = {
  id: 'pkg-1',
  label: 'BULTO-1',
  dock_zone_id: 'zone-cons',
  order_id: 'order-1',
  delivery_date: '2026-08-25',
  comunaId: 'c-1',
  comunaName: 'Quilicura',
};

const pkg2 = {
  id: 'pkg-2',
  label: 'BULTO-2',
  dock_zone_id: 'zone-cons',
  order_id: 'order-2',
  delivery_date: '2026-09-01',
  comunaId: 'c-1',
  comunaName: 'Quilicura',
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
    mockPackages = [pkg2]; // due 2026-09-01, far out
    render(<ConsolidationPage />);
    expect(screen.queryByText(/SALEN YA/)).not.toBeInTheDocument();
  });

  it('the back arrow returns to the distribution home', async () => {
    const user = userEvent.setup();
    render(<ConsolidationPage />);
    await user.click(screen.getByRole('button', { name: /volver/i }));
    expect(mockPush).toHaveBeenCalledWith('/app/distribution');
  });

  // Decisión 6 — absent entirely, not disabled, when the role can't manual-assign.
  it('warehouse_staff sees no fixed action footer at all', () => {
    mockCanUse = false;
    mockRole = 'warehouse_staff';
    render(<ConsolidationPage />);
    expect(screen.queryByRole('button', { name: /mover a andén/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /liberar a sectorización/i })).not.toBeInTheDocument();
  });

  it('ops_leader sees the footer, both actions disabled with zero selection', () => {
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
});
