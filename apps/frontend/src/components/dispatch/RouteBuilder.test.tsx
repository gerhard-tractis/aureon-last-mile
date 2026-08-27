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

const scanMutateAsyncMock = vi.fn();
vi.mock('@/hooks/dispatch/useScanPackage', () => ({
  useScanPackage: () => ({ mutateAsync: scanMutateAsyncMock }),
}));

// The route row changes underneath every mutation here, so the builder has to
// re-read it. Key alignment between this refresher and the query it targets is
// covered for real in useRefreshRouteStatus.test.tsx — mounting a QueryClient
// here would test react-query, not the builder.
const refreshRouteStatusMock = vi.fn();
vi.mock('@/hooks/dispatch/useRefreshRouteStatus', () => ({
  useRefreshRouteStatus: () => refreshRouteStatusMock,
}));

// spec-70 phase 4, breakage #3: RouteBuilder derives everything from the
// route's real status now, fetched through useDispatchRoute — not a
// `useState` a page reload wiped.
let mockRouteStatus: RouteStatus | undefined = 'draft';
// QA finding #1: the header date used to come from `new Date()`, not this
// route's own `route_date` — default undefined so most tests (which don't
// care about the date) render nothing rather than assert a stray value.
let mockRouteDate: string | undefined;
vi.mock('@/hooks/dispatch/useDispatchRoute', () => ({
  useDispatchRoute: () => ({
    data: mockRouteStatus
      ? ({ status: mockRouteStatus, route_date: mockRouteDate } as DispatchRoute)
      : undefined,
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
  mockRouteDate = undefined;
  global.fetch = vi.fn();
});

/**
 * QA finding #1: live QA showed "jue, 27 ago" (today) in the header for a
 * route whose `routes.route_date` is 2026-08-26 (a Wednesday) — the header
 * asserted the browser's clock instead of the row's own date.
 */
describe('RouteBuilder — header date', () => {
  it("renders the route's own route_date, not today", () => {
    mockRouteDate = '2026-08-26';
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    expect(screen.getByText('mié, 26 ago')).toBeInTheDocument();
  });

  it('shows nothing while the route is still loading, rather than a wrong date', () => {
    mockRouteStatus = undefined; // useDispatchRoute mock returns data: undefined
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);
    // formatRouteHeaderDate's output always has this shape — "wkd, D mon" —
    // so this pattern only matches the header date, not incidental text
    // elsewhere on the page.
    expect(
      screen.queryByText(/^\w{3}, \d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)$/),
    ).not.toBeInTheDocument();
  });
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

  /**
   * The bug this pins: `handleClose` used to call `useRoutePackages`'s
   * refetch, so a 200 from /seal refreshed the stop list and nothing else.
   * The route stayed `loading` in the cache — badge unchanged, Cerrar ruta
   * still enabled, Despachar still disabled — and a second tap only returned
   * `already_sealed`. Breakage #3 rebuilt out of new parts.
   */
  it('re-reads the route status after a successful seal, so the seal becomes visible', async () => {
    mockPackages = [pkg({ stage: 'staged' })];
    mockRouteStatus = 'loading';
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, sealed_stops: 1 }),
    });
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar Ruta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar ruta' }));

    await waitFor(() => expect(refreshRouteStatusMock).toHaveBeenCalled());
  });

  it('does not re-read the route status when the seal is refused', async () => {
    mockPackages = [pkg({ stage: 'planned' })];
    mockRouteStatus = 'loading';
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'UNSEALED_STOPS', message: 'Faltan 1 parada(s) por estibar.' }),
    });
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar Ruta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar ruta' }));

    await waitFor(() => expect(screen.getByText(/faltan 1 parada/i)).toBeInTheDocument());
    expect(refreshRouteStatusMock).not.toHaveBeenCalled();
  });

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

/**
 * QA finding #3: after a seal was refused with "Faltan 2 parada(s)...",
 * removing one stop left the banner still saying 2 while the live "faltan N
 * por estibar" counter correctly said 1 — the refusal it described no longer
 * held. Seed the seal refusal first (same path as the "seal" describe block
 * above), then exercise the action that should clear it.
 */
describe('RouteBuilder — stale seal-error banner', () => {
  async function seedSealError() {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'UNSEALED_STOPS',
        message: 'Faltan 2 parada(s) por estibar. Escanéalas o pide a un responsable que las quite de la planificación.',
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar Ruta' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar ruta' }));
    await waitFor(() =>
      expect(screen.getByText(/Faltan 2 parada\(s\)/)).toBeInTheDocument(),
    );
  }

  it('clears the banner once a scan succeeds', async () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'planned' })];
    mockRouteStatus = 'loading';
    scanMutateAsyncMock.mockResolvedValue(undefined);
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await seedSealError();

    await userEvent.type(screen.getByPlaceholderText(/Escanea barcode/i), 'PKG-1{Enter}');

    await waitFor(() =>
      expect(screen.queryByText(/Faltan 2 parada\(s\)/)).not.toBeInTheDocument(),
    );
  });

  it('does not clear the banner when a scan fails', async () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'planned' })];
    mockRouteStatus = 'loading';
    scanMutateAsyncMock.mockRejectedValue(new Error('Paquete no encontrado'));
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await seedSealError();

    await userEvent.type(screen.getByPlaceholderText(/Escanea barcode/i), 'PKG-1{Enter}');

    await waitFor(() => expect(screen.getByText('Paquete no encontrado')).toBeInTheDocument());
    expect(screen.getByText(/Faltan 2 parada\(s\)/)).toBeInTheDocument();
  });

  it('clears the banner once a removal succeeds', async () => {
    mockPackages = [pkg({ dispatch_id: 'd1', stage: 'planned' })];
    mockRouteStatus = 'loading';
    vi.spyOn(window, 'prompt').mockReturnValue('Cliente canceló');
    render(<RouteBuilder routeId="r1" operatorId="op-1" vehicles={[]} />);

    await seedSealError();

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar paquete' }));

    await waitFor(() =>
      expect(screen.queryByText(/Faltan 2 parada\(s\)/)).not.toBeInTheDocument(),
    );
  });
});
