import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, back: vi.fn() }),
}));

const operatorIdMock = vi.fn();
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => operatorIdMock(),
}));

// spec-61 Task 5 — the cancel affordance. Mocked so this file stays a test
// of WHO is offered it; the RPC call itself is covered in
// useCancelPickupRoute.test.ts.
const cancelMutateAsync = vi.fn();
vi.mock('@/hooks/pickup/useCancelPickupRoute', () => ({
  useCancelPickupRoute: () => ({ mutateAsync: cancelMutateAsync, isPending: false }),
}));

// This page does not render PickupRouteCrewStrip today, so the missing
// `crew` key was latent rather than fatal here. Filled in anyway: `crew` is
// required on ActivePickupRoute (spec-61 Task 4) and this object stands in
// for one, so an untyped hole would become a render-time TypeError the first
// time this screen shows the trip's crew.
const route = {
  id: 'route-1',
  code: 'PR-2026-0001',
  // spec-61 Task 5: the leader of the route. `driver_id` is what the cancel
  // affordance is gated on.
  driver_id: 'leader-1',
  started_at: new Date().toISOString(),
  vehicle: { plate: 'AAA-111' },
  crew: [],
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
// spec-64 Task 4 — zero verified scans is the only state RouteManifestList
// offers a remove control for (Task 3). Reusing INCOMPLETE_MANIFEST (which
// has verified_count: 1) would never surface the X at all.
const REMOVABLE_MANIFEST = {
  id: 'm1',
  external_load_id: 'LOAD-1',
  retailer_name: 'A',
  pickup_location: null,
  total_orders: 1,
  total_packages: 2,
  verified_count: 0,
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
const removeMutate = vi.fn();
vi.mock('@/hooks/pickup/useAddManifestToRoute', () => ({
  useAddManifestToRoute: () => ({ mutate: addMutate, isPending: false }),
}));
vi.mock('@/hooks/pickup/useClosePickupRoute', () => ({
  useClosePickupRoute: () => ({ mutate: closeMutate, isPending: false }),
}));
vi.mock('@/hooks/pickup/useRemoveManifestFromRoute', () => ({
  useRemoveManifestFromRoute: () => ({ mutate: removeMutate, isPending: false }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { toast } from 'sonner';

import Page from './page';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ActiveRoutePage', () => {
  beforeEach(() => {
    pushMock.mockReset();
    operatorIdMock.mockReset();
    operatorIdMock.mockReturnValue({
      operatorId: 'op-1',
      role: 'pickup_leader',
      permissions: [],
      userId: 'leader-1',
    });
    cancelMutateAsync.mockReset();
    cancelMutateAsync.mockResolvedValue({ id: 'route-1', status: 'cancelled' });
    addMutate.mockReset();
    closeMutate.mockReset();
    activeRouteMock.mockReset();
    refetchRoute.mockReset();
    removeMutate.mockReset();
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

  /**
   * spec-61 Task 5 — abandoned routes had no exit. Task 7 stopped
   * `get_pending_manifests` offering routed loads, so a route opened by
   * mistake holds its manifests away from every other crew until someone
   * opens psql.
   */
  describe('cancelling an abandoned route', () => {
    it('offers the route leader a way out', async () => {
      wrap(<Page />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /cancelar ruta/i })).toBeInTheDocument(),
      );
    });

    it('does not offer it to a crew member riding the same route', async () => {
      operatorIdMock.mockReturnValue({
        operatorId: 'op-1',
        role: 'pickup_crew',
        permissions: [],
        userId: 'crew-9',
      });
      wrap(<Page />);
      await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /cancelar ruta/i })).toBeNull();
      // The screen is otherwise intact — this is a missing control, not a
      // blocked page.
      expect(screen.getByTestId('close-route-button')).toBeInTheDocument();
    });

    // Both sides null must NOT read as "this is my route". A route row whose
    // driver_id is null and a signed-out reader are not the same person.
    it('does not offer it when nobody is signed in', async () => {
      operatorIdMock.mockReturnValue({
        operatorId: 'op-1',
        role: 'pickup_leader',
        permissions: [],
        userId: null,
      });
      activeRouteMock.mockReturnValue({
        data: { ...route, driver_id: null },
        isLoading: false,
        isError: false,
        refetch: refetchRoute,
      });
      wrap(<Page />);
      await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /cancelar ruta/i })).toBeNull();
    });

    it('takes the leader back to Recogida once the route is really cancelled', async () => {
      wrap(<Page />);
      fireEvent.click(await screen.findByRole('button', { name: /cancelar ruta/i }));
      fireEvent.click(await screen.findByRole('button', { name: /sí, cancelar la ruta/i }));
      await waitFor(() => expect(cancelMutateAsync).toHaveBeenCalledWith({ routeId: 'route-1' }));
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app/pickup'));
    });
  });

  // spec-64 Task 4 — wiring the remove control into the page. Drives the
  // real RouteManifestList row UI (Task 3): reveal the collapsed list, tap
  // the row's X (only rendered because verified_count is 0), confirm in the
  // AlertDialog.
  describe('removing a manifest from the route', () => {
    beforeEach(() => {
      routeManifestsMock.mockReturnValue({
        data: [REMOVABLE_MANIFEST, COMPLETE_MANIFEST],
        isLoading: false,
      });
    });

    async function revealListAndConfirmRemove() {
      fireEvent.click(screen.getByRole('button', { name: 'Ver los 2 manifiestos' }));
      fireEvent.click(
        screen.getByRole('button', { name: 'Quitar LOAD-1 de la ruta en curso' }),
      );
      fireEvent.click(await screen.findByRole('button', { name: 'Quitar' }));
    }

    it('passes onRemove to RouteManifestList and invoking it calls the remove mutation', async () => {
      wrap(<Page />);
      await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
      await revealListAndConfirmRemove();
      expect(removeMutate).toHaveBeenCalledWith(
        { routeId: 'route-1', manifestId: 'm1' },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    it('shows a success toast when the removal succeeds', async () => {
      removeMutate.mockImplementation((_args, { onSuccess }: { onSuccess: () => void }) => {
        onSuccess();
      });
      wrap(<Page />);
      await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
      await revealListAndConfirmRemove();
      expect(toast.success).toHaveBeenCalledWith('Carga quitada de la ruta');
    });

    // The only enforced coverage of the refusal path anywhere in the stack —
    // the SQL tests are advisory-only on QA deploy and gate nothing in CI.
    // toast.error must receive the RPC's Spanish message verbatim: no
    // wrapping, prefixing, or translating.
    it('surfaces the RPC refusal message verbatim on failure', async () => {
      const refusal = new Error('Solo la tripulación de esta ruta puede quitarle cargas.');
      removeMutate.mockImplementation((_args, { onError }: { onError: (e: Error) => void }) => {
        onError(refusal);
      });
      wrap(<Page />);
      await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
      await revealListAndConfirmRemove();
      expect(toast.error).toHaveBeenCalledWith(
        'Solo la tripulación de esta ruta puede quitarle cargas.',
      );
    });

    // Constraint 1 — the server, not the UI, decides who may remove. Crew can
    // add manifests through the ungated AddManifestSheet, so gating removal
    // to the driver would strand a crew member who mis-attached a carga.
    it('offers the remove control even when the signed-in user is not the route driver', async () => {
      operatorIdMock.mockReturnValue({
        operatorId: 'op-1',
        role: 'pickup_crew',
        permissions: [],
        userId: 'crew-9',
      });
      wrap(<Page />);
      await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Ver los 2 manifiestos' }));
      expect(
        screen.getByRole('button', { name: 'Quitar LOAD-1 de la ruta en curso' }),
      ).toBeInTheDocument();
    });
  });
});
