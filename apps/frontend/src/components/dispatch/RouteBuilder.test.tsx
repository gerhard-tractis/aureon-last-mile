import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteBuilder } from './RouteBuilder';
import type { RoutePackage } from '@/lib/dispatch/types';

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

function pkg(overrides: Partial<RoutePackage> = {}): RoutePackage {
  return {
    dispatch_id: 'd1',
    order_id: 'o1',
    order_number: 'ORD-1',
    contact_name: 'Mario',
    contact_address: 'Calle 1',
    contact_phone: null,
    package_status: 'en_carga',
    stage: 'staged',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPackages = [];
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
 * spec-70 phase 3: the seal button used to POST to a bare `/close` and ignore
 * a non-ok response entirely — a refusal (e.g. UNSEALED_STOPS) would leave the
 * operator staring at a button that silently did nothing.
 */
describe('RouteBuilder — seal', () => {
  it('POSTs to /seal, not /close', async () => {
    mockPackages = [pkg({ stage: 'staged' })];
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
