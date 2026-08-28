import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickSortPage from './page';
import type { ZoneGroup } from '@/hooks/distribution/usePendingSectorization';

const mockVerifyMutate = vi.fn();
const mockManualMutate = vi.fn();
const mockManualMutateAsync = vi.fn();

let pendingGroups: ZoneGroup[] = [];
let verifiedIds = new Set<string>();
let managerCanAssign = false;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1' }),
}));

vi.mock('@/lib/context/GlobalContext', () => ({
  useGlobal: () => ({ user: { id: 'user-1' }, role: 'warehouse_staff' }),
}));

// The scanner owns a Supabase-backed mutation of its own; this page's contract
// is the pending list beside it, so the scanner is stubbed out here. Renders
// the `mode` prop it was given so the header toggle (spec-71 phase 3 review
// item 2) can be asserted without un-stubbing the whole scanner.
vi.mock('@/components/distribution/QuickSortScanner', () => ({
  QuickSortScanner: ({ mode }: { mode?: string }) => (
    <div data-testid="quicksort-scanner" data-mode={mode} />
  ),
}));

let belowLg = false;
vi.mock('@/hooks/useViewport', () => ({
  useIsBelowLg: () => belowLg,
}));

vi.mock('@/components/distribution/QuickSortMobileView', () => ({
  QuickSortMobileView: () => <div data-testid="quicksort-mobile-view" />,
}));

vi.mock('@/hooks/distribution/useDockZones', () => ({
  useDockZones: () => ({
    data: [
      {
        id: 'zone-a',
        name: 'Andén A',
        code: 'A1',
        is_consolidation: false,
        is_active: true,
        comunas: [],
      },
      {
        id: 'zone-cons',
        name: 'Consolidación',
        code: 'CONS',
        is_consolidation: true,
        is_active: true,
        comunas: [],
      },
    ],
  }),
}));

vi.mock('@/hooks/distribution/useSectorizedByZone', () => ({
  useSectorizedByZone: () => ({ data: {} }),
}));

vi.mock('@/hooks/distribution/useDistributionKPIs', () => ({
  useDistributionKPIs: () => ({
    data: { pending: 4, consolidation: 0, dueSoon: 0 },
  }),
}));

vi.mock('@/hooks/distribution/useUnmatchedComunas', () => ({
  useUnmatchedComunas: () => ({ data: [] }),
}));

vi.mock('@/hooks/distribution/usePendingSectorization', () => ({
  usePendingSectorization: () => ({ data: pendingGroups }),
}));

vi.mock('@/hooks/distribution/useDockVerifications', () => ({
  useDockVerifications: () => ({ data: verifiedIds }),
  useDockVerificationMutation: () => ({
    mutate: mockVerifyMutate,
    mutateAsync: vi.fn(),
  }),
}));

vi.mock('@/hooks/distribution/useManualDockAssignment', () => ({
  useManualDockAssignment: () => ({
    mutate: mockManualMutate,
    mutateAsync: mockManualMutateAsync,
    get canUse() {
      return managerCanAssign;
    },
  }),
}));

function zoneGroup(): ZoneGroup {
  return {
    zone: {
      id: 'zone-a',
      name: 'Andén A',
      code: 'A1',
      is_consolidation: false,
      is_active: true,
      comunas: [],
    },
    matchResult: { matched: true },
    orders: [
      {
        orderId: 'ord-1',
        orderNumber: 'ORD-2026-0001',
        deliveryDate: '2026-08-21',
        comunaName: 'Las Condes',
        packages: [
          {
            id: 'pkg-1',
            label: 'PKG-MUSAN-0001',
            order_id: 'ord-1',
            orderNumber: 'ORD-2026-0001',
            comunaId: 'com-1',
            comunaName: 'Las Condes',
            delivery_date: '2026-08-21',
            skuItems: [],
          },
        ],
      },
    ],
  } as ZoneGroup;
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingGroups = [zoneGroup()];
  verifiedIds = new Set<string>();
  managerCanAssign = false;
  belowLg = false;
});

describe('QuickSortPage — pending list (spec-39 regression)', () => {
  it('lists the packages pending sectorisation alongside the scanner', () => {
    render(<QuickSortPage />);

    expect(screen.getByTestId('quicksort-scanner')).toBeInTheDocument();
    expect(screen.getByTestId('pending-row-pkg-1')).toBeInTheDocument();
    expect(screen.getByText('PKG-MUSAN-0001')).toBeInTheDocument();
  });

  it('renders the pending empty state when nothing is waiting', () => {
    pendingGroups = [];
    render(<QuickSortPage />);

    expect(
      screen.getByText(/no hay paquetes pendientes en este momento/i),
    ).toBeInTheDocument();
  });

  it('tapping a pending row records a tap verification', () => {
    render(<QuickSortPage />);

    fireEvent.click(screen.getByTestId('pending-row-pkg-1'));

    expect(mockVerifyMutate).toHaveBeenCalledWith({
      packageId: 'pkg-1',
      source: 'tap',
    });
  });

  it('does not re-verify a row that is already verified', () => {
    verifiedIds = new Set(['pkg-1']);
    render(<QuickSortPage />);

    fireEvent.click(screen.getByTestId('pending-row-pkg-1'));

    expect(mockVerifyMutate).not.toHaveBeenCalled();
  });

  it('hides the manual-assign menu from operators who may not use it', () => {
    render(<QuickSortPage />);

    expect(
      screen.queryByLabelText(/asignar manualmente/i),
    ).not.toBeInTheDocument();
  });

  it('offers the manual-assign menu to managers', () => {
    managerCanAssign = true;
    render(<QuickSortPage />);

    expect(
      screen.getAllByLabelText(/asignar manualmente/i).length,
    ).toBeGreaterThan(0);
  });
});

// spec-68 Fase 5.5 — below `lg` this route renders QuickSortMobileView
// instead of the desktop tree above; the desktop tree must not also mount.
describe('QuickSortPage — isBelowLg branch', () => {
  it('renders the desktop tree at/above lg', () => {
    belowLg = false;
    render(<QuickSortPage />);
    expect(screen.getByTestId('quicksort-scanner')).toBeInTheDocument();
    expect(screen.queryByTestId('quicksort-mobile-view')).not.toBeInTheDocument();
  });

  it('renders QuickSortMobileView below lg, and NOT the desktop tree', () => {
    belowLg = true;
    render(<QuickSortPage />);
    expect(screen.getByTestId('quicksort-mobile-view')).toBeInTheDocument();
    expect(screen.queryByTestId('quicksort-scanner')).not.toBeInTheDocument();
  });
});

// spec-71 phase 3 review item 2 — before this toggle, nothing in the product
// ever passed mode='stage' to QuickSortScanner; the staging pass was
// unreachable. This is its only entry point.
describe('QuickSortPage — stage mode toggle (spec-71 phase 3)', () => {
  it('defaults to sectorize mode', () => {
    render(<QuickSortPage />);
    expect(screen.getByTestId('quicksort-scanner')).toHaveAttribute('data-mode', 'sectorize');
  });

  it('switches the scanner to stage mode via the Estibar tab', async () => {
    const user = userEvent.setup();
    render(<QuickSortPage />);
    await user.click(screen.getByRole('tab', { name: 'Estibar' }));
    expect(screen.getByTestId('quicksort-scanner')).toHaveAttribute('data-mode', 'stage');
  });

  it('switches back to sectorize mode via the Sectorizar tab', async () => {
    const user = userEvent.setup();
    render(<QuickSortPage />);
    await user.click(screen.getByRole('tab', { name: 'Estibar' }));
    await user.click(screen.getByRole('tab', { name: 'Sectorizar' }));
    expect(screen.getByTestId('quicksort-scanner')).toHaveAttribute('data-mode', 'sectorize');
  });

  // spec-71 phase 4, review finding #1 (HIGH). SealPositionCard used to mount
  // an always-armed ScanField, which focuses on mount and renders after the
  // package field — so it won the focus race and swallowed package scans.
  // Collapsed by default now: no field exists until the operator taps.
  it('mounts no seal scan field when switching to Estibar — it must not arm itself', async () => {
    const user = userEvent.setup();
    render(<QuickSortPage />);
    await user.click(screen.getByRole('tab', { name: 'Estibar' }));

    expect(screen.getByRole('button', { name: 'Sellar posición' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Escanear posición a sellar')).not.toBeInTheDocument();
  });
});
