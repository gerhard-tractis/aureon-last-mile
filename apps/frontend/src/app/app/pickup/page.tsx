'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Camera, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatTile } from '@/components/StatTile';
import { ClientFilter } from '@/components/pickup/ClientFilter';
import { CameraIntake } from '@/components/pickup/CameraIntake';
import { ActiveRouteBanner } from '@/components/pickup/ActiveRouteBanner';
import { ManifestTable, type ManifestRow } from '@/components/pickup/ManifestTable';
import { PickupRouteDraftPanel } from '@/components/pickup/PickupRouteDraftPanel';
import { TodayClosuresPanel } from '@/components/pickup/TodayClosuresPanel';
import {
  usePendingManifests,
  useCompletedManifests,
  useInTransitManifests,
} from '@/hooks/pickup/useManifests';
import { clientBreakdown, completedToday, pendingTotals } from '@/hooks/pickup/pickupSummary';
import { useActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';
import { useStartPickupRoute } from '@/hooks/pickup/useStartPickupRoute';
import { useAddManifestToRoute } from '@/hooks/pickup/useAddManifestToRoute';
import { useRouteManifests } from '@/hooks/pickup/useRouteManifests';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useModuleEnabled } from '@/hooks/modules/useEnabledModules';
import { ModuleKey } from '@/lib/modules/registry';
import { createSPAClient } from '@/lib/supabase/client';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * spec-54 phase 4.4 — Recogida, escritorio (mock 1l).
 *
 * Two columns: the manifests to collect on the left, the route being assembled
 * and today's closures on the right. Below 1024px they stack.
 *
 * Not rendered, because the data does not exist:
 *   - the pickup window column and the urgency it colours rows by
 *     (get_pending_manifests returns no window)
 *   - "cierre de retiros 18:00" in the subtitle, for the same reason
 *   - estimated vehicle occupancy (no capacity on `vehicles`, no volume on
 *     `packages`)
 */

const TABS = [
  { key: 'pending', label: 'Pendientes' },
  { key: 'in_transit', label: 'En tránsito' },
  { key: 'completed', label: 'Completados' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function todayLabel(now: Date): string {
  const text = new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function matches(row: ManifestRow, term: string): boolean {
  if (!term) return true;
  const q = term.toLowerCase();
  return (
    row.externalLoadId.toLowerCase().includes(q) ||
    (row.retailerName ?? '').toLowerCase().includes(q) ||
    (row.pickupPoint ?? '').toLowerCase().includes(q)
  );
}

function PickupPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const { operatorId } = useOperatorId();
  const labelsEnabled = useModuleEnabled(operatorId, ModuleKey.PACKAGE_LABELS);

  const [intakeOpen, setIntakeOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [tab, setTab] = useState<TabKey>('pending');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectedClient = searchParams.get('client');
  const setSelectedClient = (client: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (client) params.set('client', client);
    else params.delete('client');
    router.replace(`${pathname}?${params.toString()}`);
  };

  const { data: pending } = usePendingManifests(operatorId);
  const { data: inTransit } = useInTransitManifests(operatorId);
  const { data: completed } = useCompletedManifests(operatorId);

  const { data: activeRoute } = useActivePickupRoute(operatorId);
  const { data: activeManifests = [] } = useRouteManifests(activeRoute?.id ?? null, operatorId);
  const startMut = useStartPickupRoute(operatorId);
  const addMut = useAddManifestToRoute(operatorId);

  const pendingRows: ManifestRow[] = useMemo(
    () =>
      (pending ?? []).map((m) => ({
        id: m.id,
        externalLoadId: m.external_load_id,
        pickupPoint: m.pickup_point,
        retailerName: m.retailer_name,
        orderCount: m.order_count ?? 0,
        packageCount: m.package_count ?? 0,
        verifiedCount: m.verified_count,
      })),
    [pending],
  );

  const inTransitRows: ManifestRow[] = useMemo(
    () =>
      (inTransit ?? []).map((m) => ({
        id: m.id,
        externalLoadId: m.external_load_id,
        pickupPoint: m.pickup_point,
        retailerName: m.retailer_name,
        orderCount: m.total_orders ?? 0,
        packageCount: m.total_packages ?? 0,
      })),
    [inTransit],
  );

  const completedRows: ManifestRow[] = useMemo(
    () =>
      (completed ?? []).map((m) => ({
        id: m.id,
        externalLoadId: m.external_load_id,
        pickupPoint: m.pickup_point,
        retailerName: m.retailer_name,
        orderCount: m.total_orders ?? 0,
        packageCount: m.total_packages ?? 0,
      })),
    [completed],
  );

  const totals = pendingTotals(pending ?? []);
  const closures = completedToday(completed ?? []);
  const clients = clientBreakdown(pending ?? []).map((c) => c.name);

  const rowsForTab =
    tab === 'pending' ? pendingRows : tab === 'in_transit' ? inTransitRows : completedRows;

  const visibleRows = rowsForTab
    .filter((r) => !selectedClient || r.retailerName === selectedClient)
    .filter((r) => matches(r, searchTerm));

  const selectedManifests = pendingRows.filter((r) => r.id && selectedIds.has(r.id));

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // spec-53 — opens the print route in a new tab so the executive keeps this
  // screen open while the browser print dialog runs in the other.
  const handlePrintLabels = (manifestId: string) => {
    window.open(`/app/pickup/manifests/${manifestId}/labels/print`, '_blank');
  };

  const handleRowOpen = async (row: ManifestRow) => {
    const supabase = createSPAClient();
    const { data: existing } = await supabase
      .from('manifests')
      .select('id, status')
      .eq('operator_id', operatorId!)
      .eq('external_load_id', row.externalLoadId)
      .is('deleted_at', null)
      .limit(1);

    // Since 20260814000001 every CARGA gets a 'pending' manifests row at
    // ingest; opening the scan flow is what advances it to 'in_progress'.
    if (existing?.[0]?.status === 'pending') {
      await supabase
        .from('manifests')
        .update({
          status: 'in_progress',
          started_at: new Date().toISOString(),
          total_orders: row.orderCount,
          total_packages: row.packageCount,
        })
        .eq('id', existing[0].id);
    }
    router.push(`/app/pickup/scan/${encodeURIComponent(row.externalLoadId)}`);
  };

  /** Creates the route, then attaches the ticked manifests to it. */
  const handleCreateRoute = (vehicleId: string) => {
    startMut.mutate(
      { vehicleId },
      {
        onSuccess: async (route) => {
          const ids = selectedManifests.map((m) => m.id!).filter(Boolean);
          const results = await Promise.allSettled(
            ids.map((manifestId) => addMut.mutateAsync({ routeId: route.id, manifestId })),
          );
          const failed = results.filter((r) => r.status === 'rejected').length;
          if (failed > 0) {
            // The route exists either way — say what did not make it rather
            // than let the driver leave with a short load.
            toast.error(
              `La ruta se creó, pero ${failed} de ${ids.length} manifiestos no se pudieron agregar.`,
            );
          }
          setSelectedIds(new Set());
          router.push('/app/pickup/route/active');
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-col gap-[18px] px-6 py-[22px]">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="font-heading text-[26px] font-semibold leading-[1.1] tracking-[-.02em] text-text">
            Recogida
          </h1>
          <p className="text-[12.5px] leading-none text-text-secondary">
            {todayLabel(new Date())} ·{' '}
            <span className="font-mono font-semibold text-text">{totals.manifests}</span>{' '}
            {totals.manifests === 1 ? 'manifiesto por retirar' : 'manifiestos por retirar'}
          </p>
        </div>
        <Button onClick={() => setIntakeOpen(true)} className="ml-auto gap-2">
          <Camera className="h-4 w-4" />
          {t('pickup.nuevo_manifiesto')}
        </Button>
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {activeRoute && (
            <ActiveRouteBanner
              code={activeRoute.code}
              startedAt={activeRoute.started_at}
              manifestCount={activeManifests.length}
              routeId={activeRoute.id}
            />
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Manifiestos pendientes" value={totals.manifests} />
            <StatTile label="Órdenes" value={totals.orders} />
            <StatTile label="Paquetes totales" value={totals.packages} />
            <StatTile label="Completados hoy" value={closures.length} tone="success" />
          </div>

          {clients.length > 0 && (
            <ClientFilter clients={clients} selected={selectedClient} onSelect={setSelectedClient} />
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              type="search"
              placeholder="Buscar por carga, retailer o punto de recogida…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-9"
            />
            {searchTerm && (
              <button
                type="button"
                aria-label="Limpiar búsqueda"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-border bg-surface">
            <div className="flex flex-none flex-wrap items-center gap-1 border-b border-border px-4 py-2.5">
              {TABS.map((option) => {
                const count =
                  option.key === 'pending'
                    ? pendingRows.length
                    : option.key === 'in_transit'
                      ? inTransitRows.length
                      : completedRows.length;
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={tab === option.key}
                    onClick={() => setTab(option.key)}
                    className={cn(
                      'rounded-[7px] px-3 py-1.5 text-[11.5px] leading-none transition-colors',
                      tab === option.key
                        ? 'bg-surface-raised font-semibold text-text'
                        : 'text-text-secondary hover:bg-surface-raised',
                    )}
                  >
                    {option.label} · {count}
                  </button>
                );
              })}
              {tab === 'pending' && (
                <span className="ml-auto hidden text-[11px] text-text-muted lg:inline">
                  Marca los manifiestos y agrégalos a una ruta de recogida
                </span>
              )}
            </div>

            <ManifestTable
              rows={visibleRows}
              selectedIds={tab === 'pending' ? selectedIds : undefined}
              onToggle={tab === 'pending' ? toggle : undefined}
              labelsEnabled={labelsEnabled}
              onPrintLabels={handlePrintLabels}
              onOpen={(row) => { void handleRowOpen(row); }}
              emptyMessage={
                tab === 'pending'
                  ? 'No hay manifiestos pendientes de retiro.'
                  : tab === 'in_transit'
                    ? 'Ningún manifiesto en tránsito.'
                    : 'Ningún manifiesto completado todavía.'
              }
            />
          </section>
        </div>

        <aside className="flex min-h-0 flex-col gap-4">
          <PickupRouteDraftPanel
            operatorId={operatorId}
            selected={selectedManifests}
            onRemove={toggle}
            onCreate={handleCreateRoute}
            isCreating={startMut.isPending || addMut.isPending}
            activeRouteCode={activeRoute?.code ?? null}
          />
          <TodayClosuresPanel rows={closures} />
        </aside>
      </div>

      <Dialog open={intakeOpen} onOpenChange={setIntakeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('pickup.nuevo_manifiesto')}</DialogTitle>
          </DialogHeader>
          <CameraIntake onClose={() => setIntakeOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PickupPage() {
  return (
    <Suspense>
      <PickupPageContent />
    </Suspense>
  );
}
