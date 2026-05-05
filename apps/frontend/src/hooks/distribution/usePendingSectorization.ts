import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { useDockZones } from './useDockZones';
import { determineDockZone } from '@/lib/distribution/sectorization-engine';
import type { DockZone, ZoneMatchResult } from '@/lib/distribution/sectorization-engine';

export interface SkuItem {
  sku: string;
  description: string;
  quantity: number;
}

export interface PendingPackage {
  id: string;
  label: string;
  order_id: string;
  orderNumber: string;
  comunaId: string | null;
  comunaName: string | null;
  delivery_date: string;
  skuItems: SkuItem[];
}

export interface OrderGroup {
  orderId: string;
  orderNumber: string;
  deliveryDate: string;
  comunaName: string | null;
  packages: PendingPackage[];
}

export interface ZoneGroup {
  zone: DockZone;
  matchResult: ZoneMatchResult;
  orders: OrderGroup[];
}

interface RawSkuItem {
  sku?: unknown;
  description?: unknown;
  quantity?: unknown;
}

function normalizeSkuItems(raw: unknown): SkuItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it): it is RawSkuItem => typeof it === 'object' && it !== null)
    .map(it => ({
      sku: typeof it.sku === 'string' ? it.sku : '',
      description: typeof it.description === 'string' ? it.description : '',
      quantity: typeof it.quantity === 'number' ? it.quantity : 1,
    }));
}

export function usePendingSectorization(operatorId: string | null) {
  const { data: zones } = useDockZones(operatorId);

  return useQuery({
    queryKey: ['distribution', 'pending-sectorization', operatorId],
    queryFn: async (): Promise<ZoneGroup[]> => {
      const supabase = createSPAClient();
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('packages')
        .select(
          'id, label, order_id, sku_items, orders!inner(order_number, comuna_id, delivery_date, chile_comunas(nombre))'
        )
        .eq('operator_id', operatorId!)
        .eq('status', 'en_bodega')
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (error) throw error;
      if (!data || !zones || zones.length === 0) return [];

      // Pass 1: group packages into zone buckets
      const zoneMap = new Map<string, { zone: DockZone; matchResult: ZoneMatchResult; orderMap: Map<string, OrderGroup> }>();

      for (const pkg of data) {
        const order = pkg.orders as {
          order_number: string;
          comuna_id: string | null;
          delivery_date: string;
          chile_comunas: { nombre: string } | null;
        };
        const matchResult = determineDockZone(
          { comunaId: order.comuna_id, delivery_date: order.delivery_date },
          zones,
          today
        );

        let zoneBucket = zoneMap.get(matchResult.zone_id);
        if (!zoneBucket) {
          const zone = zones.find(z => z.id === matchResult.zone_id)!;
          zoneBucket = { zone, matchResult, orderMap: new Map() };
          zoneMap.set(matchResult.zone_id, zoneBucket);
        }

        const pendingPkg: PendingPackage = {
          id: pkg.id,
          label: pkg.label,
          order_id: pkg.order_id,
          orderNumber: order.order_number,
          comunaId: order.comuna_id,
          comunaName: order.chile_comunas?.nombre ?? null,
          delivery_date: order.delivery_date,
          skuItems: normalizeSkuItems(pkg.sku_items),
        };

        let orderGroup = zoneBucket.orderMap.get(pkg.order_id);
        if (!orderGroup) {
          orderGroup = {
            orderId: pkg.order_id,
            orderNumber: order.order_number,
            deliveryDate: order.delivery_date,
            comunaName: order.chile_comunas?.nombre ?? null,
            packages: [],
          };
          zoneBucket.orderMap.set(pkg.order_id, orderGroup);
        }
        orderGroup.packages.push(pendingPkg);
      }

      // Pass 2: sort packages within each order (label ASC), sort orders by deliveryDate ASC
      return Array.from(zoneMap.values()).map(({ zone, matchResult, orderMap }) => {
        const orders = Array.from(orderMap.values());
        for (const og of orders) {
          og.packages.sort((a, b) => a.label.localeCompare(b.label));
        }
        orders.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
        return { zone, matchResult, orders };
      });
    },
    enabled: !!operatorId && !!zones && zones.length > 0,
    staleTime: 15_000,
  });
}
