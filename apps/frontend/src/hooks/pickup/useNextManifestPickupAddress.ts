import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

/**
 * spec-95 fase 3 (mock 5c panel de mapa) — el mock cuelga la dirección del
 * panel de la carga SIGUIENTE, y la dirección real vive en
 * `pickup_points.pickup_locations[0].address` (JSONB), no en
 * `manifests.pickup_location`: ese TEXT libre no tiene ningún escritor en
 * ninguna migración (verificado) y hoy queda NULL en la práctica — no es
 * "a veces vacío", es siempre vacío.
 *
 * `manifests` no lleva `pickup_point_id` (ver el docstring de
 * NextManifestCard.tsx), así que el join pasa por `orders`: el mismo
 * `external_load_id` que `useRouteManifests` ya usa para derivar
 * `total_packages` identifica también las órdenes de esta carga, y esas
 * órdenes SÍ llevan `pickup_point_id`.
 *
 * Dos queries, no una embebida: el tipo `Database` generado en `types.ts`
 * todavía no declara la FK `orders.pickup_point_id → pickup_points.id`
 * (existe en el esquema real desde `20260318000004`, pero el generador no
 * la capturó — el mismo tipo de deriva ya anotado a mano para
 * `fleet_vehicles.capacity_packages`), así que un embed tipado no
 * compilaría. `deriveTotalPackages` en `useRouteManifests.ts` resuelve el
 * mismo problema con el mismo patrón de dos pasos.
 *
 * Devuelve `null` — nunca una cadena vacía ni el nombre del punto — cuando
 * cualquier eslabón falta: sin orden, sin `pickup_point_id`, sin locations,
 * o sin campo `address` en la primera location. `null` es un resultado
 * resuelto (`isSuccess: true`), distinto de `undefined` mientras la query
 * está en curso — la pantalla que consume esto no debe confundir "todavía
 * no sé" con "no hay dirección".
 */
export function useNextManifestPickupAddress(
  operatorId: string | null,
  externalLoadId: string | null,
) {
  return useQuery({
    queryKey: ['pickup', 'next-manifest-pickup-address', operatorId, externalLoadId],
    enabled: !!operatorId && !!externalLoadId,
    staleTime: 30_000,
    queryFn: async (): Promise<string | null> => {
      const supabase = createSPAClient();

      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('pickup_point_id')
        .eq('operator_id', operatorId!)
        .eq('external_load_id', externalLoadId!)
        .is('deleted_at', null)
        .maybeSingle();
      if (orderErr) throw orderErr;
      if (!order?.pickup_point_id) return null;

      const { data: point, error: pointErr } = await supabase
        .from('pickup_points')
        .select('pickup_locations')
        .eq('operator_id', operatorId!)
        .eq('id', order.pickup_point_id)
        .is('deleted_at', null)
        .maybeSingle();
      if (pointErr) throw pointErr;

      const locations = (point?.pickup_locations ?? []) as Array<{ address?: string }>;
      return locations[0]?.address ?? null;
    },
  });
}
