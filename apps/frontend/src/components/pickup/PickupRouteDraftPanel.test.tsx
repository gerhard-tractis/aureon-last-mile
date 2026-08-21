import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupRouteDraftPanel } from './PickupRouteDraftPanel';
import type { ManifestRow } from './ManifestTable';

// StartRouteButton pops a dialog containing VehicleSelect, which reads real
// hooks. Mocked the same way VehicleSelect.test.tsx mocks them.
vi.mock('@/hooks/pickup/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/pickup/useVehicles')>(
    '@/hooks/pickup/useVehicles',
  );
  return {
    ...actual,
    useVehicles: () => ({ data: [], isLoading: false }),
    useCreateVehicle: () => ({ mutateAsync: vi.fn(), isPending: false }),
  };
});

const selected: ManifestRow[] = [
  {
    id: 'm1',
    externalLoadId: 'CARGA-001',
    pickupPoint: 'Easy Vespucio',
    retailerName: 'Easy',
    orderCount: 5,
    packageCount: 12,
    verifiedCount: 0,
  },
];

function baseProps() {
  return {
    operatorId: 'op-1',
    selected,
    onRemove: vi.fn(),
    onCreate: vi.fn(),
  };
}

describe('PickupRouteDraftPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Baseline. Without this the two gating tests below would still pass on a
  // panel that never renders a start button at all.
  it('offers the start button to a leader with a selection', () => {
    render(<PickupRouteDraftPanel {...baseProps()} />);
    expect(screen.getByRole('button', { name: /iniciar ruta/i })).toBeInTheDocument();
  });

  /**
   * spec-61 Task 5 — `1l` has its own start affordance, so gating only the
   * mobile 3j screen left a pickup_crew user on a laptop looking at a button
   * `start_pickup_route` refuses by role.
   */
  it('gives crew the ask-your-leader line instead of a start button', () => {
    render(<PickupRouteDraftPanel {...baseProps()} canLead={false} />);
    expect(screen.queryByRole('button', { name: /iniciar ruta/i })).toBeNull();
    expect(screen.getByText(/solo un líder de ruta puede abrir una ruta/i)).toBeInTheDocument();
  });

  // The default exists so every pre-spec-61 caller keeps its button. If the
  // default flipped to false, the desktop would silently lose the control.
  it('keeps the button when canLead is not passed at all', () => {
    render(<PickupRouteDraftPanel {...baseProps()} />);
    expect(screen.getByRole('button', { name: /iniciar ruta/i })).toBeInTheDocument();
    expect(screen.queryByText(/solo un líder de ruta/i)).toBeNull();
  });

  /**
   * spec-61 Task 5 — a FAILED active-route lookup is not an empty one. With
   * `data` undefined, `activeRouteCode` is null and this panel used to offer
   * the start button to a leader who already had a route open.
   */
  it('refuses to offer a start button while the active route is unknown', () => {
    render(<PickupRouteDraftPanel {...baseProps()} routeUnknown />);
    expect(screen.queryByRole('button', { name: /iniciar ruta/i })).toBeNull();
    expect(screen.getByText(/no pudimos cargar tu ruta/i)).toBeInTheDocument();
  });

  // Pre-existing behaviour, pinned because the two branches above were
  // inserted ahead of it and could have swallowed it.
  it('still says a route is already open when one is', () => {
    render(<PickupRouteDraftPanel {...baseProps()} activeRouteCode="PR-2026-0042" />);
    expect(screen.getByText('PR-2026-0042')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /iniciar ruta/i })).toBeNull();
  });

  it('still prompts for a selection when nothing is ticked', () => {
    render(<PickupRouteDraftPanel {...baseProps()} selected={[]} />);
    expect(screen.getByText(/marca los manifiestos de la tabla/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /iniciar ruta/i })).toBeNull();
  });
});
