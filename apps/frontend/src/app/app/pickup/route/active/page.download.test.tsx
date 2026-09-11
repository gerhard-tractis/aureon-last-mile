/**
 * spec-82 fase 2 — conecta useDownloadedManifestIds/useDownloadManifest a
 * RouteManifestList. Fichero separado de `page.test.tsx` sólo por tamaño
 * (regla de 300 líneas; ese archivo ya está en 437) — mismos mocks base,
 * mismo patrón.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
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

const INCOMPLETE_MANIFEST_2 = {
  id: 'm2',
  external_load_id: 'LOAD-2',
  retailer_name: 'B',
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

// spec-95 fase 3 — el panel de mapa ahora pide la dirección real vía este
// hook; este archivo no prueba el mapa, así que se mockea con "sin dato".
vi.mock('@/hooks/pickup/useNextManifestPickupAddress', () => ({
  useNextManifestPickupAddress: () => ({ data: null, isLoading: false }),
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
// B1, ronda 5 de review del PR #727 — `page.tsx` ahora llama a
// `mutateAsync(externalLoadId)` (no `mutate(externalLoadId, { onSuccess,
// ... })`), precisamente para no depender de que TanStack vuelva a invocar
// los callbacks del `mutate()` de una invocación anterior cuando una
// segunda arranca antes (ver `page.download.concurrent.test.tsx`, que
// prueba ese cableado real contra el `useMutation` sin mockear). Este
// archivo sigue mockeando el hook — lo que verifica aquí es el cableado de
// LA PÁGINA (qué hace con el resultado), no si TanStack cumple su contrato.
const downloadMutateAsync = vi.fn();
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
    return { mutateAsync: downloadMutateAsync, isPending: false, variables: undefined };
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

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
    downloadMutateAsync.mockReset();
    downloadMutateAsync.mockResolvedValue(undefined);
    useDownloadManifestArgsMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
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
    expect(downloadMutateAsync).toHaveBeenCalledWith('LOAD-1');
    // Deja que se asiente la promesa resuelta del mock (evita el warning de
    // act() de la actualización de estado que dispara el .finally()).
    await waitFor(() => expect(screen.getByRole('button', { name: /descargar load-1/i })).toBeInTheDocument());
  });

  // Menor, revisión de fase 2 — un fallo de descarga no debe enseñarle al
  // operario el mensaje crudo de PostgREST (códigos, nombres de columna,
  // detalles internos). `handleDownload` transforma el rechazo de
  // `mutateAsync` en su propio mensaje via `.catch`.
  it('shows a friendly message, not the raw error, when the download fails', async () => {
    downloadedIdsMock.mockReturnValue({ data: new Set<string>() });
    downloadMutateAsync.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "pk_manifests"'),
    );
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Ver el manifiesto' }));
    fireEvent.click(screen.getByRole('button', { name: /descargar load-1/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.not.stringMatching(/constraint|violates|pk_manifests/i),
      ),
    );
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

  // B2, ronda 4 de review del PR #727 — mutar `downloadingId={downloadMut.isPending
  // ? ... : null}` en `page.tsx` sobrevivía porque este archivo, con el mock
  // de `useDownloadManifest` siempre devolviendo `isPending: false`, nunca
  // ejerció esa derivación. El chip debe deshabilitarse a partir del estado
  // que la PÁGINA controla (no del mock del hook) mientras la descarga real
  // está en curso, y NO tocar el chip de una carga distinta.
  describe('chip disabled while its own download is in flight (B2 — page wiring, not just the component)', () => {
    it('disables only the tapped chip while it downloads, and re-enables it once settled', async () => {
      downloadedIdsMock.mockReturnValue({ data: new Set<string>() });
      routeManifestsMock.mockReturnValue({
        data: [INCOMPLETE_MANIFEST, INCOMPLETE_MANIFEST_2],
        isLoading: false,
      });
      let resolveDownload!: () => void;
      downloadMutateAsync.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
        }),
      );
      wrap(<Page />);
      await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Ver los 2 manifiestos' }));

      fireEvent.click(screen.getByRole('button', { name: /descargar load-1/i }));

      expect(screen.getByRole('button', { name: /descargar load-1/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /descargar load-2/i })).not.toBeDisabled();

      resolveDownload();

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /descargar load-1/i })).not.toBeDisabled(),
      );
    });
  });

  // M1, decisión del usuario, ronda 4 de review del PR #727 — sin señal,
  // `networkMode: 'online'` deja la mutación PAUSADA indefinidamente
  // (`isPending: true` para siempre, sin `onError` ni `onSuccess`, chip
  // deshabilitado sin salida). DESCARGAR se niega de entrada con un
  // mensaje, en vez de colgarse invisible.
  describe('DESCARGAR without network signal (M1)', () => {
    afterEach(() => {
      onlineManager.setOnline(true);
    });

    it('refuses up front with a Spanish message instead of pausing the mutation', async () => {
      downloadedIdsMock.mockReturnValue({ data: new Set<string>() });
      wrap(<Page />);
      await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Ver el manifiesto' }));

      onlineManager.setOnline(false);
      fireEvent.click(screen.getByRole('button', { name: /descargar load-1/i }));

      expect(downloadMutateAsync).not.toHaveBeenCalled();
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/sin conexión/i));
    });
  });

  // Nit, ronda 6 de review del PR #727 — costura de la cadena de
  // promesas: `.then(onSuccess).catch(onError)` hace que una excepción
  // LANZADA DENTRO de `onSuccess` caiga en el mismo `.catch`. Con
  // `mutate(id, { onSuccess, onError })` eran ramas exclusivas —
  // `.then(onSuccess, onError)` (dos argumentos) restaura esa exclusividad:
  // `onError` sólo corre si la promesa de `mutateAsync` RECHAZA, nunca si
  // `onSuccess` lanza.
  it('does not show the error toast when the success toast itself throws (then/catch seam)', async () => {
    downloadedIdsMock.mockReturnValue({ data: new Set<string>() });
    toastSuccess.mockImplementationOnce(() => {
      throw new Error('toast library exploded');
    });
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Ver el manifiesto' }));
    fireEvent.click(screen.getByRole('button', { name: /descargar load-1/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });
});
