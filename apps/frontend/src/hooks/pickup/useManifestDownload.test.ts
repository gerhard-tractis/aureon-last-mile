import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import React from 'react';
import { db } from '@/lib/db';
import {
  useDownloadedManifestIds,
  useDownloadManifest,
  useCachedManifestSnapshot,
} from './useManifestDownload';

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: mockFrom,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function mockManifestChain(data: unknown, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

function mockOrdersChain(data: unknown[], error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

const OPERATOR_A = 'operator-a';
const LOAD_1 = 'CARGA-99817';

describe('useDownloadedManifestIds', () => {
  beforeEach(async () => {
    await db.manifest_cache.clear();
  });

  it('returns an empty list once resolved, when nothing was downloaded', async () => {
    const { result } = renderHook(() => useDownloadedManifestIds(OPERATOR_A), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('does not fetch when operatorId is null', () => {
    const { result } = renderHook(() => useDownloadedManifestIds(null), {
      wrapper: createWrapper(),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
  });

  // M3, revisión de fase 2 — la tesis del diseño ("networkMode: 'always'
  // porque esto es una lectura local, no de red") no estaba probada:
  // borrar esa opción sobrevivía 14/14 porque ningún test ponía el
  // dispositivo offline de verdad. `onlineManager.setOnline(false)` es la
  // señal real que TanStack Query usa para pausar — no `navigator.onLine`.
  describe('offline (onlineManager)', () => {
    afterEach(() => {
      onlineManager.setOnline(true);
    });

    it('still resolves while the device is offline (M3 — proves networkMode: always matters)', async () => {
      onlineManager.setOnline(false);
      const { result } = renderHook(() => useDownloadedManifestIds(OPERATOR_A), {
        wrapper: createWrapper(),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });
  });
});

describe('useDownloadManifest', () => {
  beforeEach(async () => {
    mockFrom.mockReset();
    await db.manifest_cache.clear();
  });

  it('fetches manifest + orders and saves a snapshot retrievable offline', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'manifests') {
        return mockManifestChain({
          id: 'manifest-1',
          total_packages: 25,
          pickup_route_id: 'route-1',
          retailer_name: 'Ripley',
          pickup_location: 'Parque Arauco',
        });
      }
      if (table === 'orders') {
        return mockOrdersChain([
          {
            id: 'order-1',
            order_number: 'ORD-1',
            customer_name: 'Juan Pérez',
            comuna: 'Ñuñoa',
            delivery_address: 'Calle Falsa 123',
            packages: [
              {
                id: 'pkg-1',
                label: 'PKG-1',
                package_number: '1/1',
                sku_items: [],
                declared_weight_kg: 1,
                deleted_at: null,
              },
            ],
          },
        ]);
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useDownloadManifest(OPERATOR_A), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(LOAD_1);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const snapshot = await db.manifest_cache
      .where('[operatorId+externalLoadId]')
      .equals([OPERATOR_A, LOAD_1])
      .first();
    expect(snapshot?.retailerName).toBe('Ripley');
    expect(snapshot?.orders).toHaveLength(1);
  });

  // Menor, revisión de fase 2 — antes, el snapshot perdía parent_label e
  // is_generated_label: offline, las cajas hijas de una expansión (spec-55)
  // se dispersaban por orden alfabético en vez de agruparse bajo su padre
  // (OrderCard las agrupa por `parent_label ?? label`), el badge "Aureon"
  // (`is_generated_label`) desaparecía, y "Agregar bultos" reaparecía sobre
  // un bulto ya generado. La misma carga se veía distinta con y sin red.
  it('preserves parent_label and is_generated_label in the snapshot', async () => {
    const manifestChain = mockManifestChain({
      id: 'manifest-1',
      total_packages: 2,
      pickup_route_id: 'route-1',
      retailer_name: 'Ripley',
      pickup_location: 'Parque Arauco',
    });
    const ordersChain = mockOrdersChain([
      {
        id: 'order-1',
        order_number: 'ORD-1',
        customer_name: 'Juan Pérez',
        comuna: 'Ñuñoa',
        delivery_address: 'Calle Falsa 123',
        packages: [
          {
            id: 'pkg-2',
            label: 'CTN001-2',
            package_number: null,
            sku_items: [],
            declared_weight_kg: null,
            deleted_at: null,
            is_generated_label: true,
            parent_label: 'CTN001',
          },
        ],
      },
    ]);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'manifests') return manifestChain;
      return ordersChain;
    });

    const { result } = renderHook(() => useDownloadManifest(OPERATOR_A), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(LOAD_1);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // La comprobación real: el `select()` de Supabase tiene que PEDIR estas
    // columnas — sin esto, un mock que ignora el string de `.select()`
    // (como el de este mismo archivo) deja pasar el test aunque la query
    // real nunca hubiera traído el dato de producción.
    const selectArg = ordersChain.select.mock.calls[0][0] as string;
    expect(selectArg).toContain('is_generated_label');
    expect(selectArg).toContain('parent_label');

    const snapshot = await db.manifest_cache
      .where('[operatorId+externalLoadId]')
      .equals([OPERATOR_A, LOAD_1])
      .first();
    expect(snapshot?.orders[0].packages[0].is_generated_label).toBe(true);
    expect(snapshot?.orders[0].packages[0].parent_label).toBe('CTN001');
  });

  // M2, revisión de fase 2 — no-negociable del repo: operator_id en toda
  // query. `mockOrdersChain` antes de esto no distinguía QUÉ columnas se
  // filtraban (sólo que `.eq` se llamó dos veces), así que quitar el
  // `.eq('operator_id', …)` de la query real sobrevivía sin que ningún
  // test lo notara.
  it('filters both manifests and orders by operator_id (M2 — multi-tenant isolation)', async () => {
    const manifestChain = mockManifestChain({
      id: 'manifest-1',
      total_packages: 25,
      pickup_route_id: 'route-1',
      retailer_name: 'Ripley',
      pickup_location: 'Parque Arauco',
    });
    const ordersChain = mockOrdersChain([]);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'manifests') return manifestChain;
      if (table === 'orders') return ordersChain;
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useDownloadManifest(OPERATOR_A), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(LOAD_1);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(manifestChain.eq).toHaveBeenCalledWith('operator_id', OPERATOR_A);
    expect(ordersChain.eq).toHaveBeenCalledWith('operator_id', OPERATOR_A);
  });

  it('invalidates useDownloadedManifestIds after a successful download', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'manifests') {
        return mockManifestChain({
          id: 'manifest-1',
          total_packages: 25,
          pickup_route_id: 'route-1',
          retailer_name: 'Ripley',
          pickup_location: 'Parque Arauco',
        });
      }
      return mockOrdersChain([]);
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    const { result: listResult } = renderHook(() => useDownloadedManifestIds(OPERATOR_A), {
      wrapper,
    });
    await waitFor(() => expect(listResult.current.data).toEqual([]));

    const { result: downloadResult } = renderHook(() => useDownloadManifest(OPERATOR_A), {
      wrapper,
    });
    await act(async () => {
      await downloadResult.current.mutateAsync(LOAD_1);
    });

    await waitFor(() => expect(listResult.current.data).toEqual([LOAD_1]));
  });

  it('does not write anything to manifest_cache when the manifest fetch fails', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'manifests') {
        return mockManifestChain(null, { message: 'network down' });
      }
      return mockOrdersChain([]);
    });

    const { result } = renderHook(() => useDownloadManifest(OPERATOR_A), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync(LOAD_1).catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const rows = await db.manifest_cache.toArray();
    expect(rows).toHaveLength(0);
  });
});

describe('useCachedManifestSnapshot', () => {
  beforeEach(async () => {
    await db.manifest_cache.clear();
  });

  it('resolves to null (a known answer, not "still loading") for a carga never downloaded', async () => {
    const { result } = renderHook(
      () => useCachedManifestSnapshot(OPERATOR_A, 'CARGA-NUNCA'),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  // M3, revisión de fase 2 — mismo argumento que useDownloadedManifestIds:
  // esta es una lectura local, así que debe resolver aunque el dispositivo
  // esté "offline" según TanStack Query.
  describe('offline (onlineManager)', () => {
    afterEach(() => {
      onlineManager.setOnline(true);
    });

    it('still resolves while the device is offline (proves networkMode: always)', async () => {
      onlineManager.setOnline(false);
      const { result } = renderHook(
        () => useCachedManifestSnapshot(OPERATOR_A, 'CARGA-NUNCA'),
        { wrapper: createWrapper() },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeNull();
    });
  });

  it('is undefined ("todavía no lo sé") before resolving, never a fabricated null', () => {
    const { result } = renderHook(
      () => useCachedManifestSnapshot(OPERATOR_A, 'CARGA-NUNCA'),
      { wrapper: createWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });
});
