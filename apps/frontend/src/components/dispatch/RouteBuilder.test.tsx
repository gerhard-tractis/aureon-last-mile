import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteBuilder } from './RouteBuilder';
import type { RouteStatus, RoutePackage, DispatchRoute } from '@/lib/dispatch/types';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const refetchMock = vi.fn();
let mockPackages: RoutePackage[] = [];
vi.mock('@/hooks/dispatch/useRoutePackages', () => ({
  useRoutePackages: () => ({ data: mockPackages, refetch: refetchMock }),
}));

vi.mock('@/hooks/dispatch/useScanPackage', () => ({
  useScanPackage: () => ({ mutateAsync: vi.fn() }),
}));

// spec-70 phase 4, breakage #3: RouteBuilder derives everything from the
// route's real status now, fetched through useDispatchRoute — not a
// `useState` a page reload wiped.
let mockRouteStatus: RouteStatus | undefined = 'draft';
vi.mock('@/hooks/dispatch/useDispatchRoute', () => ({
  useDispatchRoute: () => ({
    data: mockRouteStatus ? ({ status: mockRouteStatus } as DispatchRoute) : undefined,
  }),
}));

function pkg(overrides: Partial<RoutePackage> = {}): RoutePackage {
  return {
    dispatch_id: 'd1',
    order_id: 'o1',
    order_number: 'ORD-1',
    contact_name: 'Mario',
    contact_address: 'Calle 1',
    contact_phone: null,
    status: 'pending',
    stage: 'staged',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPackages = [];
  mockRouteStatus = 'draft';
  global.fetch = vi.fn();
});

/**
 * spec-70 decision 4: the plan/load gap has to be visible during loading, not
 * discovered only when the seal refuses.
 */
describe('RouteBuilder — pending-to-stage visibility', () => {
  it('shows a live "faltan N por estibar" count when stops are still planned', () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'planned' }), pkg({ dispatch_id: 'd2', stage: 'staged' })];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByText(/faltan 1 por estibar/i)).toBeInTheDocument();
  });

  it('shows nothing pending once every stop is staged', () => {
    mockPackages = [pkg({ stage: 'staged' })];
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.queryByText(/por estibar/i)).not.toBeInTheDocument();
  });
});

/**
 * spec-70 phase 4, breakage #3: the header badge, the scan zone, and every
 * button in RoutePanel used to answer to a local `routeClosed` boolean that
 * defaulted to `false` on every mount — reload the page and a sealed route
 * looked open again. They now read the fetched route status.
 */
describe('RouteBuilder — route status is the source of truth', () => {
  it('shows the real route status label in the header, not a hardcoded Borrador/Listo pair', () => {
    mockRouteStatus = 'loaded';
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByText('Cargada')).toBeInTheDocument();
  });

  it('disables the scan input once the route is loaded — matching what /scan refuses server-side', () => {
    mockRouteStatus = 'loaded';
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByPlaceholderText(/Escanea barcode/i)).toBeDisabled();
  });

  it('keeps the scan input enabled while the route is still loading', () => {
    mockRouteStatus = 'loading';
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByPlaceholderText(/Escanea barcode/i)).toBeEnabled();
  });

  it('survives a "reload": a route already loaded stays loaded without any local click', () => {
    // The old bug: routeClosed always started false, so a mid-session
    // remount (what a page reload does) showed a sealed route as open again.
    mockRouteStatus = 'loaded';
    const { unmount } = render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    unmount();
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByText('Cargada')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Escanea barcode/i)).toBeDisabled();
  });
});

/**
 * spec-70 phase 3: the seal button used to POST to a bare `/close` and ignore
 * a non-ok response entirely — a refusal (e.g. UNSEALED_STOPS) would leave the
 * operator staring at a button that silently did nothing.
 */
describe('RouteBuilder — seal', () => {
  it('POSTs to /seal, not /close', async () => {
    mockPackages = [pkg({ stage: 'staged' })];
    mockRouteStatus = 'loading';
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar Ruta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar ruta' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/dispatch/routes/r1/seal',
      expect.objectContaining({ method: 'POST' }),
    ));
  });

  it('surfaces the UNSEALED_STOPS message instead of silently doing nothing', async () => {
    mockPackages = [pkg({ stage: 'planned' })];
    mockRouteStatus = 'loading';
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({
        code: 'UNSEALED_STOPS',
        message: 'Faltan 1 parada(s) por estibar. Escanéalas o pide a un responsable que las quite de la planificación.',
      }),
    });
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar Ruta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar ruta' }));

    await waitFor(() =>
      expect(screen.getByText(/Escanéalas o pide a un responsable/)).toBeInTheDocument(),
    );
  });
});

/**
 * spec-70 phase 3 review fix: the DELETE handler now requires `{ reason }`
 * (400 without one), but this button sent no body at all, so every click
 * 400'd and the trash icon silently did nothing — the one escape hatch the
 * seal refusal points people at. Regression coverage: nothing exercised
 * handleRemove at all before this.
 */
describe('RouteBuilder — remove from plan', () => {
  it('prompts for a reason and sends it in the DELETE body', async () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'planned' })];
    mockRouteStatus = 'loading';
    vi.spyOn(window, 'prompt').mockReturnValue('Cliente canceló');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar paquete' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/dispatch/routes/r1/packages/d1',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ reason: 'Cliente canceló' }),
      }),
    ));
    expect(refetchMock).toHaveBeenCalled();
  });

  it('does nothing when the reason prompt is cancelled', async () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'planned' })];
    mockRouteStatus = 'loading';
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar paquete' }));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces a refusal (e.g. FORBIDDEN or ROUTE_SEALED) instead of silently doing nothing', async () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'planned' })];
    mockRouteStatus = 'loading';
    vi.spyOn(window, 'prompt').mockReturnValue('Cliente canceló');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({
        code: 'FORBIDDEN',
        message: 'Solo un responsable puede quitar paradas de la planificación.',
      }),
    });
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar paquete' }));

    await waitFor(() =>
      expect(screen.getByText(/Solo un responsable puede quitar paradas/)).toBeInTheDocument(),
    );
  });
});
