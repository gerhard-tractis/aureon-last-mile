import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

// A mutable holder, not the const directly — the "stale selection on
// refetch" test below needs a rerender to pick up NEW data from the same
// mocked hook, the same way a real refetch would.
let mockGroupsData: Array<Record<string, unknown>> = mockGroups;
vi.mock('@/hooks/distribution/usePendingSectorization', () => ({
  usePendingSectorization: () => ({ data: mockGroupsData, isLoading: false }),
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
  mockGroupsData = mockGroups;
  const { toast } = await import('sonner');
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('PendingSectorizationPage (route: /app/distribution/pendientes)', () => {
  it('renders the titled header and the pending list', () => {
    render(<PendingSectorizationPage />);
    expect(screen.getByText('Pendientes de sectorizar')).toBeInTheDocument();
    // spec-96 Fase 2 review (Task 2.4) — 4d's compact row leads with the
    // order, not the barcode (Distribucion.dc.html:620-621).
    expect(screen.getByText('Pedido #1001')).toBeInTheDocument();
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
    // spec-96 review — the row height now comes from the shared
    // FOOTER_METRICS-pattern wrapper (56px), not a literal class on the
    // link itself; the link fills it via h-full.
    expect(link.parentElement).toHaveStyle({ height: '56px' });
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

  // Fase 2 (spec-96) — `4d`'s DET/CMP control, wired at the page level.
  describe('DET / CMP', () => {
    it('defaults to DET, expanding the multi-bulto order', () => {
      render(<PendingSectorizationPage />);
      expect(screen.getByTestId('pendientes-mode-det')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('pending-package-pkg-2')).toBeInTheDocument();
    });

    it('switching to CMP collapses the multi-bulto order into one row', async () => {
      const user = userEvent.setup();
      render(<PendingSectorizationPage />);
      await user.click(screen.getByTestId('pendientes-mode-cmp'));
      expect(screen.getByTestId('pendientes-mode-cmp')).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId('pending-order-order-2')).toBeInTheDocument();
      expect(screen.queryByTestId('pending-package-pkg-2')).not.toBeInTheDocument();
    });
  });

  // Fase 2 (spec-96) — `4d`'s SEL control. Confirming a selection reuses
  // the same SendToDockSheet pipeline the single-order ⋯ affordance does.
  describe('SEL', () => {
    it('toggling SEL exposes an unchecked checkbox per order and hides the ⋯ affordances', async () => {
      const user = userEvent.setup();
      render(<PendingSectorizationPage />);
      await user.click(screen.getByTestId('pendientes-sel-toggle'));
      expect(screen.getByTestId('pendientes-sel-toggle')).toHaveAttribute('aria-pressed', 'true');
      const checkbox = within(screen.getByTestId('pending-order-order-1')).getByRole('checkbox');
      // Regression guard — a handler firing on click is not evidence the
      // box itself ever fills in.
      expect(checkbox).toHaveAttribute('aria-checked', 'false');
      expect(screen.queryAllByRole('button', { name: /enviar/i })).toHaveLength(0);
    });

    it('clicking a checkbox flips its aria-checked and shows the counter', async () => {
      const user = userEvent.setup();
      render(<PendingSectorizationPage />);
      await user.click(screen.getByTestId('pendientes-sel-toggle'));
      const checkbox = within(screen.getByTestId('pending-order-order-1')).getByRole('checkbox');
      await user.click(checkbox);
      expect(checkbox).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText('1 SELECCIONADO')).toBeInTheDocument();
    });

    // Review fix — the confirm bar used to be `sticky bottom-0` with no
    // `z-index` inside the scrolling list, painted over by this page's own
    // `fixed z-40` footer at every scroll position where the list
    // overflows. There must be exactly one fixed footer, and the confirm
    // action must live inside it — not float as a second element.
    it('the confirm action renders inside the single fixed footer, not a second floating element', async () => {
      const user = userEvent.setup();
      render(<PendingSectorizationPage />);
      await user.click(screen.getByTestId('pendientes-sel-toggle'));
      await user.click(within(screen.getByTestId('pending-order-order-1')).getByRole('checkbox'));
      const confirm = screen.getByTestId('pending-selection-confirm');
      const fixedFooters = document.querySelectorAll('.fixed.inset-x-0.bottom-0');
      expect(fixedFooters).toHaveLength(1);
      expect(fixedFooters[0].contains(confirm)).toBe(true);
    });

    it('selecting both orders and confirming opens the sheet and assigns every package', async () => {
      const user = userEvent.setup();
      render(<PendingSectorizationPage />);
      await user.click(screen.getByTestId('pendientes-sel-toggle'));
      await user.click(within(screen.getByTestId('pending-order-order-1')).getByRole('checkbox'));
      await user.click(within(screen.getByTestId('pending-order-order-2')).getByRole('checkbox'));
      await user.click(screen.getByTestId('pending-selection-confirm'));

      // The sheet is now open, driven by the combined request.
      expect(screen.getByRole('button', { name: 'Enviar a A1' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Enviar a A1' }));

      await vi.waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(3));
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ packageId: 'pkg-1', zoneId: 'zone-a1' }),
      );
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ packageId: 'pkg-2', zoneId: 'zone-a1' }),
      );
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ packageId: 'pkg-3', zoneId: 'zone-a1' }),
      );
    });

    // Review fix — Cancelar used to also exit SEL mode, dropping the
    // selection with no way back to the same ticks to double-check an
    // andén and resend. It must now only close the sheet.
    it('cancelling the sheet keeps the selection intact', async () => {
      const user = userEvent.setup();
      render(<PendingSectorizationPage />);
      await user.click(screen.getByTestId('pendientes-sel-toggle'));
      await user.click(within(screen.getByTestId('pending-order-order-1')).getByRole('checkbox'));
      await user.click(within(screen.getByTestId('pending-order-order-2')).getByRole('checkbox'));
      await user.click(screen.getByTestId('pending-selection-confirm'));

      await user.click(screen.getByRole('button', { name: 'Cancelar' }));

      expect(screen.getByTestId('pending-selection-confirm')).toBeInTheDocument();
      expect(
        within(screen.getByTestId('pending-order-order-1')).getByRole('checkbox'),
      ).toHaveAttribute('aria-checked', 'true');
      expect(
        within(screen.getByTestId('pending-order-order-2')).getByRole('checkbox'),
      ).toHaveAttribute('aria-checked', 'true');
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    // Review fix — `usePendingSectorization` refetches (15s staleTime +
    // focus refetch). A selected order that vanishes from the next fetch
    // (sectorized by a coworker mid-selection) must drop out of the
    // selection instead of staying ticked with nothing behind it.
    it('drops a selected order that disappears from a refetch, instead of overclaiming it', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<PendingSectorizationPage />);
      await user.click(screen.getByTestId('pendientes-sel-toggle'));
      await user.click(within(screen.getByTestId('pending-order-order-1')).getByRole('checkbox'));
      await user.click(within(screen.getByTestId('pending-order-order-2')).getByRole('checkbox'));
      expect(screen.getByText('2 SELECCIONADOS')).toBeInTheDocument();

      mockGroupsData = [
        {
          ...mockGroups[0],
          orders: (mockGroups[0].orders as Array<{ orderId: string }>).filter(
            (o) => o.orderId !== 'order-1',
          ),
        },
      ];
      rerender(<PendingSectorizationPage />);

      await vi.waitFor(() => expect(screen.getByText('1 SELECCIONADO')).toBeInTheDocument());
    });
  });
});
