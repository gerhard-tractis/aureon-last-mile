import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

import { IncomingRoutesList } from './IncomingRoutesList';

const baseRoute = {
  id: 'r1', code: 'PR-2026-0001', driver_id: 'd1',
  driver_name: 'Ana Ruiz', vehicle_label: 'AAA-111',
  in_transit_at: '2026-06-25T08:00:00Z',
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

  it('uses singular form for 1 manifest', () => {
    render(<IncomingRoutesList routes={[{ ...baseRoute, manifest_count: 1 }]} />);
    expect(screen.getByText(/1 manifiesto/)).toBeInTheDocument();
    expect(screen.queryByText(/1 manifiestos/)).not.toBeInTheDocument();
  });
});
