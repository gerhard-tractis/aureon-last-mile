'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ScanLine } from 'lucide-react';
import { toast } from 'sonner';
import { DistributionMobileHeader } from '@/components/distribution/DistributionMobileHeader';
import { PendingMobileList, type SendToDockRequest } from '@/components/distribution/PendingMobileList';
import { SendToDockSheet } from '@/components/distribution/SendToDockSheet';
import { Skeleton } from '@/components/ui/skeleton';
import { usePendingSectorization } from '@/hooks/distribution/usePendingSectorization';
import { useDockZones, type DockZoneRecord } from '@/hooks/distribution/useDockZones';
import { useSectorizedByZone } from '@/hooks/distribution/useSectorizedByZone';
import { useManualDockAssignment } from '@/hooks/distribution/useManualDockAssignment';
import { useOperatorId } from '@/hooks/useOperatorId';

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

  const activeZones = zones.filter((z) => z.is_active);
  const totalPending = groups.reduce(
    (n, g) => n + g.orders.reduce((m, o) => m + o.packages.length, 0),
    0,
  );

  const handleRequestSend = (request: SendToDockRequest) => {
    setSendRequest(request);
    setSheetOpen(true);
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

  return (
    <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px] pb-[104px]">
      <DistributionMobileHeader
        variant="titled"
        title="Pendientes de sectorizar"
        subtitle={`${totalPending} ${totalPending === 1 ? 'pendiente' : 'pendientes'}`}
        onBack={() => router.push('/app/distribution')}
      />

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : (
        <PendingMobileList
          groups={groups}
          zones={zones}
          canManualAssign={manualAssign.canUse}
          onRequestSend={handleRequestSend}
        />
      )}

      <SendToDockSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        request={sendRequest}
        activeZones={activeZones}
        sectorizedCounts={sectorizedCounts}
        canUse={manualAssign.canUse}
        onConfirm={handleConfirm}
      />

      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-border bg-surface px-4 py-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
        <span className="flex-1 truncate font-mono text-[12.5px] text-text-secondary">
          {totalPending} {totalPending === 1 ? 'pendiente' : 'pendientes'}
        </span>
        <Link
          href="/app/distribution/quicksort"
          className="flex h-[56px] flex-none items-center justify-center gap-2 rounded-xl bg-accent-light px-6 text-[15px] font-semibold text-accent-light-foreground transition-opacity active:opacity-90"
        >
          <ScanLine className="h-5 w-5" />
          Escanear
        </Link>
      </div>
    </div>
  );
}
