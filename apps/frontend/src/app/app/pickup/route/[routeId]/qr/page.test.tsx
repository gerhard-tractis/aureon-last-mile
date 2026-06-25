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
  chain.is = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  // count head returns Promise itself
  chain.then = (resolve: (v: unknown) => void) =>
    Promise.resolve(result).then(resolve);
  return chain;
}

const fromMock = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: fromMock }),
}));

import Page from './page';

describe('RouteQRPage', () => {
  beforeEach(() => {
    fromMock.mockReset();
    fromMock.mockImplementation((table: string) => {
      if (table === 'pickup_routes') {
        return buildChain({ data: { id: 'route-1', code: 'PR-2026-0042' }, error: null });
      }
      if (table === 'route_receptions') {
        return buildChain({ data: { expected_count: 7 }, error: null });
      }
      // manifests count head
      const ch = buildChain({ data: null, error: null, count: 2 });
      return ch;
    });
  });

  it('renders route code and counts', async () => {
    render(<Page />);
    await waitFor(() => expect(screen.getByTestId('route-code')).toHaveTextContent('PR-2026-0042'));
    expect(screen.getByText(/7 paquetes/i)).toBeInTheDocument();
  });
});
