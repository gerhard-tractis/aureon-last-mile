/**
 * spec-82 fase 2, ronda 5 de review del PR #727 — B1/B2: dos DESCARGAR
 * concurrentes con el `useMutation` REAL (no mockeado como en
 * `page.download.test.tsx`).
 *
 * El bug vivía en la frontera entre la página y TanStack Query, y un mock
 * de `useDownloadManifest` no puede verlo: `MutationObserver.mutate()`
 * (query-core) pisa `this.#mutateOptions` y DESENGANCHA el observer de la
 * invocación anterior en cada llamada. Si un SEGUNDO `mutate()` arranca
 * antes de que el PRIMERO resuelva, los callbacks (`onSuccess`/`onError`/
 * `onSettled`) pasados al `mutate()` de la primera invocación no vuelven a
 * correr — el `Set` que deshabilita el chip nunca se libera para esa
 * descarga.
 *
 * Fichero separado de `page.download.test.tsx` (mocks e infraestructura
 * distintos: aquí NO se mockea `useManifestDownload`, se usa Dexie real y
 * un mock de Supabase con promesas diferidas para forzar el solapamiento).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { db } from '@/lib/db';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({
    operatorId: 'op-1',
    role: 'pickup_leader',
    permissions: [],
    userId: 'leader-1',
  }),
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
vi.mock('@/hooks/pickup/useActivePickupRoute', () => ({
  useActivePickupRoute: () => ({
    data: route,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const MANIFEST_A = {
  id: 'm-a',
  external_load_id: 'CARGA-A',
  retailer_name: 'A',
  pickup_location: null,
  total_orders: 1,
  total_packages: 2,
  verified_count: 1,
};
const MANIFEST_B = {
  id: 'm-b',
  external_load_id: 'CARGA-B',
  retailer_name: 'B',
  pickup_location: null,
  total_orders: 1,
  total_packages: 2,
  verified_count: 1,
};

vi.mock('@/hooks/pickup/useRouteManifests', () => ({
  useRouteManifests: () => ({ data: [MANIFEST_A, MANIFEST_B], isLoading: false }),
  useUnassignedManifests: () => ({ data: [], isLoading: false }),
}));

// spec-95 fase 3 — igual que en page.download.test.tsx: este archivo prueba
// concurrencia de descargas, no el panel de mapa.
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

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Una promesa diferida POR external_load_id, para resolver el fetch del
// manifiesto de A y B en el orden que cada test decida — es lo que fuerza
// el solapamiento real entre los dos `mutate()`.
let manifestDeferreds: Record<string, Deferred<{ data: unknown; error: unknown }>>;

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => {
      if (table === 'manifests') {
        let capturedLoadId: string | undefined;
        const chain = {
          select: () => chain,
          eq: (col: string, val: string) => {
            if (col === 'external_load_id') capturedLoadId = val;
            return chain;
          },
          is: () => chain,
          single: () => manifestDeferreds[capturedLoadId!].promise,
        };
        return chain;
      }
      // orders — no forma parte de la carrera; resuelve vacío de inmediato.
      const ordersChain = {
        select: () => ordersChain,
        eq: () => ordersChain,
        is: () => ordersChain,
        order: () => Promise.resolve({ data: [], error: null }),
      };
      return ordersChain;
    },
  }),
}));

import Page from './page';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ActiveRoutePage — dos DESCARGAR concurrentes, useMutation real (B1/B2, ronda 5)', () => {
  beforeEach(async () => {
    await db.manifest_cache.clear();
    toastSuccess.mockReset();
    toastError.mockReset();
    manifestDeferreds = { 'CARGA-A': deferred(), 'CARGA-B': deferred() };
  });

  it('un fallo en la PRIMERA descarga libera su chip aunque una segunda haya arrancado antes de que resolviera', async () => {
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Ver los 2 manifiestos' }));

    // `findByRole` (no `getByRole`) — el chip DESCARGAR sólo aparece una vez
    // que `useDownloadedManifestIds` resuelve su lectura real de Dexie
    // (`downloadedIds` empieza `undefined`, "todavía no lo sé", y
    // `RouteManifestList` no pinta el chip hasta que deja de serlo). Bajo
    // contención de CPU (toda la suite corriendo en paralelo) esa lectura
    // puede tardar más que el resto del render; `getByRole` síncrono
    // encontraba el chip por coincidencia de timing, no porque el test
    // esperara la condición real — ver `docs/specs/CLAUDE.md` sobre no
    // depender de temporización implícita.
    fireEvent.click(await screen.findByRole('button', { name: /descargar carga-a/i }));
    fireEvent.click(await screen.findByRole('button', { name: /descargar carga-b/i }));

    expect(screen.getByRole('button', { name: /descargar carga-a/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /descargar carga-b/i })).toBeDisabled();

    manifestDeferreds['CARGA-A'].resolve({ data: null, error: { message: 'network down' } });

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // El bug real: sin el fix, este chip se queda disabled para siempre —
    // sus callbacks de `mutate()` nunca vuelven a correr porque el segundo
    // `mutate()` (CARGA-B) ya desenganchó el observer.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /descargar carga-a/i })).not.toBeDisabled(),
    );

    manifestDeferreds['CARGA-B'].resolve({
      data: {
        id: 'manifest-b',
        total_packages: 2,
        pickup_route_id: 'route-1',
        retailer_name: 'B',
        pickup_location: null,
      },
      error: null,
    });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  // Nit, ronda 6 de review del PR #727 — la dirección contraria del test de
  // arriba: la PRIMERA descarga tiene éxito mientras la SEGUNDA sigue en
  // vuelo. No debe tocar el chip de B, que sigue deshabilitado por su
  // propia entrada en el `Set` hasta que su propia promesa se asiente.
  it('un éxito en la PRIMERA descarga no toca el chip de la segunda que sigue en vuelo', async () => {
    wrap(<Page />);
    await waitFor(() => expect(screen.getByText('PR-2026-0001')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Ver los 2 manifiestos' }));

    // Ver el comentario del test de arriba — `findByRole` espera a que
    // `downloadedIds` resuelva antes de tocar el chip.
    fireEvent.click(await screen.findByRole('button', { name: /descargar carga-a/i }));
    fireEvent.click(await screen.findByRole('button', { name: /descargar carga-b/i }));

    manifestDeferreds['CARGA-A'].resolve({
      data: {
        id: 'manifest-a',
        total_packages: 2,
        pickup_route_id: 'route-1',
        retailer_name: 'A',
        pickup_location: null,
      },
      error: null,
    });

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // A ya está descargada — el chip DESCARGAR desaparece (queda
    // DESCARGADA); B sigue volando, su chip sigue deshabilitado.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /descargar carga-a/i })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: /descargar carga-b/i })).toBeDisabled();

    manifestDeferreds['CARGA-B'].resolve({ data: null, error: { message: 'network down' } });
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
