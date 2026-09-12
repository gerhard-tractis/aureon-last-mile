'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DistributionMobileHeader } from '@/components/distribution/DistributionMobileHeader';
import { PendingMobileList } from '@/components/distribution/PendingMobileList';
import { PendingSelectionFooter, getFooterContentHeight } from '@/components/distribution/PendingSelectionFooter';
import { SendToDockSheet } from '@/components/distribution/SendToDockSheet';
import { Skeleton } from '@/components/ui/skeleton';
import { usePendingSectorization } from '@/hooks/distribution/usePendingSectorization';
import { useDockZones, type DockZoneRecord } from '@/hooks/distribution/useDockZones';
import { useSectorizedByZone } from '@/hooks/distribution/useSectorizedByZone';
import { useManualDockAssignment } from '@/hooks/distribution/useManualDockAssignment';
import { useOperatorId } from '@/hooks/useOperatorId';
import {
  buildSelectionRequest,
  flattenOrders,
  type SendToDockRequest,
} from '@/lib/distribution/pending-selection';

/**
 * spec-96 Fase 2 — `4d`'s DET/CMP segmented control, in the header row
 * beside the title. A sibling of `DistributionMobileHeader`, not a prop on
 * it: that component is shared across eight call sites (including
 * Despacho) and this toggle belongs to this one screen only.
 */
function DetCmpToggle({
  mode,
  onChange,
}: {
  mode: 'det' | 'cmp';
  onChange: (mode: 'det' | 'cmp') => void;
}) {
  return (
    <span className="flex flex-none overflow-hidden rounded-lg border border-border-strong">
      {(['det', 'cmp'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          onClick={() => onChange(option)}
          data-testid={`pendientes-mode-${option}`}
          className={`px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[.05em] ${
            mode === option ? 'bg-text text-bg' : 'text-text-secondary'
          }`}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </span>
  );
}

/**
 * spec-68 Fase 3 — `4d`, pendientes de sectorizar.
 *
 * Mobile-only in spirit but not desktop-guarded (Decisión 2's fixed-footer
 * routes follow the same shape `/app/pickup/scan/[loadId]` and
 * `/app/reception/route` already use): a single tree, capped to a
 * comfortable reading width, no `useIsBelowLg` branch. There is no desktop
 * equivalent of this screen to collide with — `PendingDockList` is scoped
 * inside quicksort/batch mode, not this route.
 *
 * `MOBILE_IMMERSIVE_PREFIXES` (navigation.mobile.ts) suppresses the global
 * tab bar here: the fixed Escanear bar at the bottom owns that space.
 */
export default function PendingSectorizationPage() {
  const router = useRouter();
  const { operatorId, userId } = useOperatorId();
  const { data: groups = [], isLoading } = usePendingSectorization(operatorId);
  const { data: zones = [] } = useDockZones(operatorId);
  const { data: sectorizedCounts = {} } = useSectorizedByZone(operatorId);
  // Fase 3 review (finding #6) — silentErrors: true. This screen batches
  // N mutateAsync calls per confirmation (one per bulto) and builds its
  // own single summary toast below; the hook's default per-call toast
  // would otherwise fire once per bulto on a network blip.
  const manualAssign = useManualDockAssignment(operatorId ?? '', userId ?? '', { silentErrors: true });

  const [sendRequest, setSendRequest] = useState<SendToDockRequest | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // spec-96 Fase 2 — `4d`'s DET/CMP and SEL controls.
  const [viewMode, setViewMode] = useState<'det' | 'cmp'>('det');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());

  // Review fix — `usePendingSectorization` has a 15s `staleTime` and
  // refetches on window focus. Select some orders, background the app
  // while a coworker sectorizes one of them, and the stale id would stay
  // ticked with no order behind it: the counter overclaims and the eventual
  // request silently sends fewer packages than it says. Same class of bug
  // `ConsolidationPageContent`'s Fase 4 review (finding #3) already fixed
  // for its own selection; pruned here on every `groups` change.
  useEffect(() => {
    setSelectedOrderIds((prev) => {
      if (prev.size === 0) return prev;
      // Round-2 review — `groups` transiently empties on a genuine load
      // (or a query error TanStack Query surfaces as `data: undefined` →
      // the page's own `= []` default), and this effect must not read
      // that as "every selected order vanished". Whether that can happen
      // mid-selection today depends on React Query's cache-retention
      // behaviour, not on this component's own logic — an explicit guard
      // keeps that true independent of anyone else's semantics.
      if (groups.length === 0) return prev;
      const validIds = new Set(flattenOrders(groups).map(({ order }) => order.orderId));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [groups]);

  const activeZones = zones.filter((z) => z.is_active);
  const totalPending = groups.reduce(
    (n, g) => n + g.orders.reduce((m, o) => m + o.packages.length, 0),
    0,
  );
  const totalOrders = groups.reduce((n, g) => n + g.orders.length, 0);

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  // Review fix — used to also force `selectionMode` off, so tapping
  // Cancelar in the sheet (which only closes the sheet) left the operator
  // back at SEL mode with the selection already gone: there was no path
  // back to the same 12 ticks to double-check an andén and resend. SEL
  // mode itself now only ever exits when the operator taps SEL again.
  const handleRequestSend = (request: SendToDockRequest) => {
    setSendRequest(request);
    setSheetOpen(true);
  };

  const handleToggleSelectionMode = () => {
    setSelectionMode((prev) => {
      const next = !prev;
      if (!next) setSelectedOrderIds(new Set());
      return next;
    });
  };

  const handleConfirmSelection = () => {
    const request = buildSelectionRequest(groups, selectedOrderIds, zones);
    if (request) handleRequestSend(request);
  };

  // Fase 3 review (finding #4) — reads `zone.is_consolidation` off the
  // zone SendToDockSheet says was actually picked, rather than
  // re-looking it up in `activeZones` (which can miss an inactive
  // consolidation zone — see SendToDockSheet's own finding #3 note — and
  // would then silently default isConsolidation to false, writing a
  // retention to dock_scans without its redirect_reason).
  //
  // Fase 3 review (finding #6) — Promise.allSettled, not Promise.all: a
  // partial failure must not leave the caller unsure which bultos made it,
  // and must summarize once, not toast once per bulto.
  const handleConfirm = async (zone: DockZoneRecord) => {
    if (!sendRequest) return;
    const results = await Promise.allSettled(
      sendRequest.packageIds.map((packageId, idx) =>
        manualAssign.mutateAsync({
          packageId,
          zoneId: zone.id,
          barcode: sendRequest.packageLabels[idx] ?? sendRequest.code,
          isConsolidation: zone.is_consolidation,
        }),
      ),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - succeeded;

    if (failed === 0) {
      toast.success(
        succeeded === 1
          ? `${sendRequest.code} enviado a ${zone.code}`
          : `${succeeded} bultos enviados a ${zone.code}`,
      );
      // Mirrors ConsolidationPageContent: only a FULLY successful send
      // clears the selection, so a partial failure leaves it visible for
      // the operator to review before retrying.
      setSelectedOrderIds(new Set());
    } else if (succeeded === 0) {
      toast.error(`No se pudo enviar ${sendRequest.code} a ${zone.code}. Intenta de nuevo.`);
    } else {
      toast.error(
        `${succeeded} de ${results.length} bultos enviados a ${zone.code}; ${failed} ${
          failed === 1 ? 'falló' : 'fallaron'
        }. Revisa cuáles antes de reintentar.`,
      );
    }
  };

  const hasSelectionFooter = selectionMode && selectedOrderIds.size > 0;
  const footerContentHeight = getFooterContentHeight(hasSelectionFooter);

  return (
    <div
      data-testid="pendientes-scroll"
      className="flex min-h-0 flex-col gap-4 px-6 py-[22px]"
      style={{ paddingBottom: `calc(${footerContentHeight}px + env(safe-area-inset-bottom))` }}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <DistributionMobileHeader
            variant="titled"
            title="Pendientes de sectorizar"
            subtitle={`${totalPending} ${totalPending === 1 ? 'bulto' : 'bultos'} · ${totalOrders} ${
              totalOrders === 1 ? 'orden' : 'órdenes'
            } · en bodega`}
            onBack={() => router.push('/app/distribution')}
          />
        </div>
        <DetCmpToggle mode={viewMode} onChange={setViewMode} />
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : (
        <PendingMobileList
          groups={groups}
          zones={zones}
          canManualAssign={manualAssign.canUse}
          onRequestSend={handleRequestSend}
          mode={viewMode}
          selectionMode={selectionMode}
          selectedOrderIds={selectedOrderIds}
          onToggleOrderSelection={toggleOrderSelection}
        />
      )}

      <SendToDockSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        request={sendRequest}
        activeZones={activeZones}
        sectorizedCounts={sectorizedCounts}
        canUse={manualAssign.canUse}
        mixedComunaBatch={sendRequest?.mixedComunaBatch ?? false}
        onConfirm={handleConfirm}
      />

      <PendingSelectionFooter
        selectionMode={selectionMode}
        selectedCount={selectedOrderIds.size}
        canManualAssign={manualAssign.canUse}
        onToggleSelectionMode={handleToggleSelectionMode}
        onConfirmSelection={handleConfirmSelection}
      />
    </div>
  );
}
