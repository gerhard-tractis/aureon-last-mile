'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricCard } from '@/components/metrics/MetricCard';
import { SignaturePad } from '@/components/pickup/SignaturePad';
import { usePickupScans } from '@/hooks/pickup/usePickupScans';
import { useMissingPackages } from '@/hooks/pickup/useDiscrepancies';
import { classifyCloseManifestError } from '@/lib/pickup/closeManifestErrors';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { retryBlockedManifest } from '@/hooks/useOfflineQueue';
import { createSPAClient } from '@/lib/supabase/client';
import { db } from '@/lib/db';
import { enqueue } from '@/lib/offline/queue';
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

  const [manifestId, setManifestId] = useState<string | null>(null);
  const [manifestStartedAt, setManifestStartedAt] = useState<string | null>(
    null
  );
  const [operatorName, setOperatorName] = useState('');
  const [operatorSignature, setOperatorSignature] = useState<string | null>(
    null
  );
  const [showClientSig, setShowClientSig] = useState(false);
  const [clientName, setClientName] = useState('');
  const [clientSignature, setClientSignature] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Menor 5, ronda 4 de review del PR #679 — `5f` es la pantalla que hace la
  // promesa "se sube al recuperar señal" (la línea estática de más abajo) y
  // era la única del flujo de Recogida sin ningún indicador de bloqueo:
  // `PickupFlowHeader` (montado en `5c`/scan) no vive aquí. Sin esto, un
  // operario que llega a esta pantalla con algo ya bloqueado no tiene forma
  // de saberlo ni de reintentar.
  const sync = useSyncQueue(operatorId);

  useEffect(() => {
    if (!operatorId) return;
    const supabase = createSPAClient();
    supabase
      .from('manifests')
      .select('id, started_at')
      .eq('operator_id', operatorId)
      .eq('external_load_id', loadId)
      .is('deleted_at', null)
      .single()
      .then(({ data }) => {
        if (data) {
          setManifestId(data.id);
          setManifestStartedAt(data.started_at);
        }
      });
    // Get user full name for operator signature
    supabase.auth.getUser().then(({ data }) => {
      const userId = data.user?.id;
      if (userId) {
        supabase
          .from('users')
          .select('full_name')
          .eq('id', userId)
          .single()
          .then(({ data: userData }) => {
            setOperatorName(userData?.full_name ?? data.user?.email ?? '');
          });
      }
    });
  }, [operatorId, loadId]);

  const { data: scans = [] } = usePickupScans(manifestId, operatorId);
  const { data: missingPackages = [] } = useMissingPackages(
    operatorId,
    loadId,
    manifestId
  );

  const verifiedCount = useMemo(
    () => scans.filter((s) => s.scan_result === 'verified').length,
    [scans]
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

  const handleComplete = async () => {
    if (!manifestId || !operatorId || !userId || !operatorSignature) return;
    setIsSubmitting(true);

    try {
      const supabase = createSPAClient();
      // H5 (fix round 1): operator_name is NOT sent — close_manifest derives
      // the signer's name server-side from the JWT actor's public.users row.
      // A client-supplied name would be worthless as custody-transfer
      // evidence.
      const { error } = await supabase.rpc('close_manifest', {
        p_manifest_id: manifestId,
        p_signatures: {
          operator_signature: operatorSignature,
          client_signature: clientSignature,
          client_name: clientName || null,
        },
      });

      if (error) throw error;
      toast.success('Manifiesto completado exitosamente');
      router.push('/app/pickup');
    } catch (err) {
      // H2 (fix round 1): close_manifest now has three hard rejections
      // (cross-tenant, non-closable status, already signed) where the old
      // raw .update() almost always just succeeded. Swallowing the error
      // left the operator staring at a re-enabled button with no idea
      // whether the signature was captured — surface it.
      // F3 (fix round 2): close_manifest raises in English with a sentinel
      // prefix (MANIFEST_ALREADY_SIGNED, MANIFEST_NOT_CLOSABLE,
      // OPERATOR_SIGNATURE_REQUIRED) — map it to Spanish rather than
      // painting raw Postgres text on an all-Spanish PWA.
      console.error('Failed to complete manifest:', err);

      // spec-81 fase 2, checklist item 5 — "sin conexión" y "rechazo de
      // negocio irrecuperable" son ramas distintas, no el mismo mensaje ni
      // la misma afordancia. Offline: encolar la firma capturada y dejar al
      // operario seguir — es el caso normal en este muelle, y
      // `useOfflineQueue` la drenará al volver la señal. Rechazo de
      // negocio: detenerse, no encolar algo que el servidor puede seguir
      // rechazando para siempre, y re-habilitar el botón para que el
      // operario corrija o pida ayuda.
      const classified = classifyCloseManifestError(err);

      // P0, ronda 3 de review del PR #679 (bloqueante) — `idempotent` (23505
      // `MANIFEST_ALREADY_SIGNED`) significa que el cierre YA SE APLICÓ: la
      // respuesta se perdió en el camino (túnel, o el propio
      // `AbortSignal.timeout` del sender), no que el intento fallara. Sin
      // esta rama caía al `toast.error` genérico de abajo, dejando al
      // operario atrapado en esta pantalla para siempre después de un cierre
      // que sí funcionó — refrescar no ayuda, el `useEffect` recarga el
      // mismo manifiesto ya firmado. `offlineQueueSender.ts` ya trata este
      // mismo `kind` como éxito para el drenador de fondo; esto alinea el
      // camino interactivo con esa misma lectura.
      if (classified.kind === 'idempotent') {
        toast.success(classified.message);
        router.push('/app/pickup');
        return;
      }

      if (classified.kind === 'offline') {
        // M5, ronda 2 de review del PR #679 (mayor): `enqueue` puede lanzar
        // por su cuenta — el tope de 500 entradas sin confirmar
        // (`lib/offline/queue.ts`), o cualquier `DOMException` real de
        // IndexedDB (cuota agotada, modo privado de Safari). Antes, esa
        // excepción escapaba de este `catch` sin capturar: `setIsSubmitting
        // (false)` nunca corría, el botón quedaba deshabilitado con
        // "Completando…" para siempre, sin toast, y la firma se perdía.
        // "fallo silencioso contra la cuota" se convertía en "fallo
        // silencioso con la pantalla colgada".
        try {
          await enqueue(db, {
            operatorId,
            userId,
            manifestId,
            type: 'close_manifest',
            payload: {
              manifestId,
              signatures: {
                operator_signature: operatorSignature,
                client_signature: clientSignature,
                client_name: clientName || null,
              },
            },
          });
          toast.success(classified.message);
          router.push('/app/pickup');
          return;
        } catch (enqueueErr) {
          console.error('Failed to enqueue offline close_manifest:', enqueueErr);
          toast.error(
            enqueueErr instanceof Error ? enqueueErr.message : 'No se pudo completar el manifiesto',
          );
          setIsSubmitting(false);
          return;
        }
      }

      toast.error(classified.message);
      setIsSubmitting(false);
    }
  };

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
          onClick={() => {
            if (manifestId && operatorId) void retryBlockedManifest(operatorId, manifestId);
          }}
          className="flex w-full items-center justify-between gap-2 rounded-lg border border-status-error-border bg-status-error-bg p-3 text-left text-sm font-medium text-status-error-text"
        >
          <span>{sync.blockedCount} REQUIERE AYUDA</span>
          <span className="text-xs font-normal">Toca para reintentar</span>
        </button>
      )}

      {/*
        Decisión del usuario, 2026-09-08 (ronda 3 de review del PR #679) —
        línea estática del mock de `5f` (`docs/design/Recogida.dc.html`),
        siempre visible ANTES de que el operario firme, no como reacción a un
        fallo. Texto literal del mock. El toast (más abajo, en el catch de
        `handleComplete`) se queda como confirmación de que el cierre se
        encoló — esta línea es la promesa hecha ANTES de decidir firmar, no
        un reemplazo de esa confirmación.
      */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-status-warning-bg border border-status-warning-border">
        <p className="text-sm text-status-warning-text">
          Todo queda en el teléfono y se sube al recuperar señal. Las fotos también.
        </p>
      </div>

      {/* Operator Signature (required) */}
      <div className="space-y-2">
        <p className="text-sm text-text-secondary">
          Operador: <strong className="text-text">{operatorName}</strong>
        </p>
        <SignaturePad
          label="Firma del operador (obligatoria)"
          onChange={setOperatorSignature}
        />
      </div>

      {/* Client Signature (optional) */}
      <div className="space-y-2">
        <label htmlFor="client-sig" className="flex items-center gap-2">
          <Checkbox
            id="client-sig"
            checked={showClientSig}
            onCheckedChange={(checked) => setShowClientSig(checked === true)}
          />
          <span className="text-sm text-text">Agregar firma del cliente</span>
        </label>
        {showClientSig && (
          <div className="space-y-2 ml-6">
            <Input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Nombre del cliente"
              className="text-sm"
              aria-label="Nombre del cliente"
            />
            <SignaturePad
              label="Firma del cliente (opcional)"
              onChange={setClientSignature}
            />
          </div>
        )}
      </div>

      {/* Complete Button with Confirmation Dialog */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            disabled={!canComplete || isSubmitting}
            className="w-full disabled:opacity-50"
            size="lg"
          >
            {isSubmitting ? 'Completando...' : 'Completar y generar recibo'}
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
