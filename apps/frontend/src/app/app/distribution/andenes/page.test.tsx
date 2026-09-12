import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import AndenesPage from './page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

let mockOperatorId: string | null = 'op-1';
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: mockOperatorId, userId: 'user-1', role: 'ops_leader' }),
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

const zoneUnconfigured = {
  id: 'zone-b1',
  name: 'Consolidación',
  code: 'CONS',
  is_consolidation: true,
  is_active: true,
  comunas: [],
  operator_id: 'op-1',
  capacity: null,
};

// spec-68 Fase 6 review (finding #2) — module-level mutable mock state,
// reset in beforeEach/afterEach rather than at the tail of each test body.
// A reset that only runs after the assertions never fires if an assertion
// throws, and the leaked value then cascades into every test that runs
// after it — one real failure reads as a whole run of unrelated ones.
let mockZones: unknown[] | undefined = [zoneA];
let mockZonesLoading = false;
let mockZonesError = false;

vi.mock('@/hooks/distribution/useDockZones', () => ({
  useDockZones: () => ({ data: mockZones, isLoading: mockZonesLoading, isError: mockZonesError }),
}));

vi.mock('@/hooks/distribution/useSectorizedByZone', () => ({
  useSectorizedByZone: () => ({ data: { 'zone-a1': 42 } }),
}));

// spec-96 Fase 8 review round 1 (finding #1) — `usePendingSectorization`'s
// `ZoneGroup[]` shape, kept minimal: only the fields
// `countUnassignedComunas`/`determineDockZone` actually read.
let mockPendingGroups: unknown[] = [];
let mockPendingLoading = false;
vi.mock('@/hooks/distribution/usePendingSectorization', () => ({
  usePendingSectorization: () => ({ data: mockPendingGroups, isLoading: mockPendingLoading }),
}));

// A past delivery date is always "active" per isDeliveryDateActive
// (delivery <= tomorrow), regardless of when the suite runs.
const PAST_DATE = '2020-01-01';

function flaggedOrder(orderId: string, comunaId: string, comunaName: string) {
  return {
    orderId,
    orderNumber: orderId,
    deliveryDate: PAST_DATE,
    comunaName,
    packages: [
      {
        id: `${orderId}-p1`,
        label: `BULTO-${orderId}`,
        order_id: orderId,
        orderNumber: orderId,
        comunaId,
        comunaName,
        delivery_date: PAST_DATE,
        skuItems: [],
      },
    ],
  };
}

beforeEach(() => {
  mockOperatorId = 'op-1';
  mockZones = [zoneA];
  mockZonesLoading = false;
  mockZonesError = false;
  mockPendingGroups = [];
  mockPendingLoading = false;
});

afterEach(() => {
  mockOperatorId = 'op-1';
  mockZones = [zoneA];
  mockZonesLoading = false;
  mockZonesError = false;
  mockPendingGroups = [];
  mockPendingLoading = false;
});

describe('AndenesPage', () => {
  it('renders a titled header with back navigation', () => {
    render(<AndenesPage />);
    expect(screen.getByRole('heading', { name: 'Andenes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /volver/i })).toBeInTheDocument();
  });

  it('renders the dock list with zone data', () => {
    render(<AndenesPage />);
    expect(screen.getByTestId('dock-list-row-zone-a1')).toBeInTheDocument();
  });

  it('shows a loading skeleton while zones are loading', () => {
    mockZonesLoading = true;
    mockZones = undefined;
    render(<AndenesPage />);
    expect(screen.queryByTestId('dock-list-row-zone-a1')).not.toBeInTheDocument();
    expect(screen.getByTestId('andenes-skeleton')).toBeInTheDocument();
  });

  it('shows the empty state with no active zones', () => {
    mockZones = [];
    render(<AndenesPage />);
    expect(screen.getByText('Sin andenes configurados')).toBeInTheDocument();
  });

  // spec-68 Fase 6 review (finding #1) — `useDockZones` is
  // `enabled: !!operatorId`, and `GlobalContext` initialises `operatorId`
  // to `null` while `AppLayout` renders children unconditionally. React
  // Query v5's `isLoading` is `isPending && isFetching`: a DISABLED query
  // has `isFetching: false`, so on every cold load `isLoading` was false
  // too — the old `zonesLoading` gate rendered `DockListMobile` with the
  // `zones = []` default and flashed "Sin andenes configurados" /
  // "0 andenes activos" at a crew standing in front of a fully configured
  // warehouse, before `operatorId` resolved a beat later.
  it('does not flash the empty state on a cold load — operatorId still null, query disabled', () => {
    mockOperatorId = null;
    mockZones = undefined;
    mockZonesLoading = false; // exactly what a disabled query reports
    render(<AndenesPage />);
    expect(screen.queryByText('Sin andenes configurados')).not.toBeInTheDocument();
    expect(screen.getByTestId('andenes-skeleton')).toBeInTheDocument();
  });

  // spec-68 Fase 6 review (finding #1) — on a genuine query failure
  // (offline warehouse, RLS), `isLoading` is false and `data` stays
  // undefined FOREVER. The old code had no error branch at all, so this
  // was indistinguishable from "no andenes configured" — permanently. "No
  // hay andenes" and "no pude cargar los andenes" are different facts and
  // must not share a screen.
  it('shows an error state, not the empty state, when the zones query fails', () => {
    mockZones = undefined;
    mockZonesLoading = false;
    mockZonesError = true;
    render(<AndenesPage />);
    expect(screen.queryByText('Sin andenes configurados')).not.toBeInTheDocument();
    expect(screen.getByText(/no pudimos cargar los andenes/i)).toBeInTheDocument();
  });

  // spec-68 Fase 6 accessibility sweep (6.3).
  it('carries exactly one top-level heading', () => {
    render(<AndenesPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  // spec-68 Fase 6 accessibility sweep (6.3) — the error state must not
  // itself introduce a second <h1> or drop the route's only heading.
  it('still carries exactly one top-level heading in the error state', () => {
    mockZones = undefined;
    mockZonesError = true;
    render(<AndenesPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  // spec-96 Fase 8 (4l) — the subtitle's unconfigured-capacity count must
  // track the zones the route already fetched, not stay silent about it.
  // Review round 2 (finding #4) — the reviewer A/B tested a sr-only mirror
  // span against an exact-string assertion on the real subtitle text: the
  // exact match kills the same hardcode mutation with no DOM addition and
  // no a11y regression (a screen reader would otherwise announce a bare
  // "1" right after a header that already said "1 sin abrir"). Asserting
  // the whole computed string, not a decorative substring, is the
  // behavioural anchor — round 1's bug was `/1 sin abrir/` matching inside
  // a different, wrong number, which an exact `getByText` cannot do.
  it('carries the unconfigured-capacity count, derived from the zones', () => {
    mockZones = [zoneA, { ...zoneUnconfigured, is_consolidation: false, id: 'zone-real' }];
    render(<AndenesPage />);
    expect(screen.getByText('2 activos · 1 sin abrir')).toBeInTheDocument();
  });

  it('omits the unconfigured mention when every active zone has a capacity', () => {
    mockZones = [zoneA];
    render(<AndenesPage />);
    expect(screen.getByText('1 activo')).toBeInTheDocument();
  });

  // Review round 1 (finding #4) — capacity: 0 has no CHECK constraint
  // preventing it; must land in "unconfigured" the same as null.
  it('treats an active zone with capacity: 0 as unconfigured', () => {
    mockZones = [{ ...zoneA, capacity: 0 }];
    render(<AndenesPage />);
    expect(screen.getByText('1 activo · 1 sin abrir')).toBeInTheDocument();
  });

  // Review round 2 (finding #3) — the consolidation zone carries
  // `capacity: null` by design (no `Editar` action in Configuración de
  // Andenes); it must never count toward "sin abrir".
  it('does not count the consolidation zone toward "sin abrir"', () => {
    mockZones = [zoneA, zoneUnconfigured];
    render(<AndenesPage />);
    expect(screen.getByText('2 activos')).toBeInTheDocument();
    expect(screen.queryByText(/sin abrir/)).not.toBeInTheDocument();
  });

  // spec-96 Fase 8 (4l) review round 1 (finding #1) — the footer banner
  // over comunas falling to consolidation for want of a covering andén.
  // `get_unmatched_comunas`/`useUnmatchedComunas` cannot source this: its
  // predicate (`comuna_id IS NULL`) is the exact complement of
  // `determineDockZone`'s `flagged` (`comunaId !== null`) — zero overlap.
  // This recomputes per order over `usePendingSectorization`'s data
  // instead, the same way `PendingMobileList` already does.
  describe('the comunas-without-dock banner', () => {
    it('counts distinct comunas among flagged orders, not raw rows', () => {
      mockZones = [zoneA, zoneUnconfigured];
      mockPendingGroups = [
        {
          zone: zoneUnconfigured,
          matchResult: { zone_id: 'zone-b1', zone_name: 'x', zone_code: 'x', is_consolidation: true, reason: 'unmapped', flagged: false },
          orders: [
            flaggedOrder('o1', 'c-901', 'Melipilla'),
            // same comuna as o1, different order — must count once, not twice
            flaggedOrder('o2', 'c-901', 'Melipilla'),
            flaggedOrder('o3', 'c-902', 'Til Til'),
          ],
        },
      ];
      render(<AndenesPage />);
      const banner = screen.getByTestId('unassigned-comunas-banner');
      expect(within(banner).getByTestId('unassigned-comunas-count')).toHaveTextContent('2');
    });

    it('excludes an order whose comuna is unknown (comunaId null — a different predicate)', () => {
      mockZones = [zoneA, zoneUnconfigured];
      mockPendingGroups = [
        {
          zone: zoneUnconfigured,
          matchResult: { zone_id: 'zone-b1', zone_name: 'x', zone_code: 'x', is_consolidation: true, reason: 'unmapped', flagged: false },
          orders: [
            {
              orderId: 'o1',
              orderNumber: 'o1',
              deliveryDate: PAST_DATE,
              comunaName: null,
              packages: [
                {
                  id: 'o1-p1',
                  label: 'BULTO-o1',
                  order_id: 'o1',
                  orderNumber: 'o1',
                  comunaId: null,
                  comunaName: null,
                  delivery_date: PAST_DATE,
                  skuItems: [],
                },
              ],
            },
          ],
        },
      ];
      render(<AndenesPage />);
      expect(screen.queryByTestId('unassigned-comunas-banner')).not.toBeInTheDocument();
    });

    it('excludes an order matched to a real zone', () => {
      mockZones = [zoneA, zoneUnconfigured];
      mockPendingGroups = [
        {
          zone: zoneA,
          matchResult: { zone_id: 'zone-a1', zone_name: 'x', zone_code: 'x', is_consolidation: false, reason: 'matched', flagged: false },
          // zoneA covers comuna 'c-1' (Quilicura) — this order matches it.
          orders: [flaggedOrder('o1', 'c-1', 'Quilicura')],
        },
      ];
      render(<AndenesPage />);
      expect(screen.queryByTestId('unassigned-comunas-banner')).not.toBeInTheDocument();
    });

    it('omits the banner when there is nothing flagged', () => {
      mockZones = [zoneA, zoneUnconfigured];
      mockPendingGroups = [];
      render(<AndenesPage />);
      expect(screen.queryByTestId('unassigned-comunas-banner')).not.toBeInTheDocument();
    });

    // Review round 2 (finding #6) — while the packages query is still
    // settling, the count reads 0 exactly like "confirmed none flagged"
    // would, and that gap is indistinguishable from the truncation error
    // usePendingSectorization now throws. A quiet, distinct loading state
    // closes that gap instead of silently rendering nothing.
    it('shows a quiet loading state instead of silently omitting the banner', () => {
      mockZones = [zoneA, zoneUnconfigured];
      mockPendingGroups = [];
      mockPendingLoading = true;
      render(<AndenesPage />);
      expect(screen.getByTestId('unassigned-comunas-checking')).toBeInTheDocument();
      expect(screen.queryByTestId('unassigned-comunas-banner')).not.toBeInTheDocument();
    });

    it('does not show the loading state once the query settles with nothing flagged', () => {
      mockZones = [zoneA, zoneUnconfigured];
      mockPendingGroups = [];
      mockPendingLoading = false;
      render(<AndenesPage />);
      expect(screen.queryByTestId('unassigned-comunas-checking')).not.toBeInTheDocument();
    });
  });
});
