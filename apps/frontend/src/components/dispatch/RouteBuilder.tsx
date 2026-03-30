'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/StatusBadge';
import { ScanZone } from './ScanZone';
import { PackageRow } from './PackageRow';
import { RoutePanel } from './RoutePanel';
import { useScanPackage } from '@/hooks/dispatch/useScanPackage';
import { useRoutePackages } from '@/hooks/dispatch/useRoutePackages';
import type { FleetVehicle } from '@/lib/dispatch/types';

interface Props {
  routeId: string;
  operatorId: string;
  vehicles: FleetVehicle[];
}

export function RouteBuilder({ routeId, operatorId, vehicles }: Props) {
  const router = useRouter();
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [driverName, setDriverName] = useState('');
  const [routeClosed, setRouteClosed] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const { data: packages = [], refetch } = useRoutePackages(routeId, operatorId);
  const scanMutation = useScanPackage(routeId);

  const handleScan = async (code: string) => {
    setScanError(null);
    try {
      await scanMutation.mutateAsync(code);
      await refetch();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setScanError(e.message ?? 'Error al escanear');
    }
  };

  const handleRemove = async (dispatchId: string) => {
    await fetch(`/api/dispatch/routes/${routeId}/packages/${dispatchId}`, { method: 'DELETE' });
    await refetch();
  };

  const handleClose = async () => {
    const res = await fetch(`/api/dispatch/routes/${routeId}/close`, { method: 'POST' });
    if (res.ok) { setRouteClosed(true); await refetch(); }
  };

  const handleDispatch = async () => {
    if (!selectedVehicle) return;
    setDispatching(true);
    setDispatchError(null);
    try {
      const res = await fetch(`/api/dispatch/routes/${routeId}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ truck_identifier: selectedVehicle, driver_identifier: driverName || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Error al despachar');
      router.push('/app/dispatch');
    } catch (err: unknown) {
      const e = err as { message?: string };
      setDispatchError(e.message ?? 'Error de DispatchTrack');
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-53px)] overflow-hidden">
      {/* Left panel */}
      <div className="flex-1 flex flex-col overflow-hidden md:border-r border-border">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-5 h-14 bg-surface border-b border-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/app/dispatch')}
            className="text-text-muted"
          >
            <ArrowLeft />
          </Button>
          <span className="font-mono text-[15px] font-bold text-accent">
            {routeId.slice(0, 8).toUpperCase()}
          </span>
          <span className="text-xs text-text-muted">
            {new Date().toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          <StatusBadge
            status={routeClosed ? 'Listo' : 'Borrador'}
            variant={routeClosed ? 'success' : 'neutral'}
            size="sm"
          />
        </div>

        <ScanZone onScan={handleScan} disabled={routeClosed} lastError={scanError} />

        {/* Package count bar */}
        <div className="shrink-0 flex items-center justify-between px-5 h-9 bg-background border-b border-border">
          <span className="text-[11px] text-text-muted uppercase tracking-[0.06em]">
            Paquetes escaneados
          </span>
          <strong className="font-mono text-[13px] text-accent">
            {packages.length}
          </strong>
        </div>

        {/* Package list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {packages.map((pkg, i) => (
            <PackageRow key={pkg.dispatch_id} index={i + 1} pkg={pkg} onRemove={handleRemove} />
          ))}
        </div>
      </div>

      <RoutePanel
        packageCount={packages.length}
        vehicles={vehicles}
        selectedVehicle={selectedVehicle}
        driverName={driverName}
        routeClosed={routeClosed}
        dispatching={dispatching}
        dispatchError={dispatchError}
        onVehicleChange={setSelectedVehicle}
        onDriverChange={setDriverName}
        onClose={handleClose}
        onDispatch={handleDispatch}
        onRetry={handleDispatch}
      />
    </div>
  );
}
