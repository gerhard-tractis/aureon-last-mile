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
import { useRouteManifests } from '@/hooks/pickup/useRouteManifests';
import { useManifestCompletionContext } from '@/hooks/pickup/useManifestCompletionContext';
import { useCloseManifest } from '@/hooks/pickup/useCloseManifest';
import { dedupeNotFoundScans } from '@/lib/pickup/reviewCloseGate';
import { summarizePendingRouteManifests } from '@/lib/pickup/manifestCloseSummary';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { retryBlockedManifest } from '@/hooks/useOfflineQueue';
import { CheckCircle, XCircle, Target, Shield } from 'lucide-react';
import { PickupStepBreadcrumb } from '@/components/pickup/PickupStepBreadcrumb';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

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

  const { data: scans = [] } = usePickupScans(manifestId, operatorId);
  const { data: missingPackages = [] } = useMissingPackages(
    operatorId,
    loadId,
    manifestId
  );
  // 5i — same document count ManifestPhotoStrip already renders, read again
  // here for the "Respaldo" row; react-query dedupes by query key.
  const { data: documents = [] } = useManifestDocuments(operatorId, manifestId);
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
  const verifiedCount = useMemo(() => {
    const packageIds = new Set<string>();
    for (const s of scans) {
      if (s.scan_result === 'verified' && s.package_id) packageIds.add(s.package_id);
    }
    return packageIds.size;
  }, [scans]);

  // 5i — same dedupe rule close_manifest applies server-side (H3): distinct
  // not_found barcodes, not a row count.
  const unexpectedCount = useMemo(() => dedupeNotFoundScans(scans).length, [scans]);

  const routeSummary = useMemo(
    () => (manifestId ? summarizePendingRouteManifests(routeManifests, manifestId) : null),
    [routeManifests, manifestId]
  );

  const precision = useMemo(() => {
    const total = verifiedCount + missingPackages.length;
    return total > 0 ? Math.round((verifiedCount / total) * 100) : 0;
  }, [verifiedCount, missingPackages.length]);

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
    return (
      <div className="space-y-4 p-4 sm:p-6 max-w-2xl mx-auto">
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

  if (isClosed) {
    return (
      <ManifestClosedSummary
        loadId={loadId}
        retailerName={retailerName}
        verifiedCount={verifiedCount}
        missingCount={missingPackages.length}
        unexpectedCount={unexpectedCount}
        photosCount={documents.length}
        signaturesCount={clientSignature ? 2 : 1}
        routeExternalId={routeExternalId}
        pendingRouteCount={routeSummary?.pendingCount ?? 0}
        nextManifestLabel={routeSummary?.nextManifestLabel ?? null}
        onBackToRoute={() => router.push('/app/pickup/route/active')}
      />
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6 max-w-2xl mx-auto">
      <PickupStepBreadcrumb current="complete" />

      {/* Gold header */}
      <div className="bg-accent text-accent-foreground dark:bg-accent-muted dark:text-accent p-4 -mx-4 rounded-none">
        <p className="text-xs opacity-80">{loadId}</p>
        <p className="font-semibold text-base mt-0.5">Firma y finalización</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard icon={CheckCircle} label="Verificados" value={verifiedCount} />
        <MetricCard icon={XCircle} label="Faltantes (con nota)" value={missingPackages.length} />
        <MetricCard icon={Target} label="Precisión" value={`${precision}%`} />
        <MetricCard icon={Shield} label="Duración" value={elapsed} />
      </div>

      {/* Legal Notice */}
      <div className="bg-status-warning-bg border border-status-warning-border rounded-lg p-3">
        <p className="text-sm text-text font-medium">
          Aviso de transferencia de custodia
        </p>
        <p className="text-xs text-text-secondary mt-1">
          Al firmar, el operador confirma la recepción de los paquetes verificados.
          A partir de este momento, el operador asume la responsabilidad legal
          sobre la mercancía.
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
      />

      {/*
        Decisión del usuario, 2026-09-08 (ronda 3 de review del PR #679) —
        línea estática del mock de `5f` (`docs/design/Recogida.dc.html`),
        siempre visible ANTES de que el operario firme, no como reacción a un
        fallo. Texto literal del mock. El toast (más abajo, en el catch de
        `handleComplete`) se queda como confirmación de que el cierre se
        encoló — esta línea es la promesa hecha ANTES de decidir firmar, no
        un reemplazo de esa confirmación.

        Bloqueante 1, ronda 2 de review del PR #706 — "Las fotos también" es
        HOY una promesa a medias. La firma (`close_manifest`) SÍ sobrevive
        sin señal desde spec-81 fase 2 (encolada en IndexedDB, drenada al
        volver la conexión). Las fotos NO: `useUploadManifestDocument` sube
        directo al bucket sin ninguna ruta offline, y si `upload` falla el
        archivo se pierde — `lib/offline/photos.ts` (spec-81 fase 5,
        `[pending]`) es quien cierra ese hueco, no esta fase. Declarado aquí
        y en el spec en vez de resuelto en silencio; mientras tanto,
        `ManifestPhotoStrip` al menos falla en español y sin ambigüedad
        (ver su propio comentario) en lugar de perder la foto callado.
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

      {/* Complete Button with Confirmation Dialog */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            disabled={!canComplete || isSubmitting}
            className="w-full disabled:opacity-50"
            size="lg"
          >
            {isSubmitting ? 'Completando...' : 'Confirmar y cerrar carga'}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Confirmar transferencia de custodia?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción es irreversible. Al confirmar, se registrará la
              transferencia legal de los paquetes al operador.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleComplete}>
              Confirmar y completar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
