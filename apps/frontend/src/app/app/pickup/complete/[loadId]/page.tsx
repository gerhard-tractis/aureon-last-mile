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
import { useOperatorId } from '@/hooks/useOperatorId';
import { createSPAClient } from '@/lib/supabase/client';
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
  const { operatorId } = useOperatorId();

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
    if (!manifestId || !operatorId || !operatorSignature) return;
    setIsSubmitting(true);

    try {
      const supabase = createSPAClient();
      const { error } = await supabase
        .from('manifests')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          signature_operator: operatorSignature,
          signature_operator_name: operatorName,
          signature_client: clientSignature,
          signature_client_name: clientName || null,
        })
        .eq('id', manifestId);

      if (error) throw error;
      toast.success('Manifiesto completado exitosamente');
      router.push('/app/pickup');
    } catch (err) {
      console.error('Failed to complete manifest:', err);
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
