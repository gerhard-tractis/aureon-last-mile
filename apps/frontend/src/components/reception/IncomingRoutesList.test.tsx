import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

// A row must never open a reception by being tapped: guard the whole client.
const mockRpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ rpc: mockRpc, from: vi.fn() }),
}));

import { IncomingRoutesList } from './IncomingRoutesList';

const baseRoute = {
  id: 'r1', code: 'PR-2026-0001', driver_id: 'd1',
  driver_name: 'Ana Ruiz', vehicle_label: 'AAA-111',
  in_transit_at: '2026-06-25T08:00:00Z',
  started_at: '2026-06-25T06:00:00Z',
  manifest_count: 2, expected_packages: 15,
};

describe('IncomingRoutesList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders empty state when no routes', () => {
    render(<IncomingRoutesList routes={[]} />);
    expect(screen.getByText('Sin rutas entrantes')).toBeInTheDocument();
  });

  it('renders route code, driver and counts', () => {
    render(<IncomingRoutesList routes={[baseRoute]} />);
    expect(screen.getByText('PR-2026-0001')).toBeInTheDocument();
    expect(screen.getByText(/Ana Ruiz/)).toBeInTheDocument();
    expect(screen.getByText(/2 manifiestos/)).toBeInTheDocument();
    expect(screen.getByText(/15 paquetes/)).toBeInTheDocument();
  });

  it('navigates to the route reception page on button click', async () => {
    const user = userEvent.setup();
    render(<IncomingRoutesList routes={[baseRoute]} />);
    await user.click(screen.getByRole('button', { name: /iniciar recepción/i }));
    expect(mockPush).toHaveBeenCalledWith('/app/reception/route/r1');
  });

  it('sends an in_progress row to the read-only preview and fires no RPC', async () => {
    const user = userEvent.setup();
    render(
      <IncomingRoutesList
        routes={[{ ...baseRoute, in_transit_at: null, started_at: '2026-06-25T06:00:00Z' }]}
        status="in_progress"
      />,
    );
    await user.click(screen.getByRole('button', { name: /ver detalle/i }));
    expect(mockPush).toHaveBeenCalledWith('/app/reception/route/r1/preview');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('sends an in_transit row straight into the open session', async () => {
    const user = userEvent.setup();
    render(<IncomingRoutesList routes={[baseRoute]} status="in_transit" />);
    await user.click(screen.getByRole('button', { name: /iniciar recepción/i }));
    expect(mockPush).toHaveBeenCalledWith('/app/reception/route/r1');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('shows a distinct empty state for trucks still out collecting', () => {
    render(<IncomingRoutesList routes={[]} status="in_progress" />);
    expect(screen.getByText('Sin rutas en camino')).toBeInTheDocument();
  });

  it('uses singular form for 1 manifest', () => {
    render(<IncomingRoutesList routes={[{ ...baseRoute, manifest_count: 1 }]} />);
    expect(screen.getByText(/1 manifiesto/)).toBeInTheDocument();
    expect(screen.queryByText(/1 manifiestos/)).not.toBeInTheDocument();
  });
});
