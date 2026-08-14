import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ routeId: 'route-1' }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1', role: 'driver', permissions: [] }),
}));

function buildChain(result: { data: unknown; error: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (resolve: (v: unknown) => void) =>
    Promise.resolve(result).then(resolve);
  return chain;
}

const ROUTE = { data: { id: 'route-1', code: 'PR-2026-0042' }, error: null };
const TWO_MANIFESTS = { data: [{ id: 'm1' }, { id: 'm2' }], error: null };

const fromMock = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: fromMock }),
}));

import Page from './page';

describe('RouteQRPage', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('shows the frozen expected_count once the reception batch exists', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'pickup_routes') return buildChain(ROUTE);
      if (table === 'route_receptions') return buildChain({ data: { expected_count: 7 }, error: null });
      if (table === 'manifests') return buildChain(TWO_MANIFESTS);
      return buildChain({ data: [], error: null });
    });

    render(<Page />);
    await waitFor(() => expect(screen.getByTestId('route-code')).toHaveTextContent('PR-2026-0042'));
    expect(screen.getByText(/7 paquetes/i)).toBeInTheDocument();
  });

  // Regression: this page became reachable while the route is still in_progress
  // (the QR is now shown for the whole trip, not only after close). There is no
  // route_receptions row until the receptionist opens the batch, so reading
  // expected_count yielded 0 and the driver showed the receptionist a card
  // reading "2 manifiestos · 0 paquetes" mid-route.
  it('counts distinct verified pickup scans when no reception batch exists yet', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'pickup_routes') return buildChain(ROUTE);
      if (table === 'route_receptions') return buildChain({ data: null, error: null });
      if (table === 'manifests') return buildChain(TWO_MANIFESTS);
      if (table === 'pickup_scans') {
        return buildChain({
          data: [
            { package_id: 'p1' },
            { package_id: 'p2' },
            { package_id: 'p2' }, // rescanned — must not double-count
            { package_id: null },  // not_found scan — must not count
          ],
          error: null,
        });
      }
      return buildChain({ data: [], error: null });
    });

    render(<Page />);
    await waitFor(() => expect(screen.getByTestId('route-code')).toHaveTextContent('PR-2026-0042'));
    expect(screen.getByText(/2 paquetes/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 paquetes/i)).not.toBeInTheDocument();
  });

  it('shows zero packages when nothing has been scanned yet', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'pickup_routes') return buildChain(ROUTE);
      if (table === 'route_receptions') return buildChain({ data: null, error: null });
      if (table === 'manifests') return buildChain({ data: [], error: null });
      return buildChain({ data: [], error: null });
    });

    render(<Page />);
    await waitFor(() => expect(screen.getByTestId('route-code')).toHaveTextContent('PR-2026-0042'));
    expect(screen.getByText(/0 paquetes/i)).toBeInTheDocument();
  });
});
