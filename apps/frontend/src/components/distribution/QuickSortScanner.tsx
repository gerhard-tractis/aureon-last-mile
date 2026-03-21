'use client';
import { useRef, useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createSPAClient } from '@/lib/supabase/client';
import {
  determineDockZone,
  type DockZone,
  type ZoneMatchResult,
} from '@/lib/distribution/sectorization-engine';
import { useCreateDockBatch, useCloseDockBatch } from '@/hooks/distribution/useDockBatches';
import { useDockScanMutation } from '@/hooks/distribution/useDockScans';

interface QuickSortScannerProps {
  operatorId: string;
  userId: string;
  zones: DockZone[];
}

type ScanState = 'scan_package' | 'show_destination' | 'scan_anden';

interface PackageInfo {
  id: string;
  label: string;
}

export function QuickSortScanner({ operatorId, userId, zones }: QuickSortScannerProps) {
  const [state, setState] = useState<ScanState>('scan_package');
  const [destination, setDestination] = useState<ZoneMatchResult | null>(null);
  const [currentBatchId, setCurrentBatchId] = useState<string | null>(null);
  const [currentPackage, setCurrentPackage] = useState<PackageInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counter, setCounter] = useState(0);
  const [pkgValue, setPkgValue] = useState('');
  const [andenValue, setAndenValue] = useState('');

  const pkgInputRef = useRef<HTMLInputElement>(null);
  const andenInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (state === 'scan_package') {
      setTimeout(() => pkgInputRef.current?.focus(), 50);
    }
    if (state === 'scan_anden') {
      setTimeout(() => andenInputRef.current?.focus(), 50);
    }
  }, [state]);

  const handlePackageScan = async (barcode: string) => {
    setError(null);
    try {
      const supabase = createSPAClient();
      const { data, error: dbError } = await supabase
        .from('packages')
        .select('id, label, status, order_id, orders!inner(comuna, delivery_date)')
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
        return;
      }

      const pkg = data[0] as {
        id: string;
        label: string;
        status: string;
        order_id: string;
        orders: { comuna: string; delivery_date: string };
      };
      const order = pkg.orders;

      const matchResult = determineDockZone(
        { comuna: order.comuna, delivery_date: order.delivery_date },
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

    if (scannedCode.trim().toUpperCase() !== destination.zone_code.toUpperCase()) {
      setError(`Andén incorrecto — se esperaba ${destination.zone_code}`);
      setAndenValue('');
      return;
    }

    setError(null);

    // Record the scan if we have a package barcode
    if (currentPackage?.label) {
      try {
        await scanMutation.mutateAsync(currentPackage.label);
      } catch {
        // scan mutation failure should not block the flow
      }
    }

    closeBatch.mutate({ id: currentBatchId, operator_id: operatorId });
    setCounter(c => c + 1);
    setDestination(null);
    setCurrentBatchId(null);
    setCurrentPackage(null);
    setPkgValue('');
    setAndenValue('');
    setState('scan_package');
  };

  const handlePkgKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && pkgValue.trim()) {
      e.preventDefault();
      const val = pkgValue.trim();
      setPkgValue('');
      await handlePackageScan(val);
    }
  };

  const handleAndenKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && andenValue.trim()) {
      e.preventDefault();
      const val = andenValue.trim();
      setAndenValue('');
      await handleAndenScan(val);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground font-medium">
        {counter} paquetes sectorizados hoy
      </div>

      {state === 'scan_package' && (
        <div className="space-y-2">
          <p className="font-medium">Escanear paquete</p>
          <Input
            ref={pkgInputRef}
            aria-label="Escanear paquete"
            value={pkgValue}
            placeholder="Escanear paquete..."
            onChange={e => setPkgValue(e.target.value)}
            onKeyDown={handlePkgKeyDown}
            onBlur={() => setTimeout(() => pkgInputRef.current?.focus(), 100)}
            autoComplete="off"
            className="text-lg font-mono"
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
      )}

      {state === 'show_destination' && destination && (
        <div className="space-y-4">
          <div className="text-center space-y-2">
            <p className="text-4xl font-bold">{destination.zone_name}</p>
            <p className="text-2xl font-mono text-muted-foreground">{destination.zone_code}</p>
            {destination.flagged && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800">
                Comuna sin andén asignado — redirigiendo a Consolidación
              </div>
            )}
          </div>
          <Button className="w-full" onClick={() => setState('scan_anden')}>
            Confirmar andén
          </Button>
        </div>
      )}

      {state === 'scan_anden' && destination && (
        <div className="space-y-4">
          <div className="text-center space-y-1">
            <p className="text-4xl font-bold">{destination.zone_name}</p>
            <p className="text-2xl font-mono text-muted-foreground">{destination.zone_code}</p>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-center text-muted-foreground">Escanear andén para confirmar</p>
            <Input
              ref={andenInputRef}
              aria-label="Escanear andén"
              value={andenValue}
              placeholder="Escanear andén..."
              onChange={e => setAndenValue(e.target.value)}
              onKeyDown={handleAndenKeyDown}
              onBlur={() => setTimeout(() => andenInputRef.current?.focus(), 100)}
              autoComplete="off"
              className="text-lg font-mono"
            />
            {error && <p className="text-red-600 text-sm">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
