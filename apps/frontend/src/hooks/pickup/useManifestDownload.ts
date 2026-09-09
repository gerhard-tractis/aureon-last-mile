'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { db, type CachedManifestOrder } from '@/lib/db';
import {
  getManifestSnapshot,
  listDownloadedExternalLoadIds,
  saveManifestSnapshot,
} from '@/lib/offline/manifest-cache';

/**
 * spec-82 fase 2 — "DESCARGAR" (`5c`).
 *
 * Query key compartida por el hook de lectura y el de escritura, para que
 * `useDownloadManifest` sepa qué invalidar sin que el llamador tenga que
 * conocer la forma interna de la clave.
 */
const downloadedIdsKey = (operatorId: string | null) =>
  ['pickup', 'manifest-cache', 'downloaded', operatorId] as const;

/**
 * Qué cargas ya están descargadas para este operador. Lectura 100% local
 * (IndexedDB, nunca red) — por eso `networkMode: 'always'`, no el `'online'`
 * por defecto de TanStack Query. Con el por defecto, esta consulta se
 * PAUSARÍA con el dispositivo sin señal (`isLoading: false`, `data:
 * undefined`) aunque la respuesta ya esté en el disco — el mismo error que
 * ya se cometió dos veces hoy en otras pantallas de Recogida (ver el spec).
 *
 * `data === undefined` mientras la consulta no resolvió — el llamador NO
 * debe leer eso como "nada descargado" (`?? []` fabricaría un cero
 * convincente); es el tercer estado, "todavía no lo sé".
 */
export function useDownloadedManifestIds(operatorId: string | null) {
  return useQuery({
    queryKey: downloadedIdsKey(operatorId),
    queryFn: () => listDownloadedExternalLoadIds(db, operatorId!),
    enabled: !!operatorId,
    networkMode: 'always',
    // Nada más invalida esto que una descarga nueva (ver onSuccess de
    // useDownloadManifest) o un remount — no hay servidor al que
    // preguntarle si cambió.
    staleTime: Infinity,
  });
}

/**
 * Trae manifiesto + órdenes + bultos de Supabase y los deja en
 * `manifest_cache` para trabajar `5d` sin red. Requiere red para sí misma
 * (es exactamente lo que "descargar" significa) — a diferencia de
 * `useDownloadedManifestIds`, se queda con el `networkMode: 'online'` por
 * defecto: si no hay señal, no hay nada que descargar, y TanStack Query ya
 * sabe pausarla en vez de fallar con un error de red confuso.
 *
 * No persiste ningún estado "descargando" — ver "Estado de 'descargando'
 * nunca se persiste" en el spec. Si la mutación falla a mitad, no queda
 * nada escrito: el chip DESCARGAR sigue disponible tal cual.
 */
export function useDownloadManifest(operatorId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (externalLoadId: string) => {
      if (!operatorId) throw new Error('Falta operatorId');
      const supabase = createSPAClient();

      const { data: manifest, error: manifestError } = await supabase
        .from('manifests')
        .select('id, total_packages, pickup_route_id, retailer_name, pickup_location')
        .eq('operator_id', operatorId)
        .eq('external_load_id', externalLoadId)
        .is('deleted_at', null)
        .single();
      if (manifestError) throw manifestError;

      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select(
          'id, order_number, customer_name, comuna, delivery_address, packages(id, label, package_number, sku_items, declared_weight_kg, deleted_at)',
        )
        .eq('operator_id', operatorId)
        .eq('external_load_id', externalLoadId)
        .is('deleted_at', null)
        .order('order_number', { ascending: true });
      if (ordersError) throw ordersError;

      type RawOrder = Omit<CachedManifestOrder, 'packages'> & {
        packages: (CachedManifestOrder['packages'][number] & { deleted_at?: string | null })[];
      };
      const cleanOrders: CachedManifestOrder[] = ((orders ?? []) as RawOrder[]).map((order) => ({
        ...order,
        packages: (order.packages ?? []).filter((p) => !p.deleted_at),
      }));

      await saveManifestSnapshot(db, {
        operatorId,
        externalLoadId,
        manifestId: manifest.id as string,
        totalPackages: (manifest.total_packages as number | null) ?? null,
        pickupRouteId: (manifest.pickup_route_id as string | null) ?? null,
        retailerName: (manifest.retailer_name as string | null) ?? null,
        pickupLocation: (manifest.pickup_location as string | null) ?? null,
        orders: cleanOrders,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: downloadedIdsKey(operatorId) });
    },
  });
}

/**
 * El snapshot completo de una carga, para que `5d` pueda leer sin red.
 *
 * `data === null` es una respuesta CONOCIDA — "esta carga nunca se
 * descargó" — no una ausencia de respuesta; se representa como `null` y no
 * `undefined` porque TanStack Query v5 rechaza (`throw`) un `queryFn` que
 * resuelve `undefined` ("Query data cannot be undefined"). `data ===
 * undefined` sigue significando "todavía no lo sé" (consulta en curso o
 * deshabilitada) — el tercer estado real, no colapsado con `null`.
 */
export function useCachedManifestSnapshot(
  operatorId: string | null,
  externalLoadId: string | null,
) {
  return useQuery({
    queryKey: ['pickup', 'manifest-cache', 'snapshot', operatorId, externalLoadId],
    queryFn: async () => (await getManifestSnapshot(db, operatorId!, externalLoadId!)) ?? null,
    enabled: !!operatorId && !!externalLoadId,
    networkMode: 'always',
    staleTime: Infinity,
  });
}
