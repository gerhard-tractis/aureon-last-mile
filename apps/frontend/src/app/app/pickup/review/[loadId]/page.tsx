'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { UnverifiedPackagesBlock } from '@/components/pickup/UnverifiedPackagesBlock';
import { usePickupScans } from '@/hooks/pickup/usePickupScans';
import {
  useMissingPackages,
  useDiscrepancyNotes,
  useSaveDiscrepancyNote,
} from '@/hooks/pickup/useDiscrepancies';
import {
  computeReviewCounts,
  dedupeNotFoundScans,
  closeButtonLabel,
  primaryButtonLabel,
  manifestSubtitleLabel,
} from '@/lib/pickup/reviewCloseGate';
import { useOperatorId } from '@/hooks/useOperatorId';
import { createSPAClient } from '@/lib/supabase/client';
import { PickupStepBreadcrumb } from '@/components/pickup/PickupStepBreadcrumb';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * spec-80 fase 2, mock `5e`. Replaces spec-47's review screen at the same
 * point in the flow: no longer just informational — it is "el bloqueo que
 * faltaba en 5d" the mock's own label calls it. The client signs on `5f`
 * over whatever counts leave this screen (verified/missing/unexpected); a
 * missing package's note is optional and does not block the close (user
 * decision, 2026-09-08 — see reviewCloseGate.ts).
 *
 * Validated against `docs/design/Recogida.dc.html` (`5e Cierre con
 * faltantes`): "Faltan N paquetes" / "X de Y verificados" live inside the
 * red warning card (UnverifiedPackagesBlock), not in a page header — this
 * screen's own header is just the load id. "Seguir escaneando" is the
 * gold/primary CTA while anything is missing; "Cerrar con N faltantes" is
 * the secondary, red-outlined one, never disabled. With zero missing, a
 * single gold "Continuar a firma" replaces both.
 */
export default function DiscrepancyReviewPage() {
  const params = useParams();
  const router = useRouter();
  const loadId = decodeURIComponent(params.loadId as string);
  const { operatorId } = useOperatorId();

  const [manifestId, setManifestId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // Medio 5a (spec-80 fase 2 review, PR #686): the mock draws "Falabella ·
  // Mall Plaza Vespucio" under the load id — retailer + pickup point,
  // sourced straight from manifests (both columns exist on the table
  // already; no new query). pickup_location can be NULL this early in the
  // flow (it's populated at digitalization, spec-53/spec-83) — the subtitle
  // just omits the "· X" half when it is.
  const [manifestMeta, setManifestMeta] = useState<{
    retailerName: string | null;
    pickupLocation: string | null;
  } | null>(null);

  useEffect(() => {
    if (!operatorId) return;
    const supabase = createSPAClient();
    supabase
      .from('manifests')
      .select('id, retailer_name, pickup_location')
      .eq('operator_id', operatorId)
      .eq('external_load_id', loadId)
      .is('deleted_at', null)
      .single()
      .then(({ data }) => {
        if (data) {
          setManifestId(data.id);
          setManifestMeta({
            retailerName: data.retailer_name ?? null,
            pickupLocation: data.pickup_location ?? null,
          });
        }
      });
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, [operatorId, loadId]);

  // Bloqueante 1 (spec-80 fase 2 review, ronda 3, PR #686): `isLoading` is
  // `isPending && isFetching` in TanStack Query v5 — it is FALSE while a
  // query sits `paused` (networkMode:'online', the repo default —
  // Providers.tsx calls onlineManager.setOnline(false) on the browser's
  // `offline` event, never overriding networkMode). The crew's exact "SIN
  // RED" path: arriving from scan/[loadId] with ['pickup','scans',...]
  // already warm in cache, `missing` still in flight when the connection
  // drops — scansLoading/missingLoading both read false, isError both read
  // false, data stays undefined. Gating on loading/error state let that
  // slip through. Gating on DATA PRESENCE instead is honest regardless of
  // which TanStack phase produced the absence (pending, paused, or errored
  // with no cached data): the CTA cannot exist until we actually know
  // there's nothing missing.
  const { data: scans, isError: scansError } = usePickupScans(
    manifestId,
    operatorId
  );
  const { data: missingPackages, isError: missingError } = useMissingPackages(
    operatorId,
    loadId,
    manifestId
  );
  const { data: notes = [] } = useDiscrepancyNotes(manifestId);
  const saveNote = useSaveDiscrepancyNote();

  const notFoundScans = useMemo(
    () => dedupeNotFoundScans(scans ?? []),
    [scans]
  );

  const counts = useMemo(
    () => computeReviewCounts(scans ?? [], (missingPackages ?? []).length),
    [scans, missingPackages]
  );

  const noteMap = useMemo(
    () => new Map(notes.map((n) => [n.package_id, n.note])),
    [notes]
  );

  // Medio 4 (spec-80 fase 2 review, PR #686): mutateAsync, not the
  // fire-and-forget mutate — MissingPackageRow now awaits this and keeps
  // the typed note (instead of discarding it) if the save rejects.
  const handleSaveNote = (packageId: string, note: string): Promise<void> => {
    if (!operatorId || !manifestId || !userId) {
      return Promise.reject(
        new Error('missing operatorId/manifestId/userId')
      );
    }
    return saveNote.mutateAsync({
      operatorId,
      manifestId,
      packageId,
      note,
      userId,
    });
  };

  // Decisión del usuario (2026-09-08): la nota del faltante es OPCIONAL —
  // "Es opcional, y la dejaría editable en el futuro". El mock 5e muestra el
  // CTA de cierre totalmente opaco con bultos SIN nota; no hay estado
  // deshabilitado en ningún caso de este flujo. No gatear el cierre por notas.
  const goToFirma = () => {
    router.push(`/app/pickup/complete/${encodeURIComponent(loadId)}`);
  };

  const goToScan = () => {
    router.push(`/app/pickup/scan/${encodeURIComponent(loadId)}`);
  };

  // Bloqueante 2 (spec-80 fase 2 review, ronda 3, PR #686): each gate below
  // must stand on its own hook — `scans` comes back warm from cache when
  // the crew arrives from scan/[loadId] (same query key already fetched
  // there), while `missing` is very often still resolving. A combined
  // `scansError || missingError` / `scans === undefined ||
  // missingPackages === undefined` reads correctly but a test that only
  // ever sets both hooks to the same state at once can't tell which half
  // is doing the work — see page.test.tsx for the per-hook tests and the
  // two mutations applied to confirm each one is load-bearing.
  if (!manifestId) {
    return (
      <div
        data-testid="review-loading"
        className="space-y-4 p-4 sm:p-6 max-w-2xl mx-auto"
      >
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  // Error takes priority over "still loading": once a query has actually
  // settled into an error, its data is ALSO undefined — checking data
  // presence first would show the loading skeleton forever instead of the
  // error card.
  if (scansError || missingError) {
    return (
      <div
        data-testid="review-error"
        className="space-y-4 p-4 sm:p-6 max-w-2xl mx-auto"
      >
        <div className="flex flex-col gap-2 rounded-2xl p-4 bg-status-error-bg border-2 border-status-error-border">
          <span className="font-semibold text-status-error">
            No se pudo cargar el estado de {loadId}
          </span>
          <span className="text-sm text-text">
            Revisa la conexión e inténtalo de nuevo. No se puede continuar a
            firma sin saber si quedan bultos sin verificar.
          </span>
        </div>
      </div>
    );
  }

  // Bloqueante 1: gate on DATA PRESENCE, not on isLoading — a query paused
  // by networkMode:'online' while offline reads isLoading=false AND
  // isError=false, with data still undefined. This is the check that
  // actually keeps the CTA unreachable in that state.
  if (scans === undefined || missingPackages === undefined) {
    return (
      <div
        data-testid="review-loading"
        className="space-y-4 p-4 sm:p-6 max-w-2xl mx-auto"
      >
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4 p-4 sm:p-6 pb-24 max-w-2xl mx-auto">
        <PickupStepBreadcrumb current="review" />

        <div className="flex flex-col gap-0.5">
          <span className="text-lg font-semibold text-text">{loadId}</span>
          {(() => {
            const subtitle = manifestSubtitleLabel(
              manifestMeta?.retailerName ?? null,
              manifestMeta?.pickupLocation ?? null
            );
            return subtitle ? (
              <span className="text-sm text-text-secondary">{subtitle}</span>
            ) : null;
          })()}
        </div>

        <UnverifiedPackagesBlock
          counts={counts}
          missingPackages={missingPackages}
          notFoundScans={notFoundScans}
          noteMap={noteMap}
          onSaveNote={handleSaveNote}
        />
      </div>

      {/* Sticky footer — always visible on tablet/mobile */}
      <div className="fixed bottom-0 inset-x-0 bg-background border-t border-border p-4 sm:p-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-3">
          {/* Medio 6 (spec-80 fase 2 review, PR #686): mock draws the
              primary CTA at 60px and the secondary at 52px — Button's
              default h-10 (40px) is under the touch-target minimum on the
              two most important taps of this screen. */}
          {counts.missingCount > 0 ? (
            <Button onClick={goToScan} className="w-full min-h-[60px]">
              {primaryButtonLabel(counts.missingCount)}
            </Button>
          ) : null}

          {counts.missingCount > 0 ? (
            <Button
              variant="outline"
              onClick={goToFirma}
              className="w-full min-h-[52px] border-status-error-border text-status-error hover:bg-status-error-bg"
            >
              {closeButtonLabel(counts.missingCount)}
            </Button>
          ) : (
            <Button onClick={goToFirma} className="w-full min-h-[60px]">
              {primaryButtonLabel(counts.missingCount)}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
