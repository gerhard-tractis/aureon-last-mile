'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CameraIntake } from '@/components/pickup/CameraIntake';
import { type ManifestRow } from '@/components/pickup/ManifestTable';
import { PickupDesktopView, type TabKey } from '@/components/pickup/PickupDesktopView';
import { PickupMobileView } from '@/components/pickup/PickupMobileView';
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
import { useIsBelowLg } from '@/hooks/useViewport';
import { useModuleEnabled } from '@/hooks/modules/useEnabledModules';
import { ModuleKey } from '@/lib/modules/registry';
import { createSPAClient } from '@/lib/supabase/client';
import { openPendingManifest } from '@/lib/pickup/openPendingManifest';
import { todayLabel, matchesSearchTerm } from '@/lib/pickup/pickupPageHelpers';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { toast } from 'sonner';

/**
 * spec-54 phase 4.4 — Recogida, escritorio (mock 1l).
 *
 * Two columns: the manifests to collect on the left, the route being assembled
 * and today's closures on the right. Below 1280px (`xl`) they stack.
 *
 * Not rendered, because the data does not exist:
 *   - the pickup window column and the urgency it colours rows by
 *     (get_pending_manifests returns no window)
 *   - "cierre de retiros 18:00" in the subtitle, for the same reason
 *   - estimated vehicle occupancy (no capacity on `vehicles`, no volume on
 *     `packages`)
 *
 * spec-54 mock 3h — below `lg` (1024px) this swaps entirely for
 * `PickupMobileView`'s phone card layout instead of squeezing the table
 * above into 390px (its fixed pixel grid wraps "PUNTO DE RECOGIDA" onto two
 * lines there). `isBelowLg` picks exactly one of the two trees — see
 * `useViewport.ts` — so this file's own header/KPI/dialog chrome stays
 * shared, and the `1l` tree below is completely unmodified by the mobile
 * work: same JSX, same tests.
 */

function PickupPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const { operatorId } = useOperatorId();
  const labelsEnabled = useModuleEnabled(operatorId, ModuleKey.PACKAGE_LABELS);
  // spec-54 mock 3h: below `lg` this screen swaps its whole body for the
  // phone card layout instead of squeezing the desktop table into 390px.
  // Defaults to `false` (desktop) when unmocked — see useViewport.ts.
  const isBelowLg = useIsBelowLg();

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
  // item 8 — mobile (3h) has no "en tránsito" tab and never reads this
  // data, so it's skipped entirely on a phone instead of fetched and
  // discarded. useCompletedManifests stays unconditional: mobile's header
  // needs closures.length even without the desktop's completed tab/table.
  const { data: inTransit } = useInTransitManifests(operatorId, !isBelowLg);
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
    .filter((r) => matchesSearchTerm(r, searchTerm));

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
    await openPendingManifest(createSPAClient(), operatorId!, row.externalLoadId, {
      orderCount: row.orderCount,
      packageCount: row.packageCount,
    });
    router.push(`/app/pickup/scan/${encodeURIComponent(row.externalLoadId)}`);
  };

  // Mobile (3h) — a card in the active-route list. Shares openPendingManifest
  // with the desktop path above (same status/started_at flip, same guard),
  // but omits `counts`: route manifests come from useRouteManifests, which
  // reads the real, NULLABLE `manifests.total_packages`/`total_orders`
  // columns directly — coalescing a genuine NULL (OCR never recorded a
  // count) through `?? 0` and writing it back would permanently turn
  // "unknown" into "zero" in the database, corrupting exactly the case
  // manifestProgress.ts exists to protect. total_orders/total_packages are
  // the only fields this path must never touch — status/started_at are
  // written exactly like the desktop path (see openPendingManifest.ts).
  const handleRouteManifestOpen = async (loadId: string) => {
    await openPendingManifest(createSPAClient(), operatorId!, loadId);
    router.push(`/app/pickup/scan/${encodeURIComponent(loadId)}`);
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

      {isBelowLg && (
        <PickupMobileView
          activeRoute={activeRoute ?? null}
          activeManifests={activeManifests}
          pendingRows={pendingRows}
          closuresCount={closures.length}
          selectedIds={selectedIds}
          onToggleSelect={toggle}
          selectedManifests={selectedManifests}
          onOpenPending={(row) => { void handleRowOpen(row); }}
          onOpenRouteManifest={(loadId) => { void handleRouteManifestOpen(loadId); }}
          operatorId={operatorId}
          onCreateRoute={handleCreateRoute}
          isCreatingRoute={startMut.isPending || addMut.isPending}
        />
      )}

      {!isBelowLg && (
        <PickupDesktopView
          activeRoute={activeRoute}
          activeManifests={activeManifests}
          totals={totals}
          closures={closures}
          clients={clients}
          selectedClient={selectedClient}
          setSelectedClient={setSelectedClient}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          pendingRows={pendingRows}
          inTransitRows={inTransitRows}
          completedRows={completedRows}
          visibleRows={visibleRows}
          tab={tab}
          setTab={setTab}
          selectedIds={selectedIds}
          toggle={toggle}
          labelsEnabled={labelsEnabled}
          onPrintLabels={handlePrintLabels}
          onOpen={(row) => { void handleRowOpen(row); }}
          operatorId={operatorId}
          selectedManifests={selectedManifests}
          onCreateRoute={handleCreateRoute}
          isCreatingRoute={startMut.isPending || addMut.isPending}
        />
      )}

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
