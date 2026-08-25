'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DistributionMobileHeader } from '@/components/distribution/DistributionMobileHeader';
import { ConsolidationMobileView } from '@/components/distribution/ConsolidationMobileView';
import { SendToDockSheet } from '@/components/distribution/SendToDockSheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useConsolidation, useReleaseFromConsolidation, type ConsolidationPackage } from '@/hooks/distribution/useConsolidation';
import { useDockZones, type DockZoneRecord } from '@/hooks/distribution/useDockZones';
import { useSectorizedByZone } from '@/hooks/distribution/useSectorizedByZone';
import { useManualDockAssignment } from '@/hooks/distribution/useManualDockAssignment';
import { useOperatorId } from '@/hooks/useOperatorId';
import { countLeavingSoon } from '@/lib/distribution/leaving-soon';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';
import type { SendToDockRequest } from '@/components/distribution/PendingMobileList';

/**
 * spec-68 Fase 4 — `4f`, consolidación.
 *
 * Same shape as `pendientes`'s route (Fase 3): titled header, the list
 * component owns content, this file owns selection state and the fixed
 * action footer. `SendToDockSheet` is the SAME sheet `4e` opens — no
 * second sheet — fed a synthetic `SendToDockRequest` that can span more
 * than one selected package.
 *
 * Decisión 7 (verified on QA 2026-08-25, Fase 0) — *Mover a andén* is a
 * manual assignment per selected package via `useManualDockAssignment`,
 * not a new mutation: `trg_dock_scan_advance_package_status` promotes
 * `retenido → sectorizado` off `manual_override = true` rows regardless of
 * the package's prior status.
 *
 * Decisión 6 — the WHOLE footer (both actions) is gated on
 * `useManualDockAssignment().canUse`, absent entirely rather than
 * disabled-and-visible when the signed-in role can't manual-assign. This
 * spec explicitly extends that gate to *Liberar a sectorización* too, not
 * just *Mover a andén* — a role that can't be trusted to hand-assign a
 * dock isn't the role this screen's bulk actions are for either.
 */

function matchZoneByComuna(comunaId: string | null, zones: DockZoneRecord[]): DockZoneRecord | null {
  if (!comunaId) return null;
  return (
    zones.find((z) => !z.is_consolidation && z.is_active && z.comunas.some((c) => c.id === comunaId)) ?? null
  );
}

/**
 * The zone SendToDockSheet pre-selects for a bulk "Mover a andén" request:
 * the first selected package's own comuna match, falling back to any
 * active non-consolidation zone, and finally to consolidation itself so
 * this never returns nothing.
 */
function resolveSuggestedZone(
  selected: ConsolidationPackage[],
  zones: DockZoneRecord[],
): DockZoneRecord | null {
  for (const pkg of selected) {
    const matched = matchZoneByComuna(pkg.comunaId, zones);
    if (matched) return matched;
  }
  return zones.find((z) => z.is_active && !z.is_consolidation) ?? zones.find((z) => z.is_consolidation) ?? null;
}

export default function ConsolidationPage() {
  const router = useRouter();
  const { operatorId, userId } = useOperatorId();
  const { data: packages = [], isLoading } = useConsolidation(operatorId);
  const { data: zones = [] } = useDockZones(operatorId);
  const { data: sectorizedCounts = {} } = useSectorizedByZone(operatorId);
  const manualAssign = useManualDockAssignment(operatorId ?? '', userId ?? '', { silentErrors: true });
  const releaseFromConsolidation = useReleaseFromConsolidation(operatorId ?? '');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendRequest, setSendRequest] = useState<SendToDockRequest | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeZones = zones.filter((z) => z.is_active);
  const consolidationZone = zones.find((z) => z.is_consolidation);
  const today = todayISOInTimezone();
  const leavingSoon = countLeavingSoon(packages, today);
  const selectedPackages = packages.filter((p) => selectedIds.has(p.id));

  const handleMoveToAnden = () => {
    if (selectedPackages.length === 0) return;
    const suggestedZone = resolveSuggestedZone(selectedPackages, zones);
    if (!suggestedZone) return;
    const comunaNames = new Set(selectedPackages.map((p) => p.comunaName));
    setSendRequest({
      packageIds: selectedPackages.map((p) => p.id),
      packageLabels: selectedPackages.map((p) => p.label),
      code: selectedPackages.length === 1 ? selectedPackages[0].label : `${selectedPackages.length} bultos`,
      comunaName: comunaNames.size === 1 ? [...comunaNames][0] : null,
      suggestedZone,
    });
    setSheetOpen(true);
  };

  // Same Promise.allSettled + one summary toast pattern Fase 3 established
  // in pendientes/page.tsx — see its finding #6 note.
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
      setSelectedIds(new Set());
    } else if (succeeded === 0) {
      toast.error(`No se pudo enviar a ${zone.code}. Intenta de nuevo.`);
    } else {
      toast.error(
        `${succeeded} de ${results.length} bultos enviados a ${zone.code}; ${failed} ${
          failed === 1 ? 'falló' : 'fallaron'
        }. Revisa cuáles antes de reintentar.`,
      );
    }
  };

  const handleRelease = () => {
    if (selectedPackages.length === 0) return;
    releaseFromConsolidation.mutate(
      selectedPackages.map((p) => p.id),
      {
        onSuccess: () => {
          toast.success(
            selectedPackages.length === 1
              ? '1 bulto liberado a sectorización'
              : `${selectedPackages.length} bultos liberados a sectorización`,
          );
          setSelectedIds(new Set());
        },
        onError: () => {
          toast.error('No se pudo liberar a sectorización. Intenta de nuevo.');
        },
      },
    );
  };

  const subtitle = `${packages.length} ${packages.length === 1 ? 'bulto retenido' : 'bultos retenidos'}${
    consolidationZone ? ` · zona ${consolidationZone.code}` : ''
  }`;

  return (
    <div className="flex min-h-0 flex-col gap-4 px-6 py-[22px] pb-[104px]">
      <DistributionMobileHeader
        variant="titled"
        title="Consolidación"
        subtitle={subtitle}
        onBack={() => router.push('/app/distribution')}
        statusChip={leavingSoon > 0 ? { label: `${leavingSoon} SALEN YA`, tone: 'warning' } : undefined}
      />

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : (
        <ConsolidationMobileView
          packages={packages}
          zones={zones}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
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

      {manualAssign.canUse && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-border bg-surface px-4 py-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={handleRelease}
            disabled={selectedPackages.length === 0}
            className="flex h-[56px] flex-1 items-center justify-center rounded-xl border border-border bg-surface px-3 text-[13.5px] font-semibold text-text transition-colors active:bg-surface-raised disabled:opacity-40"
          >
            Liberar a sectorización
          </button>
          <button
            type="button"
            onClick={handleMoveToAnden}
            disabled={selectedPackages.length === 0}
            className="flex h-[56px] flex-1 items-center justify-center rounded-xl bg-accent-light px-3 text-[13.5px] font-semibold text-accent-light-foreground transition-opacity active:opacity-90 disabled:opacity-40"
          >
            Mover a andén
          </button>
        </div>
      )}
    </div>
  );
}
