'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CameraIntake } from '@/components/pickup/CameraIntake';
import { type ManifestRow } from '@/components/pickup/ManifestTable';
import { PickupDesktopHeader } from '@/components/pickup/PickupDesktopHeader';
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
import { canLeadPickupRoute } from '@/lib/permissions';
import { useIsBelowLg } from '@/hooks/useViewport';
import { useModuleEnabled } from '@/hooks/modules/useEnabledModules';
import { ModuleKey } from '@/lib/modules/registry';
import { createSPAClient } from '@/lib/supabase/client';
import { openPendingManifest } from '@/lib/pickup/openPendingManifest';
import {
  attachManifestsToRoute,
  partialAttachMessage,
} from '@/lib/pickup/attachManifestsToRoute';
import { matchesSearchTerm, pendingToRows, totalsToRows } from '@/lib/pickup/pickupPageHelpers';
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
  // spec-61 Task 5 — `role` decides 3j vs the crew screen, `userId` decides
  // whose route this is (the cancel affordance) and keeps a leader out of
  // their own crew picker.
  const { operatorId, role, userId } = useOperatorId();
  // spec-61 Task 5 — `role === null` means UNKNOWN, not "crew". GlobalContext
  // sets operatorId/role/permissions in ONE setState pass once its async
  // getUser() + getSession() resolve (GlobalContext.tsx:31-63), and
  // _client-gate.tsx:19 deliberately paints children while permissions are
  // still empty — so nothing blocks the render. `!operatorId` is therefore an
  // exact "claims have not landed yet" signal, and the two branches that key
  // off `canLead` must not fire a refusal during it.
  const roleUnknown = !operatorId;
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

  // spec-61 Task 5 — `isError` is read, not just `data`. After React Query
  // exhausts its retries a FAILED lookup leaves `data` undefined, which is
  // indistinguishable from "no route": this screen then told a leader who
  // HAS an open route that they do not, and left "Iniciar ruta" enabled on
  // both the mobile and the desktop path. Task 4 made the same fix on
  // route/active/page.tsx.
  const {
    data: activeRoute,
    isError: activeRouteUnknown,
    refetch: refetchActiveRoute,
  } = useActivePickupRoute(operatorId);
  const { data: activeManifests = [] } = useRouteManifests(activeRoute?.id ?? null, operatorId);
  const startMut = useStartPickupRoute(operatorId);
  const addMut = useAddManifestToRoute(operatorId);

  const pendingRows: ManifestRow[] = useMemo(() => pendingToRows(pending ?? []), [pending]);
  const inTransitRows: ManifestRow[] = useMemo(() => totalsToRows(inTransit ?? []), [inTransit]);
  const completedRows: ManifestRow[] = useMemo(() => totalsToRows(completed ?? []), [completed]);

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

  /**
   * Creates the route, then attaches the ticked manifests to it.
   *
   * `crewIds` is DEFAULTED, and must stay defaulted: the desktop path calls
   * this with one argument (PickupDesktopView -> PickupRouteDraftPanel ->
   * StartRouteButton's `onStart(vehicleId)`), and `1l` has no crew picker.
   * Making it required would be a tsc error on that prop type and, at
   * runtime, would hand `undefined` to the RPC as the crew.
   */
  const handleCreateRoute = (vehicleId: string, crewIds: string[] = []) => {
    startMut.mutate(
      { vehicleId, crewUserIds: crewIds },
      {
        onSuccess: async (route) => {
          const { attempted, failedLoadIds } = await attachManifestsToRoute(
            route.id,
            selectedManifests,
            addMut.mutateAsync,
          );
          if (failedLoadIds.length > 0) {
            // The route exists either way — name what did not make it rather
            // than let the driver leave with a short load and no idea which
            // one. If EVERY add fails the leader lands on 3h with an empty
            // route; CancelRouteButton is their way out.
            toast.error(partialAttachMessage(failedLoadIds, attempted));
          }
          setSelectedIds(new Set());
          router.push('/app/pickup/route/active');
        },
        // spec-61 Task 5 — ONE surface per screen, not two. Mobile renders
        // this same message as a persistent role="alert" inside 3j, right
        // under the button that failed (PickupMobileStartRoute), so a toast
        // as well said it twice and the copy that survives is the one that
        // does not auto-dismiss while the phone is in a pocket. Desktop's
        // draft panel has no inline error line, so there the toast IS the
        // surface.
        onError: (err) => { if (!isBelowLg) toast.error(err.message); },
      },
    );
  };

  return (
    <div className="flex min-h-0 flex-col gap-[18px] px-6 py-[22px]">
      {/* Desktop-only. Mobile (3h/3j) renders its own header inside
          PickupMobileView — both stacked on a 390px screen before this
          guard (found live in QA). */}
      {!isBelowLg && (
        <PickupDesktopHeader
          manifestCount={totals.manifests}
          onNewManifest={() => setIntakeOpen(true)}
          newManifestLabel={t('pickup.nuevo_manifiesto')}
        />
      )}

      {isBelowLg && (
        <PickupMobileView
          activeRoute={activeRoute ?? null}
          activeManifests={activeManifests}
          pendingRows={pendingRows}
          selectedIds={selectedIds}
          onToggleSelect={toggle}
          selectedManifests={selectedManifests}
          onOpenRouteManifest={(loadId) => { void handleRouteManifestOpen(loadId); }}
          operatorId={operatorId}
          role={role}
          currentUserId={userId}
          roleUnknown={roleUnknown}
          routeUnknown={activeRouteUnknown}
          onRetryRoute={() => { void refetchActiveRoute(); }}
          canCancelRoute={!!userId && activeRoute?.driver_id === userId}
          onCreateRoute={handleCreateRoute}
          isCreatingRoute={startMut.isPending || addMut.isPending}
          createRouteError={startMut.error?.message ?? null}
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
          canLead={canLeadPickupRoute(role)}
          routeUnknown={activeRouteUnknown}
          roleUnknown={roleUnknown}
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
