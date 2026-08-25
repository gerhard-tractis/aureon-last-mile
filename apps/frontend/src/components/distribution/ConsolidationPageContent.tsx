'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DistributionMobileHeader } from './DistributionMobileHeader';
import { ConsolidationMobileView } from './ConsolidationMobileView';
import { SendToDockSheet } from './SendToDockSheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useConsolidation, useReleaseFromConsolidation, type ConsolidationPackage } from '@/hooks/distribution/useConsolidation';
import { useDockZones, type DockZoneRecord } from '@/hooks/distribution/useDockZones';
import { useSectorizedByZone } from '@/hooks/distribution/useSectorizedByZone';
import { useManualDockAssignment } from '@/hooks/distribution/useManualDockAssignment';
import { useOperatorId } from '@/hooks/useOperatorId';
import { countLeavingSoon } from '@/lib/distribution/leaving-soon';
import { matchZoneByComuna } from '@/lib/distribution/consolidation-zone-match';
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
 * Decisión 6, corrected in Fase 4 review (finding #0) — only *Mover a
 * andén* is gated on `useManualDockAssignment().canUse`, absent entirely
 * rather than disabled-and-visible: it writes an audited
 * `manual_override` row and promotes the package's status, the same
 * emergency-exit shape as `4e`. *Liberar a sectorización* is NOT gated —
 * releasing only returns a package to the pending pool where it still has
 * to be scanned properly; it carries none of manual assignment's
 * bypass-the-scan risk, and desktop's `ConsolidationPanel` never gated it
 * either. A `warehouse_staff` user sees the footer with Liberar only.
 */

/**
 * The zone SendToDockSheet pre-selects for a bulk "Mover a andén" request:
 * the first selected package's own comuna match. Fase 4 review (finding
 * #1) — when nothing in the selection matches any andén (every selected
 * package is itself SIN ANDÉN), this falls back to the CONSOLIDATION
 * zone, never an arbitrary active andén. The old fallback
 * (`zones.find(z => z.is_active && !z.is_consolidation)`) picked whatever
 * andén happened to sort first and let the sheet present it pre-selected,
 * badged SUGERIDO, "sugerido {code} por comuna" — auditable but false,
 * and the trigger would still promote the package to `sectorizado` there
 * on confirm. Consolidación is always the safe default: it is where an
 * unmapped-comuna package already lives.
 */
function resolveSuggestedZone(
  selected: ConsolidationPackage[],
  zones: DockZoneRecord[],
): DockZoneRecord | null {
  for (const pkg of selected) {
    const matched = matchZoneByComuna(pkg.comunaId, zones);
    if (matched) return matched;
  }
  return zones.find((z) => z.is_consolidation) ?? null;
}

/**
 * Fase 4 review (finding #2) — true when the selection's comuna matches
 * resolve to MORE THAN ONE distinct andén. `resolveSuggestedZone` only
 * reflects the FIRST matching package in that case; confirming as-is
 * would silently sectorize every other package onto a zone that isn't
 * actually theirs. Packages with no match at all (SIN ANDÉN) don't count
 * toward "mixed" on their own — only disagreement between ACTUAL matches
 * does.
 */
function isMixedComunaBatch(selected: ConsolidationPackage[], zones: DockZoneRecord[]): boolean {
  const matchedZoneIds = new Set(
    selected
      .map((pkg) => matchZoneByComuna(pkg.comunaId, zones))
      .filter((zone): zone is DockZoneRecord => zone !== null)
      .map((zone) => zone.id),
  );
  return matchedZoneIds.size > 1;
}

export interface ConsolidationPageContentProps {
  /** Injectable for tests; defaults to now. Threaded through to
   *  `ConsolidationMobileView` too, so both agree on "today" — Fase 4
   *  review (finding #5): the page used to call `todayISOInTimezone()`
   *  with no seam, so its own SALEN YA count drifted from the view's
   *  URGENTES/PRÓXIMOS split at the calendar boundary and its tests
   *  passed only by date coincidence. */
  now?: Date;
}

export function ConsolidationPageContent({ now }: ConsolidationPageContentProps = {}) {
  const router = useRouter();
  const { operatorId, userId } = useOperatorId();
  const { data: packages = [], isLoading } = useConsolidation(operatorId);
  const { data: zones = [], isLoading: zonesLoading } = useDockZones(operatorId);
  const { data: sectorizedCounts = {} } = useSectorizedByZone(operatorId);
  const manualAssign = useManualDockAssignment(operatorId ?? '', userId ?? '', { silentErrors: true });
  const releaseFromConsolidation = useReleaseFromConsolidation(operatorId ?? '');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendRequest, setSendRequest] = useState<SendToDockRequest | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [mixedComunaBatch, setMixedComunaBatch] = useState(false);

  // Fase 4 review (finding #3) — `selectedIds` used to persist ids the
  // packages list no longer carries (a partial "Mover a andén" failure
  // that deliberately keeps the selection, or the hook's own 30s
  // `refetchInterval` picking up a coworker's scan). The chip and the
  // footer would then disagree with reality. Pruned here, once, so every
  // reader of `selectedIds` (the chip, the footer, `selectedPackages`
  // below) stays consistent without each having to re-derive it.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(packages.map((p) => p.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [packages]);

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
  const today = todayISOInTimezone(now);
  const leavingSoon = countLeavingSoon(packages, today);
  const selectedPackages = packages.filter((p) => selectedIds.has(p.id));

  // Fase 4 review (finding #4) — `handleMoveToAnden`'s own
  // `if (!suggestedZone) return` used to be the only guard: with
  // `useConsolidation` resolved from cache while `useDockZones` was still
  // in flight, the button looked enabled and tapping it silently did
  // nothing — no sheet, no toast, no visible disabled state. `zones` is
  // never actually empty once loaded (a consolidation zone is a system
  // invariant — `useEnsureConsolidationZone`), so gating on load state
  // covers the real gap without permanently disabling the button.
  const moveDisabled = selectedPackages.length === 0 || zonesLoading || zones.length === 0;

  const handleMoveToAnden = () => {
    if (selectedPackages.length === 0) return;
    const suggestedZone = resolveSuggestedZone(selectedPackages, zones);
    if (!suggestedZone) return;
    const comunaNames = new Set(selectedPackages.map((p) => p.comunaName));
    setMixedComunaBatch(isMixedComunaBatch(selectedPackages, zones));
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
          now={now}
        />
      )}

      <SendToDockSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        request={sendRequest}
        activeZones={activeZones}
        sectorizedCounts={sectorizedCounts}
        canUse={manualAssign.canUse}
        mixedComunaBatch={mixedComunaBatch}
        onConfirm={handleConfirm}
      />

      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-border bg-surface px-4 py-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={handleRelease}
          disabled={selectedPackages.length === 0}
          className="flex h-[56px] flex-1 items-center justify-center rounded-xl border border-border bg-surface px-3 text-[13.5px] font-semibold text-text transition-colors active:bg-surface-raised disabled:opacity-40"
        >
          Liberar a sectorización
        </button>
        {manualAssign.canUse && (
          <button
            type="button"
            onClick={handleMoveToAnden}
            disabled={moveDisabled}
            className="flex h-[56px] flex-1 items-center justify-center rounded-xl bg-accent-light px-3 text-[13.5px] font-semibold text-accent-light-foreground transition-opacity active:opacity-90 disabled:opacity-40"
          >
            Mover a andén
          </button>
        )}
      </div>
    </div>
  );
}
