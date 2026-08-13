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

const mockResolveRouteId = vi.fn();
vi.mock('@/lib/reception/route-ref', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reception/route-ref')>();
  return {
    ...actual,
    resolveRouteId: (...args: unknown[]) => mockResolveRouteId(...args),
  };
});

const mockMutate = vi.fn();
const hookState = { mutate: mockMutate, isPending: false };
vi.mock('@/hooks/reception/useOpenRouteReception', () => ({
  useOpenRouteReception: () => hookState,
}));

import { RouteQRScannerEntry } from './RouteQRScannerEntry';

const UUID = '11111111-2222-3333-4444-555555555555';

async function typeAndSearch(value: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Código de ruta'), value);
  await user.click(screen.getByRole('button', { name: /buscar ruta/i }));
}

describe('RouteQRScannerEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookState.isPending = false;
    mockResolveRouteId.mockResolvedValue('route-uuid-1');
    mockMutate.mockImplementation((_a, opts) => opts?.onSuccess?.());
  });

  it('renders code input and search button', () => {
    render(<RouteQRScannerEntry operatorId="op-1" enableCamera={false} />);
    expect(screen.getByLabelText('Código de ruta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /buscar ruta/i })).toBeInTheDocument();
  });

  it('opens the reception for an in_progress route — the arriving truck case', async () => {
    render(<RouteQRScannerEntry operatorId="op-1" enableCamera={false} />);
    await typeAndSearch('pr-2026-0001');

    await waitFor(() =>
      expect(mockResolveRouteId).toHaveBeenCalledWith('op-1', 'PR-2026-0001'),
    );
    expect(mockMutate.mock.calls[0][0]).toEqual({ routeId: 'route-uuid-1' });
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/app/reception/route/route-uuid-1'),
    );
  });

  it('passes a scanned UUID payload straight to open_route_reception', async () => {
    render(<RouteQRScannerEntry operatorId="op-1" enableCamera={false} />);
    await typeAndSearch(UUID);

    await waitFor(() => expect(mockMutate).toHaveBeenCalled());
    expect(mockResolveRouteId).not.toHaveBeenCalled();
    expect(mockMutate.mock.calls[0][0]).toEqual({ routeId: UUID });
  });

  it('shows error when route not found and never opens a reception', async () => {
    mockResolveRouteId.mockResolvedValue(null);
    render(<RouteQRScannerEntry operatorId="op-1" enableCamera={false} />);
    await typeAndSearch('PR-X');

    expect(await screen.findByText('Ruta no encontrada')).toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('rejects an already-received route with the server message', async () => {
    mockMutate.mockImplementation((_a, opts) =>
      opts?.onError?.(new Error('La ruta PR-2026-0001 ya fue recibida en el hub')),
    );
    render(<RouteQRScannerEntry operatorId="op-1" enableCamera={false} />);
    await typeAndSearch('PR-2026-0001');

    expect(
      await screen.findByText(/ya fue recibida en el hub/),
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('rejects a cancelled route with the server message', async () => {
    mockMutate.mockImplementation((_a, opts) =>
      opts?.onError?.(new Error('La ruta PR-2026-0001 fue anulada y no puede recibirse')),
    );
    render(<RouteQRScannerEntry operatorId="op-1" enableCamera={false} />);
    await typeAndSearch('PR-2026-0001');

    expect(
      await screen.findByText(/fue anulada y no puede recibirse/),
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
