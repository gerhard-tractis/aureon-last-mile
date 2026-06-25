import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-1', role: 'driver', permissions: [] }),
}));

const route = {
  id: 'route-1',
  code: 'PR-2026-0001',
  started_at: new Date().toISOString(),
  vehicle_label: null,
};

vi.mock('@/hooks/pickup/useActivePickupRoute', () => ({
  useActivePickupRoute: () => ({ data: route, isLoading: false }),
}));

vi.mock('@/hooks/pickup/useRouteManifests', () => ({
  useRouteManifests: () => ({
    data: [
      {
        id: 'm1',
        external_load_id: 'LOAD-1',
        retailer_name: 'A',
        total_orders: 1,
        total_packages: 2,
        verified_count: 2,
      },
    ],
    isLoading: false,
  }),
  useUnassignedManifests: () => ({ data: [], isLoading: false }),
}));

const addMutate = vi.fn();
const closeMutate = vi.fn();
vi.mock('@/hooks/pickup/useAddManifestToRoute', () => ({
  useAddManifestToRoute: () => ({ mutate: addMutate, isPending: false }),
}));
vi.mock('@/hooks/pickup/useClosePickupRoute', () => ({
  useClosePickupRoute: () => ({ mutate: closeMutate, isPending: false }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Page from './page';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ActiveRoutePage', () => {
  beforeEach(() => {
    pushMock.mockReset();
    addMutate.mockReset();
    closeMutate.mockReset();
  });

  it('renders route header and linked manifests', async () => {
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();
  });

  it('clicking Cerrar ruta calls closeMut and navigates to QR on success', async () => {
    closeMutate.mockImplementation((_args, { onSuccess }: { onSuccess: () => void }) => {
      onSuccess();
    });
    wrap(<Page />);
    fireEvent.click(screen.getByTestId('close-route-button'));
    expect(closeMutate).toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith('/app/pickup/route/route-1/qr');
  });
});
