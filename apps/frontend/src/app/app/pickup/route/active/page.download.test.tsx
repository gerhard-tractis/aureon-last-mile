/**
 * spec-82 fase 2 — conecta useDownloadedManifestIds/useDownloadManifest a
 * RouteManifestList. Fichero separado de `page.test.tsx` sólo por tamaño
 * (regla de 300 líneas; ese archivo ya está en 437) — mismos mocks base,
 * mismo patrón.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const operatorIdMock = vi.fn();
vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => operatorIdMock(),
}));

vi.mock('@/hooks/pickup/useCancelPickupRoute', () => ({
  useCancelPickupRoute: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const route = {
  id: 'route-1',
  code: 'PR-2026-0001',
  driver_id: 'leader-1',
  started_at: new Date().toISOString(),
  vehicle: { plate: 'AAA-111' },
  crew: [],
};

const activeRouteMock = vi.fn();
vi.mock('@/hooks/pickup/useActivePickupRoute', () => ({
  useActivePickupRoute: () => activeRouteMock(),
}));

const INCOMPLETE_MANIFEST = {
  id: 'm1',
  external_load_id: 'LOAD-1',
  retailer_name: 'A',
  pickup_location: null,
  total_orders: 1,
  total_packages: 2,
  verified_count: 1,
};

const routeManifestsMock = vi.fn();
vi.mock('@/hooks/pickup/useRouteManifests', () => ({
  useRouteManifests: () => routeManifestsMock(),
  useUnassignedManifests: () => ({ data: [], isLoading: false }),
}));

vi.mock('@/hooks/pickup/useAddManifestToRoute', () => ({
  useAddManifestToRoute: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/pickup/useClosePickupRoute', () => ({
  useClosePickupRoute: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/pickup/useRemoveManifestFromRoute', () => ({
  useRemoveManifestFromRoute: () => ({ mutate: vi.fn(), isPending: false }),
}));

const downloadedIdsMock = vi.fn();
const downloadMutate = vi.fn();
const useDownloadManifestArgsMock = vi.fn();
// M4, revisión de fase 2 — antes, estos mocks IGNORABAN los argumentos con
// los que `page.tsx` llama a los hooks reales. Un mutante que pasara
// `null`/un valor fijo en vez de `operatorId` real desactivaría la fase
// entera sin que ningún test lo notara — el mock respondía igual de todos
// modos. `(...args) => …Mock(...args)` deja los argumentos capturables.
vi.mock('@/hooks/pickup/useManifestDownload', () => ({
  useDownloadedManifestIds: (...args: unknown[]) => downloadedIdsMock(...args),
  useDownloadManifest: (...args: unknown[]) => {
    useDownloadManifestArgsMock(...args);
    return { mutate: downloadMutate, isPending: false, variables: undefined };
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Page from './page';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ActiveRoutePage — DESCARGAR wiring', () => {
  beforeEach(() => {
    operatorIdMock.mockReset();
    operatorIdMock.mockReturnValue({
      operatorId: 'op-1',
      role: 'pickup_leader',
      permissions: [],
      userId: 'leader-1',
    });
    activeRouteMock.mockReset();
    activeRouteMock.mockReturnValue({
      data: route,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    routeManifestsMock.mockReset();
    routeManifestsMock.mockReturnValue({ data: [INCOMPLETE_MANIFEST], isLoading: false });
    downloadedIdsMock.mockReset();
    downloadMutate.mockReset();
    useDownloadManifestArgsMock.mockReset();
  });

  it('shows DESCARGAR for a manifest not yet downloaded', async () => {
    downloadedIdsMock.mockReturnValue({ data: new Set<string>() });
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Ver el manifiesto' }));
    expect(screen.getByRole('button', { name: /descargar load-1/i })).toBeInTheDocument();
  });

  it('does not show DESCARGAR when downloadedIds is still unknown (undefined)', async () => {
    downloadedIdsMock.mockReturnValue({ data: undefined });
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Ver el manifiesto' }));
    expect(screen.queryByRole('button', { name: /descargar/i })).toBeNull();
  });

  it('does not show DESCARGAR once the manifest is in downloadedIds', async () => {
    downloadedIdsMock.mockReturnValue({ data: new Set(['LOAD-1']) });
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Ver el manifiesto' }));
    expect(screen.queryByRole('button', { name: /descargar/i })).toBeNull();
  });

  it('tapping DESCARGAR calls the download mutation with the manifest', async () => {
    downloadedIdsMock.mockReturnValue({ data: new Set<string>() });
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Ver el manifiesto' }));
    fireEvent.click(screen.getByRole('button', { name: /descargar load-1/i }));
    expect(downloadMutate).toHaveBeenCalledWith('LOAD-1', expect.anything());
  });

  // M4, revisión de fase 2 — el seam real: `page.tsx` tiene que pasar el
  // `operatorId` de verdad a los dos hooks, no un valor fijo. Antes de
  // capturar los argumentos (arriba), un mutante que pasara `null` en su
  // lugar desactivaría la fase entera sin romper ningún test — el mock
  // respondía igual sin mirar qué le llegó.
  it('passes the real operatorId to useDownloadedManifestIds and useDownloadManifest (M4)', async () => {
    downloadedIdsMock.mockReturnValue({ data: new Set<string>() });
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());

    expect(downloadedIdsMock).toHaveBeenCalledWith('op-1');
    expect(useDownloadManifestArgsMock).toHaveBeenCalledWith('op-1');
  });
});
