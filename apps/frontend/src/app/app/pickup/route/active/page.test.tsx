import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
  vehicle: { plate: 'AAA-111' },
};

const activeRouteMock = vi.fn();
const refetchRoute = vi.fn();
vi.mock('@/hooks/pickup/useActivePickupRoute', () => ({
  useActivePickupRoute: () => activeRouteMock(),
}));

// spec-54 phase 4.6 fix: the default fixture now has a genuinely incomplete
// manifest, so "next manifest" tests exercise the real find-the-first-
// incomplete path rather than the all-complete fallback (the fallback no
// longer exists — see the dedicated route-complete tests below).
const INCOMPLETE_MANIFEST = {
  id: 'm1',
  external_load_id: 'LOAD-1',
  retailer_name: 'A',
  pickup_location: null,
  total_orders: 1,
  total_packages: 2,
  verified_count: 1,
};
const COMPLETE_MANIFEST = {
  id: 'm2',
  external_load_id: 'LOAD-2',
  retailer_name: 'B',
  pickup_location: null,
  total_orders: 1,
  total_packages: 2,
  verified_count: 2,
};

const routeManifestsMock = vi.fn();
vi.mock('@/hooks/pickup/useRouteManifests', () => ({
  useRouteManifests: () => routeManifestsMock(),
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
    activeRouteMock.mockReset();
    refetchRoute.mockReset();
    activeRouteMock.mockReturnValue({
      data: route,
      isLoading: false,
      isError: false,
      refetch: refetchRoute,
    });
    routeManifestsMock.mockReset();
    routeManifestsMock.mockReturnValue({
      data: [INCOMPLETE_MANIFEST, COMPLETE_MANIFEST],
      isLoading: false,
    });
  });

  it('renders route header and the highlighted next manifest', async () => {
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    const card = screen.getByTestId('next-manifest-card');
    expect(within(card).getByText('A')).toBeInTheDocument();
    expect(within(card).getByText('1/2')).toBeInTheDocument();
  });

  // spec-52: the header shows the real plate from the joined `vehicles` row,
  // never pickup_routes.vehicle_label (a deprecated expand-phase mirror).
  it('renders the vehicle plate in the route header', async () => {
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText(/AAA-111/)).toBeInTheDocument());
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

  // spec-54 phase 4.6 restyle: the full manifest list collapses behind a
  // toggle so the mobile screen matches mock 1i's "next manifest" + "luego"
  // layout instead of always showing every manifest at once.
  it('collapses the full manifest list behind "Ver los N manifiestos" by default', async () => {
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    expect(screen.queryByTestId('route-manifest-list')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Ver los 2 manifiestos' });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // No dangling idref: the panel doesn't exist in the DOM while collapsed.
    expect(toggle).not.toHaveAttribute('aria-controls');
  });

  it('reveals the full manifest list when the toggle is pressed', async () => {
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Ver los 2 manifiestos' }));
    const list = screen.getByTestId('route-manifest-list');
    expect(list).toBeInTheDocument();
    expect(list.closest('#route-manifest-list-panel')).not.toBeNull();
    const toggle = screen.getByRole('button', { name: 'Ocultar manifiestos' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'route-manifest-list-panel');
  });

  it('singularises the toggle label for exactly one manifest', async () => {
    routeManifestsMock.mockReturnValue({ data: [INCOMPLETE_MANIFEST], isLoading: false });
    wrap(<Page />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Ver el manifiesto' })).toBeInTheDocument(),
    );
  });

  it('does not render the toggle at all when the route has no manifests', async () => {
    routeManifestsMock.mockReturnValue({ data: [], isLoading: false });
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /ver/i })).toBeNull();
    // The empty state must still be reachable without an extra tap.
    expect(screen.getByText(/sin manifiestos en la ruta/i)).toBeInTheDocument();
  });

  it('highlights the first genuinely incomplete manifest and lets the driver jump into scanning it', async () => {
    wrap(<Page />);
    await waitFor(() => expect(screen.getByTestId('next-manifest-card')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /verificar/i }));
    expect(pushMock).toHaveBeenCalledWith('/app/pickup/scan/LOAD-1');
  });

  // spec-54 phase 4.6 fix: a finished route used to fall back to showing its
  // first manifest as "next", with a live "Verificar" CTA, advertising work
  // that no longer existed.
  it('shows the route-complete notice — not a fabricated "next manifest" — once every manifest is verified', async () => {
    routeManifestsMock.mockReturnValue({
      data: [{ ...COMPLETE_MANIFEST, id: 'm3', external_load_id: 'LOAD-3' }],
      isLoading: false,
    });
    wrap(<Page />);
    await waitFor(() =>
      expect(screen.getByTestId('route-complete-notice')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('next-manifest-card')).toBeNull();
    expect(screen.queryByRole('button', { name: /verificar/i })).toBeNull();
  });

  it('does not list the already-complete manifest under "Luego" ahead of the highlighted one', async () => {
    // 3 manifests: [complete, incomplete, complete] — "Luego" must show only
    // what comes AFTER the highlighted (2nd) manifest, not "everything else".
    routeManifestsMock.mockReturnValue({
      data: [
        { ...COMPLETE_MANIFEST, id: 'm0', external_load_id: 'LOAD-0', retailer_name: 'Before' },
        INCOMPLETE_MANIFEST,
        { ...COMPLETE_MANIFEST, id: 'm4', external_load_id: 'LOAD-4', retailer_name: 'After' },
      ],
      isLoading: false,
    });
    wrap(<Page />);
    await waitFor(() => expect(screen.getByTestId('next-manifest-card')).toBeInTheDocument());
    const upcoming = screen.getByTestId('upcoming-manifest-list');
    expect(within(upcoming).getByText('After')).toBeInTheDocument();
    expect(within(upcoming).queryByText('Before')).toBeNull();
  });

  // spec-54 phase 4.6 fix (review round 2): the header rendered above the
  // manifests-loading gate with `routeManifests` defaulting to `[]`, so a
  // slow connection flashed a fabricated "0/0" — sumExpected([]) can't tell
  // "genuinely zero manifests" from "not loaded yet".
  it('does not show a fabricated 0/0 in the header while manifests are loading', async () => {
    routeManifestsMock.mockReturnValue({ data: [], isLoading: true });
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    expect(screen.queryByText('0/0')).toBeNull();
    expect(screen.getByText(/cargando manifiestos/i)).toBeInTheDocument();
  });

  // spec-61: the route is one RPC now, so a failure is wholesale. Rendering
  // the empty state on error would tell a leader with an open route that they
  // have none — and send them back to 3j to open a second one for the same
  // van.
  it('offers a retry on a failed lookup instead of claiming there is no route', async () => {
    activeRouteMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchRoute,
    });
    wrap(<Page />);
    await waitFor(() =>
      expect(screen.getByText(/no pudimos cargar tu ruta/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/no tienes una ruta activa/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(refetchRoute).toHaveBeenCalledTimes(1);
  });

  it('renders the map placeholder instead of a real map', async () => {
    wrap(<Page />);
    await waitFor(() =>
      expect(screen.getByTestId('route-map-placeholder')).toBeInTheDocument(),
    );
  });
});
