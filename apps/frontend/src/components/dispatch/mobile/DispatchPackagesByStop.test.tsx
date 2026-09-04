import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchPackagesByStop } from './DispatchPackagesByStop';
import type { RawDispatchRow, RawPackageRow } from '@/lib/dispatch/mobile/route-packages-by-stop';

const mockUseRoutePackagesByStop = vi.fn();
vi.mock('@/hooks/dispatch/mobile/useRoutePackagesByStop', () => ({
  useRoutePackagesByStop: (...args: unknown[]) => mockUseRoutePackagesByStop(...args),
}));

const mutateMock = vi.fn();
const resetMock = vi.fn();
let mutationState: { isPending: boolean; error: unknown };
vi.mock('@/hooks/dispatch/mobile/useRemovePackageFromRoute', () => ({
  useRemovePackageFromRoute: () => ({ mutate: mutateMock, reset: resetMock, isPending: mutationState.isPending, error: mutationState.error }),
}));

const dispatches: RawDispatchRow[] = [
  { dispatch_id: 'd1', order_id: 'o1', order_number: 'ORD-1', contact_address: 'Los Aromos 442', client_name: 'Javiera Muñoz' },
  { dispatch_id: 'd2', order_id: 'o2', order_number: 'ORD-2', contact_address: 'Av. Kennedy 5001', client_name: 'Pedro Salas' },
];

const packages: RawPackageRow[] = [
  { id: 'p1', order_id: 'o1', label: 'CL8841881', package_number: '1 de 2', status: 'en_carga', loaded_at: '2026-09-03T14:07:00.000Z' },
  { id: 'p2', order_id: 'o1', label: 'CL8841882', package_number: '2 de 2', status: 'en_carga', loaded_at: '2026-09-03T14:22:00.000Z' },
  { id: 'p3', order_id: 'o2', label: 'CL8841883', package_number: null, status: 'en_carga', loaded_at: '2026-09-03T15:01:00.000Z' },
  { id: 'p4', order_id: 'o2', label: 'CL8841884', package_number: null, status: 'retenido', loaded_at: null },
];

function renderScreen(overrides: Partial<Parameters<typeof DispatchPackagesByStop>[0]> = {}) {
  return render(
    <DispatchPackagesByStop
      routeId="r1"
      operatorId="op-1"
      routeCode="RUT-0099"
      ordersCount={2}
      stopsCount={2}
      onBack={vi.fn()}
      {...overrides}
    />,
  );
}

describe('DispatchPackagesByStop', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    resetMock.mockReset();
    mutationState = { isPending: false, error: null };
    mockUseRoutePackagesByStop.mockReturnValue({
      data: { dispatches, packages },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it('spec-76 2h — header shows loaded count (not raw row count), route code, orders and stops', () => {
    renderScreen();
    // 3 loaded (p1, p2, p3) — p4 is retenido/unloaded and must NOT inflate this.
    expect(screen.getByText('3 paquetes cargados')).toBeInTheDocument();
    expect(screen.getByText(/RUT-0099/)).toBeInTheDocument();
    expect(screen.getByText(/2 órdenes/)).toBeInTheDocument();
    expect(screen.getByText(/2 paradas/)).toBeInTheDocument();
  });

  it('spec-76 2h #18 — groups by stop by default, with the Incompletas count', () => {
    renderScreen();
    expect(screen.getByText('Parada 01')).toBeInTheDocument();
    expect(screen.getByText('Parada 02')).toBeInTheDocument();
    expect(screen.getByText(/incompletas \(1\)/i)).toBeInTheDocument();
  });

  it('spec-76 2h #20 — a retenido package shows NO EMBARCADO on its stop', () => {
    renderScreen();
    expect(screen.getByText('NO EMBARCADO')).toBeInTheDocument();
  });

  it('toggles to "Por hora" grouping', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: /por hora/i }));
    expect(screen.getByRole('button', { name: /por hora/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('spec-76 2h #18 — Incompletas filter narrows to only the incomplete order\'s stop', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: /incompletas/i }));
    expect(screen.queryByText('Parada 02')).not.toBeInTheDocument(); // "Los Aromos" (o1) sorts stop 2, complete
    expect(screen.getByText('Parada 01')).toBeInTheDocument(); // "Av. Kennedy" (o2) sorts stop 1, incomplete
  });

  it('"Volver al escaneo" calls onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderScreen({ onBack });
    await user.click(screen.getByRole('button', { name: /volver al escaneo/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('spec-76 2h #19 — removing a row opens the confirm sheet and submits through the mutation', async () => {
    const user = userEvent.setup();
    renderScreen();
    const rows = screen.getAllByRole('button', { name: /quitar/i });
    await user.click(rows[0]);
    expect(screen.getByRole('heading', { name: /quitar pedido/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Motivo para quitar el pedido'), 'Dañado en tránsito');
    await user.click(screen.getByRole('button', { name: /^quitar pedido$/i }));
    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({ routeId: 'r1', reason: 'Dañado en tránsito' }),
      expect.anything(),
    );
  });

  it('shows a loading state', () => {
    mockUseRoutePackagesByStop.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() });
    renderScreen();
    expect(screen.getByTestId('dispatch-packages-by-stop-loading')).toBeInTheDocument();
  });

  it('shows an error state with a retry, not a silently empty "0 paquetes"', () => {
    const refetch = vi.fn();
    mockUseRoutePackagesByStop.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    renderScreen();
    expect(screen.getByTestId('dispatch-packages-by-stop-error')).toBeInTheDocument();
    expect(screen.queryByText(/paquetes cargados/)).not.toBeInTheDocument();
  });
});
