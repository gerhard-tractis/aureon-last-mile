'use client';

import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricCard } from '@/components/metrics/MetricCard';
import { ManifestPhotoStrip } from '@/components/pickup/ManifestPhotoStrip';
import { ClientSignatureSection } from '@/components/pickup/ClientSignatureSection';
import { OperatorSignatureSection } from '@/components/pickup/OperatorSignatureSection';
import { ManifestClosedSummary } from '@/components/pickup/ManifestClosedSummary';
import { usePickupScans } from '@/hooks/pickup/usePickupScans';
import { useMissingPackages } from '@/hooks/pickup/useDiscrepancies';
import { useManifestDocuments } from '@/hooks/pickup/useManifestDocuments';
import { useQueuedManifestPhotoCount } from '@/hooks/pickup/useQueuedManifestPhotoCount';
import { useRouteManifests } from '@/hooks/pickup/useRouteManifests';
import { useManifestCompletionContext } from '@/hooks/pickup/useManifestCompletionContext';
import { useCloseManifest } from '@/hooks/pickup/useCloseManifest';
import { dedupeNotFoundScans } from '@/lib/pickup/reviewCloseGate';
import { summarizePendingRouteManifests, custodyNoticeCopy } from '@/lib/pickup/manifestCloseSummary';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { retryBlockedManifest } from '@/hooks/useOfflineQueue';
import { CheckCircle, XCircle, Target, Shield } from 'lucide-react';
import { PickupStepBreadcrumb } from '@/components/pickup/PickupStepBreadcrumb';
import { CustodyConfirmationSheet } from '@/components/pickup/CustodyConfirmationSheet';
import { toast } from 'sonner';

// B2, ronda 2 de review de spec-95 fase 6 — el mismo esqueleto servía dos
// veces (manifiesto sin cargar, o `scans`/`missingPackages` pausados);
// compartido en vez de duplicado para no volver a inflar el archivo.
function CompletionSkeleton() {
  return (
    <div className="w-full space-y-4 p-4 sm:p-6 max-w-2xl mx-auto">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-16 w-full" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export default function CompletionPage() {
  const params = useParams();
  const router = useRouter();
  const loadId = decodeURIComponent(params.loadId as string);
  const { operatorId, userId } = useOperatorId();

  // 5f/5i state — extracted to `useManifestCompletionContext` (spec-80 fase
  // 5) to keep this file under the repo's file-size convention; same two
  // Supabase round trips this page always made, unchanged.
  const {
    manifestId,
    manifestStartedAt,
    retailerName,
    routeId,
    routeExternalId,
    operatorName,
  } = useManifestCompletionContext(operatorId, loadId);
  const [operatorSignature, setOperatorSignature] = useState<string | null>(
    null
  );
  const [showClientSig, setShowClientSig] = useState(false);
  const [clientName, setClientName] = useState('');
  const [clientSignature, setClientSignature] = useState<string | null>(null);
  // spec-95 fase 7 (5f2) — la hoja inferior de confirmación irreversible se
  // abre/cierra con este estado; antes lo llevaba `AlertDialog` (Radix) por
  // dentro, sin que esta página necesitara saberlo.
  const [showCustodyConfirm, setShowCustodyConfirm] = useState(false);
  // 5i — set once close_manifest succeeds (online, idempotent-recovered, or
  // queued offline); replaces the signing form with the closed summary.
  // `null` means "still signing".
  const [isClosed, setIsClosed] = useState(false);

  // Menor 5, ronda 4 de review del PR #679 — `5f` es la pantalla que hace la
  // promesa "se sube al recuperar señal" (la línea estática de más abajo) y
  // era la única del flujo de Recogida sin ningún indicador de bloqueo:
  // `PickupFlowHeader` (montado en `5c`/scan) no vive aquí. Sin esto, un
  // operario que llega a esta pantalla con algo ya bloqueado no tiene forma
  // de saberlo ni de reintentar.
  const sync = useSyncQueue(operatorId);

  // M-3, ronda 5 de review del PR #679 (mayor) — `blockedCount` incluye
  // bloqueos cross-user que este botón no puede resolver (sólo revive
  // `dead`, vía `retryBlockedManifest`/`retryDead`). Sin este feedback, el
  // operario tocaba "REQUIERE AYUDA" sobre un bloqueo cross-user y no veía
  // ningún cambio.
  const handleRetryBlocked = () => {
    if (!manifestId || !operatorId) return;
    void retryBlockedManifest(operatorId, manifestId).then((revived) => {
      if (revived === 0) {
        toast.info('Nada que reintentar todavía. Puede que otro operario lo esté procesando.');
      }
    });
  };

  // B2, ronda 2 de review de spec-95 fase 6 — SIN `= []`, igual que
  // `documents` más abajo: una query pausada (`networkMode:'online'`, sin
  // señal) da `data===undefined` con `isLoading`/`isError` en `false`, y un
  // `= []` lo convertía en "0 verificados" dentro del aviso que TRANSFIERE
  // CUSTODIA. Gateado explícito más abajo (mismo patrón que
  // `review/[loadId]/page.tsx:199-204`).
  const { data: scans } = usePickupScans(manifestId, operatorId);
  const { data: missingPackages } = useMissingPackages(
    operatorId,
    loadId,
    manifestId
  );
  // 5i — same document count ManifestPhotoStrip already renders, read again
  // here for the "Respaldo" row; react-query dedupes by query key.
  //
  // Seguimiento de spec-80 fase 6 (PR #736) — sin `= []`, a propósito: ese
  // default convertía un `data: undefined` (query en pausa) en "0 fotos"
  // pese a hojas ya confirmadas por el servidor. `null` = no se sabe; ver
  // `backupPhotosLabel` (`lib/pickup/manifestCloseSummary.ts`).
  const { data: documents } = useManifestDocuments(operatorId, manifestId);
  const serverPhotosCount = documents === undefined ? null : documents.length;
  const queuedPhotoCount = useQueuedManifestPhotoCount(operatorId, manifestId);
  // 5i — "Sigue en PR-…": the OTHER manifests on this same route, so this
  // screen can say how many are still pending and which is next.
  const { data: routeManifests = [] } = useRouteManifests(routeId, operatorId);

  // Ronda 2 de review del PR #726 (B2) — DISTINCT package_id, not a row
  // count. close_manifest's own out_verified_count uses
  // `COUNT(DISTINCT ps.package_id)` precisely because the only unique index
  // on pickup_scans is on client_operation_id, not (manifest_id,
  // package_id): two crew members on the same manifest, both offline, both
  // scanning the same barcode, produce two DIFFERENT client_operation_ids
  // and therefore two 'verified' rows for the same package. A plain row
  // count would show one more "verified" than the server actually recorded
  // — on the exact screen that is the client's evidence of what was
  // handed over. Same rule useRouteManifests.ts already applies
  // (verifiedByManifest, a Set of package_id per manifest).
  //
  // Seguimiento, ronda 3 — SQL's COUNT(DISTINCT) drops NULLs; a plain
  // `new Set(...).map(s => s.package_id)` would count a null package_id as
  // its own distinct member, one client_operation_id short of the server's
  // figure. Not reachable today (pickup_scans only ever writes package_id
  // on a real match), but `useRouteManifests.ts:139` — the precedent this
  // comment already cites — filters `!s.package_id` before adding to its
  // Set, and this code did not. Matched here rather than left diverging.
  // `?? []` interno: las reglas de hooks no permiten un `return`
  // condicional antes de un `useMemo`. No filtra la mentira de "0
  // verificados" — el `return` que gatea por presencia de dato, más abajo
  // antes de `isClosed`, es lo que impide pintar estos números pausados.
  const verifiedCount = useMemo(() => {
    const packageIds = new Set<string>();
    for (const s of scans ?? []) {
      if (s.scan_result === 'verified' && s.package_id) packageIds.add(s.package_id);
    }
    return packageIds.size;
  }, [scans]);

  // 5i — same dedupe rule close_manifest applies server-side (H3): distinct
  // not_found barcodes, not a row count.
  const unexpectedCount = useMemo(() => dedupeNotFoundScans(scans ?? []).length, [scans]);

  const routeSummary = useMemo(
    () => (manifestId ? summarizePendingRouteManifests(routeManifests, manifestId) : null),
    [routeManifests, manifestId]
  );

  const missingCount = missingPackages?.length ?? 0;

  const precision = useMemo(() => {
    const total = verifiedCount + missingCount;
    return total > 0 ? Math.round((verifiedCount / total) * 100) : 0;
  }, [verifiedCount, missingCount]);

  const elapsed = useMemo(() => {
    if (!manifestStartedAt) return '\u2014';
    const diff = Math.floor(
      (Date.now() - new Date(manifestStartedAt).getTime()) / 1000
    );
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins}m ${secs}s`;
  }, [manifestStartedAt]);

  const canComplete = !!operatorSignature;

  // Ronda 2 de review del PR #726 — `handleComplete` (antes ~113 líneas
  // inline, con los comentarios de seis rondas de review del PR #679)
  // movido verbatim a `useCloseManifest.ts` para mantener este archivo bajo
  // el límite de líneas del repo. `onClosed` es lo único que cambia de
  // significado: antes navegaba a `/app/pickup`, ahora muestra `5i`.
  //
  // Rebase de spec-81 fase 4 ronda 3 (PR #725) sobre spec-80 fase 5 (PR
  // #726) — el `enqueue(db, { ..., externalLoadId: loadId, ... })` que esa
  // ronda añadió inline aquí se movió DENTRO de `useCloseManifest.ts` junto
  // con el resto de `handleComplete`; `externalLoadId` pasa ahora como
  // parámetro del hook.
  const { isSubmitting, handleComplete } = useCloseManifest({
    manifestId,
    operatorId,
    userId,
    externalLoadId: loadId,
    operatorSignature,
    clientSignature,
    clientName,
    onClosed: () => setIsClosed(true),
  });

  if (!manifestId) {
    return <CompletionSkeleton />;
  }

  // B2 — gatea por PRESENCIA de dato, no por `isLoading`/`isError`; mismo
  // patrón que `review/[loadId]/page.tsx:199-204` (bloqueante 1, spec-80
  // fase 2 ronda 3, PR #686). Ver el comentario junto a `scans` arriba.
  if (scans === undefined || missingPackages === undefined) {
    return <CompletionSkeleton />;
  }

  if (isClosed) {
    return (
      <ManifestClosedSummary
        loadId={loadId}
        retailerName={retailerName}
        verifiedCount={verifiedCount}
        missingCount={missingPackages.length}
        unexpectedCount={unexpectedCount}
        serverPhotosCount={serverPhotosCount}
        queuedPhotosCount={queuedPhotoCount}
        // Review de spec-95 fase 7 (hallazgo 5a) — mismo criterio que
        // `CustodyConfirmationSheet`: un trazo sin nombre no cuenta como
        // firmante en NINGUNA pantalla. Antes, un cliente que firmaba sin
        // teclear su nombre hacía que `5f2` mostrara un solo firmante y `5i`
        // (esta pantalla), acto seguido, dijera "2 firmas" — dos pantallas
        // consecutivas del mismo cierre contradiciéndose sobre el mismo dato.
        signaturesCount={clientSignature && clientName ? 2 : 1}
        routeExternalId={routeExternalId}
        pendingRouteCount={routeSummary?.pendingCount ?? 0}
        nextManifestLabel={routeSummary?.nextManifestLabel ?? null}
        onBackToRoute={() => router.push('/app/pickup/route/active')}
      />
    );
  }

  return (
    <div className="w-full space-y-4 p-4 sm:p-6 max-w-2xl mx-auto">
      <PickupStepBreadcrumb current="complete" />

      {/* Gold header — spec-95 fase 6, mock `5f`: título arriba, subtítulo
          `CARGA-… · <cliente>` debajo (antes iba al revés). */}
      <div className="bg-accent text-accent-foreground dark:bg-accent-muted dark:text-accent p-4 -mx-4 rounded-none">
        <p className="font-semibold text-base">Firma y finalización</p>
        {/* M3 — `font-mono`, mock (`Recogida.dc.html:793`): JetBrains Mono
            es lo que distingue un id de carga en el resto de la app. */}
        <p className="font-mono text-xs opacity-80 mt-0.5">
          {retailerName ? `${loadId} · ${retailerName}` : loadId}
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard icon={CheckCircle} label="Verificados" value={verifiedCount} />
        {/* spec-95 fase 6, mock `5f` — dos líneas: en una se cortaba con
            elipsis (defecto que encontró el recorrido de QA). */}
        <MetricCard icon={XCircle} label={'Faltantes\n(con nota)'} value={missingPackages.length} />
        <MetricCard icon={Target} label="Precisión" value={`${precision}%`} />
        <MetricCard icon={Shield} label="Duración" value={elapsed} />
      </div>

      {/* Legal Notice — mock `5f`: cuenta las dos mitades (verificados a
          custodia de Aureon, faltantes a nombre del local) con las cifras
          reales. Copy en `custodyNoticeCopy` (manifestCloseSummary.ts), no
          inline — B3: un string quemado aquí no lo detecta ningún test de
          esta página con cifras siempre iguales; el unitario sí varía. */}
      <div className="bg-status-warning-bg border border-status-warning-border rounded-lg p-3">
        <p className="text-sm text-text font-medium">
          Aviso de transferencia de custodia
        </p>
        <p className="text-xs text-text-secondary mt-1">
          {custodyNoticeCopy(verifiedCount, missingPackages.length)}
        </p>
      </div>

      {/* Menor 5, ronda 4 de review del PR #679 — ver el comentario junto a
          `sync` más arriba. */}
      {sync.blockedCount > 0 && (
        <button
          type="button"
          data-testid="blocked-badge"
          onClick={handleRetryBlocked}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-status-error-border bg-status-error-bg p-3 text-left text-sm font-medium text-status-error-text"
        >
          <span>{sync.blockedCount} REQUIERE AYUDA</span>
          <span className="text-xs font-normal">Toca para reintentar</span>
        </button>
      )}

      {/* spec-80 fase 3, mock `5f` — "bloque de fotos arriba": el respaldo
          fotográfico del manifiesto firmado se monta antes de la línea de
          seguridad offline y de ambas firmas. */}
      <ManifestPhotoStrip
        operatorId={operatorId}
        manifestId={manifestId}
        userId={userId}
        externalLoadId={loadId}
      />

      {/*
        Decisión del usuario, 2026-09-08 (ronda 3 de review del PR #679) —
        línea estática del mock de `5f` (`docs/design/Recogida.dc.html`),
        siempre visible ANTES de que el operario firme, no como reacción a un
        fallo. Texto literal del mock. El toast (más abajo, en el catch de
        `handleComplete`) se queda como confirmación de que el cierre se
        encoló — esta línea es la promesa hecha ANTES de decidir firmar, no
        un reemplazo de esa confirmación.

        spec-80 fase 6 — "Las fotos también" dejó de ser una promesa a
        medias: `ManifestPhotoStrip` ya no sube directo al bucket
        (`useUploadManifestDocument`); la captura (`5g`/`5h`) se encola con
        `enqueueManifestPhoto` (`lib/offline/photos.ts`, spec-81 fase 5) y
        drena junto con la firma. Verificado antes de dejar esta línea tal
        cual — ver el spec.

        spec-95 fase 6 — reconsiderado, sigue SIN condicionarse a
        `sync.status`: promete qué pasa SI se pierde señal, no afirma que
        ahora mismo no hay señal. `SIN RED` en el mock es el escenario
        dibujado, no una condición de visibilidad.
      */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-status-warning-bg border border-status-warning-border">
        <p className="text-sm text-status-warning-text">
          Todo queda en el teléfono y se sube al recuperar señal. Las fotos también.
        </p>
      </div>

      <ClientSignatureSection
        showClientSig={showClientSig}
        onToggleShowClientSig={setShowClientSig}
        clientName={clientName}
        onClientNameChange={setClientName}
        onClientSignatureChange={setClientSignature}
      />

      <OperatorSignatureSection
        operatorName={operatorName}
        onOperatorSignatureChange={setOperatorSignature}
      />

      {/* spec-95 fase 7, mock `5f2` — este botón sólo ABRE la hoja de
          confirmación irreversible; ya no lleva el diálogo dentro. */}
      <Button
        disabled={!canComplete || isSubmitting}
        className="w-full disabled:opacity-50"
        size="lg"
        onClick={() => setShowCustodyConfirm(true)}
      >
        {isSubmitting ? 'Completando...' : 'Confirmar y cerrar carga'}
      </Button>

      <CustodyConfirmationSheet
        open={showCustodyConfirm}
        onOpenChange={setShowCustodyConfirm}
        verifiedCount={verifiedCount}
        missingCount={missingPackages.length}
        operatorName={operatorName}
        // 5f2 — "Firmas" sólo lleva al cliente cuando de verdad firmó; el
        // checkbox opcional puede estar marcado con `clientName` escrito y
        // sin trazo todavía (`clientSignature` null), y eso no es una firma.
        clientName={clientSignature ? clientName : null}
        serverPhotosCount={serverPhotosCount}
        queuedPhotosCount={queuedPhotoCount}
        onConfirm={handleComplete}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
