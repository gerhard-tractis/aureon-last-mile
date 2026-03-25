'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
import { ReceptionSummary } from '@/components/reception/ReceptionSummary';
import { ReceptionStepBreadcrumb } from '@/components/reception/ReceptionStepBreadcrumb';
import {
  useHubReception,
  useCompleteReception,
} from '@/hooks/reception/useHubReceptions';
import { useOperatorId } from '@/hooks/useOperatorId';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';

export default function ReceptionCompletePage() {
  const params = useParams();
  const router = useRouter();
  const receptionId = params.receptionId as string;
  const { operatorId } = useOperatorId();

  const [discrepancyNotes, setDiscrepancyNotes] = useState('');
  const [isCompleted, setIsCompleted] = useState(false);

  const { data: reception, isLoading } = useHubReception(receptionId, operatorId);
  const completeMutation = useCompleteReception();

  const expectedCount = reception?.expected_count ?? 0;
  const receivedCount = reception?.received_count ?? 0;
  const missingCount = Math.max(0, expectedCount - receivedCount);
  const hasMissing = missingCount > 0;
  const manifestId = reception?.manifest_id ?? '';
  const externalLoadId = reception?.manifests?.external_load_id ?? '';
  const retailerName = reception?.manifests?.retailer_name ?? 'Retailer desconocido';

  const handleConfirm = () => {
    if (!operatorId || !manifestId) return;

    completeMutation.mutate(
      {
        receptionId,
        manifestId,
        operatorId,
        discrepancyNotes: hasMissing && discrepancyNotes.trim()
          ? discrepancyNotes.trim()
          : null,
      },
      {
        onSuccess: () => {
          setIsCompleted(true);
          toast.success('Recepción completada exitosamente');
          setTimeout(() => {
            router.push('/app/reception');
          }, 2000);
        },
        onError: () => {
          toast.error('Error al completar la recepción');
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (isCompleted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-4 space-y-4">
        <CheckCircle className="h-16 w-16 text-status-success" />
        <h2 className="text-xl font-bold text-text">
          Recepción completada
        </h2>
        <p className="text-text-secondary text-center">
          {retailerName} — {externalLoadId}
        </p>
        <p className="text-sm text-text-muted">
          Redirigiendo...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6 max-w-2xl mx-auto">
      <ReceptionStepBreadcrumb current="confirm" />

      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.back()}
          aria-label="Volver"
        >
          <ArrowLeft className="h-5 w-5 text-text-secondary" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-text">
            Confirmar Recepción
          </h1>
          <p className="text-sm text-text-secondary">
            {retailerName} — {externalLoadId}
          </p>
        </div>
      </div>

      {/* Summary */}
      <ReceptionSummary
        expectedCount={expectedCount}
        receivedCount={receivedCount}
      />

      {/* Discrepancy notes (only when missing packages) */}
      {hasMissing && (
        <div className="bg-status-error-bg border border-status-error-border rounded-lg p-4 space-y-2">
          <p className="text-sm font-semibold text-text">
            Reporte de discrepancia
          </p>
          <p className="text-sm text-text-secondary">
            Se detectaron {missingCount} paquetes faltantes. Registre las
            observaciones sobre la pérdida en tránsito.
          </p>
          <Textarea
            placeholder="Describa los paquetes faltantes y posibles causas..."
            value={discrepancyNotes}
            onChange={(e) => setDiscrepancyNotes(e.target.value)}
            rows={3}
            data-testid="discrepancy-notes"
          />
        </div>
      )}

      {/* Confirm button with AlertDialog */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            disabled={completeMutation.isPending}
            className="w-full"
            size="lg"
          >
            {completeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Procesando...
              </>
            ) : (
              'Confirmar recepción'
            )}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Confirmar recepción de carga?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción registrará la transferencia de custodia y no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              Confirmar recepción
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
