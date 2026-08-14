'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScanField } from '@/components/scan/ScanField';
import { ScanResult } from '@/components/scan/ScanResult';
import { createSPAClient } from '@/lib/supabase/client';
import {
  determineDockZone,
  type DockZone,
  type ZoneMatchResult,
} from '@/lib/distribution/sectorization-engine';
import { useCreateDockBatch, useCloseDockBatch } from '@/hooks/distribution/useDockBatches';
import { useDockScanMutation } from '@/hooks/distribution/useDockScans';
import { validateDockDestination } from '@/lib/distribution/dock-scan-validator';
import { updateBatchDockZone } from '@/lib/distribution/batch-zone';

export interface QuickSortScanEvent {
  code: string;
  zoneCode: string | null;
  zoneName: string | null;
  at: Date;
  status: 'ok' | 'error';
  /** Populated on error — shown instead of the dock code in the history. */
  reason?: string;
}

interface QuickSortScannerProps {
  operatorId: string;
  userId: string;
  zones: DockZone[];
  /** Feeds the "Últimos escaneos" panel alongside this console. */
  onScanEvent?: (event: QuickSortScanEvent) => void;
}

type ScanState = 'scan_package' | 'show_destination' | 'scan_anden';

interface PackageInfo {
  id: string;
  label: string;
}

export function QuickSortScanner({ operatorId, userId, zones, onScanEvent }: QuickSortScannerProps) {
  const [state, setState] = useState<ScanState>('scan_package');
  const [destination, setDestination] = useState<ZoneMatchResult | null>(null);
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
  const [currentPackage, setCurrentPackage] = useState<PackageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counter, setCounter] = useState(0);

  const createBatch = useCreateDockBatch();
  const closeBatch = useCloseDockBatch();
  const today = new Date().toISOString().split('T')[0];

  // useDockScanMutation requires batchId and zoneId — use current values, fallback to empty string
  const scanMutation = useDockScanMutation(
    operatorId,
    currentBatchId ?? '',
    destination?.zone_id ?? '',
    userId
  );


  const handlePackageScan = async (barcode: string) => {
    setError(null);
    try {
      const supabase = createSPAClient();
      const { data, error: dbError } = await supabase
        .from('packages')
        .select('id, label, status, order_id, orders!inner(comuna_id, delivery_date)')
        .eq('operator_id', operatorId)
        .eq('label', barcode)
        .is('deleted_at', null)
        .limit(1);

      if (dbError) {
        setError('Error de red — intente de nuevo');
        return;
      }

      if (!data || data.length === 0) {
        setError('Código no encontrado');
        onScanEvent?.({
          code: barcode, zoneCode: null, zoneName: null, at: new Date(),
          status: 'error', reason: 'NO ENCONTRADO',
        });
        return;
      }

      const pkg = data[0] as {
        id: string;
        label: string;
        status: string;
        order_id: string;
        orders: { comuna_id: string | null; delivery_date: string };
      };
      const order = pkg.orders;

      const matchResult = determineDockZone(
        { comunaId: order.comuna_id, delivery_date: order.delivery_date },
        zones,
        today
      );

      const batch = await createBatch.mutateAsync({
        operator_id: operatorId,
        dock_zone_id: matchResult.zone_id,
        created_by: userId,
      });

      setCurrentBatchId(batch.id);
      setCurrentPackage({ id: pkg.id, label: pkg.label });
      setDestination(matchResult);
      setState('show_destination');
    } catch {
      setError('Error al procesar — intente de nuevo');
    }
  };

  const handleAndenScan = async (scannedCode: string) => {
    if (!destination || !currentBatchId) return;

    const outcome = validateDockDestination(scannedCode, {
      suggestedZoneCode: destination.zone_code,
      zones,
    });

    if (outcome.kind === 'rejected_wrong_dock') {
      setError(
        `Asignación fallida: andén incorrecto. Esperado ${outcome.expectedCode} o Consolidación.`
      );
      return;
    }

    setError(null);

    // For consolidación redirect, switch the batch's zone first so the trigger
    // routes the package to retenido/consolidación instead of sectorizado.
    if (outcome.kind === 'accepted_consolidation') {
      await updateBatchDockZone({
        batchId: currentBatchId,
        zoneId: outcome.zoneId,
        operatorId,
      });
    }

    if (currentPackage?.label) {
      try {
        await scanMutation.mutateAsync({
          barcode: currentPackage.label,
          ...(outcome.kind === 'accepted_consolidation'
            ? { redirectReason: 'manual_consolidation' as const }
            : {}),
        });
      } catch {
        // scan mutation failure should not block the flow
      }
    }

    closeBatch.mutate({ id: currentBatchId, operator_id: operatorId });
    onScanEvent?.({
      code: currentPackage?.label ?? '',
      zoneCode: destination.zone_code,
      zoneName: destination.zone_name,
      at: new Date(),
      status: 'ok',
    });
    setCounter(c => c + 1);
    setDestination(null);
    setCurrentBatchId(null);
    setCurrentPackage(null);
    setState('scan_package');
  };



  return (
    <div className="flex flex-col gap-3">
      {state === 'scan_package' && (
        <ScanField
          ariaLabel="Escanear paquete"
          onScan={(code) => { void handlePackageScan(code); }}
          helperText="Escanea o escribe el código y presiona Enter"
        />
      )}

      {/* The dock is confirmed by scanning it, not by trusting the suggestion —
          validateDockDestination rejects the wrong one. The mock shows a
          single-step scan; that would drop a real verification step, so the
          two-step flow stays and only its presentation changes. */}
      {state !== 'scan_package' && destination && (
        <>
          <ScanResult
            status="ok"
            title={`ANDÉN ${destination.zone_code} · ${destination.zone_name}`}
            context={currentPackage?.label ?? ''}
            code={destination.zone_code}
          />

          {destination.flagged && (
            <p className="rounded-lg border border-status-warning-border bg-status-warning-bg px-4 py-2.5 text-xs text-status-warning-text">
              Comuna sin andén asignado — redirigiendo a Consolidación
            </p>
          )}

          {state === 'show_destination' ? (
            <Button className="h-11" onClick={() => setState('scan_anden')}>
              Confirmar andén
            </Button>
          ) : (
            <ScanField
              size="md"
              ariaLabel="Escanear andén"
              onScan={(code) => { void handleAndenScan(code); }}
              helperText="Escanea el andén para confirmar"
            />
          )}
        </>
      )}

      {error && (
        <ScanResult status="error" title={error} context={currentPackage?.label} />
      )}

      <p className="font-mono text-[10.5px] uppercase tracking-[.1em] text-text-muted">
        {counter} paquetes sectorizados en esta sesión
      </p>
    </div>
  );
}
