'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
    <div style={{ display: 'flex', height: 'calc(100vh - 53px)', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1.5px solid var(--color-border)' }}>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', height: 56, background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
          <button onClick={() => router.push('/app/dispatch')} style={{ width: 40, height: 40, borderRadius: 8, border: 'none', background: 'var(--color-surface-raised)', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 18 }}>←</button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: 'var(--color-accent)' }}>{routeId.slice(0, 8).toUpperCase()}</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date().toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: routeClosed ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)' : 'var(--color-surface-raised)', color: routeClosed ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
            {routeClosed ? 'Listo' : 'Draft'}
          </span>
        </div>
        <ScanZone onScan={handleScan} disabled={routeClosed} lastError={scanError} />
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', height: 36, background: 'var(--color-background)', borderBottom: '1px solid var(--color-border)' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Paquetes escaneados</span>
          <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-accent)' }}>{packages.length}</strong>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px' }}>
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
