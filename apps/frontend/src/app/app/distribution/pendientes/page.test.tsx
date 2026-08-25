import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PendingSectorizationPage from './page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1', userId: 'user-1', role: 'ops_leader' }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const zoneA = {
  id: 'zone-a1',
  name: 'Zona Norte',
  code: 'A1',
  is_consolidation: false,
  is_active: true,
  comunas: [{ id: 'c-1', nombre: 'Quilicura' }],
  operator_id: 'op-1',
  capacity: 180,
};

const consZone = {
  id: 'zone-cons',
  name: 'Consolidación',
  code: 'CONS',
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

const pkg = {
  id: 'pkg-1',
  label: 'BULTO-1',
  order_id: 'order-1',
  orderNumber: '1001',
  comunaId: 'c-1',
  comunaName: 'Quilicura',
  delivery_date: '2026-08-24',
  skuItems: [],
};

const pkg2 = {
  id: 'pkg-2',
  label: 'BULTO-2',
  order_id: 'order-2',
  orderNumber: '1002',
  comunaId: 'c-1',
  comunaName: 'Quilicura',
  delivery_date: '2026-08-24',
  skuItems: [],
};

const pkg3 = {
  id: 'pkg-3',
  label: 'BULTO-3',
  order_id: 'order-2',
  orderNumber: '1002',
  comunaId: 'c-1',
  comunaName: 'Quilicura',
  delivery_date: '2026-08-24',
  skuItems: [],
};

const mockGroups: Array<Record<string, unknown>> = [
  {
    zone: zoneA,
    matchResult: {
      zone_id: 'zone-a1',
      zone_name: 'Zona Norte',
      zone_code: 'A1',
      is_consolidation: false,
      reason: 'matched',
      flagged: false,
    },
    orders: [
      {
        orderId: 'order-1',
        orderNumber: '1001',
        deliveryDate: '2026-08-24',
        comunaName: 'Quilicura',
        packages: [pkg],
      },
      // A genuine multi-bulto order — needed to exercise a partial
      // failure WITHIN one send-to-dock confirmation (finding #6).
      {
        orderId: 'order-2',
        orderNumber: '1002',
        deliveryDate: '2026-08-24',
        comunaName: 'Quilicura',
        packages: [pkg2, pkg3],
      },
    ],
  },
];

vi.mock('@/hooks/distribution/usePendingSectorization', () => ({
  usePendingSectorization: () => ({ data: mockGroups, isLoading: false }),
}));

const mockMutateAsync = vi.fn().mockResolvedValue(undefined);
const mockUseManualDockAssignment = vi.fn(() => ({ canUse: true, mutateAsync: mockMutateAsync }));
vi.mock('@/hooks/distribution/useManualDockAssignment', () => ({
  useManualDockAssignment: (...args: unknown[]) => mockUseManualDockAssignment(...args),
}));

beforeEach(async () => {
  mockPush.mockClear();
  mockMutateAsync.mockClear();
  mockMutateAsync.mockResolvedValue(undefined);
  mockUseManualDockAssignment.mockClear();
  mockUseManualDockAssignment.mockImplementation(() => ({ canUse: true, mutateAsync: mockMutateAsync }));
  const { toast } = await import('sonner');
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('PendingSectorizationPage (route: /app/distribution/pendientes)', () => {
  it('renders the titled header and the pending list', () => {
    render(<PendingSectorizationPage />);
    expect(screen.getByText('Pendientes de sectorizar')).toBeInTheDocument();
    expect(screen.getByText('BULTO-1')).toBeInTheDocument();
  });

  it('the back arrow returns to the distribution home', async () => {
    const user = userEvent.setup();
    render(<PendingSectorizationPage />);
    await user.click(screen.getByRole('button', { name: /volver/i }));
    expect(mockPush).toHaveBeenCalledWith('/app/distribution');
  });

  it('the fixed footer offers Escanear to quicksort at the primary touch floor', () => {
    render(<PendingSectorizationPage />);
    const link = screen.getByRole('link', { name: /escanear/i });
    expect(link).toHaveAttribute('href', '/app/distribution/quicksort');
    expect(link.className).toMatch(/h-\[?(5[6-9]|60)/);
  });

  it('tapping the ⋯ affordance opens the send-to-dock sheet, and confirming assigns the package', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    render(<PendingSectorizationPage />);
    await user.click(screen.getByRole('button', { name: /enviar bulto-1 a andén/i }));
    expect(screen.getByText('Enviar BULTO-1 a')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Enviar a A1' }));
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        packageId: 'pkg-1',
        zoneId: 'zone-a1',
        barcode: 'BULTO-1',
        isConsolidation: false,
      }),
    );
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('never shows the ⋯ affordance or the sheet when canUse is false', () => {
    mockUseManualDockAssignment.mockImplementation(() => ({ canUse: false, mutateAsync: mockMutateAsync }));
    render(<PendingSectorizationPage />);
    expect(screen.queryByRole('button', { name: /enviar/i })).not.toBeInTheDocument();
  });

  // Finding #6 (Fase 3 review) — passes silentErrors so the hook's own
  // per-mutation toast never fires; the page is solely responsible for
  // the one summary toast asserted below.
  it('opts the shared hook into silentErrors so only the page summary toast fires', () => {
    render(<PendingSectorizationPage />);
    expect(mockUseManualDockAssignment).toHaveBeenCalledWith('op-1', 'user-1', { silentErrors: true });
  });

  // Finding #6 — a multi-package request (order-level "enviar todo") with
  // a partial failure must summarize once, naming both outcomes, not fire
  // one toast per package. Drives order-2's real two-bulto "enviar todo"
  // affordance so both mutateAsync calls belong to the SAME confirmation.
  it('summarizes a partially-failed multi-package send in one toast, not one per package', async () => {
    const user = userEvent.setup();
    const { toast } = await import('sonner');
    mockMutateAsync
      .mockResolvedValueOnce(undefined) // pkg-2 succeeds
      .mockRejectedValueOnce(new Error('network blip')); // pkg-3 fails

    render(<PendingSectorizationPage />);
    await user.click(screen.getByRole('button', { name: /enviar pedido 1002 a andén/i }));
    await user.click(screen.getByRole('button', { name: 'Enviar a A1' }));

    await vi.waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(2));
    // Exactly ONE toast for this whole confirmation, not one per package —
    // and it must be the failure-summary toast, since one of the two
    // packages didn't make it.
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalled();
  });

  // spec-68 Fase 6 accessibility sweep (6.3) — regression guard: this
  // route's only heading used to be DistributionMobileHeader's <h2>, so it
  // shipped with zero <h1>s. Fixed by promoting the titled variant's title
  // to <h1> (Fase 6).
  it('carries exactly one top-level heading', () => {
    render(<PendingSectorizationPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
