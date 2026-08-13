'use client';

import { useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState } from '@/components/EmptyState';
import { ManifestCard } from '@/components/pickup/ManifestCard';
import type {
  PendingManifest, InTransitManifest, CompletedManifest,
} from '@/hooks/pickup/useManifests';

/**
 * The Activos / En tránsito / Completados tabs of /app/pickup.
 *
 * Lifted out of `app/app/pickup/page.tsx`, which had grown to 382 lines —
 * over the 300-line limit in CLAUDE.md. A pure extraction: no behaviour was
 * changed on the way out.
 *
 * The FILTERING lives here rather than in the page because the filter chain is
 * the same for all three lists and applying it is what the tabs are for. The
 * page still owns the filter INPUTS (`selectedClient` comes from the URL,
 * `searchTerm` from the search box) because it also owns the controls that set
 * them and the KPI cards, which count the UNFILTERED pending list.
 */

interface Searchable {
  external_load_id: string;
  retailer_name: string | null;
  pickup_point: string | null;
}

interface PickupManifestTabsProps {
  pending: PendingManifest[] | undefined;
  inTransit: InTransitManifest[] | undefined;
  completed: CompletedManifest[] | undefined;
  pendingLoading: boolean;
  inTransitLoading: boolean;
  completedLoading: boolean;
  /** Retailer chosen in ClientFilter; null = all. Mirrors the `client` search param. */
  selectedClient: string | null;
  searchTerm: string;
  /** spec-53 PACKAGE_LABELS module gate — passed straight through to the cards. */
  labelsEnabled: boolean;
  onManifestClick: (
    externalLoadId: string,
    retailerName: string | null,
    orderCount: number,
    packageCount: number,
  ) => void;
  onInTransitClick: (externalLoadId: string) => void;
  onPrintLabels: (manifestId: string) => void;
}

function ListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
      ))}
    </>
  );
}

export function PickupManifestTabs({
  pending, inTransit, completed,
  pendingLoading, inTransitLoading, completedLoading,
  selectedClient, searchTerm, labelsEnabled,
  onManifestClick, onInTransitClick, onPrintLabels,
}: PickupManifestTabsProps) {
  const [activeTab, setActiveTab] = useState<'active' | 'in_transit' | 'completed'>('active');

  // Match against load id, retailer name, and pickup point. Case-insensitive substring.
  const matchesSearch = (m: Searchable) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.trim().toLowerCase();
    return (
      m.external_load_id.toLowerCase().includes(q) ||
      (m.retailer_name?.toLowerCase().includes(q) ?? false) ||
      (m.pickup_point?.toLowerCase().includes(q) ?? false)
    );
  };

  const filteredPending = useMemo(
    () => (pending ?? [])
      .filter((m) => !selectedClient || m.retailer_name === selectedClient)
      .filter(matchesSearch),
    // matchesSearch is recomputed each render but only its inputs (searchTerm) need
    // to be in the dep list — eslint-disable for the closure capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, selectedClient, searchTerm],
  );

  const filteredCompleted = useMemo(
    () => (completed ?? [])
      .filter((m) => !selectedClient || m.retailer_name === selectedClient)
      .filter(matchesSearch),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [completed, selectedClient, searchTerm],
  );

  const filteredInTransit = useMemo(
    () => (inTransit ?? [])
      .filter((m) => !selectedClient || m.retailer_name === selectedClient)
      .filter(matchesSearch),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inTransit, selectedClient, searchTerm],
  );

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'active' | 'in_transit' | 'completed')}>
      <TabsList>
        <TabsTrigger value="active">Activos</TabsTrigger>
        <TabsTrigger value="in_transit">En tránsito</TabsTrigger>
        <TabsTrigger value="completed">Completados</TabsTrigger>
      </TabsList>

      <TabsContent value="active">
        <div className="space-y-3">
          {pendingLoading ? (
            <ListSkeleton />
          ) : filteredPending.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Sin manifiestos pendientes"
              description="Los manifiestos asignados aparecerán aquí."
            />
          ) : (
            filteredPending.map((m) => (
              <ManifestCard
                key={m.external_load_id}
                externalLoadId={m.external_load_id}
                retailerName={m.retailer_name}
                pickupPoint={m.pickup_point}
                orderCount={m.order_count}
                packageCount={m.package_count}
                verifiedCount={m.verified_count}
                createdAt={m.created_at}
                labelsEnabled={labelsEnabled}
                manifestId={m.id}
                labelsPrintedAt={m.labels_printed_at}
                labelsPrintedByName={m.labels_printed_by_name}
                onPrintLabels={() => m.id && onPrintLabels(m.id)}
                onClick={() => onManifestClick(
                  m.external_load_id, m.retailer_name, m.order_count, m.package_count,
                )}
              />
            ))
          )}
        </div>
      </TabsContent>

      <TabsContent value="in_transit">
        <div className="space-y-3">
          {inTransitLoading ? (
            <ListSkeleton />
          ) : filteredInTransit.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Sin manifiestos en tránsito"
              description="Los manifiestos entregados a bodega aparecerán aquí."
            />
          ) : (
            filteredInTransit.map((m) => (
              <ManifestCard
                key={m.id}
                externalLoadId={m.external_load_id}
                retailerName={m.retailer_name}
                pickupPoint={m.pickup_point}
                orderCount={m.total_orders ?? 0}
                packageCount={m.total_packages ?? 0}
                createdAt={m.created_at}
                inTransit
                labelsEnabled={labelsEnabled}
                manifestId={m.id}
                labelsPrintedAt={m.labels_printed_at}
                labelsPrintedByName={m.labels_printed_by_name}
                onPrintLabels={() => onPrintLabels(m.id)}
                onClick={() => onInTransitClick(m.external_load_id)}
              />
            ))
          )}
        </div>
      </TabsContent>

      <TabsContent value="completed">
        <div className="space-y-3">
          {completedLoading ? (
            <ListSkeleton />
          ) : filteredCompleted.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Sin manifiestos completados"
              description="Los manifiestos finalizados aparecerán aquí."
            />
          ) : (
            filteredCompleted.map((m) => (
              <ManifestCard
                key={m.id}
                externalLoadId={m.external_load_id}
                retailerName={m.retailer_name}
                pickupPoint={m.pickup_point}
                orderCount={m.total_orders ?? 0}
                packageCount={m.total_packages ?? 0}
                createdAt={m.created_at}
                completedAt={m.completed_at}
                interactive={false}
                labelsEnabled={labelsEnabled}
                manifestId={m.id}
                labelsPrintedAt={m.labels_printed_at}
                labelsPrintedByName={m.labels_printed_by_name}
                onPrintLabels={() => onPrintLabels(m.id)}
                onClick={() => {}}
              />
            ))
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
