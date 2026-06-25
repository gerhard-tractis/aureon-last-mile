import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

// Avoid html5-qrcode trying to use cameras in jsdom
vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    start = vi.fn(() => Promise.reject(new Error('no camera')));
    stop = vi.fn(() => Promise.resolve());
    clear = vi.fn();
  },
}));

const mockLimit = vi.fn();
const mockEq3 = vi.fn(() => ({ limit: mockLimit }));
const queryChain = {
  eq: vi.fn(() => queryChain),
  is: vi.fn(() => queryChain),
  limit: vi.fn(() => ({ eq: mockEq3 })),
};
const mockSelect = vi.fn(() => queryChain);
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

import { RouteQRScannerEntry } from './RouteQRScannerEntry';

describe('RouteQRScannerEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders code input and search button', () => {
    render(<RouteQRScannerEntry operatorId="op-1" enableCamera={false} />);
    expect(screen.getByLabelText('Código de ruta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /buscar ruta/i })).toBeInTheDocument();
  });

  it('resolves a typed code and navigates to the route page', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [{ id: 'route-uuid-1', status: 'in_transit' }],
      error: null,
    });

    const user = userEvent.setup();
    render(<RouteQRScannerEntry operatorId="op-1" enableCamera={false} />);

    await user.type(screen.getByLabelText('Código de ruta'), 'pr-2026-0001');
    await user.click(screen.getByRole('button', { name: /buscar ruta/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/app/reception/route/route-uuid-1');
    });
  });

  it('shows error when route not found', async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null });

    const user = userEvent.setup();
    render(<RouteQRScannerEntry operatorId="op-1" enableCamera={false} />);

    await user.type(screen.getByLabelText('Código de ruta'), 'PR-X');
    await user.click(screen.getByRole('button', { name: /buscar ruta/i }));

    expect(await screen.findByText('Ruta no encontrada')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows warning when route is already received', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [{ id: 'r1', status: 'received' }],
      error: null,
    });

    const user = userEvent.setup();
    render(<RouteQRScannerEntry operatorId="op-1" enableCamera={false} />);

    await user.type(screen.getByLabelText('Código de ruta'), 'PR-2026-0001');
    await user.click(screen.getByRole('button', { name: /buscar ruta/i }));

    expect(await screen.findByText('Esta ruta ya fue recibida')).toBeInTheDocument();
  });
});
