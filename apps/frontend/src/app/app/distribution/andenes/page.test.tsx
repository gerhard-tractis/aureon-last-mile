import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

beforeEach(() => {
  mockOperatorId = 'op-1';
  mockZones = [zoneA];
  mockZonesLoading = false;
  mockZonesError = false;
});

afterEach(() => {
  mockOperatorId = 'op-1';
  mockZones = [zoneA];
  mockZonesLoading = false;
  mockZonesError = false;
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
});
